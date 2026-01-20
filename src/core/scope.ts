/**
 * A Scope is a simple lifecycle container.
 * Anything registered via `onCleanup` will run when `dispose()` is called.
 *
 * This is the foundation for "automatic cleanup" in Dalila:
 * - effects can be disposed when a view/controller scope ends
 * - event listeners / timers / abort controllers can be tied to scope lifetime
 */
export interface Scope {
  /** Register a cleanup callback to run when the scope is disposed. */
  onCleanup(fn: () => void): void;

  /** Dispose the scope and run all registered cleanups. */
  dispose(): void;
}

/**
 * Creates a new Scope instance.
 *
 * Notes:
 * - Cleanups run in FIFO order (registration order).
 * - If a cleanup registers another cleanup during disposal, it will NOT run
 *   in the same dispose pass (because we snapshot via `splice(0)`).
 */
export function createScope(): Scope {
  const cleanups: (() => void)[] = [];

  return {
    onCleanup(fn: () => void) {
      cleanups.push(fn);
    },
    dispose() {
      // Snapshot and clear, then run.
      for (const fn of cleanups.splice(0)) fn();
    },
  };
}

/**
 * The currently active scope for the running code path.
 * This is set by `withScope()` and read by reactive primitives.
 */
let currentScope: Scope | null = null;

/** Returns the current active scope (or null if none). */
export function getCurrentScope(): Scope | null {
  return currentScope;
}

/**
 * Sets the current active scope.
 * Prefer using `withScope()` unless you are implementing low-level internals.
 */
export function setCurrentScope(scope: Scope | null): void {
  currentScope = scope;
}

/**
 * Runs a function with the given scope set as current, then restores the previous scope.
 *
 * This enables scope-aware primitives:
 * - `signal()` can register cleanup in the current scope
 * - `effect()` can auto-dispose when the scope ends
 */
export function withScope<T>(scope: Scope, fn: () => T): T {
  const prevScope = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = prevScope;
  }
}
