# Resources

Resources manage async data with AbortSignal, reactive state, dependency-driven refresh, and optional cache.

## Decision Tree

```txt
Need reactivity?
├── No  -> fetch/http directly
└── Yes -> Need lifecycle helpers (interval/timeout/event)?
    ├── Yes -> useInterval / useTimeout / useEvent
    └── No  -> Is it data fetching?
        ├── Yes -> Simple/prototype flow?
        │   ├── Yes -> useFetch
        │   └── No  -> Need invalidation by key/tag?
        │       ├── Yes -> createQueryClient
        │       └── No  -> createResource / resourceFromUrl
        └── No  -> createResource (generic async state)
```

## Quick Comparison

| API | Reactive state | Manual refresh | Cache | Invalidation |
|---|---|---|---|---|
| `fetch` / `http` | No | No | No | No |
| `useFetch` | Yes | No | No | No |
| `resourceFromUrl` | Yes | Yes | Optional | No |
| `createResource` | Yes | Yes | Optional | No |
| `createResourceCache` | Yes | Yes | Yes (isolated) | Yes (local key/tag) |
| `createQueryClient` (`query`) | Yes | Yes | Yes | Yes (key/tag) |

## API (Consolidated)

```ts
function createResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options?: {
    initialValue?: T | null;
    onSuccess?: (data: T) => void;
    onError?: (err: Error) => void;
    deps?: () => unknown;
    cache?: string | {
      key: string | (() => string);
      ttlMs?: number;
      tags?: readonly string[];
      persist?: boolean;
    };
    refreshInterval?: number;
    fetchOptions?: RequestInit;
  }
): ResourceState<T>

function resourceFromUrl<T>(
  url: string | (() => string),
  options?: {
    initialValue?: T | null;
    onSuccess?: (data: T) => void;
    onError?: (err: Error) => void;
    deps?: () => unknown;
    cache?: string | {
      key: string | (() => string);
      ttlMs?: number;
      tags?: readonly string[];
      persist?: boolean;
    };
    refreshInterval?: number;
    fetchOptions?: RequestInit;
  }
): ResourceState<T>

function createResourceCache(config?: {
  maxEntries?: number;
  warnOnEviction?: boolean;
}): {
  create: <T>(key: string, fetchFn: (signal: AbortSignal) => Promise<T>, options?: CachedResourceOptions<T>) => ResourceState<T>;
  clear: (key?: string) => void;
  invalidate: (key: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTag: (tag: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTags: (tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }) => void;
  keys: () => string[];
  configure: (config: { maxEntries?: number; warnOnEviction?: boolean }) => void;
}

function configureResourceCache(config: {
  maxEntries?: number;
  warnOnEviction?: boolean;
}): void

interface ResourceState<T> {
  data(): T | null;
  loading(): boolean;
  error(): Error | null;
  refresh(opts?: { force?: boolean }): Promise<void>;
}
```

## Examples

### Basic

```ts
import { createResource } from "dalila";

const user = createResource(async (signal) => {
  const res = await fetch("/api/me", { signal });
  return res.json();
});
```

### With deps

```ts
const userId = signal("1");

const user = createResource(async (signal) => {
  const res = await fetch(`/api/users/${userId()}`, { signal });
  return res.json();
}, {
  deps: () => userId(),
});
```

### With cache

```ts
const user = createResource(async (signal) => {
  const res = await fetch("/api/me", { signal });
  return res.json();
}, {
  cache: {
    key: "user:me",
    ttlMs: 60_000,
    tags: ["user"],
  },
});
```

### With dynamic cache key

```ts
const userId = signal("1");

const user = createResource(async (signal) => {
  const res = await fetch(`/api/users/${userId()}`, { signal });
  return res.json();
}, {
  deps: () => userId(),
  cache: {
    key: () => `user:${userId()}`,
    tags: ["user"],
  },
});
```

### URL helper

```ts
import { resourceFromUrl } from "dalila";

const todos = resourceFromUrl("/api/todos", {
  cache: "todos:list",
  fetchOptions: { credentials: "include" },
});
```

### With createHttpClient

```ts
import { createHttpClient } from "dalila/http";
import { createResource, signal } from "dalila";

const http = createHttpClient({
  baseURL: "https://api.example.com",
});

const userId = signal("1");

const user = createResource(async (signal) => {
  return http.get(`/users/${userId()}`, { signal });
}, {
  deps: () => userId(),
  cache: {
    key: () => `users:${userId()}`,
    tags: ["users"],
  },
});
```

### Isolated cache

```ts
import { createResourceCache } from "dalila";

const cache = createResourceCache({ maxEntries: 100 });

const me = cache.create("user:me", async (signal) => {
  const res = await fetch("/api/me", { signal });
  return res.json();
});

cache.invalidateTag("user");
cache.clear();
```

## Notes

- Outside a scope, cache is disabled by default unless `persist: true`.
- `refreshInterval` requires a scope for automatic cleanup.
