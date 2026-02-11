import { disposeScope, registerScope } from "./devtools.js";

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

  /** Parent scope in the hierarchy (for context lookup). */
  readonly parent: Scope | null;
}

/** Tracks disposed scopes without mutating the public interface. */
const disposedScopes = new WeakSet<Scope>();

const scopeCreateListeners = new Set<(scope: Scope) => void>();
const scopeDisposeListeners = new Set<(scope: Scope) => void>();

/**
 * Subscribe to scope creation events.
 * Returns an unsubscribe function.
 */
export function onScopeCreate(fn: (scope: Scope) => void): () => void {
  scopeCreateListeners.add(fn);
  return () => scopeCreateListeners.delete(fn);
}

/**
 * Subscribe to scope disposal events.
 * Returns an unsubscribe function.
 */
export function onScopeDispose(fn: (scope: Scope) => void): () => void {
  scopeDisposeListeners.add(fn);
  return () => scopeDisposeListeners.delete(fn);
}

/** Returns true if the given scope has been disposed. */
export function isScopeDisposed(scope: Scope): boolean {
  return disposedScopes.has(scope);
}

/**
 * Creates a new Scope instance.
 *
 * Notes:
 * - Cleanups run in FIFO order (registration order).
 * - If a cleanup registers another cleanup during disposal, it will NOT run
 *   in the same dispose pass (because we snapshot via `splice(0)`).
 * - Parent is captured from the current scope context (set by withScope).
 */
export function createScope(parentOverride?: Scope | null): Scope {
  const cleanups: (() => void)[] = [];
  const parentCandidate =
    parentOverride === undefined ? currentScope : parentOverride === null ? null : parentOverride;
  // A stale async context can leave `currentScope` pointing to an already
  // disposed scope; in that case we create a detached scope instead.
  const parent = parentCandidate && isScopeDisposed(parentCandidate)
    ? null
    : parentCandidate;

  const runCleanupSafely = (fn: () => void): unknown | undefined => {
    try {
      fn();
      return undefined;
    } catch (err) {
      return err;
    }
  };

  const scope: Scope = {
    onCleanup(fn: () => void) {
      if (isScopeDisposed(scope)) {
        const error = runCleanupSafely(fn);
        if (error) {
          console.error('[Dalila] cleanup registered after dispose() threw:', error);
        }
        return;
      }
      cleanups.push(fn);
    },
    dispose() {
      if (isScopeDisposed(scope)) return;
      disposedScopes.add(scope);

      const snapshot = cleanups.splice(0);
      const errors: unknown[] = [];

      for (const fn of snapshot) {
        const error = runCleanupSafely(fn);
        if (error) errors.push(error);
      }

      if (errors.length > 0) {
        console.error('[Dalila] scope.dispose() had cleanup errors:', errors);
      }
      disposeScope(scope);
      for (const listener of scopeDisposeListeners) {
        try {
          listener(scope);
        } catch (err) {
          console.error('[Dalila] scope.dispose() listener threw:', err);
        }
      }
    },
    parent,
  };

  registerScope(scope, parent);

  if (parent) {
    parent.onCleanup(() => scope.dispose());
  }

  for (const listener of scopeCreateListeners) {
    try {
      listener(scope);
    } catch (err) {
      console.error('[Dalila] scope.create() listener threw:', err);
    }
  }

  return scope;
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
 * Returns the current scope hierarchy, from current scope up to the root.
 */
export function getCurrentScopeHierarchy(): Scope[] {
  const scopes: Scope[] = [];
  let current = currentScope;
  while (current) {
    scopes.push(current);
    current = current.parent;
  }
  return scopes;
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
  if (isScopeDisposed(scope)) {
    throw new Error('[Dalila] withScope() cannot enter a disposed scope.');
  }
  const prevScope = currentScope;
  currentScope = scope;
  try {
    return fn();
  } finally {
    currentScope = prevScope;
  }
}

/**
 * Async version of withScope that properly maintains scope during await.
 *
 * IMPORTANT: Use this instead of withScope when fn is async, because
 * withScope() restores the previous scope immediately when the Promise
 * is returned, not when it resolves. This means anything created after
 * an await would not be in the scope.
 *
 * Example:
 * ```ts
 * await withScopeAsync(scope, async () => {
 *   await fetch(...);
 *   const sig = signal(0);  // ← This will be in scope
 * });
 * ```
 */
export async function withScopeAsync<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  if (isScopeDisposed(scope)) {
    throw new Error('[Dalila] withScopeAsync() cannot enter a disposed scope.');
  }
  const prevScope = currentScope;
  currentScope = scope;
  try {
    return await fn();
  } finally {
    currentScope = prevScope;
  }
}
