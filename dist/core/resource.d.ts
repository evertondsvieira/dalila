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
export interface ResourceCachePolicy {
    key: string | (() => string);
    ttlMs?: number;
    tags?: readonly string[];
    persist?: boolean;
}
export interface CreateResourceOptions<T> extends ResourceOptions<T> {
    deps?: () => unknown;
    cache?: string | ResourceCachePolicy;
    refreshInterval?: number;
    fetchOptions?: RequestInit;
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
