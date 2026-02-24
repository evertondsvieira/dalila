import { getCurrentScope, Scope, withScope } from './scope.js';
import { scheduleMicrotask, isBatching, queueInBatch } from './scheduler.js';
import {
  aliasEffectToNode,
  linkSubscriberSetToSignal,
  registerEffect,
  registerSignal,
  trackDependency,
  trackEffectDispose,
  trackEffectRun,
  trackSignalRead,
  trackSignalWrite,
  untrackDependencyBySet,
} from './devtools.js';

/**
 * Optional global error handler for reactive execution.
 *
 * The runtime keeps running even if an effect/computed throws:
 * - if a handler is registered, we forward errors to it
 * - otherwise we log to the console
 */
let effectErrorHandler: ((error: Error, source: string) => void) | null = null;

/**
 * Register a global error handler for effects/computed invalidations.
 *
 * Use this to report errors without crashing the reactive graph.
 */
export function setEffectErrorHandler(handler: (error: Error, source: string) => void): void {
  effectErrorHandler = handler;
}

/**
 * Normalize unknown throws into Error and route to the global handler (or console).
 */
function reportEffectError(error: unknown, source: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (effectErrorHandler) effectErrorHandler(err, source);
  else console.error(`[Dalila] Error in ${source}:`, err);
}

/**
 * Internal effect function type.
 *
 * - deps: reverse dependency tracking (which subscriber Sets we are registered in)
 * - disposed: prevents future executions and allows idempotent cleanup
 * - sync: marks "run immediately" effects (used by computed invalidation)
 */
type EffectFn = (() => void) & {
  deps?: Set<Set<EffectFn>>;
  disposed?: boolean;
  sync?: boolean;
  queued?: boolean;
  runner?: () => void;
};

/**
 * Currently executing effect for dependency collection.
 * Any signal read while this is set subscribes this effect.
 */
let activeEffect: EffectFn | null = null;

/**
 * Scope associated with the currently executing effect.
 *
 * Best-effort safety:
 * - effects run inside an owning scope
 * - signals only subscribe the active effect if the caller is in the same scope
 */
let activeScope: Scope | null = null;

/**
 * Per-tick dedupe for async effects.
 * Multiple writes in the same tick schedule an effect only once.
 */
/**
 * Schedule an effect with correct semantics:
 * - computed invalidations run synchronously (mark dirty immediately)
 * - normal effects run async (microtask), coalesced/deduped per tick
 * - inside batch(): queue into the batch queue to flush once
 */
function scheduleEffect(eff: EffectFn): void {
  if (eff.disposed) return;

  // Computed invalidation: run immediately so computed becomes dirty synchronously.
  if (eff.sync) {
    try {
      eff();
    } catch (error) {
      reportEffectError(error, 'computed');
    }
    return;
  }

  if (eff.queued) return;
  eff.queued = true;

  if (!eff.runner) {
    eff.runner = () => {
      eff.queued = false;
      if (eff.disposed) return;

      try {
        eff();
      } catch (error) {
        reportEffectError(error, 'effect');
      }
    };
  }

  // During batch: defer scheduling into the batch queue (no microtask overhead).
  // Outside batch: schedule in a microtask (coalescing across multiple writes).
  if (isBatching()) queueInBatch(eff.runner);
  else scheduleMicrotask(eff.runner, { priority: 'medium' });
}

function trySubscribeActiveEffect(
  subscribers: Set<EffectFn>,
  signalRef: object
): void {
  if (!activeEffect || activeEffect.disposed) return;

  if (activeScope) {
    const current = getCurrentScope();
    if (activeScope !== current) return;
  }

  if (subscribers.has(activeEffect)) return;

  subscribers.add(activeEffect);
  (activeEffect.deps ??= new Set()).add(subscribers);
  trackDependency(signalRef, activeEffect);
}

export interface Signal<T> {
  /** Read the current value (with dependency tracking if inside an effect). */
  (): T;
  /** Set a new value and notify subscribers. */
  set(value: T): void;
  /** Update the value using a function. */
  update(fn: (v: T) => T): void;
  /** Read the current value without creating a dependency (no tracking). */
  peek(): T;
  /** Subscribe to value changes manually (outside of effects). Returns unsubscribe function. */
  on(callback: (value: T) => void): () => void;
}

export interface ReadonlySignal<T> {
  /** Read the current value (with dependency tracking if inside an effect). */
  (): T;
  /** Read the current value without creating a dependency (no tracking). */
  peek(): T;
  /** Subscribe to value changes manually (outside of effects). Returns unsubscribe function. */
  on(callback: (value: T) => void): () => void;
}

export interface DebounceSignalOptions {
  /** Emit immediately on the first update in a burst. Default: false */
  leading?: boolean;
  /** Emit the latest value when the burst settles. Default: true */
  trailing?: boolean;
}

export interface ThrottleSignalOptions {
  /** Emit immediately when entering a throttle window. Default: true */
  leading?: boolean;
  /** Emit the latest buffered value at the end of a throttle window. Default: true */
  trailing?: boolean;
}

/**
 * Create a signal: a mutable value with automatic dependency tracking.
 *
 * Reads:
 * - if there is an active effect, subscribe it (dynamic deps supported)
 *
 * Writes:
 * - update the value immediately
 * - notify subscribers (immediately, or deferred via batch queue)
 *
 * Lifecycle:
 * - effects remove themselves from subscriber sets on re-run and on dispose
 * - signals do not "own" subscriber lifetimes; they only maintain the set
 */
export function signal<T>(initialValue: T): Signal<T> {
  const owningScope = getCurrentScope();
  let value = initialValue;
  const subscribers = new Set<EffectFn>();
  let signalRef: object;

  const read = () => {
    trackSignalRead(signalRef);
    trySubscribeActiveEffect(subscribers, signalRef);

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
    trackSignalWrite(signalRef, nextValue);

    // Notify now, or defer into the batch queue.
    if (isBatching()) queueInBatch(notify);
    else notify();
  };

  read.update = (fn: (v: T) => T) => {
    read.set(fn(value));
  };

  read.peek = () => value;

  read.on = (callback: (value: T) => void): (() => void) => {
    // Create a lightweight effect-like subscriber for manual subscriptions
    const subscriber: EffectFn = (() => {
      if (subscriber.disposed) return;
      callback(value);
    }) as EffectFn;

    subscriber.disposed = false;

    subscribers.add(subscriber);
    (subscriber.deps ??= new Set()).add(subscribers);

    // Return unsubscribe function
    return () => {
      if (subscriber.disposed) return;
      subscriber.disposed = true;
      subscribers.delete(subscriber);
      subscriber.deps?.delete(subscribers);
    };
  };

  signalRef = read as unknown as object;
  registerSignal(signalRef, 'signal', {
    scopeRef: owningScope,
    initialValue,
  });
  linkSubscriberSetToSignal(subscribers, signalRef);

  return read as Signal<T>;
}

/**
 * Create a read-only view over a signal.
 *
 * Type-level:
 * - hides `set` and `update` from the public contract
 *
 * Runtime:
 * - defensive guards throw if mutating methods are accessed via casts
 */
export function readonly<T>(source: Signal<T>): ReadonlySignal<T> {
  const read = (() => source()) as ReadonlySignal<T> & {
    set?: (value: T) => void;
    update?: (fn: (v: T) => T) => void;
  };

  read.peek = () => source.peek();
  read.on = (callback: (value: T) => void) => source.on(callback);

  const throwReadonlyMutationError = () => {
    throw new Error('Cannot mutate a readonly signal.');
  };

  // Runtime guard against trivial casts to mutable signal-like shape.
  Object.defineProperty(read, 'set', {
    value: throwReadonlyMutationError,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  Object.defineProperty(read, 'update', {
    value: throwReadonlyMutationError,
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return read;
}

function assertTimingOptions(
  waitMs: number,
  leading: boolean,
  trailing: boolean,
  kind: 'debounceSignal' | 'throttleSignal'
): void {
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error(`${kind}: waitMs must be a non-negative finite number.`);
  }
  if (!leading && !trailing) {
    throw new Error(`${kind}: at least one of { leading, trailing } must be true.`);
  }
}

/**
 * Create a debounced read-only signal derived from a source signal.
 *
 * Default semantics:
 * - leading: false
 * - trailing: true
 */
export function debounceSignal<T>(
  source: ReadonlySignal<T>,
  waitMs: number,
  options: DebounceSignalOptions = {}
): ReadonlySignal<T> {
  const leading = options.leading ?? false;
  const trailing = options.trailing ?? true;
  assertTimingOptions(waitMs, leading, trailing, 'debounceSignal');

  const out = signal(source.peek());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let latest = out.peek();
  let lastSourceValue = latest;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const startTimer = () => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (trailing && pending) out.set(latest);
      pending = false;
    }, waitMs);
  };

  const stopEffect = effect(() => {
    const next = source();
    if (Object.is(next, lastSourceValue)) return;
    lastSourceValue = next;
    latest = next;

    // First update in burst can emit immediately.
    if (!timer && leading) {
      out.set(next);
      pending = false;
      startTimer();
      return;
    }

    pending = true;
    startTimer();
  });

  const dispose = () => {
    clearTimer();
    pending = false;
    stopEffect();
  };

  const owningScope = getCurrentScope();
  if (owningScope) owningScope.onCleanup(dispose);

  return readonly(out);
}

/**
 * Create a throttled read-only signal derived from a source signal.
 *
 * Default semantics:
 * - leading: true
 * - trailing: true
 */
export function throttleSignal<T>(
  source: ReadonlySignal<T>,
  waitMs: number,
  options: ThrottleSignalOptions = {}
): ReadonlySignal<T> {
  const leading = options.leading ?? true;
  const trailing = options.trailing ?? true;
  assertTimingOptions(waitMs, leading, trailing, 'throttleSignal');

  const out = signal(source.peek());
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pendingValue = out.peek();
  let lastSourceValue = pendingValue;

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };

  const startWindow = () => {
    timer = setTimeout(() => {
      timer = null;
      if (trailing && hasPending) {
        hasPending = false;
        out.set(pendingValue);
        startWindow();
        return;
      }
      hasPending = false;
    }, waitMs);
  };

  const stopEffect = effect(() => {
    const next = source();
    if (Object.is(next, lastSourceValue)) return;
    lastSourceValue = next;

    if (!timer) {
      if (leading) out.set(next);
      else if (trailing) {
        pendingValue = next;
        hasPending = true;
      }
      startWindow();
      return;
    }

    if (trailing) {
      pendingValue = next;
      hasPending = true;
    }
  });

  const dispose = () => {
    clearTimer();
    hasPending = false;
    stopEffect();
  };

  const owningScope = getCurrentScope();
  if (owningScope) owningScope.onCleanup(dispose);

  return readonly(out);
}

/**
 * Create an effect: reruns `fn` whenever any tracked signal changes.
 *
 * Scheduling:
 * - the initial run is scheduled (microtask) to coalesce multiple writes
 *
 * Dependency tracking:
 * - before each run, the effect unsubscribes from previous dependencies
 * - during the run, reads resubscribe to the new dependencies (dynamic deps)
 *
 * Scope:
 * - if created inside a scope, the effect runs inside that scope
 * - the effect is disposed automatically when the scope disposes
 */
export function effect(fn: () => void): () => void {
  const owningScope = getCurrentScope();

  const cleanupDeps = () => {
    if (!run.deps) return;
    for (const depSet of run.deps) {
      depSet.delete(run);
      untrackDependencyBySet(depSet, run);
    }
    run.deps.clear();
  };

  const dispose = () => {
    if (run.disposed) return;
    run.disposed = true;
    cleanupDeps();
    run.queued = false;
    trackEffectDispose(run);
  };

  const run: EffectFn = (() => {
    if (run.disposed) return;
    trackEffectRun(run);

    // Dynamic deps: unsubscribe from previous reads.
    cleanupDeps();

    const prevEffect = activeEffect;
    const prevScope = activeScope;

    activeEffect = run;
    activeScope = owningScope ?? null;

    try {
      // Run inside owning scope so resources created by the effect are scoped.
      if (owningScope) withScope(owningScope, fn);
      else fn();
    } finally {
      activeEffect = prevEffect;
      activeScope = prevScope;
    }
  }) as EffectFn;

  registerEffect(run, 'effect', owningScope);
  scheduleEffect(run);
  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}

/**
 * Create a computed signal (derived, cached, read-only).
 *
 * Semantics:
 * - lazy: computes on first read
 * - cached: returns the cached value until invalidated
 * - synchronous invalidation: dependencies mark it dirty immediately
 *
 * Dependency tracking:
 * - while computing, we collect dependencies into an internal "markDirty" effect
 * - those dependencies will synchronously mark this computed as dirty on change
 *
 * Subscription:
 * - other effects can subscribe to the computed like a normal signal
 */
export function computed<T>(fn: () => T): Signal<T> {
  const owningScope = getCurrentScope();
  let value: T;
  let dirty = true;

  const subscribers = new Set<EffectFn>();
  let signalRef: object;

  // Dep sets that `markDirty` is currently registered in (so we can unsubscribe on recompute).
  let trackedDeps = new Set<Set<EffectFn>>();

  /**
   * Internal invalidator.
   * Runs synchronously when any dependency changes.
   */
  const markDirty: EffectFn = (() => {
    if (dirty) return;
    dirty = true;
    for (const eff of subscribers) scheduleEffect(eff);
  }) as EffectFn;

  markDirty.disposed = false;
  markDirty.sync = true;

  const cleanupDeps = () => {
    for (const depSet of trackedDeps) {
      depSet.delete(markDirty);
      untrackDependencyBySet(depSet, markDirty);
    }
    trackedDeps.clear();
    if (markDirty.deps) markDirty.deps.clear();
  };

  const read = (): T => {
    trackSignalRead(signalRef);

    // Allow effects to subscribe to this computed (same rules as signal()).
    trySubscribeActiveEffect(subscribers, signalRef);

    if (dirty) {
      cleanupDeps();

      const prevEffect = activeEffect;
      const prevScope = activeScope;

      // Collect deps into markDirty.
      activeEffect = markDirty;

      // During dependency collection for computed:
      // - we want to subscribe to its dependencies regardless of the caller scope.
      // - the computed's deps belong to the computed itself, not to whoever read it.
      activeScope = null;

      try {
        value = fn();
        dirty = false;

        // Snapshot the current dep sets for later unsubscription.
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

  read.peek = () => {
    // For computed, peek still needs to compute if dirty, but without tracking
    if (dirty) {
      cleanupDeps();

      const prevEffect = activeEffect;
      const prevScope = activeScope;

      activeEffect = markDirty;
      activeScope = null;

      try {
        value = fn();
        dirty = false;

        if (markDirty.deps) trackedDeps = new Set(markDirty.deps);
      } finally {
        activeEffect = prevEffect;
        activeScope = prevScope;
      }
    }
    return value;
  };

  read.on = (callback: (value: T) => void): (() => void) => {
    const subscriber: EffectFn = (() => {
      if (subscriber.disposed) return;
      // For computed, we need to get the latest value
      callback(read.peek());
    }) as EffectFn;

    subscriber.disposed = false;

    subscribers.add(subscriber);
    (subscriber.deps ??= new Set()).add(subscribers);

    return () => {
      if (subscriber.disposed) return;
      subscriber.disposed = true;
      subscribers.delete(subscriber);
      subscriber.deps?.delete(subscribers);
    };
  };

  signalRef = read as unknown as object;
  registerSignal(signalRef, 'computed', {
    scopeRef: owningScope,
  });
  linkSubscriberSetToSignal(subscribers, signalRef);
  aliasEffectToNode(markDirty, signalRef);
  registerEffect(markDirty, 'effect', owningScope);

  return read as Signal<T>;
}

/**
 * Async effect with cancellation.
 *
 * Semantics:
 * - provides an AbortSignal to the callback
 * - on re-run, aborts the previous run before starting the next
 * - when disposed, aborts the current run and stops future scheduling
 */
export function effectAsync(fn: (signal: AbortSignal) => void): () => void {
  const owningScope = getCurrentScope();
  let controller: AbortController | null = null;

  const cleanupDeps = () => {
    if (!run.deps) return;
    for (const depSet of run.deps) {
      depSet.delete(run);
      untrackDependencyBySet(depSet, run);
    }
    run.deps.clear();
  };

  const dispose = () => {
    if (run.disposed) return;
    run.disposed = true;

    controller?.abort();
    controller = null;

    cleanupDeps();
    run.queued = false;
    trackEffectDispose(run);
  };

  const run: EffectFn = (() => {
    if (run.disposed) return;
    trackEffectRun(run);

    // Abort previous run (if any), then create a new controller for this run.
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

  registerEffect(run, 'effectAsync', owningScope);
  scheduleEffect(run);
  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}

/**
 * Run a function without tracking any signal reads as dependencies.
 *
 * Use this inside an effect when you want to read a signal's value
 * without creating a dependency on it.
 *
 * Example:
 * ```ts
 * effect(() => {
 *   const tracked = count();        // This read is tracked
 *   const untracked = untrack(() => other()); // This read is NOT tracked
 * });
 * ```
 */
export function untrack<T>(fn: () => T): T {
  const prevEffect = activeEffect;
  const prevScope = activeScope;

  activeEffect = null;
  activeScope = null;

  try {
    return fn();
  } finally {
    activeEffect = prevEffect;
    activeScope = prevScope;
  }
}
