# Query Client

The query client builds a React Query-like experience on top of cached resources,
while staying signal-driven and scope-safe.

## Core Concepts

- Queries are cached resources keyed by `QueryKey`.
- `query()` caches only inside a scope (safe-by-default).
- `queryGlobal()` enables explicit global caching.
- `staleTime` schedules revalidation after success.

## API Reference

```ts
function createQueryClient(): QueryClient

interface QueryClient {
  key: typeof key
  query<TK extends QueryKey, TR>(cfg: QueryConfig<TK, TR>): QueryState<TR>
  queryGlobal<TK extends QueryKey, TR>(cfg: QueryConfig<TK, TR>): QueryState<TR>
  mutation<TInput, TResult>(cfg: MutationConfig<TInput, TResult>): MutationState<TInput, TResult>
  invalidateKey(key: QueryKey, opts?: { revalidate?: boolean; force?: boolean }): void
  invalidateTag(tag: string, opts?: { revalidate?: boolean; force?: boolean }): void
  invalidateTags(tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }): void
}

interface QueryConfig<TKey, TResult> {
  key: () => TKey
  fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>
  tags?: readonly string[]
  staleTime?: number
  initialValue?: TResult
  onSuccess?: (data: TResult) => void
  onError?: (error: Error) => void
}

interface QueryState<TResult> {
  data(): TResult | null
  loading(): boolean
  error(): Error | null
  refresh(opts?: { force?: boolean }): Promise<void>
  status(): "loading" | "error" | "success"
  cacheKey(): string
}
```

## Basic query

```ts
import { createQueryClient, signal } from "dalila";

const q = createQueryClient();
const userId = signal("1");

const user = q.query({
  key: () => ["user", userId()],
  fetch: async (signal, key) => {
    const res = await fetch(`/api/user/${key[1]}`, { signal });
    return res.json();
  },
  staleTime: 10_000,
});

user.data();
user.loading();
user.error();
```

## Global cache

```ts
const user = q.queryGlobal({
  key: () => ["user", "me"],
  fetch: async (signal) => (await fetch("/api/me", { signal })).json(),
});
```

## Invalidate

```ts
q.invalidateKey(["user", "me"], { revalidate: true });
q.invalidateTag("user");
```

## Comparison: Query vs Resource

| Use | Best choice |
|-----|-------------|
| Simple async state | `createResource` |
| Shared cached data | `createCachedResource` |
| Full query client (keys, invalidation, mutations) | `createQueryClient` |

## Best Practices

- Use `key()` helper to build stable keys.
- Prefer `query()` inside component scopes.
- Use `queryGlobal()` only when you want cross-scope persistence.
- Use `staleTime` for background refresh on static-ish data.

## Common Pitfalls

1) **Expecting cache outside scopes**

`query()` outside a scope does not cache. Use `queryGlobal()` or run inside a scope.

2) **Unstable keys**

Avoid objects in keys. Prefer primitive parts and `key()` helper.

3) **staleTime without scope**

`staleTime` requires a scope for cleanup; it warns and skips scheduling if none.

## Performance Notes

- Queries are cached by encoded keys (O(1) lookup).
- `staleTime` uses timers; avoid tiny stale times across many queries.
- Key changes recreate the underlying resource; keep key functions stable.
