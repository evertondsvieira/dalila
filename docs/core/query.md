# Query Client

Query Client provides a cache-first, key-driven orchestration layer built on top of Resources.
It centralizes reads, invalidation, optimistic cache updates, prefetching, and infinite pagination.

## Core Concepts

```txt
┌─────────────────────────────────────────────────────────────┐
│                    Query Client Layer                       │
│                                                             │
│   query(key, fetch)  ─┐                                     │
│   queryGlobal(...)    ├── cached by encoded key             │
│   prefetchQuery(...)  ┘                                     │
│                                                             │
│   setQueryData/getQueryData   -> manual cache patching      │
│   invalidateKey/Tag/Queries   -> targeted revalidation      │
│   cancelQueries               -> abort in-flight reads      │
│                                                             │
│   infiniteQuery               -> pages + fetchNextPage      │
└─────────────────────────────────────────────────────────────┘
```

**Modes:**
1. `query()` for scope-safe caching (default).
2. `queryGlobal()` for explicit cross-scope persistence.
3. `infiniteQuery()` for append-based pagination.

## API Reference

```ts
function createQueryClient(): QueryClient

interface QueryClient {
  key: typeof key

  query<TK extends QueryKey, TR>(cfg: QueryConfig<TK, TR>): QueryState<TR>
  queryGlobal<TK extends QueryKey, TR>(cfg: QueryConfig<TK, TR>): QueryState<TR>

  infiniteQuery<TK extends QueryKey, TP, TParam>(cfg: InfiniteQueryConfig<TK, TP, TParam>): InfiniteQueryState<TP, TParam>

  prefetchQuery<TK extends QueryKey, TR>(cfg: PrefetchQueryConfig<TK, TR>): Promise<TR | null>

  getQueryData<TR>(key: QueryKey): TR | null | undefined
  setQueryData<TR>(
    key: QueryKey,
    updater: TR | null | ((current: TR | null | undefined) => TR | null)
  ): TR | null
  findQueries(filters?: QueryFilters | QueryKey): QueryInfo[]
  cancelQueries(filters?: QueryFilters | QueryKey): void
  refetchQueries(filters?: QueryFilters | QueryKey, opts?: { force?: boolean }): void
  observeQuery<TR>(
    state: QueryState<TR>,
    listener: (snapshot: QueryObserverSnapshot<TR>) => void,
    opts?: { immediate?: boolean }
  ): () => void

  mutation<TInput, TResult, TContext = unknown>(cfg: MutationConfig<TInput, TResult, TContext>): MutationState<TInput, TResult>

  invalidateKey(key: QueryKey, opts?: { revalidate?: boolean; force?: boolean }): void
  invalidateTag(tag: string, opts?: { revalidate?: boolean; force?: boolean }): void
  invalidateTags(tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }): void
  invalidateQueries(filters: QueryFilters | QueryKey, opts?: { force?: boolean }): void
}
```

### Query config/state

```ts
interface QueryConfig<TKey, TResult> {
  key: () => TKey
  fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>
  tags?: readonly string[]
  staleTime?: number
  staleWhileRevalidate?: boolean
  retry?: number | ((failureCount: number, error: Error, key: TKey) => boolean)
  retryDelay?: number | ((failureCount: number, error: Error, key: TKey) => number)
  initialValue?: TResult
  onSuccess?: (data: TResult) => void
  onError?: (error: Error) => void
}

interface QueryState<TResult> {
  data(): TResult | null
  loading(): boolean
  fetching(): boolean
  error(): Error | null
  refresh(opts?: { force?: boolean }): Promise<void>
  status(): "loading" | "error" | "success"
  cacheKey(): string
}
```

### Infinite query config/state

```ts
interface InfiniteQueryConfig<TKey, TPage, TPageParam> {
  queryKey: TKey | (() => TKey)
  queryFn: (input: { signal: AbortSignal; queryKey: TKey; pageParam: TPageParam }) => Promise<TPage>
  initialPageParam: TPageParam
  getNextPageParam: (lastPage: TPage, pages: readonly TPage[], pageParams: readonly TPageParam[]) => TPageParam | null | undefined
  retry?: number | ((failureCount: number, error: Error, key: TKey) => boolean)
  retryDelay?: number | ((failureCount: number, error: Error, key: TKey) => number)
}

interface InfiniteQueryState<TPage, TPageParam> {
  pages(): TPage[]
  pageParams(): TPageParam[]
  loading(): boolean
  fetching(): boolean
  error(): Error | null
  hasNextPage(): boolean
  fetchNextPage(): Promise<TPage | null>
  loadMore(): Promise<TPage | null>
  refresh(): Promise<void>
}
```

## Basic Query

```ts
const q = createQueryClient();
const userId = signal("1");

const user = q.query({
  key: () => q.key("user", userId()),
  fetch: async (signal, [_type, id]) => {
    const res = await fetch(`/api/users/${id}`, { signal });
    if (!res.ok) throw new Error("failed");
    return res.json();
  },
  staleTime: 30_000,
  staleWhileRevalidate: true,
});
```

## Prefetch

```ts
await q.prefetchQuery({
  key: ["todo", 42],
  fetch: async (signal, [_type, id]) => {
    const res = await fetch(`/api/todos/${id}`, { signal });
    return res.json();
  },
});
```

## Manual Cache Patching

```ts
const key = ["todos"] as const;
const previous = q.getQueryData<{ id: number; title: string }[]>(key);

q.setQueryData(key, (old) => [...(old ?? []), { id: 99, title: "optimistic" }]);

// rollback
q.setQueryData(key, previous ?? []);
```

## Infinite Query

```ts
const todos = q.infiniteQuery({
  queryKey: ["todos"],
  initialPageParam: 1,
  queryFn: async ({ signal, pageParam }) => {
    const res = await fetch(`/api/todos?page=${pageParam}`, { signal });
    return res.json();
  },
  getNextPageParam: (lastPage) => lastPage.nextPage,
});

await todos.fetchNextPage();
```

## Retry

```ts
const user = q.query({
  key: () => q.key("user", 1),
  retry: 3,
  retryDelay: (attempt) => attempt * 200,
  fetch: async (signal) => {
    const res = await fetch("/api/user/1", { signal });
    if (!res.ok) throw new Error("request failed");
    return res.json();
  },
});
```

## Query Filters

```ts
const activeTodos = q.findQueries({
  keyPrefix: ["todos"],
  predicate: (entry) => entry.fetching,
});

q.refetchQueries({ keyPrefix: ["todos"] });
q.cancelQueries({ keyPrefix: ["todos"] });
```

## Query Observer

```ts
const stop = q.observeQuery(user, (snapshot) => {
  console.log(snapshot.status, snapshot.data);
});

stop();
```

## Invalidation and Cancellation

```ts
q.invalidateKey(["user", 1], { revalidate: true, force: true });
q.invalidateTag("users", { revalidate: true });
q.invalidateQueries(["todos"]);

q.cancelQueries(["todos"]);
```

## Best Practices

1. Use `q.key(...)` or stable primitive arrays for keys.
2. Prefer `query()` inside scopes; use `queryGlobal()` explicitly.
3. Use `fetching()` for background indicators and `loading()` for first load only.
4. Use `prefetchQuery` before navigation for perceived speed.
5. Use `invalidateQueries(prefix)` for collection-level refresh.

## Common Pitfalls

1. **Unstable keys**

Object keys create cache misses. Keep keys primitive and deterministic.

2. **Ignoring cancellation**

Always pass the provided signal to network calls.

3. **Assuming query() caches everywhere**

`query()` is scope-safe; use `queryGlobal()` for explicit global persistence.

## Performance Notes

- Key lookup and cache patching are O(1) by encoded key.
- Prefix invalidation/cancelation iterate active query registry; keep keys coarse enough.
- Infinite query appends pages incrementally; add app-level pruning if pages grow very large.
