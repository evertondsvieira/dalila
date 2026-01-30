import { type Signal } from "./signal.js";
import { type Scope } from "./scope.js";
/**
 * ResourceOptions:
 * - initialValue: optional initial data (null is allowed by design)
 * - onSuccess/onError: run only for non-aborted runs
 */
export interface ResourceOptions<T> {
    /**
     * Optional initial data for the resource.
     * We allow null because ResourceState.data() is T | null by design.
     */
    initialValue?: T | null;
    onError?: (error: Error) => void;
    onSuccess?: (data: T) => void;
}
export interface ResourceRefreshOptions {
    /** If true, abort any in-flight request and revalidate now. */
    force?: boolean;
}
export interface ResourceState<T> {
    data: () => T | null;
    loading: () => boolean;
    error: () => Error | null;
    /**
     * Triggers a revalidation.
     *
     * Semantics:
     * - If already loading and not forced, it awaits the current run (dedupe).
     * - If forced, it aborts the current run and starts a new request.
     * - `await refresh()` resolves only when the requested run completes (waiter semantics).
     */
    refresh: (options?: ResourceRefreshOptions) => Promise<void>;
}
/**
 * Async data primitive with cancellation + refresh correctness.
 *
 * Design goals:
 * - Scope-first: if created inside a scope, abort + cleanup on scope disposal.
 * - Abort-safe callbacks: do not call onSuccess/onError for aborted runs.
 * - Correct refresh: `await refresh()` must wait for the *new* fetch, not a stale inFlight.
 *
 * Semantics:
 * - A driver `effectAsync` runs `fetchFn(signal)` whenever `refreshTick` changes.
 * - Each run gets a fresh AbortController.
 * - Reruns abort the previous controller.
 *
 * Why a waiter system?
 * - Without it, refresh() can accidentally await an older promise and resolve early.
 * - We map each refresh request to a runId and resolve its waiter when that run finishes.
 *
 * Safety:
 * - If the driver reruns during a fetch, an aborted run must NOT resolve the latest waiter.
 *   Guard: only resolve if `lastRunController === controller` for that run.
 *
 * Lifetime:
 * - On parent scope cleanup:
 *   - abort current request
 *   - dispose the driver
 *   - resolve all pending waiters (avoid hanging Promises)
 */
export declare function createResource<T>(fetchFn: (signal: AbortSignal) => Promise<T>, options?: ResourceOptions<T>): ResourceState<T>;
/**
 * Fetch helper built on top of createResource().
 *
 * Semantics:
 * - `url` may be static or dynamic (function).
 * - Uses fetch() with AbortSignal.
 * - Non-2xx responses throw (surfaced via resource.error()).
 */
export declare function createFetchResource<T>(url: string | (() => string), options?: ResourceOptions<T> & {
    fetchOptions?: RequestInit;
}): ResourceState<T>;
export type DepSource<D> = (() => D) | ReadonlyArray<Signal<any>> | {
    get: () => D;
    key?: () => any;
};
/**
 * Resource that revalidates when dependencies change.
 *
 * Design goals:
 * - Same guarantees as createResource():
 *   - abort-safe callbacks
 *   - refresh waiter correctness
 * - Flexible deps:
 *   - function getter (value mode)
 *   - array of signals (array mode)
 *   - accessor with optional key() (key mode for stable change detection)
 *
 * Semantics:
 * - The driver reads deps, decides if changed, then fetches.
 * - If deps didn't change, it does nothing (no remount/refetch).
 *
 * Important edge-case:
 * - If the effect reruns while a fetch is still in flight and deps are unchanged,
 *   we must not resolve refresh waiters prematurely.
 *   Guard: early-return resolves only if `!loading()`.
 */
export declare function createDependentResource<T, D>(fetchFn: (signal: AbortSignal, deps: D) => Promise<T>, deps: DepSource<D>, options?: ResourceOptions<T>): ResourceState<T>;
/**
 * CacheEntry:
 * A cached resource plus book-keeping for memory safety and invalidation.
 *
 * Fields:
 * - createdAt/ttlMs: TTL-based expiry.
 * - tags: tag index for invalidation.
 * - stale: marker used by invalidation flows.
 * - refCount: number of active scopes referencing this entry.
 * - persist: if true, entry may live outside scopes (global cache).
 * - cacheScope: dedicated scope that owns the underlying resource lifetime.
 *
 * Why cacheScope?
 * - If a cached resource were created in the caller scope, it could be disposed
 *   prematurely when that scope ends, even though other scopes still reference it.
 * - We isolate each cache entry in its own scope so the cache controls disposal.
 */
type CacheEntry = {
    resource: ResourceState<any>;
    createdAt: number;
    ttlMs?: number;
    tags: Set<string>;
    stale: boolean;
    /** Active scoped users. */
    refCount: number;
    /** Explicit "keep global" flag. */
    persist: boolean;
    /**
     * Dedicated scope for this cache entry.
     * The resource is created inside this scope, isolating it from caller scopes.
     * When the entry is removed from cache, this scope is disposed.
     */
    cacheScope: Scope;
};
export interface CachedResourceOptions<T> extends ResourceOptions<T> {
    ttlMs?: number;
    tags?: readonly string[];
    /**
     * If true, allow caching outside a scope (global cache).
     * If false/undefined, calling cached APIs outside a scope won't cache (safe-by-default).
     */
    persist?: boolean;
    /**
     * Optional dev warning when caller attempted caching outside scope without persist.
     * Leave default as true to teach DX.
     */
    warnIfNoScope?: boolean;
    /**
     * Optional dev warning when persist is true without ttlMs.
     * Leave default as true to teach DX.
     */
    warnPersistWithoutTtl?: boolean;
    /**
     * Optional scope to run fetchFn inside (for context lookup).
     * Note: only the sync portion before the first await runs inside this scope.
     */
    fetchScope?: Scope | null;
}
/**
 * Global cache configuration for memory safety.
 */
interface CacheConfig {
    maxEntries: number;
    warnOnEviction: boolean;
}
/**
 * Configure the global resource cache limits.
 * Call this early in your app initialization.
 */
export declare function configureResourceCache(config: Partial<CacheConfig>): void;
/**
 * Create or reuse a cached resource by cache key.
 *
 * Safe-by-default:
 * - If called outside a scope and persist !== true, it returns a non-cached resource.
 * - This prevents accidental global cache growth from unscoped usage.
 *
 * TTL:
 * - On access, if an existing entry is expired, it is removed and recreated.
 *
 * Lifetime:
 * - Each entry has a dedicated cacheScope, disposed when the entry is removed.
 * - Scopes referencing an entry increment refCount; on scope cleanup they release it.
 */
export declare function createCachedResource<T>(key: string, fetchFn: (signal: AbortSignal) => Promise<T>, options?: CachedResourceOptions<T>): ResourceState<T>;
/**
 * Convenience wrapper: builds the cache key from an id.
 */
export declare function createCachedResourceById<T, I>(id: I, keyFn: (id: I) => string, fetchFn: (signal: AbortSignal, id: I) => Promise<T>, options?: CachedResourceOptions<T>): ResourceState<T>;
/**
 * Clears the cache:
 * - with no key: clears everything
 * - with key: clears a single entry
 *
 * Note: removing an entry disposes its cacheScope, aborting in-flight requests and running cleanups.
 */
export declare function clearResourceCache(key?: string): void;
/**
 * Marks a cached entry stale and optionally revalidates it.
 *
 * Semantics:
 * - stale is a marker for debugging/inspection.
 * - by default we revalidate immediately (force by default).
 */
export declare function invalidateResourceCache(key: string, opts?: {
    revalidate?: boolean;
    force?: boolean;
}): void;
/**
 * Invalidates all cached resources registered under a given tag.
 */
export declare function invalidateResourceTag(tag: string, opts?: {
    revalidate?: boolean;
    force?: boolean;
}): void;
/**
 * Invalidates multiple tags.
 */
export declare function invalidateResourceTags(tags: readonly string[], opts?: {
    revalidate?: boolean;
    force?: boolean;
}): void;
/**
 * Introspection helper: returns cache keys registered for a tag.
 */
export declare function getResourceCacheKeysByTag(tag: string): string[];
/**
 * Auto-refreshing resource helper.
 *
 * Semantics:
 * - Requires a scope so the interval can be cleaned up automatically.
 * - Outside a scope, it warns and returns a normal resource (no interval).
 */
export declare function createAutoRefreshResource<T>(fetchFn: (signal: AbortSignal) => Promise<T>, refreshInterval: number, options?: ResourceOptions<T>): ResourceState<T>;
/**
 * Isolated cache instance for SSR and testing.
 *
 * Use this when you need complete cache isolation:
 * - SSR: each request gets its own cache
 * - Testing: each test gets fresh state
 *
 * Example:
 * ```ts
 * const { createCachedResource, clearCache, invalidateKey, getCache } = createIsolatedCache();
 *
 * // Use the isolated createCachedResource instead of the global one
 * const resource = createCachedResource('key', fetchFn);
 *
 * // Clean up when done
 * clearCache();
 * ```
 */
export interface IsolatedCache {
    /**
     * Create a cached resource using this isolated cache.
     */
    createCachedResource: <T>(key: string, fetchFn: (signal: AbortSignal) => Promise<T>, options?: CachedResourceOptions<T>) => ResourceState<T>;
    /**
     * Clear all entries in this isolated cache.
     */
    clearCache: (key?: string) => void;
    /**
     * Invalidate a specific key in this isolated cache.
     */
    invalidateKey: (key: string, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Invalidate all entries with a specific tag.
     */
    invalidateTag: (tag: string, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Invalidate all entries with any of the specified tags.
     */
    invalidateTags: (tags: readonly string[], opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Get the underlying cache Map (for debugging/inspection).
     */
    getCache: () => Map<string, CacheEntry>;
    /**
     * Get cache keys by tag.
     */
    getKeysByTag: (tag: string) => string[];
    /**
     * Configure cache limits for this instance.
     */
    configure: (config: Partial<{
        maxEntries: number;
        warnOnEviction: boolean;
    }>) => void;
}
export declare function createIsolatedCache(): IsolatedCache;
export {};
