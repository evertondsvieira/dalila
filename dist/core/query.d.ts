import { key as keyBuilder, type QueryKey } from "./key.js";
import { type MutationConfig, type MutationState } from "./mutation.js";
export interface QueryConfig<TKey extends QueryKey, TResult> {
    /** Reactive key (stable identity + encodable). */
    key: () => TKey;
    /** Optional tags registered on the cached resource (for invalidation). */
    tags?: readonly string[];
    /** Fetch function for the given key (AbortSignal is provided). */
    fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>;
    /**
     * Optional stale revalidation window (ms).
     * After a successful fetch, schedules a refresh after `staleTime`.
     */
    staleTime?: number;
    /** Optional initial value (treated as already-known data). */
    initialValue?: TResult;
    onSuccess?: (data: TResult) => void;
    onError?: (error: Error) => void;
}
export interface QueryState<TResult> {
    data: () => TResult | null;
    loading: () => boolean;
    error: () => Error | null;
    /** Manual refresh of the underlying resource. */
    refresh: (opts?: {
        force?: boolean;
    }) => Promise<void>;
    /** Derived status for convenience. */
    status: () => "loading" | "error" | "success";
    /** Current encoded cache key. */
    cacheKey: () => string;
}
export interface QueryClient {
    key: typeof keyBuilder;
    /** Safe-by-default: requires scope for caching. Outside scope, does NOT cache. */
    query: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;
    /** Explicit global caching (persist). */
    queryGlobal: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;
    mutation: <TInput, TResult>(cfg: MutationConfig<TInput, TResult>) => MutationState<TInput, TResult>;
    invalidateKey: (key: QueryKey, opts?: {
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
}
/**
 * Query client (React Query-like API on top of Dalila resources).
 *
 * Design goals:
 * - DOM-first + signals: queries are just resources exposed as reactive getters.
 * - Cache safety: by default, caching requires a scope; global cache is opt-in.
 * - Keyed caching: results are cached by encoded key.
 * - Stale revalidation: optionally schedule a refresh after a successful fetch.
 *
 * Implementation notes:
 * - The underlying cached resource is created inside a computed() so it can react
 *   to key changes.
 * - computed() is lazy, so we "kick" it once and also install an effect() that
 *   re-reads it, ensuring key changes recreate the resource even if nobody reads
 *   data() yet.
 * - staleTime revalidation is guarded by `expectedCk` so a timer from an old key
 *   cannot refresh a new key’s resource.
 * - If created inside a scope, staleTime timers are cleared on scope cleanup.
 */
export declare function createQueryClient(): QueryClient;
