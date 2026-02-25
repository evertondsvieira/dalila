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
export interface CreateScopeOptions {
    /** Optional debug name shown in DevTools. */
    name?: string;
}
/**
 * Subscribe to scope creation events.
 * Returns an unsubscribe function.
 */
export declare function onScopeCreate(fn: (scope: Scope) => void): () => void;
/**
 * Subscribe to scope disposal events.
 * Returns an unsubscribe function.
 */
export declare function onScopeDispose(fn: (scope: Scope) => void): () => void;
/** Returns true if the given scope has been disposed. */
export declare function isScopeDisposed(scope: Scope): boolean;
/**
 * Creates a new Scope instance.
 *
 * Notes:
 * - Cleanups registered on the same scope run in FIFO order (registration order).
 * - Child scopes are disposed before parent-local cleanups run (for Dalila-created parents).
 * - Parent is captured from the current scope context (set by withScope).
 * - Optional debug names can be passed for DevTools diagnostics.
 */
export declare function createScope(): Scope;
export declare function createScope(parentOverride?: Scope | null): Scope;
export declare function createScope(options: CreateScopeOptions): Scope;
export declare function createScope(parentOverride: Scope | null | undefined, options?: CreateScopeOptions): Scope;
/** Returns the current active scope (or null if none). */
export declare function getCurrentScope(): Scope | null;
/**
 * Returns the current scope hierarchy, from current scope up to the root.
 */
export declare function getCurrentScopeHierarchy(): Scope[];
/**
 * Sets the current active scope.
 * Prefer using `withScope()` unless you are implementing low-level internals.
 */
export declare function setCurrentScope(scope: Scope | null): void;
/**
 * Runs a function with the given scope set as current, then restores the previous scope.
 *
 * This enables scope-aware primitives:
 * - `signal()` can register cleanup in the current scope
 * - `effect()` can auto-dispose when the scope ends
 */
export declare function withScope<T>(scope: Scope, fn: () => T): T;
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
export declare function withScopeAsync<T>(scope: Scope, fn: () => Promise<T>): Promise<T>;
