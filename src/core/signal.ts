import { getCurrentScope, Scope, withScope } from './scope.js';
import { scheduleMicrotask, isBatching, queueInBatch } from './scheduler.js';

/**
 * Optional global error handler for effect execution.
 *
 * Dalila keeps the reactive system alive even if an effect throws.
 * If no handler is set, errors are logged to the console.
 */
let effectErrorHandler: ((error: Error, source: string) => void) | null = null;

/**
 * Sets a global error handler for effects/computed invalidations.
 *
 * @example
 * setEffectErrorHandler((err, src) => report(err, { source: src }));
 */
export function setEffectErrorHandler(handler: (error: Error, source: string) => void): void {
  effectErrorHandler = handler;
}

/** Normalizes unknown throws and routes them to the global handler (or console). */
function reportEffectError(error: unknown, source: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (effectErrorHandler) effectErrorHandler(err, source);
  else console.error(`[Dalila] Error in ${source}:`, err);
}

type EffectFn = (() => void) & {
  /**
   * Reverse dependency tracking:
   * we store the subscriber Set(s) this effect is registered in so we can
   * unsubscribe on re-run (dynamic deps) and on dispose.
   */
  deps?: Set<Set<EffectFn>>;

  /** When true, this effect must never execute again. */
  disposed?: boolean;

  /**
   * Synchronous scheduling flag.
   * Used by computed invalidation: mark dirty immediately when deps change.
   */
  sync?: boolean;
};

/**
 * Currently executing effect (dependency collector).
 * Signals read while this is set will subscribe this effect.
 */
let activeEffect: EffectFn | null = null;

/**
 * Scope associated with the currently executing effect.
 *
 * Best-effort guard: avoid cross-scope subscriptions by only subscribing when
 * the current scope matches the effect's owning scope (or when there is no owning scope).
 */
let activeScope: Scope | null = null;

/**
 * Dedup set for scheduled effects.
 * Multiple signal writes in the same tick will only enqueue an effect once.
 */
const pendingEffects = new Set<EffectFn>();

/**
 * Stable runner per effect (function identity).
 *
 * Important for `batch()`:
 * - during a batch we enqueue runner functions into the batch queue
 * - dedupe is done by function identity
 * - so each effect needs a stable runner function
 */
const effectRunners = new WeakMap<EffectFn, () => void>();

/**
 * Schedules an effect respecting:
 * - computed invalidations run synchronously
 * - regular effects run async (microtask), deduped per tick
 * - during `batch()`, we enqueue into the batch queue (which flushes once per frame)
 */
function scheduleEffect(eff: EffectFn): void {
  if (eff.disposed) return;

  // Computed invalidation: run immediately so computed is marked dirty ASAP.
  if (eff.sync) {
    try {
      eff();
    } catch (error) {
      reportEffectError(error, 'computed');
    }
    return;
  }

  // Dedup before scheduling.
  if (pendingEffects.has(eff)) return;
  pendingEffects.add(eff);

  // Create / reuse stable runner (so batch dedupe works correctly).
  let runEffect = effectRunners.get(eff);
  if (!runEffect) {
    runEffect = () => {
      pendingEffects.delete(eff);
      if (eff.disposed) return;

      try {
        eff();
      } catch (error) {
        reportEffectError(error, 'effect');
      }
    };
    effectRunners.set(eff, runEffect);
  }

  // During batch: defer scheduling into the batch queue (no microtask overhead).
  // Outside batch: schedule in a microtask (coalescing across multiple writes).
  if (isBatching()) queueInBatch(runEffect);
  else scheduleMicrotask(runEffect);
}

export interface Signal<T> {
  (): T;
  set(value: T): void;
  update(fn: (v: T) => T): void;
}

/**
 * Creates a signal: a mutable value with automatic dependency tracking.
 *
 * Reads inside effects subscribe the effect.
 * Writes notify subscribers, with optional deferral when inside `batch()`.
 */
export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const subscribers = new Set<EffectFn>();
  const owningScope = getCurrentScope();

  const read = () => {
    if (activeEffect && !activeEffect.disposed) {
      const current = getCurrentScope();

      // Scope-aware subscription guard (best effort).
      if (!activeScope || activeScope === current) {
        if (!subscribers.has(activeEffect)) {
          subscribers.add(activeEffect);
          (activeEffect.deps ??= new Set()).add(subscribers);
        }
      }
    }

    return value;
  };

  const notify = () => {
    for (const eff of subscribers) scheduleEffect(eff);
  };

  read.set = (nextValue: T) => {
    // No-op on identical values.
    if (Object.is(value, nextValue)) return;

    // State updates are immediate even inside `batch()`.
    value = nextValue;

    // Notify now, or defer into the batch queue.
    if (isBatching()) queueInBatch(notify);
    else notify();
  };

  read.update = (fn: (v: T) => T) => {
    read.set(fn(value));
  };

  // If the signal was created inside a scope, drop subscribers when the scope ends.
  if (owningScope) {
    owningScope.onCleanup(() => {
      subscribers.clear();
    });
  }

  return read as Signal<T>;
}

/**
 * Creates an effect: reruns `fn` whenever any tracked signal changes.
 *
 * Notes:
 * - First run is scheduled (microtask) to coalesce multiple writes.
 * - Dependency sets are cleared before each run (dynamic dependency tracking).
 * - If created inside a scope, the effect is disposed automatically on scope cleanup.
 */
export function effect(fn: () => void): () => void {
  const owningScope = getCurrentScope();

  const cleanupDeps = () => {
    if (!run.deps) return;
    for (const depSet of run.deps) depSet.delete(run);
    run.deps.clear();
  };

  const dispose = () => {
    if (run.disposed) return;
    run.disposed = true;
    cleanupDeps();
    pendingEffects.delete(run);
  };

  const run: EffectFn = (() => {
    if (run.disposed) return;

    // Dynamic deps: unsubscribe from previous reads.
    cleanupDeps();

    const prevEffect = activeEffect;
    const prevScope = activeScope;

    activeEffect = run;
    activeScope = owningScope ?? null;

    try {
      // Run inside owning scope so any resources created by the effect are scoped.
      if (owningScope) withScope(owningScope, fn);
      else fn();
    } finally {
      activeEffect = prevEffect;
      activeScope = prevScope;
    }
  }) as EffectFn;

  scheduleEffect(run);
  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}

/**
 * Creates a computed signal.
 *
 * - Lazy: computes on first read.
 * - Cached: returns cached value until invalidated by a dependency change.
 * - Consistent: invalidation is synchronous, so immediate reads after writes
 *   recompute the latest value.
 *
 * Computed signals are read-only.
 */
export function computed<T>(fn: () => T): Signal<T> {
  let value: T;
  let dirty = true;

  const subscribers = new Set<EffectFn>();
  const owningScope = getCurrentScope();

  // Track which deps we subscribed to so we can unsubscribe when re-tracking.
  let trackedDeps = new Set<Set<EffectFn>>();

  /**
   * Synchronous invalidator:
   * When any dependency changes, mark dirty immediately and notify subscribers.
   */
  const markDirty: EffectFn = (() => {
    if (dirty) return;
    dirty = true;
    for (const eff of subscribers) scheduleEffect(eff);
  }) as EffectFn;

  markDirty.disposed = false;
  markDirty.sync = true;

  const cleanupDeps = () => {
    for (const depSet of trackedDeps) depSet.delete(markDirty);
    trackedDeps.clear();
    if (markDirty.deps) markDirty.deps.clear();
  };

  const read = (): T => {
    // Allow effects to subscribe to this computed.
    if (activeEffect && !activeEffect.disposed) {
      const current = getCurrentScope();
      if (!activeScope || activeScope === current) {
        if (!subscribers.has(activeEffect)) {
          subscribers.add(activeEffect);
          (activeEffect.deps ??= new Set()).add(subscribers);
        }
      }
    }

    if (dirty) {
      cleanupDeps();

      const prevEffect = activeEffect;
      const prevScope = activeScope;

      // Collect deps into markDirty.
      activeEffect = markDirty;
      activeScope = owningScope ?? null;

      try {
        value = fn();
        dirty = false;

        // Save subscribed dep sets so we can unsubscribe on next recompute.
        if (markDirty.deps) trackedDeps = new Set(markDirty.deps);
      } finally {
        activeEffect = prevEffect;
        activeScope = prevScope;
      }
    }

    return value;
  };

  read.set = () => {
    throw new Error('Cannot set a computed signal directly. Computed signals are derived from other signals.');
  };

  read.update = () => {
    throw new Error('Cannot update a computed signal directly. Computed signals are derived from other signals.');
  };

  if (owningScope) {
    owningScope.onCleanup(() => {
      markDirty.disposed = true;
      cleanupDeps();
      subscribers.clear();
    });
  }

  return read as Signal<T>;
}

/**
 * Async effect with cancellation.
 *
 * Semantics:
 * - Runs like a normal effect, but provides an AbortSignal to the callback.
 * - On re-run, the previous run is aborted before starting the next.
 * - If created inside a scope, it's aborted + disposed on scope cleanup.
 */
export function effectAsync(fn: (signal: AbortSignal) => void): () => void {
  const owningScope = getCurrentScope();
  let controller: AbortController | null = null;

  const cleanupDeps = () => {
    if (!run.deps) return;
    for (const depSet of run.deps) depSet.delete(run);
    run.deps.clear();
  };

  const dispose = () => {
    if (run.disposed) return;
    run.disposed = true;

    controller?.abort();
    controller = null;

    cleanupDeps();
    pendingEffects.delete(run);
  };

  const run: EffectFn = (() => {
    if (run.disposed) return;

    // Abort the previous run (if any), then create a new signal for this run.
    controller?.abort();
    controller = new AbortController();

    cleanupDeps();

    const prevEffect = activeEffect;
    const prevScope = activeScope;

    activeEffect = run;
    activeScope = owningScope ?? null;

    try {
      const exec = () => fn(controller!.signal);
      if (owningScope) withScope(owningScope, exec);
      else exec();
    } finally {
      activeEffect = prevEffect;
      activeScope = prevScope;
    }
  }) as EffectFn;

  scheduleEffect(run);
  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}
