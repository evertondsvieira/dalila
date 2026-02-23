/**
 * Reset warning flags (used by src/internal/watch-testing.ts for deterministic tests).
 * @internal
 */
export declare function __resetWarningsForTests(): void;
/**
 * watch(node, fn)
 *
 * Runs `fn` inside a reactive effect while `node` is connected to the document.
 * - Signal reads inside `fn` are tracked (because `fn` runs inside effect()).
 * - When the node disconnects, the effect is disposed.
 * - If the node reconnects later, the effect may start again (best-effort, based on DOM mutations).
 *
 * Implementation notes / fixes:
 * 1) Scope capture: the scope at watch() time is stored on the entry so effects that start later
 *    still get created "inside" the original scope (fixes late-start effects created outside scope).
 * 2) Memory safety: watches uses WeakMap<Node, ...> so detached nodes are not kept alive.
 * 3) Observer lifecycle: we track ctx.watchCount (WeakMap has no .size) to know when to disconnect.
 */
export declare function watch(node: Node, fn: () => void): () => void;
/**
 * onCleanup(fn)
 *
 * Registers fn to run when the current scope is disposed.
 * If called outside a scope, fn is never called (no-op).
 */
export declare function onCleanup(fn: () => void): void;
/**
 * useEvent(target, type, handler, options?)
 *
 * Attaches an event listener and returns an idempotent dispose() function.
 * - Inside a scope: listener is removed automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export declare function useEvent<T extends EventTarget>(target: T, type: string, handler: (event: Event) => void, options?: AddEventListenerOptions): () => void;
/**
 * useInterval(fn, ms)
 *
 * Starts an interval and returns an idempotent dispose() function.
 * - Inside a scope: interval is cleared automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export declare function useInterval(fn: () => void, ms: number): () => void;
/**
 * useTimeout(fn, ms)
 *
 * Starts a timeout and returns an idempotent dispose() function.
 * - Inside a scope: timeout is cleared automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export declare function useTimeout(fn: () => void, ms: number): () => void;
/**
 * useFetch(url, options)
 *
 * Small convenience for "fetch + reactive state + abort" built on effectAsync().
 * Returns { data, loading, error, dispose }.
 *
 * Behavior:
 * - Runs the fetch inside effectAsync, which provides an AbortSignal.
 * - If url is a function, it tracks signal reads (reactive).
 * - Calling dispose() aborts the in-flight request (via effectAsync's signal).
 * - Inside a scope: auto-disposed on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 *
 * Limitations:
 * - No refresh(), no caching, no invalidation.
 * - For those features, use createResource / query().
 */
export declare function useFetch<T>(url: string | (() => string), options?: RequestInit): {
    data: () => T | null;
    loading: () => boolean;
    error: () => Error | null;
    dispose: () => void;
};
