import { computed, effect, signal } from "./signal.js";
import { getCurrentScope, createScope, withScope, type Scope } from "./scope.js";
import { key as keyBuilder, encodeKey, type QueryKey } from "./key.js";
import {
  createResource,
  invalidateResourceCache,
  invalidateResourceTag,
  invalidateResourceTags,
  getResourceCacheData,
  getResourceCacheKeys,
  setResourceCacheData,
  cancelResourceCache,
  type ResourceState,
} from "./resource.js";
import { createMutation, type MutationConfig, type MutationState } from "./mutation.js";
import { isInDevMode } from "./dev.js";

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
  refresh: (opts?: { force?: boolean }) => Promise<void>;
  
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
  queryFn: (input: { signal: AbortSignal; queryKey: TKey; pageParam: TPageParam }) => Promise<TPage>;
  
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
  refetchQueries: (filters?: QueryFilters | QueryKey, opts?: { force?: boolean }) => void;
  
  /**
   * Observes query state changes.
   * Returns function to cancel observation.
   */
  observeQuery: <TResult>(
    state: QueryState<TResult>,
    listener: (snapshot: QueryObserverSnapshot<TResult>) => void,
    opts?: { immediate?: boolean }
  ) => () => void;
  
  /**
   * Creates a mutation associated with this client.
   */
  mutation: <TInput, TResult, TContext = unknown>(cfg: MutationConfig<TInput, TResult, TContext>) => MutationState<TInput, TResult>;
  
  /**
   * Invalidates all queries with a specific key.
   */
  invalidateKey: (key: QueryKey, opts?: { revalidate?: boolean; force?: boolean }) => void;
  
  /**
   * Invalidates all queries with a specific tag.
   */
  invalidateTag: (tag: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  
  /**
   * Invalidates all queries with any of the tags.
   */
  invalidateTags: (tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }) => void;
  
  /**
   * Invalidates queries matching filters.
   */
  invalidateQueries: (filters: QueryFilters | QueryKey, opts?: { force?: boolean }) => void;
}

type QueryRegistryEntry = {
  getRawKey: () => QueryKey;
  getCacheKey: () => string;
  getData: () => unknown;
  getLoading: () => boolean;
  getFetching: () => boolean;
  getError: () => Error | null;
  setData: (value: unknown) => void;
  cancel: () => void;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
};

function isKeyPrefixMatch(key: QueryKey, prefix: QueryKey): boolean {
  if (typeof prefix === "string") {
    if (typeof key !== "string") return false;
    return key.startsWith(prefix);
  }

  if (typeof key === "string") return false;
  if (prefix.length > key.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (!Object.is(key[i], prefix[i])) return false;
  }
  return true;
}

function isQueryFiltersInput(value: unknown): value is QueryFilters {
  return typeof value === "object" && value !== null;
}

function normalizeQueryFilters(filters?: QueryFilters | QueryKey): QueryFilters {
  if (filters === undefined) return {};
  if (Array.isArray(filters) || typeof filters === "string") {
    return { keyPrefix: filters };
  }
  if (isQueryFiltersInput(filters)) {
    return filters;
  }
  return {};
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(abortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function shouldRetry<TKey extends QueryKey>(
  retry: number | ((failureCount: number, error: Error, key: TKey) => boolean) | undefined,
  failureCount: number,
  error: Error,
  key: TKey
): boolean {
  if (typeof retry === "function") return retry(failureCount, error, key);
  const maxRetries = retry ?? 0;
  return failureCount <= maxRetries;
}

function retryDelayMs<TKey extends QueryKey>(
  retryDelay: number | ((failureCount: number, error: Error, key: TKey) => number) | undefined,
  failureCount: number,
  error: Error,
  key: TKey
): number {
  if (typeof retryDelay === "function") {
    return Math.max(0, retryDelay(failureCount, error, key));
  }
  return Math.max(0, retryDelay ?? 300);
}

async function runWithRetry<TKey extends QueryKey, TResult>(
  signal: AbortSignal,
  key: TKey,
  run: () => Promise<TResult>,
  retry: number | ((failureCount: number, error: Error, key: TKey) => boolean) | undefined,
  retryDelay: number | ((failureCount: number, error: Error, key: TKey) => number) | undefined
): Promise<TResult> {
  let failureCount = 0;
  while (true) {
    try {
      return await run();
    } catch (error) {
      if (signal.aborted) throw abortError();
      const err = error instanceof Error ? error : new Error(String(error));
      failureCount++;
      if (!shouldRetry(retry, failureCount, err, key)) {
        throw err;
      }
      await waitForRetry(retryDelayMs(retryDelay, failureCount, err, key), signal);
    }
  }
}

function getFilteredCacheKeys(filters: QueryFilters, managedKeys: readonly string[]): string[] {
  if (filters.key !== undefined) {
    const encoded = encodeKey(filters.key);
    return managedKeys.includes(encoded) ? [encoded] : [];
  }

  if (filters.keyPrefix !== undefined) {
    const encodedPrefix = encodeKey(filters.keyPrefix);
    return managedKeys.filter((key) => {
      if (typeof filters.keyPrefix === "string") {
        return key.startsWith(encodedPrefix);
      }
      if (Array.isArray(filters.keyPrefix) && filters.keyPrefix.length === 0) {
        return key.startsWith("k|arr|");
      }
      return key === encodedPrefix || key.startsWith(encodedPrefix + ";");
    });
  }

  return Array.from(managedKeys);
}

export function createQueryClient(): QueryClient {
  const registry = new Set<QueryRegistryEntry>();
  const managedCacheKeyRefs = new Map<string, number>();
  const persistentManagedKeys = new Set<string>();

  function retainManagedCacheKey(key: string): void {
    managedCacheKeyRefs.set(key, (managedCacheKeyRefs.get(key) ?? 0) + 1);
  }

  function releaseManagedCacheKey(key: string): void {
    const current = managedCacheKeyRefs.get(key) ?? 0;
    if (current <= 1) {
      managedCacheKeyRefs.delete(key);
      return;
    }
    managedCacheKeyRefs.set(key, current - 1);
  }

  function listManagedCacheKeys(): string[] {
    const existing = new Set(getResourceCacheKeys());
    for (const key of managedCacheKeyRefs.keys()) {
      if (!existing.has(key)) {
        managedCacheKeyRefs.delete(key);
      }
    }
    for (const key of persistentManagedKeys) {
      if (!existing.has(key)) {
        persistentManagedKeys.delete(key);
      }
    }
    return Array.from(new Set([...managedCacheKeyRefs.keys(), ...persistentManagedKeys]));
  }

  function trackPersistentManagedKey(key: string): void {
    persistentManagedKeys.add(key);
  }

  function makeQuery<TKey extends QueryKey, TResult>(
    cfg: QueryConfig<TKey, TResult>,
    behavior: { persist: boolean }
  ): QueryState<TResult> {
    const scope = getCurrentScope();
    const parentScope = scope;
    const staleTime = cfg.staleTime ?? 0;

    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupRegistered = false;
    let keyScope: Scope | null = null;
    let keyScopeCk: string | null = null;

    if (isInDevMode() && !parentScope && behavior.persist === false) {
      console.warn(
        `[Dalila] q.query() called outside a scope. ` +
        `It will not cache and may leak. Use within a scope or q.queryGlobal().`
      );
    }

    function ensureKeyScope(ck: string): Scope | null {
      if (!parentScope) return null;

      if (keyScope && keyScopeCk === ck) return keyScope;

      if (staleTimer != null) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }

      keyScope?.dispose();
      keyScopeCk = ck;
      keyScope = createScope(parentScope);
      return keyScope;
    }

    const scheduleStaleRevalidate = (r: ResourceState<TResult>, expectedCk: string) => {
      if (staleTime <= 0) return;
      if (!scope) {
        if (isInDevMode()) {
          console.warn(
            `[Dalila] staleTime requires a scope for cleanup. ` +
            `Run the query inside a scope or disable staleTime.`
          );
        }
        return;
      }
      if (encodeKey(cfg.key()) !== expectedCk) return;

      if (!cleanupRegistered) {
        cleanupRegistered = true;
        scope.onCleanup(() => {
          if (staleTimer != null) clearTimeout(staleTimer);
          staleTimer = null;
        });
      }

      if (staleTimer != null) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }

      staleTimer = setTimeout(() => {
        if (encodeKey(cfg.key()) !== expectedCk) return;
        r.refresh({ force: false }).catch(() => { });
      }, staleTime);
    };

    const resource = computed<ResourceState<TResult>>(() => {
      const k = cfg.key();
      const ck = encodeKey(k);

      let r!: ResourceState<TResult>;

      const ks = ensureKeyScope(ck);

      const opts: {
        initialValue?: TResult;
        onError?: (error: Error) => void;
        onSuccess?: (data: TResult) => void;
        staleWhileRevalidate?: boolean;
        cache: {
          key: string;
          tags?: readonly string[];
          persist?: boolean;
        };
      } = {
        onError: cfg.onError,
        onSuccess: (data) => {
          cfg.onSuccess?.(data);
          scheduleStaleRevalidate(r, ck);
        },
        staleWhileRevalidate: cfg.staleWhileRevalidate ?? true,
        cache: {
          key: ck,
          tags: cfg.tags,
          persist: behavior.persist,
        },
      };

      if (cfg.initialValue !== undefined) opts.initialValue = cfg.initialValue;

      const make = () =>
        createResource<TResult>(async (sig) => {
          await Promise.resolve();
          return runWithRetry(
            sig,
            k,
            () => cfg.fetch(sig, k),
            cfg.retry,
            cfg.retryDelay
          );
        }, opts);
      r = ks ? withScope(ks, make) : make();

      return r;
    });

    const status = computed<"loading" | "error" | "success">(() => {
      const r = resource();
      if (r.loading()) return "loading";
      if (r.error()) return "error";
      return "success";
    });

    const cacheKeySig = computed(() => encodeKey(cfg.key()));
    const rawKeySig = computed(() => cfg.key());
    let trackedManagedKey: string | null = null;

    resource();
    effect(() => {
      resource();
    });
    effect(() => {
      const current = cacheKeySig();
      if (trackedManagedKey === current) return;
      if (trackedManagedKey != null) {
        releaseManagedCacheKey(trackedManagedKey);
      }
      retainManagedCacheKey(current);
      if (behavior.persist) {
        trackPersistentManagedKey(current);
      }
      trackedManagedKey = current;
    });

    const entry: QueryRegistryEntry = {
      getRawKey: () => rawKeySig(),
      getCacheKey: () => cacheKeySig(),
      getData: () => resource().data(),
      getLoading: () => resource().loading(),
      getFetching: () => resource().fetching(),
      getError: () => resource().error(),
      setData: (value: unknown) => {
        resource().setData(value as TResult | null);
        resource().setError(null);
      },
      cancel: () => {
        resource().cancel();
      },
      refresh: (opts) => resource().refresh(opts),
    };

    if (scope) {
      registry.add(entry);
      scope.onCleanup(() => {
        registry.delete(entry);
        if (trackedManagedKey != null) {
          releaseManagedCacheKey(trackedManagedKey);
          trackedManagedKey = null;
        }
      });
    }

    return {
      data: () => resource().data(),
      loading: () => resource().loading(),
      fetching: () => resource().fetching(),
      error: () => resource().error(),
      refresh: (opts) => resource().refresh(opts),
      status: () => status(),
      cacheKey: () => cacheKeySig(),
    };
  }

  function query<TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>): QueryState<TResult> {
    return makeQuery(cfg, { persist: false });
  }

  function queryGlobal<TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>): QueryState<TResult> {
    return makeQuery(cfg, { persist: true });
  }

  function getQueryData<TResult>(k: QueryKey): TResult | null | undefined {
    const encoded = encodeKey(k);
    for (const entry of registry) {
      if (entry.getCacheKey() === encoded) {
        return entry.getData() as TResult | null;
      }
    }
    return getResourceCacheData<TResult>(encoded);
  }

  function setQueryData<TResult>(
    k: QueryKey,
    updater: TResult | null | ((current: TResult | null | undefined) => TResult | null)
  ): TResult | null {
    const encoded = encodeKey(k);
    const current = getQueryData<TResult>(k);
    const next = typeof updater === "function"
      ? (updater as (value: TResult | null | undefined) => TResult | null)(current)
      : updater;

    let appliedToRegistry = false;
    for (const entry of registry) {
      if (entry.getCacheKey() !== encoded) continue;
      appliedToRegistry = true;
      entry.setData(next);
    }

    const appliedToCache = setResourceCacheData<TResult>(encoded, next);
    if (!appliedToRegistry && !appliedToCache) {
      return next;
    }

    return next;
  }

  function findQueries(filters?: QueryFilters | QueryKey): QueryInfo[] {
    const normalized = normalizeQueryFilters(filters);
    const exactKey = normalized.key;
    const hasExactKey = exactKey !== undefined;
    const exactEncoded = hasExactKey ? encodeKey(exactKey) : null;
    const prefix = normalized.keyPrefix;
    const out: QueryInfo[] = [];

    for (const entry of registry) {
      if (hasExactKey && entry.getCacheKey() !== exactEncoded) continue;
      if (!hasExactKey && prefix !== undefined && !isKeyPrefixMatch(entry.getRawKey(), prefix)) continue;
      const info: QueryInfo = {
        key: entry.getRawKey(),
        cacheKey: entry.getCacheKey(),
        data: entry.getData(),
        loading: entry.getLoading(),
        fetching: entry.getFetching(),
        error: entry.getError(),
      };
      if (normalized.predicate && !normalized.predicate(info)) continue;
      out.push(info);
    }
    return out;
  }

  function cancelQueries(filters?: QueryFilters | QueryKey): void {
    if (filters === undefined) {
      for (const key of getFilteredCacheKeys({}, listManagedCacheKeys())) {
        cancelResourceCache(key);
      }
      for (const entry of registry) {
        entry.cancel();
      }
      return;
    }

    const normalized = normalizeQueryFilters(filters);
    if (!normalized.predicate) {
      for (const key of getFilteredCacheKeys(normalized, listManagedCacheKeys())) {
        cancelResourceCache(key);
      }
    }

    const keys = new Set(findQueries(normalized).map((q) => q.cacheKey));
    for (const entry of registry) {
      if (!keys.has(entry.getCacheKey())) continue;
      entry.cancel();
    }
  }

  async function prefetchQuery<TKey extends QueryKey, TResult>(cfg: PrefetchQueryConfig<TKey, TResult>): Promise<TResult | null> {
    const resolvedKey = typeof cfg.key === "function" ? (cfg.key as () => TKey)() : cfg.key;
    const encoded = encodeKey(resolvedKey);
    if (cfg.persist ?? true) {
      trackPersistentManagedKey(encoded);
    }
    const prefetched = createResource<TResult>(
      async (sig) =>
        runWithRetry(
          sig,
          resolvedKey,
          () => cfg.fetch(sig, resolvedKey),
          cfg.retry,
          cfg.retryDelay
        ),
      {
        cache: {
          key: encoded,
          tags: cfg.tags,
          persist: cfg.persist ?? true,
        },
        staleTime: cfg.staleTime,
        staleWhileRevalidate: cfg.staleWhileRevalidate ?? true,
      }
    );

    await prefetched.refresh();
    return prefetched.data();
  }

  function invalidateKey(k: QueryKey, opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceCache(encodeKey(k), opts);
  }

  function invalidateTag(tag: string, opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceTag(tag, opts);
  }

  function invalidateTags(tags: readonly string[], opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceTags(tags, opts);
  }

  function refetchQueries(filters?: QueryFilters | QueryKey, opts: { force?: boolean } = {}): void {
    const keys = new Set(findQueries(filters).map((q) => q.cacheKey));
    for (const entry of registry) {
      if (!keys.has(entry.getCacheKey())) continue;
      entry.refresh({ force: opts.force ?? true }).catch(() => {});
    }
  }

  function invalidateQueries(filters: QueryFilters | QueryKey, opts: { force?: boolean } = {}): void {
    const normalized = normalizeQueryFilters(filters);
    if (!normalized.predicate) {
      for (const key of getFilteredCacheKeys(normalized, listManagedCacheKeys())) {
        invalidateResourceCache(key, { revalidate: true, force: opts.force ?? true });
      }
      return;
    }
    refetchQueries(normalized, opts);
  }

  function observeQuery<TResult>(
    state: QueryState<TResult>,
    listener: (snapshot: QueryObserverSnapshot<TResult>) => void,
    opts: { immediate?: boolean } = {}
  ): () => void {
    let first = true;
    return effect(() => {
      const snapshot: QueryObserverSnapshot<TResult> = {
        data: state.data(),
        loading: state.loading(),
        fetching: state.fetching(),
        error: state.error(),
        status: state.status(),
        cacheKey: state.cacheKey(),
      };
      if (first && opts.immediate === false) {
        first = false;
        return;
      }
      first = false;
      listener(snapshot);
    });
  }

  function infiniteQuery<TKey extends QueryKey, TPage, TPageParam>(
    cfg: InfiniteQueryConfig<TKey, TPage, TPageParam>
  ): InfiniteQueryState<TPage, TPageParam> {
    const pages = signal<TPage[]>([]);
    const pageParams = signal<TPageParam[]>([]);
    const loading = signal(true);
    const fetching = signal(false);
    const error = signal<Error | null>(null);
    const hasNextPage = signal(true);

    let controller: AbortController | null = null;
    let activeEncodedKey: string | null = null;

    const resolveKey = (): TKey => {
      if (typeof cfg.queryKey === "function") {
        return (cfg.queryKey as () => TKey)();
      }
      return cfg.queryKey;
    };

    const runPage = async (pageParam: TPageParam, append: boolean, expectedKey?: TKey): Promise<TPage | null> => {
      controller?.abort();
      controller = new AbortController();
      const sig = controller.signal;

      fetching.set(true);
      if (!append) loading.set(true);
      if (!append) error.set(null);

      try {
        const queryKey = expectedKey ?? resolveKey();
        const encodedKey = encodeKey(queryKey);
        if (activeEncodedKey !== encodedKey) {
          activeEncodedKey = encodedKey;
          append = false;
          pages.set([]);
          pageParams.set([]);
          hasNextPage.set(true);
        }
        const page = await runWithRetry(
          sig,
          queryKey,
          () =>
            cfg.queryFn({
              signal: sig,
              queryKey,
              pageParam,
            }),
          cfg.retry,
          cfg.retryDelay
        );

        if (sig.aborted) return null;

        const nextPages = append ? [...pages(), page] : [page];
        const nextParams = append ? [...pageParams(), pageParam] : [pageParam];
        pages.set(nextPages);
        pageParams.set(nextParams);

        const next = cfg.getNextPageParam(page, nextPages, nextParams);
        hasNextPage.set(next !== undefined && next !== null);

        error.set(null);
        return page;
      } catch (e) {
        if (sig.aborted) return null;
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        return null;
      } finally {
        if (!sig.aborted) {
          fetching.set(false);
          loading.set(false);
        }
      }
    };

    const refresh = async (): Promise<void> => {
      pages.set([]);
      pageParams.set([]);
      hasNextPage.set(true);
      await runPage(cfg.initialPageParam, false);
    };

    const fetchNextPage = async (): Promise<TPage | null> => {
      const key = resolveKey();
      const encoded = encodeKey(key);
      if (activeEncodedKey !== null && activeEncodedKey !== encoded) {
        return runPage(cfg.initialPageParam, false, key);
      }

      const currentPages = pages();
      const currentParams = pageParams();
      if (currentPages.length === 0) {
        return runPage(cfg.initialPageParam, false, key);
      }
      const next = cfg.getNextPageParam(
        currentPages[currentPages.length - 1],
        currentPages,
        currentParams
      );
      if (next === undefined || next === null) {
        hasNextPage.set(false);
        return null;
      }
      return runPage(next, true, key);
    };

    fetchNextPage().catch(() => {});

    const scope = getCurrentScope();
    if (scope) {
      scope.onCleanup(() => {
        controller?.abort();
        controller = null;
      });
    }

    return {
      pages,
      pageParams,
      loading,
      fetching,
      error,
      hasNextPage,
      fetchNextPage,
      loadMore: fetchNextPage,
      refresh,
    };
  }

  return {
    key: keyBuilder,
    query,
    queryGlobal,
    infiniteQuery,
    prefetchQuery,
    getQueryData,
    setQueryData,
    findQueries,
    cancelQueries,
    refetchQueries,
    observeQuery,
    mutation: (cfg) => createMutation(cfg),
    invalidateKey,
    invalidateTag,
    invalidateTags,
    invalidateQueries,
  };
}
