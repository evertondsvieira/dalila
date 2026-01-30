/** Tracks disposed scopes without mutating the public interface. */
const disposedScopes = new WeakSet();
const scopeCreateListeners = new Set();
const scopeDisposeListeners = new Set();
/**
 * Subscribe to scope creation events.
 * Returns an unsubscribe function.
 */
export function onScopeCreate(fn) {
    scopeCreateListeners.add(fn);
    return () => scopeCreateListeners.delete(fn);
}
/**
 * Subscribe to scope disposal events.
 * Returns an unsubscribe function.
 */
export function onScopeDispose(fn) {
    scopeDisposeListeners.add(fn);
    return () => scopeDisposeListeners.delete(fn);
}
/** Returns true if the given scope has been disposed. */
export function isScopeDisposed(scope) {
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
export function createScope(parentOverride) {
    const cleanups = [];
    const parent = parentOverride === undefined ? currentScope : parentOverride === null ? null : parentOverride;
    const runCleanupSafely = (fn) => {
        try {
            fn();
            return undefined;
        }
        catch (err) {
            return err;
        }
    };
    const scope = {
        onCleanup(fn) {
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
            if (isScopeDisposed(scope))
                return;
            disposedScopes.add(scope);
            const snapshot = cleanups.splice(0);
            const errors = [];
            for (const fn of snapshot) {
                const error = runCleanupSafely(fn);
                if (error)
                    errors.push(error);
            }
            if (errors.length > 0) {
                console.error('[Dalila] scope.dispose() had cleanup errors:', errors);
            }
            for (const listener of scopeDisposeListeners) {
                try {
                    listener(scope);
                }
                catch (err) {
                    console.error('[Dalila] scope.dispose() listener threw:', err);
                }
            }
        },
        parent,
    };
    if (parent) {
        parent.onCleanup(() => scope.dispose());
    }
    for (const listener of scopeCreateListeners) {
        try {
            listener(scope);
        }
        catch (err) {
            console.error('[Dalila] scope.create() listener threw:', err);
        }
    }
    return scope;
}
/**
 * The currently active scope for the running code path.
 * This is set by `withScope()` and read by reactive primitives.
 */
let currentScope = null;
/** Returns the current active scope (or null if none). */
export function getCurrentScope() {
    return currentScope;
}
/**
 * Returns the current scope hierarchy, from current scope up to the root.
 */
export function getCurrentScopeHierarchy() {
    const scopes = [];
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
export function setCurrentScope(scope) {
    currentScope = scope;
}
/**
 * Runs a function with the given scope set as current, then restores the previous scope.
 *
 * This enables scope-aware primitives:
 * - `signal()` can register cleanup in the current scope
 * - `effect()` can auto-dispose when the scope ends
 */
export function withScope(scope, fn) {
    if (isScopeDisposed(scope)) {
        throw new Error('[Dalila] withScope() cannot enter a disposed scope.');
    }
    const prevScope = currentScope;
    currentScope = scope;
    try {
        return fn();
    }
    finally {
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
export async function withScopeAsync(scope, fn) {
    if (isScopeDisposed(scope)) {
        throw new Error('[Dalila] withScopeAsync() cannot enter a disposed scope.');
    }
    const prevScope = currentScope;
    currentScope = scope;
    try {
        return await fn();
    }
    finally {
        currentScope = prevScope;
    }
}
