import { key as keyBuilder, type QueryKey } from "./key.js";
import { type MutationConfig, type MutationState } from "./mutation.js";
/**
 * Configuration for creating a query (read operation with cache).
 *
 * Follows the Query pattern from React Query/TanStack Query:
 * - Automatic cache with staleTime
 * - Invalidation by tags/keys
 * - Automatic retry on failures
 * - Support for initial data (initialValue)
 *
 * @template TKey - Type of query key (string or array)
 * @template TResult - Type of returned data
 */
export interface QueryConfig<TKey extends QueryKey, TResult> {
    /**
     * Function that returns the query key.
     * The query will re-execute when the key changes.
     */
    key: () => TKey;
    /**
     * Tags for cache invalidation.
     * Useful for invalidating multiple related queries.
     */
    tags?: readonly string[];
    /**
     * Fetch function that returns the data.
     * Receives AbortSignal for cancellation and the query key.
     */
    fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>;
    /**
     * Time in ms that data is considered "fresh".
     * After this time, the query will be re-fetched in background.
     * Default: 0 (always stale after first fetch)
     */
    staleTime?: number;
    /**
     * If true, keeps old data while fetching new data in background.
     * Default: true
     */
    staleWhileRevalidate?: boolean;
    /**
     * Number of retry attempts on error.
     * Can be a number or a function returning boolean.
     */
    retry?: number | ((failureCount: number, error: Error, key: TKey) => boolean);
    /**
     * Delay between retry attempts in ms.
     * Can be a number or a function.
     */
    retryDelay?: number | ((failureCount: number, error: Error, key: TKey) => number);
    /**
     * Initial value for data before first fetch.
     * Useful for SSR/hydration.
     */
    initialValue?: TResult;
    /**
     * Callback executed when query succeeds.
     */
    onSuccess?: (data: TResult) => void;
    /**
     * Callback executed when query fails.
     */
    onError?: (error: Error) => void;
}
/**
 * Query state, exposing signals and methods for control.
 *
 * @template TResult - Type of returned data
 */
export interface QueryState<TResult> {
    /**
     * Signal accessor for query data.
     */
    data: () => TResult | null;
    /**
     * Signal indicating if it's the first load (no previous data).
     */
    loading: () => boolean;
    /**
     * Signal indicating if fetching new data (even with cached data).
     */
    fetching: () => boolean;
    /**
     * Signal for the last error (if any).
     */
    error: () => Error | null;
    /**
     * Refetch query data.
     * @param opts.force - If true, forces refetch even if not stale
     */
    refresh: (opts?: {
        force?: boolean;
    }) => Promise<void>;
    /**
     * Current query status: "loading" | "error" | "success"
     */
    status: () => "loading" | "error" | "success";
    /**
     * Encoded cache key for this query.
     */
    cacheKey: () => string;
}
/**
 * Configuration for infinite queries (infinite pagination).
 *
 * @template TKey - Type of key
 * @template TPage - Type of each page
 * @template TPageParam - Type of page parameter
 */
export interface InfiniteQueryConfig<TKey extends QueryKey, TPage, TPageParam> {
    /**
     * Query key (static or function).
     */
    queryKey: TKey | (() => TKey);
    /**
     * Function to fetch a specific page.
     */
    queryFn: (input: {
        signal: AbortSignal;
        queryKey: TKey;
        pageParam: TPageParam;
    }) => Promise<TPage>;
    /**
     * Initial parameter for the first page.
     */
    initialPageParam: TPageParam;
    /**
     * Function that determines the next page parameter.
     * Returns null/undefined if no next page.
     */
    getNextPageParam: (lastPage: TPage, pages: readonly TPage[], pageParams: readonly TPageParam[]) => TPageParam | null | undefined;
    /**
     * Number of retry attempts.
     */
    retry?: number | ((failureCount: number, error: Error, key: TKey) => boolean);
    /**
     * Delay between retry attempts.
     */
    retryDelay?: number | ((failureCount: number, error: Error, key: TKey) => number);
}
/**
 * State of an infinite query.
 *
 * @template TPage - Type of each page
 * @template TPageParam - Type of page parameter
 */
export interface InfiniteQueryState<TPage, TPageParam> {
    /**
     * Signal with all loaded pages.
     */
    pages: () => TPage[];
    /**
     * Signal with all page parameters used.
     */
    pageParams: () => TPageParam[];
    /**
     * Signal indicating if loading the first page.
     */
    loading: () => boolean;
    /**
     * Signal indicating if fetching (first or next page).
     */
    fetching: () => boolean;
    /**
     * Signal for error (if any).
     */
    error: () => Error | null;
    /**
     * Signal indicating if there are more pages to load.
     */
    hasNextPage: () => boolean;
    /**
     * Fetches the next page.
     */
    fetchNextPage: () => Promise<TPage | null>;
    /**
     * Alias for fetchNextPage.
     */
    loadMore: () => Promise<TPage | null>;
    /**
     * Resets and reloads all pages.
     */
    refresh: () => Promise<void>;
}
/**
 * Configuration for query prefetching.
 *
 * @template TKey - Type of key
 * @template TResult - Type of data
 */
export interface PrefetchQueryConfig<TKey extends QueryKey, TResult> {
    /**
     * Query key to prefetch.
     */
    key: TKey | (() => TKey);
    /**
     * Fetch function.
     */
    fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>;
    /**
     * Tags for cache.
     */
    tags?: readonly string[];
    /**
     * Time in ms to consider stale.
     */
    staleTime?: number;
    /**
     * Keep old data while revalidating.
     */
    staleWhileRevalidate?: boolean;
    /**
     * Number of retry attempts.
     */
    retry?: number | ((failureCount: number, error: Error, key: TKey) => boolean);
    /**
     * Delay between retry attempts.
     */
    retryDelay?: number | ((failureCount: number, error: Error, key: TKey) => number);
    /**
     * If true, persists in global cache.
     * Default: true for prefetch
     */
    persist?: boolean;
}
/**
 * Filters for finding/filtering queries in the client.
 */
export interface QueryFilters {
    /**
     * Exact query key.
     */
    key?: QueryKey;
    /**
     * Key prefix to match multiple queries.
     */
    keyPrefix?: QueryKey;
    /**
     * Custom predicate for filtering.
     */
    predicate?: (query: QueryInfo) => boolean;
}
/**
 * Information about a query registered in the client.
 */
export interface QueryInfo {
    /** Original query key. */
    key: QueryKey;
    /** Encoded cache key. */
    cacheKey: string;
    /** Cached data. */
    data: unknown;
    /** If on first load. */
    loading: boolean;
    /** If fetching. */
    fetching: boolean;
    /** Current error (if any). */
    error: Error | null;
}
/**
 * Snapshot of query state at observation time.
 * Used by observeQuery to notify listeners.
 *
 * @template TResult - Type of data
 */
export interface QueryObserverSnapshot<TResult> {
    /** Current data. */
    data: TResult | null;
    /** If first load. */
    loading: boolean;
    /** If fetching. */
    fetching: boolean;
    /** Current error. */
    error: Error | null;
    /** Current status. */
    status: "loading" | "error" | "success";
    /** Cache key. */
    cacheKey: string;
}
/**
 * Query client - main interface for managing queries and mutations.
 *
 * Provides methods for:
 * - Creating queries (query, queryGlobal, infiniteQuery)
 * - Manipulating cache (getQueryData, setQueryData)
 * - Invalidating queries (invalidateKey, invalidateTag, invalidateQueries)
 * - Observing queries (observeQuery)
 * - Creating mutations (mutation)
 *
 * @example
 * ```ts
 * const client = createQueryClient();
 *
 * // Create a query
 * const usersQuery = client.query({
 *   key: () =>   fetch: async (signal, key) => {
 * ['users'],
 *     const res = await fetch('/api/users', { signal });
 *     return res.json();
 *   },
 *   staleTime: 5000
 * });
 *
 * // Invalidate all queries with tag
 * client.invalidateTag('users');
 * ```
 */
export interface QueryClient {
    /** Query key builder. */
    key: typeof keyBuilder;
    /**
     * Creates a scoped query (doesn't persist between scopes).
     * Recommended for use within components.
     */
    query: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;
    /**
     * Creates a global query (persists in global cache).
     * Useful for data that needs to survive component unmounts.
     */
    queryGlobal: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;
    /**
     * Creates an infinite query for pagination.
     */
    infiniteQuery: <TKey extends QueryKey, TPage, TPageParam>(cfg: InfiniteQueryConfig<TKey, TPage, TPageParam>) => InfiniteQueryState<TPage, TPageParam>;
    /**
     * Pre-loads a query into cache (without rendering).
     * Useful for prefetching before navigating to a page.
     */
    prefetchQuery: <TKey extends QueryKey, TResult>(cfg: PrefetchQueryConfig<TKey, TResult>) => Promise<TResult | null>;
    /**
     * Gets data directly from cache without creating a query.
     */
    getQueryData: <TResult>(key: QueryKey) => TResult | null | undefined;
    /**
     * Updates data in cache directly.
     */
    setQueryData: <TResult>(key: QueryKey, updater: TResult | null | ((current: TResult | null | undefined) => TResult | null)) => TResult | null;
    /**
     * Creates a memoized derived accessor from query cache data.
     * Memoization is scoped by encoded key + selector identity.
     */
    select: <TResult, TSelected>(key: QueryKey | (() => QueryKey), selector: (data: TResult | null | undefined) => TSelected) => () => TSelected;
    /**
     * Finds all queries matching filters.
     */
    findQueries: (filters?: QueryFilters | QueryKey) => QueryInfo[];
    /**
     * Cancels in-flight queries.
     */
    cancelQueries: (filters?: QueryFilters | QueryKey) => void;
    /**
     * Refetch queries matching filters.
     */
    refetchQueries: (filters?: QueryFilters | QueryKey, opts?: {
        force?: boolean;
    }) => void;
    /**
     * Observes query state changes.
     * Returns function to cancel observation.
     */
    observeQuery: <TResult>(state: QueryState<TResult>, listener: (snapshot: QueryObserverSnapshot<TResult>) => void, opts?: {
        immediate?: boolean;
    }) => () => void;
    /**
     * Creates a mutation associated with this client.
     */
    mutation: <TInput, TResult, TContext = unknown>(cfg: MutationConfig<TInput, TResult, TContext>) => MutationState<TInput, TResult>;
    /**
     * Invalidates all queries with a specific key.
     */
    invalidateKey: (key: QueryKey, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Invalidates all queries with a specific tag.
     */
    invalidateTag: (tag: string, opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Invalidates all queries with any of the tags.
     */
    invalidateTags: (tags: readonly string[], opts?: {
        revalidate?: boolean;
        force?: boolean;
    }) => void;
    /**
     * Invalidates queries matching filters.
     */
    invalidateQueries: (filters: QueryFilters | QueryKey, opts?: {
        force?: boolean;
    }) => void;
}
export declare function createQueryClient(): QueryClient;
