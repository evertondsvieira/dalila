# Resources

Resources are Dalila's async state primitive for data fetching and other asynchronous flows.
They provide cancellation, refresh semantics, optional cache, and stale-while-revalidate behavior.

## Core Concepts

```txt
┌─────────────────────────────────────────────────────────────┐
│                     Resource Lifecycle                      │
│                                                             │
│  createResource(fetchFn, options)                           │
│        │                                                    │
│        ├── data(): T | null                                 │
│        ├── loading(): boolean   (initial load only)         │
│        ├── fetching(): boolean  (any in-flight fetch)       │
│        ├── error(): Error | null                            │
│        └── refresh()/cancel()/setData()/setError()          │
│                                                             │
│  refresh(force) -> abort previous (if needed) + revalidate  │
└─────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
1. **Abort-aware**: in-flight requests are aborted on rerun/scope cleanup.
2. **Refresh correctness**: `await refresh()` resolves when the requested run finishes.
3. **SWR**: with `staleWhileRevalidate`, old data stays visible while refetching.
4. **Optional cache**: keyed cache with TTL/tags/persist.

## API Reference

### `createResource`

```ts
function createResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options?: {
    initialValue?: T | null;
    onSuccess?: (data: T) => void;
    onError?: (error: Error) => void;

    deps?: () => unknown;
    cache?: string | {
      key: string | (() => string);
      ttlMs?: number;
      tags?: readonly string[];
      persist?: boolean;
    };

    refreshInterval?: number;
    staleTime?: number;
    staleWhileRevalidate?: boolean;

    fetchOptions?: RequestInit;
  }
): ResourceState<T>
```

### `resourceFromUrl`

```ts
function resourceFromUrl<T>(
  url: string | (() => string),
  options?: CreateResourceOptions<T>
): ResourceState<T>
```

### `ResourceState`

```ts
interface ResourceState<T> {
  data(): T | null;
  loading(): boolean;
  fetching(): boolean;
  error(): Error | null;

  refresh(opts?: { force?: boolean }): Promise<void>;
  cancel(): void;

  setData(value: T | null): void;
  setError(value: Error | null): void;
}
```

### Cache invalidation/introspection helpers

```ts
function invalidateResourceCache(key: string, opts?: { revalidate?: boolean; force?: boolean }): void
function invalidateResourceTag(tag: string, opts?: { revalidate?: boolean; force?: boolean }): void
function invalidateResourceTags(tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }): void

function getResourceCacheData<T>(key: string): T | null | undefined
function setResourceCacheData<T>(key: string, value: T | null): boolean
function cancelResourceCache(key: string): void
```

## Basic Usage

```ts
import { createResource } from "dalila";

const user = createResource(async (signal) => {
  const res = await fetch("/api/me", { signal });
  if (!res.ok) throw new Error("failed");
  return res.json();
});
```

## SWR + staleTime

```ts
const user = createResource(fetchUser, {
  staleWhileRevalidate: true,
  staleTime: 5 * 60 * 1000,
});

// loading(): true only when there is no data yet
// fetching(): true during initial load and refetches
```

## With deps

```ts
const userId = signal("1");

const user = createResource(async (signal) => {
  const res = await fetch(`/api/users/${userId()}`, { signal });
  return res.json();
}, {
  deps: () => userId(),
});
```

## With cache (key/tags/ttl)

```ts
const todos = createResource(async (signal) => {
  const res = await fetch("/api/todos", { signal });
  return res.json();
}, {
  cache: {
    key: "todos:list",
    tags: ["todos"],
    ttlMs: 60_000,
  },
});

invalidateResourceTag("todos", { revalidate: true, force: true });
```

## Manual cache patch

```ts
const key = "todos:list";
const current = getResourceCacheData<{ id: number; title: string }[]>(key) ?? [];
setResourceCacheData(key, [...current, { id: 99, title: "Optimistic" }]);
```

## Related Features in Query/Mutation

`createResource` is the base async primitive.

For higher-level orchestration:

- **Prefetch**: `queryClient.prefetchQuery(...)`
- **Infinite pagination**: `queryClient.infiniteQuery(...)`
- **Optimistic lifecycle**: `mutation.onMutate/onError/onSettled` with `getQueryData/setQueryData`

See:
- `docs/core/query.md`
- `docs/core/mutation.md`

## `loading()` vs `fetching()`

| State | Meaning |
|---|---|
| `loading()` | First load without data |
| `fetching()` | Any network run in progress |

Use `loading()` for skeletons and `fetching()` for background refresh indicators.

## Best Practices

1. Pass `AbortSignal` to all network calls.
2. Use `deps` to control revalidation ownership explicitly.
3. Prefer cache keys with stable primitive identity.
4. Use tags for cross-resource invalidation.
5. Use `staleTime` on resources that can be revalidated in background.

## Common Pitfalls

1. **No scope + no persist**

Caching is safe-by-default: outside scope, cache is disabled unless `persist: true`.

2. **Using `loading()` as global spinner**

For refetches under SWR, use `fetching()`, not `loading()`.

3. **Forcing every refresh**

`refresh({ force: true })` aborts in-flight work; use only when needed.

## Performance Notes

- Resource cache supports TTL and LRU-cap by config (`configureResourceCache`).
- Prefer tag invalidation over many key invalidations when possible.
- Use SWR to avoid UI flicker on frequent refetch.
