import { getCurrentScope, Scope, withScope } from './scope.js';
import { scheduleMicrotask, isBatching, queueInBatch } from './scheduler.js';

type EffectFn = (() => void) & {
  /**
   * Reverse-dependency tracking:
   * We store the subscriber Set(s) this effect is registered in,
   * so we can unsubscribe correctly on re-run and dispose.
   */
  deps?: Set<Set<EffectFn>>;

  /** If disposed, the effect must never run again. */
  disposed?: boolean;
};

/**
 * Currently running effect (if any).
 * Signals read while this is set will subscribe the effect automatically.
 */
let activeEffect: EffectFn | null = null;

/**
 * Scope associated with the currently running effect.
 * Signals can use this to prevent cross-scope subscriptions (best-effort).
 */
let activeScope: Scope | null = null;

/**
 * Effect scheduling dedupe:
 * If many signals schedule the same effect before the microtask flush,
 * enqueue it once.
 */
const pendingEffects = new Set<EffectFn>();

function scheduleEffect(eff: EffectFn): void {
  if (eff.disposed) return;
  if (pendingEffects.has(eff)) return;

  pendingEffects.add(eff);

  scheduleMicrotask(() => {
    pendingEffects.delete(eff);
    if (!eff.disposed) eff();
  });
}

export interface Signal<T> {
  (): T;
  set(value: T): void;
  update(fn: (v: T) => T): void;
}

export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const subscribers = new Set<EffectFn>();
  const owningScope = getCurrentScope();

  const read = () => {
    // Track dependency if we're inside an active effect.
    if (activeEffect && !activeEffect.disposed) {
      // Scope-aware subscription guard.
      const current = getCurrentScope();
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

  const applySet = (nextValue: T) => {
    if (Object.is(value, nextValue)) return;
    value = nextValue;
    notify();
  };

  read.set = (nextValue: T) => {
    if (isBatching()) {
      queueInBatch(() => applySet(nextValue));
      return;
    }
    applySet(nextValue);
  };

  read.update = (fn: (v: T) => T) => {
    read.set(fn(value));
  };

  if (owningScope) {
    owningScope.onCleanup(() => {
      // Drop subscribers when the signal's owner scope ends.
      subscribers.clear();
    });
  }

  return read as Signal<T>;
}

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

    // Dynamic dependency tracking: clear old deps before collecting new ones.
    cleanupDeps();

    const prevEffect = activeEffect;
    const prevScope = activeScope;

    activeEffect = run;
    activeScope = owningScope ?? null;

    try {
      // If the effect was created inside a scope, execute it within that scope.
      // This keeps scope-aware dependency tracking consistent across scheduled runs.
      if (owningScope) {
        withScope(owningScope, fn);
      } else {
        fn();
      }
    } finally {
      activeEffect = prevEffect;
      activeScope = prevScope;
    }
  }) as EffectFn;

  // First run is scheduled (coalescing behavior).
  scheduleEffect(run);

  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}

export function computed<T>(fn: () => T): Signal<T> {
  // Sync initial value for better DX.
  const computedSignal = signal<T>(fn());

  effect(() => {
    computedSignal.set(fn());
  });

  return computedSignal;
}

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

    if (controller) {
      controller.abort();
      controller = null;
    }

    cleanupDeps();
    pendingEffects.delete(run);
  };

  const run: EffectFn = (() => {
    if (run.disposed) return;

    // Abort previous async job on re-run.
    if (controller) controller.abort();
    controller = new AbortController();

    cleanupDeps();

    const prevEffect = activeEffect;
    const prevScope = activeScope;

    activeEffect = run;
    activeScope = owningScope ?? null;

    try {
      const exec = () => fn(controller!.signal);

      // Execute within the owning scope to keep scope-aware dependency tracking consistent.
      if (owningScope) {
        withScope(owningScope, exec);
      } else {
        exec();
      }
    } finally {
      activeEffect = prevEffect;
      activeScope = prevScope;
    }
  }) as EffectFn;

  scheduleEffect(run);

  if (owningScope) owningScope.onCleanup(dispose);

  return dispose;
}
