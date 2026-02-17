import { type Signal } from "./signal.js";
import { type Scope } from "./scope.js";
/**
 * Options for configuring a resource.
 *
 * A resource is an async primitive with support for:
 * - Cancellation via AbortSignal
 * - Lifecycle callbacks (onSuccess, onError)
 * - Initial data for SSR/hydration
 * - staleWhileRevalidate strategy
 */
export interface ResourceOptions<T> {
    /**
     * Optional initial data for the resource.
     * Null is allowed because ResourceState.data() returns T | null by design.
     */
    initialValue?: T | null;
    /**
     * Callback executed when fetch succeeds.
     * Not called for aborted requests.
     */
    onError?: (error: Error) => void;
    /**
     * Callback executed when fetch fails.
     * Not called for aborted requests.
     */
    onSuccess?: (data: T) => void;
    /**
     * If true, keeps old data while fetching new data in background.
     * Default: false
     */
    staleWhileRevalidate?: boolean;
}
/**
 * Cache policy for cached resources.
 * Defines key, TTL, tags, and persistence.
 */
export interface ResourceCachePolicy {
    /** Cache key (static or dynamic). */
    key: string | (() => string);
    /** Time to live in milliseconds. */
    ttlMs?: number;
    /** Tags for group invalidation. */
    tags?: readonly string[];
    /** If true, persists in global cache. */
    persist?: boolean;
}
/**
 * Complete options for creating a resource.
 * Extends ResourceOptions with cache, dependencies, and refresh options.
 */
export interface CreateResourceOptions<T> extends ResourceOptions<T> {
    /**
     * Reactive function that returns dependencies.
     * The resource will be re-created when these dependencies change.
     */
    deps?: () => unknown;
    /** Cache configuration (key or policy object). */
    cache?: string | ResourceCachePolicy;
    /** Interval in ms for continuous auto-refresh. */
    refreshInterval?: number;
    /** Time in ms until data is considered stale. */
    staleTime?: number;
    /** Additional fetch options (headers, credentials, etc). */
    fetchOptions?: RequestInit;
}
/**
 * Options for resource refresh/revalidation.
 */
export interface ResourceRefreshOptions {
    /**
     * If true, aborts any in-flight request and starts a new one.
     * If false (default), waits for the current request (deduplication).
     */
    force?: boolean;
}
/**
 * Resource state - exposing signals and methods for control.
 *
 * @template T - Type of data returned by the resource
 */
export interface ResourceState<T> {
    /**
     * Signal accessor for resource data.
     * Returns null if not loaded yet or on error.
     */
    data: () => T | null;
    /**
     * Signal indicating first load (no previous data).
     */
    loading: () => boolean;
    /**
     * Signal indicating if fetching (even with cached data).
     */
    fetching: () => boolean;
    /**
     * Signal for current error (if any).
     */
    error: () => Error | null;
    /**
     * Triggers data revalidation.
     *
     * Semantics:
     * - If already loading and not forced, waits for current request (dedupe).
     * - If forced, aborts current request and starts new.
     * - `await refresh()` resolves only when the requested request completes.
     *
     * @param options - Refresh options (force)
     */
    refresh: (options?: ResourceRefreshOptions) => Promise<void>;
    /**
     * Cancels the current in-flight request.
     */
    cancel: () => void;
    /**
     * Manually sets resource data.
     * Useful for optimistic updates or data from other sources.
     */
    setData: (value: T | null) => void;
    /**
     * Manually sets resource error.
     */
    setError: (value: Error | null) => void;
}
export declare function createResource<T>(fetchFn: (signal: AbortSignal) => Promise<T>, options?: CreateResourceOptions<T>): ResourceState<T>;
export declare function resourceFromUrl<T>(url: string | (() => string), options?: CreateResourceOptions<T>): ResourceState<T>;
export type DepSource<D> = (() => D) | ReadonlyArray<Signal<any>> | {
    get: () => D;
    key?: () => any;
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
export declare function getResourceCacheData<T>(key: string): T | null | undefined;
export declare function setResourceCacheData<T>(key: string, value: T | null): boolean;
export declare function cancelResourceCache(key: string): void;
export declare function getResourceCacheKeys(): string[];
/**
 * Introspection helper: returns cache keys registered for a tag.
 */
export declare function getResourceCacheKeysByTag(tag: string): string[];
export interface ResourceCache {
    create: <T>(key: string, fetchFn: (signal: AbortSignal) => Promise<T>, options?: CachedResourceOptions<T>) => ResourceState<T>;
    clear: (key?: string) => void;
    invalidate: (key: string, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    invalidateTag: (tag: string, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    invalidateTags: (tags: readonly string[], opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    keys: () => string[];
    configure: (config: Partial<{
        maxEntries: number;
        warnOnEviction: boolean;
    }>) => void;
}
export declare function createResourceCache(config?: Partial<{
    maxEntries: number;
    warnOnEviction: boolean;
}>): ResourceCache;
export {};
