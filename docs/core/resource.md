# Resources

Resources manage async data with AbortSignal, reactive state, and optional caching.

## Core Concepts

- **Reactive state**: `data()`, `loading()`, `error()` are signals.
- **Cancellation**: in-flight work aborts on refresh or scope disposal.
- **Refresh correctness**: `refresh()` always waits for the run you requested.
- **Caching**: optional, safe-by-default (requires scope or explicit persist).

## API Reference

```ts
function createResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options?: { initialValue?: T | null; onSuccess?: (data: T) => void; onError?: (err: Error) => void }
): ResourceState<T>

function createFetchResource<T>(
  url: string | (() => string),
  options?: { initialValue?: T | null; onSuccess?: (data: T) => void; onError?: (err: Error) => void; fetchOptions?: RequestInit }
): ResourceState<T>

function createDependentResource<T, D>(
  fetchFn: (signal: AbortSignal, deps: D) => Promise<T>,
  deps: (() => D) | ReadonlyArray<Signal<any>> | { get: () => D; key?: () => any },
  options?: { initialValue?: T | null; onSuccess?: (data: T) => void; onError?: (err: Error) => void }
): ResourceState<T>

function createCachedResource<T>(
  key: string,
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options?: { ttlMs?: number; tags?: readonly string[]; persist?: boolean; fetchScope?: Scope | null }
): ResourceState<T>

function createCachedResourceById<T, I>(
  key: string,
  id: I,
  fetchFn: (signal: AbortSignal, id: I) => Promise<T>,
  options?: { ttlMs?: number; tags?: readonly string[]; persist?: boolean }
): ResourceState<T>

function createAutoRefreshResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  ms: number
): ResourceState<T>

function configureResourceCache(config: { maxEntries?: number; warnOnEviction?: boolean }): void
function clearResourceCache(key?: string): void
function invalidateResourceCache(key: string, opts?: { revalidate?: boolean; force?: boolean }): void
function invalidateResourceTag(tag: string, opts?: { revalidate?: boolean; force?: boolean }): void
function invalidateResourceTags(tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }): void

function createIsolatedCache(): {
  createCachedResource: typeof createCachedResource;
  clearCache: typeof clearResourceCache;
  invalidateKey: typeof invalidateResourceCache;
  invalidateTag: typeof invalidateResourceTag;
  getCacheKeys: () => string[];
}

interface ResourceState<T> {
  data(): T | null
  loading(): boolean
  error(): Error | null
  refresh(opts?: { force?: boolean }): Promise<void>
}
```

## createResource

```ts
import { createResource } from "dalila";

const user = createResource(async (signal) => {
  const res = await fetch("/api/user", { signal });
  return res.json();
});

user.data();     // T | null
user.loading();  // boolean
user.error();    // Error | null

await user.refresh();
```

Behavior:
- `refresh()` dedupes if already loading; `{ force: true }` aborts and restarts.
- `onSuccess/onError` are not called for aborted runs.

## createFetchResource

```ts
import { createFetchResource } from "dalila";

const todos = createFetchResource("/api/todos");
```

Notes:
- Non-2xx responses throw and land in `error()`.

## createDependentResource

Use explicit deps instead of implicit signal reads inside the fetch.

```ts
import { createDependentResource, signal } from "dalila";

const id = signal("1");

const user = createDependentResource(
  async (signal, deps) => {
    const res = await fetch(`/api/user/${deps}`, { signal });
    return res.json();
  },
  () => id()
);
```

Notes:
- `deps` can be a getter, an array of signals, or `{ get, key }`.
- If deps don't change, the resource does not refetch.

## Cached resources

```ts
import { createCachedResource } from "dalila";

const user = createCachedResource(
  "user:me",
  async (signal) => {
    const res = await fetch("/api/me", { signal });
    return res.json();
  },
  { tags: ["user"], ttlMs: 60_000 }
);
```

Behavior:
- Safe-by-default: outside a scope, caching is disabled unless `persist: true`.
- `ttlMs` expires entries lazily on access.
- Tags allow invalidation by group.

## Cache control

```ts
import { invalidateResourceCache, invalidateResourceTag } from "dalila";

invalidateResourceCache("user:me");
invalidateResourceTag("user");
```

## Cache configuration

```ts
import { configureResourceCache } from "dalila";

configureResourceCache({
  maxEntries: 500,
  warnOnEviction: true,
});
```

Notes:
- LRU eviction removes entries with refCount 0 when the cache is too large.
- Persisted entries can still be evicted if not actively referenced.

## Isolated caches

```ts
import { createIsolatedCache } from "dalila";

const cache = createIsolatedCache();
const user = cache.createCachedResource("user:me", fetchUser);
```

## Comparison: Resource Options

| Use | Best choice |
|-----|-------------|
| Simple async state | `createResource` |
| Fetch by URL | `createFetchResource` |
| Explicit deps | `createDependentResource` |
| Shared cached data | `createCachedResource` |
| App-level caching + mutations | Query client |

## Best Practices

- Use cached resources for shared data.
- Prefer explicit deps if fetch reads many signals.
- Use `persist: true` only when you need global caching; add `ttlMs`.
- Use `fetchScope` when you need context available during the synchronous phase.

## Common Pitfalls

1) **Expecting cache outside scopes**

Calling `createCachedResource` outside a scope does not cache unless `persist: true`.

2) **Persist without TTL**

`persist: true` with no `ttlMs` can grow cache indefinitely.

3) **Reading context after await**

Context is available only before the first await. Capture it synchronously.

## Performance Notes

- Cache lookups are O(1) by key.
- LRU eviction runs only when max entries are exceeded.
- Frequent refreshes can create network churn; use stale windows or dedupe.
