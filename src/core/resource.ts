import { signal, effect, effectAsync, type Signal } from "./signal.js";
import { isInDevMode } from "./dev.js";
import { getCurrentScope, createScope, isScopeDisposed, withScope, type Scope } from "./scope.js";

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

/** Helper type for deferred promise with synchronous resolve. */
type Deferred = { promise: Promise<void>; resolve: () => void };

/**
 * Creates a Deferred object - a promise that can be resolved externally.
 * Used internally by the waiter system for correct refresh.
 */
function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * Async data primitive with cancellation and refresh correctness.
 * 
 * Design goals:
 * - Scope-first: if created inside a scope, aborts and cleans up when scope is disposed.
 * - Abort-safe callbacks: does not call onSuccess/onError for aborted runs.
 * - Correct refresh: `await refresh()` must wait for the new fetch, not an outdated inFlight.
 * 
 * Semantics:
 * - A driver `effectAsync` runs `fetchFn(signal)` whenever `refreshTick` changes.
 * - Each run gets a new AbortController.
 * - Reruns abort the previous controller.
 * 
 * Why a waiter system?
 * - Without it, refresh() can accidentally await an old promise and resolve prematurely.
 * - We map each refresh request to a runId and resolve its waiter when that run finishes.
 * 
 * Safety:
 * - If the driver reruns during a fetch, an aborted run must NOT resolve the latest waiter.
 *   Guard: only resolves if `lastRunController === controller` for that run.
 * 
 * Lifetime:
 * - On parent scope cleanup:
 *   - aborts current request
 *   - disposes the driver
 *   - resolves all pending waiters (avoids hanging Promises)
 */
function createResourceBase<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options: ResourceOptions<T> = {}
): ResourceState<T> {
  const data = signal<T | null>(options.initialValue ?? null);
  const loading = signal<boolean>(false);
  const fetching = signal<boolean>(false);
  const error = signal<Error | null>(null);
  const staleWhileRevalidate = options.staleWhileRevalidate === true;
  let hasSettledValue = Object.prototype.hasOwnProperty.call(options, "initialValue");

  /**
   * Reactive "kick" signal: bumping this triggers the driver.
   * We store runId here so the driver can resolve the correct waiter.
   */
  const refreshTick = signal<number>(0);

  /** Tracks the currently running fetch promise (for non-forced refresh dedupe). */
  let inFlight: Promise<void> | null = null;

  /** AbortController of the most recent run (force abort + "current run" guard). */
  let lastRunController: AbortController | null = null;

  /** Monotonic run counter. */
  let runId = 0;

  /**
   * Waiters keyed by runId:
   * - refresh() creates a waiter for the next runId
   * - driver resolves it when that run finishes (if still current)
   */
  const waiters = new Map<number, { deferred: Deferred; controller: AbortController | null }>();

  const owningScope = getCurrentScope();

  /**
   * Requests a new run and returns a Promise that resolves when that run completes.
   */
  function requestRun(): Promise<void> {
    const id = ++runId;
    const deferred = createDeferred();
    waiters.set(id, { deferred, controller: null });

    refreshTick.set(id);
    return deferred.promise;
  }

  /**
   * Driver:
   * - reads refreshTick() to start a run
   * - aborts previous run on rerun
   * - updates signals only for non-aborted runs
   * - resolves the waiter only if this run is still current
   */
  const disposeDriver = effectAsync((runSignal) => {
    const id = refreshTick();
    const waiter = waiters.get(id);

    // Abort previous run before starting a new one.
    lastRunController?.abort();

    const controller = new AbortController();
    lastRunController = controller;
    if (waiter) waiter.controller = controller;

    // If the effect run is aborted (rerun or scope disposal), abort this request too.
    const onAbort = () => controller.abort();
    runSignal.addEventListener("abort", onAbort, { once: true });

    const requestSignal = controller.signal;

    fetching.set(true);
    loading.set(!(staleWhileRevalidate && hasSettledValue));
    error.set(null);

    inFlight = (async () => {
      try {
        // NOTE: fetchFn runs inside the effect's sync tracking phase.
        // Synchronous signal reads before the first await may be tracked.
        // Use createDependentResource or QueryClient to opt out of this.
        const result = await fetchFn(requestSignal);
        if (requestSignal.aborted) return;

        data.set(result);
        hasSettledValue = true;
        options.onSuccess?.(result);
      } catch (err) {
        if (requestSignal.aborted) return;

        const errorObj = err instanceof Error ? err : new Error(String(err));
        error.set(errorObj);
        options.onError?.(errorObj);
      } finally {
        // Only flip loading off for non-aborted runs.
        if (!requestSignal.aborted) {
          fetching.set(false);
          loading.set(false);
        }
      }
    })();

    inFlight.finally(() => {
      if (waiter && waiter.controller === controller) {
        waiter.deferred.resolve();
        waiters.delete(id);
      }
      runSignal.removeEventListener("abort", onAbort);
    });
  });

  /**
   * Scope cleanup:
   * - abort current run
   * - dispose driver (unsubscribe deps)
   * - resolve pending waiters (avoid dangling Promises)
   */
  if (owningScope) {
    owningScope.onCleanup(() => {
      lastRunController?.abort();
      lastRunController = null;
      disposeDriver();

      loading.set(false);
      fetching.set(false);

      for (const [, deferred] of waiters) {
        deferred.deferred.resolve();
      }
      waiters.clear();
    });
  }

  async function refresh(opts: ResourceRefreshOptions = {}): Promise<void> {
    // Dedupe: if already loading and not forced, just await the active run.
    if (fetching() && !opts.force) {
      await Promise.resolve();
      await (inFlight ?? Promise.resolve());
      return;
    }

    // Force: abort and request a new run.
    if (opts.force) {
      lastRunController?.abort();
    }

    const waiter = requestRun();
    await waiter;
  }

  function cancel(): void {
    lastRunController?.abort();
    lastRunController = null;
    loading.set(false);
    fetching.set(false);
  }

  function setData(value: T | null): void {
    data.set(value);
    hasSettledValue = true;
  }

  function setError(value: Error | null): void {
    error.set(value);
  }

  return { data, loading, fetching, error, refresh, cancel, setData, setError };
}

function normalizeResourceCachePolicy(cache: CreateResourceOptions<unknown>["cache"]): ResourceCachePolicy | null {
  if (!cache) return null;
  if (typeof cache === "string") return { key: cache };
  return cache;
}

function attachResourceRefreshInterval<T>(resource: ResourceState<T>, refreshInterval: number): void {
  const scope = getCurrentScope();
  if (!scope) {
    if (isInDevMode()) {
      console.warn(
        `[Dalila] createResource(..., { refreshInterval }) called outside a scope. ` +
          `Auto-refresh will not work. Use within a scope or manage cleanup manually.`
      );
    }
    return;
  }

  const intervalId = setInterval(() => {
    resource.refresh().catch(() => {});
  }, refreshInterval);

  scope.onCleanup(() => {
    clearInterval(intervalId);
  });
}

function enqueueForcedRefresh(resource: ResourceState<any>): void {
  queueMicrotask(() => {
    resource.refresh({ force: true }).catch(() => {});
  });
}

function createDynamicCachedResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  cachePolicy: ResourceCachePolicy,
  options: CreateResourceOptions<T>
): ResourceState<T> {
  const ownerScope = getCurrentScope();
  const rawKey = cachePolicy.key;
  const keyGetter: () => string = typeof rawKey === "function"
    ? rawKey
    : () => rawKey;
  const deps = options.deps;

  const cachedOptions: CachedResourceOptions<T> = {
    initialValue: options.initialValue,
    onError: options.onError,
    onSuccess: options.onSuccess,
    staleWhileRevalidate: options.staleWhileRevalidate,
    ttlMs: cachePolicy.ttlMs,
    tags: cachePolicy.tags,
    persist: cachePolicy.persist,
  };

  let activeKey: string | null = null;
  let activeKeyScope: Scope | null = null;
  let activeResource: ResourceState<T> | null = null;
  const activeResourceSignal = signal<ResourceState<T> | null>(null);
  let first = true;

  const activateKey = (key: string): ResourceState<T> => {
    if (activeResource && activeKey === key) {
      return activeResource;
    }

    if (ownerScope) {
      activeKeyScope?.dispose();
      const keyScope = createScope(ownerScope);
      activeKeyScope = keyScope;
      activeResource = withScope(keyScope, () => createCachedResource<T>(key, fetchFn, cachedOptions));
    } else {
      // Outside a scope, createCachedResource already applies safe-by-default semantics.
      activeResource = createCachedResource<T>(key, fetchFn, cachedOptions);
    }

    activeKey = key;
    activeResourceSignal.set(activeResource);
    return activeResource;
  };

  effect(() => {
    if (deps) deps();
    const key = keyGetter();
    const previousKey = activeKey;
    const resource = activateKey(key);

    // If deps changed but key stayed the same, revalidate current entry.
    if (!first && deps && previousKey === key) {
      enqueueForcedRefresh(resource);
    }
    if (first) {
      first = false;
    }
  });

  if (ownerScope) {
    ownerScope.onCleanup(() => {
      activeKeyScope?.dispose();
      activeKeyScope = null;
    });
  }

  return {
    data: () => activeResourceSignal()?.data() ?? null,
    loading: () => activeResourceSignal()?.loading() ?? false,
    fetching: () => activeResourceSignal()?.fetching() ?? false,
    error: () => activeResourceSignal()?.error() ?? null,
    refresh: (opts?: ResourceRefreshOptions) => activeResourceSignal()?.refresh(opts) ?? Promise.resolve(),
    cancel: () => activeResourceSignal()?.cancel(),
    setData: (value: T | null) => activeResourceSignal()?.setData(value),
    setError: (value: Error | null) => activeResourceSignal()?.setError(value),
  };
}

export function createResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options: CreateResourceOptions<T> = {}
): ResourceState<T> {
  const { deps, refreshInterval, staleTime } = options;
  const cachePolicy = normalizeResourceCachePolicy(options.cache);
  const dynamicCacheKeyGetter = cachePolicy && typeof cachePolicy.key === "function"
    ? cachePolicy.key
    : null;
  const fetchFnForCached = deps
    ? async (signal: AbortSignal) => {
      // Keep deps ownership explicit (via options.deps) when cache is enabled.
      // This avoids duplicate revalidations from sync reads inside fetchFn.
      await Promise.resolve();
      return fetchFn(signal);
    }
    : fetchFn;

  const ownerScope = getCurrentScope();
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleStaleRefresh = (expectedDynamicKey?: string) => {
    if (!ownerScope) return;
    if (!staleTime || staleTime <= 0) return;
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
      if (dynamicCacheKeyGetter) {
        if (expectedDynamicKey == null) return;
        if (dynamicCacheKeyGetter() !== expectedDynamicKey) return;
      }
      resource.refresh({ force: false }).catch(() => {});
    }, staleTime);
  };

  const baseOptions: ResourceOptions<T> = {
    initialValue: options.initialValue,
    onError: options.onError,
    onSuccess: (value) => {
      options.onSuccess?.(value);
      const expectedDynamicKey = dynamicCacheKeyGetter ? dynamicCacheKeyGetter() : undefined;
      scheduleStaleRefresh(expectedDynamicKey);
    },
    staleWhileRevalidate: options.staleWhileRevalidate,
  };

  let resource: ResourceState<T>;

  if (cachePolicy) {
    const key = cachePolicy.key;

    if (typeof key === "function") {
      resource = createDynamicCachedResource(fetchFnForCached, cachePolicy, {
        ...options,
        ...baseOptions,
      });
    } else {
      resource = createCachedResource<T>(key, fetchFnForCached, {
        ...baseOptions,
        ttlMs: cachePolicy.ttlMs,
        tags: cachePolicy.tags,
        persist: cachePolicy.persist,
      });

      if (deps) {
        let first = true;
        effect(() => {
          deps();
          if (first) {
            first = false;
            return;
          }
          enqueueForcedRefresh(resource);
        });
      }
    }
  } else if (deps) {
    resource = createDependentResource<T, unknown>(
      (signal) => fetchFn(signal),
      deps,
      baseOptions
    );
  } else {
    resource = createResourceBase(fetchFn, baseOptions);
  }

  if (refreshInterval != null && refreshInterval > 0) {
    attachResourceRefreshInterval(resource, refreshInterval);
  }

  if (ownerScope && staleTime && staleTime > 0) {
    ownerScope.onCleanup(() => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = null;
    });
  }

  return resource;
}

/**
 * Fetch helper built on top of createResource().
 *
 * Semantics:
 * - `url` may be static or dynamic (function).
 * - Uses fetch() with AbortSignal.
 * - Non-2xx responses throw (surfaced via resource.error()).
 */
function createFetchResource<T>(
  url: string | (() => string),
  options: CreateResourceOptions<T> = {}
): ResourceState<T> {
  return resourceFromUrl<T>(url, options);
}

export function resourceFromUrl<T>(
  url: string | (() => string),
  options: CreateResourceOptions<T> = {}
): ResourceState<T> {
  const { fetchOptions, ...resourceOptions } = options;
  return createResource<T>(async (signal) => {
    const fetchUrl = typeof url === "function" ? url() : url;

    const response = await fetch(fetchUrl, {
      ...fetchOptions,
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return (await response.json()) as T;
  }, resourceOptions);
}

export type DepSource<D> =
  | (() => D)
  | ReadonlyArray<Signal<any>>
  | { get: () => D; key?: () => any };

/**
 * Resource that revalidates when dependencies change.
 *
 * Design goals:
 * - Same guarantees as createResource():
 *   - abort-safe callbacks
 *   - refresh waiter correctness
 * - Flexible deps:
 *   - function getter (value mode)
 *   - array of signals (array mode)
 *   - accessor with optional key() (key mode for stable change detection)
 *
 * Semantics:
 * - The driver reads deps, decides if changed, then fetches.
 * - If deps didn't change, it does nothing (no remount/refetch).
 *
 * Important edge-case:
 * - If the effect reruns while a fetch is still in flight and deps are unchanged,
 *   we must not resolve refresh waiters prematurely.
 *   Guard: early-return resolves only if `!fetching()`.
 */
function createDependentResource<T, D>(
  fetchFn: (signal: AbortSignal, deps: D) => Promise<T>,
  deps: DepSource<D>,
  options: ResourceOptions<T> = {}
): ResourceState<T> {
  const data = signal<T | null>(options.initialValue ?? null);
  const loading = signal<boolean>(false);
  const fetching = signal<boolean>(false);
  const error = signal<Error | null>(null);
  const staleWhileRevalidate = options.staleWhileRevalidate === true;
  let hasSettledValue = Object.prototype.hasOwnProperty.call(options, "initialValue");

  const refreshTick = signal<number>(0);

  /** Last-seen deps snapshots for cheap "changed" detection. */
  let lastKey: any = Symbol("init");
  let lastArr: any[] | null = null;
  let lastVal: any = Symbol("init");

  let inFlight: Promise<void> | null = null;
  let lastRunController: AbortController | null = null;

  let runId = 0;
  const waiters = new Map<number, { deferred: Deferred; controller: AbortController | null }>();

  const owningScope = getCurrentScope();

  function requestRun(): Promise<void> {
    const id = ++runId;
    const deferred = createDeferred();
    waiters.set(id, { deferred, controller: null });

    refreshTick.set(id);
    return deferred.promise;
  }

  const disposeDriver = effectAsync((runSignal) => {
    const id = refreshTick();
    const waiter = waiters.get(id);

    const resolved = resolveDeps(deps);

    const changed = depsChanged(resolved);
    if (!changed) {
      // Only resolve the waiter if no fetch is in flight.
      // (refresh forces changed=true, so this path only occurs on normal reruns)
      if (!fetching()) {
        if (waiter) {
          waiter.deferred.resolve();
          waiters.delete(id);
        }
      }
      return;
    }

    lastRunController?.abort();

    const controller = new AbortController();
    lastRunController = controller;
    if (waiter) waiter.controller = controller;

    const onAbort = () => controller.abort();
    runSignal.addEventListener("abort", onAbort, { once: true });

    const requestSignal = controller.signal;

    fetching.set(true);
    loading.set(!(staleWhileRevalidate && hasSettledValue));
    error.set(null);

    inFlight = (async () => {
      try {
        // Break reactive tracking: run fetchFn outside effect's sync tracking phase.
        await Promise.resolve();
        const result = await fetchFn(requestSignal, resolved.deps);
        if (requestSignal.aborted) return;

        data.set(result);
        hasSettledValue = true;
        options.onSuccess?.(result);
      } catch (err) {
        if (requestSignal.aborted) return;

        const errorObj = err instanceof Error ? err : new Error(String(err));
        error.set(errorObj);
        options.onError?.(errorObj);
      } finally {
        if (lastRunController === controller) {
          lastRunController = null;
          fetching.set(false);
          loading.set(false);
        }
      }
    })();

    inFlight.finally(() => {
      if (waiter && waiter.controller === controller) {
        waiter.deferred.resolve();
        waiters.delete(id);
      }
      runSignal.removeEventListener("abort", onAbort);
    });
  });

  if (owningScope) {
    owningScope.onCleanup(() => {
      lastRunController?.abort();
      lastRunController = null;
      disposeDriver();

      loading.set(false);
      fetching.set(false);

      for (const [, deferred] of waiters) {
        deferred.deferred.resolve();
      }
      waiters.clear();
    });
  }

  function depsChanged(resolved: ResolvedDeps<D>): boolean {
    if (resolved.kind === "key") {
      if (Object.is(lastKey, resolved.key)) return false;
      lastKey = resolved.key;
      return true;
    }

    if (resolved.kind === "array") {
      if (lastArr && shallowArrayEqual(lastArr, resolved.deps as unknown as any[])) return false;
      lastArr = (resolved.deps as unknown as any[]).slice();
      return true;
    }

    if (Object.is(lastVal, resolved.deps)) return false;
    lastVal = resolved.deps;
    return true;
  }

  /**
   * Manual refresh for dependent resources.
   *
   * Implementation detail:
   * - We force depsChanged() to return true by resetting last* sentinels,
   *   so the next driver run always fetches even if deps are unchanged.
   */
  async function refresh(opts: ResourceRefreshOptions = {}): Promise<void> {
    if (fetching() && !opts.force) {
      await Promise.resolve();
      await (inFlight ?? Promise.resolve());
      return;
    }

    if (opts.force) {
      lastRunController?.abort();
    }

    lastKey = Symbol("refresh");
    lastArr = null;
    lastVal = Symbol("refresh");

    const waiter = requestRun();
    await waiter;
  }

  function cancel(): void {
    lastRunController?.abort();
    lastRunController = null;
    loading.set(false);
    fetching.set(false);
  }

  function setData(value: T | null): void {
    data.set(value);
    hasSettledValue = true;
  }

  function setError(value: Error | null): void {
    error.set(value);
  }

  return { data, loading, fetching, error, refresh, cancel, setData, setError };
}

type ResolvedDeps<D> =
  | { deps: D; kind: "value" }
  | { deps: D; kind: "array" }
  | { deps: D; kind: "key"; key: any };

function isSignalArray(value: unknown): value is ReadonlyArray<Signal<any>> {
  return Array.isArray(value);
}

function isDepAccessor<D>(value: unknown): value is { get: () => D; key?: () => any } {
  return (
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof (value as any).get === "function"
  );
}

function resolveDeps<D>(src: DepSource<D>): ResolvedDeps<D> {
  if (typeof src === "function") {
    return { deps: (src as () => D)(), kind: "value" };
  }

  if (isSignalArray(src)) {
    const values = src.map((s) => s());
    return { deps: values as unknown as D, kind: "array" };
  }

  if (!isDepAccessor<D>(src)) {
    throw new Error("Invalid deps source passed to createDependentResource()");
  }

  const depsVal = src.get();

  if (src.key) {
    return { deps: depsVal, kind: "key", key: src.key() };
  }

  return { deps: depsVal, kind: "value" };
}

function shallowArrayEqual(a: any[], b: any[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

// Cached resources + invalidation + refCount

/**
 * CacheEntry:
 * A cached resource plus book-keeping for memory safety and invalidation.
 *
 * Fields:
 * - createdAt/ttlMs: TTL-based expiry.
 * - tags: tag index for invalidation.
 * - stale: marker used by invalidation flows.
 * - refCount: number of active scopes referencing this entry.
 * - persist: if true, entry may live outside scopes (global cache).
 * - cacheScope: dedicated scope that owns the underlying resource lifetime.
 *
 * Why cacheScope?
 * - If a cached resource were created in the caller scope, it could be disposed
 *   prematurely when that scope ends, even though other scopes still reference it.
 * - We isolate each cache entry in its own scope so the cache controls disposal.
 */
type CacheEntry = {
  resource: ResourceState<any>;
  // createdAt is treated as a last-used timestamp for TTL + LRU.
  createdAt: number;
  ttlMs?: number;

  tags: Set<string>;
  stale: boolean;

  /** Active scoped users. */
  refCount: number;

  /** Explicit "keep global" flag. */
  persist: boolean;

  /**
   * Dedicated scope for this cache entry.
   * The resource is created inside this scope, isolating it from caller scopes.
   * When the entry is removed from cache, this scope is disposed.
   */
  cacheScope: Scope;
};

const resourceCache = new Map<string, CacheEntry>();
const tagIndex = new Map<string, Set<string>>();

/**
 * Tracks keys acquired per scope so we don't double-release.
 * WeakMap ensures we don't keep scopes alive through bookkeeping.
 */
const scopeKeys = new WeakMap<Scope, Map<string, CacheEntry>>();

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

const cacheConfig: CacheConfig = {
  maxEntries: 500,
  warnOnEviction: true,
};

/**
 * Configure the global resource cache limits.
 * Call this early in your app initialization.
 */
export function configureResourceCache(config: Partial<CacheConfig>): void {
  Object.assign(cacheConfig, config);
}

/**
 * LRU eviction: remove oldest entries when cache exceeds maxEntries.
 *
 * Policy:
 * - Only evict entries with refCount === 0 (no active scoped users).
 * - Persisted entries can still be evicted by this LRU pass if they are refCount 0,
 *   because persist controls scope lifetime, not global memory limits.
 *
 * Note:
 * - TTL expiry is handled lazily on access (see createCachedResource).
 */
function evictIfNeeded(): void {
  if (resourceCache.size <= cacheConfig.maxEntries) return;

  // Collect evictable entries (refCount 0, not actively used)
  const evictable: Array<{ key: string; entry: CacheEntry }> = [];

  for (const [key, entry] of resourceCache) {
    // Only evict entries not actively referenced
    if (entry.refCount === 0) {
      evictable.push({ key, entry });
    }
  }

  // Sort by createdAt (oldest first) for LRU behavior
  evictable.sort((a, b) => a.entry.createdAt - b.entry.createdAt);

  // Evict until we're under the limit
  const toEvict = resourceCache.size - cacheConfig.maxEntries;
  let evicted = 0;

  for (const { key } of evictable) {
    if (evicted >= toEvict) break;

    if (cacheConfig.warnOnEviction) {
      console.warn(
        `[Dalila] Cache evicting "${key}" (LRU). ` +
          `Cache size exceeded ${cacheConfig.maxEntries} entries.`
      );
    }

    removeCacheKey(key);
    evicted++;
  }

  // If we couldn't evict enough (all entries are actively referenced), warn
  if (evicted < toEvict && cacheConfig.warnOnEviction) {
    console.warn(
      `[Dalila] Cache has ${resourceCache.size} entries but only evicted ${evicted}. ` +
        `${resourceCache.size - cacheConfig.maxEntries} entries are still actively referenced.`
    );
  }
}

/**
 * Create or reuse a cached resource by cache key.
 *
 * Safe-by-default:
 * - If called outside a scope and persist !== true, it returns a non-cached resource.
 * - This prevents accidental global cache growth from unscoped usage.
 *
 * TTL:
 * - On access, if an existing entry is expired, it is removed and recreated.
 *
 * Lifetime:
 * - Each entry has a dedicated cacheScope, disposed when the entry is removed.
 * - Scopes referencing an entry increment refCount; on scope cleanup they release it.
 */
function createCachedResource<T>(
  key: string,
  fetchFn: (signal: AbortSignal) => Promise<T>,
  options: CachedResourceOptions<T> = {}
): ResourceState<T> {
  const scope = getCurrentScope();
  const fetchScope =
    options.fetchScope && !isScopeDisposed(options.fetchScope) ? options.fetchScope : null;
  const wrappedFetch = fetchScope
    ? (signal: AbortSignal) => withScope(fetchScope, () => fetchFn(signal))
    : fetchFn;

  // Memory safety: persist without TTL can cause unbounded cache growth
  if (
    isInDevMode() &&
    options.persist === true &&
    options.ttlMs == null &&
    options.warnPersistWithoutTtl !== false
  ) {
    console.warn(
      `[Dalila] createCachedResource("${key}") has persist: true without ttlMs. ` +
        `This can cause memory leaks. Consider adding a ttlMs or using maxEntries.`
    );
  }

  // Safe-by-default: outside scope, don't cache unless explicitly persisted.
  if (!scope && options.persist !== true) {
    if (options.warnIfNoScope !== false) {
      if (isInDevMode()) {
        console.warn(
          `[Dalila] createCachedResource("${key}") called outside a scope. ` +
            `No caching will happen. Use persist: true (or q.queryGlobal) for global cache.`
        );
      }
    }
    return createResourceBase(wrappedFetch, options);
  }

  const now = Date.now();
  const existing = resourceCache.get(key);

  if (existing) {
    // TTL expiry is checked lazily on access.
    if (existing.ttlMs != null && now - existing.createdAt > existing.ttlMs) {
      if (existing.refCount === 0) {
        removeCacheKey(key);
      } else {
        existing.stale = true;
        // createdAt is treated as a last-used timestamp for TTL + LRU.
        existing.createdAt = now;
        existing.resource.refresh({ force: true }).catch(() => {});

        // Update tags/persist behavior if caller provided them.
        if (options.tags) setEntryTags(key, existing, options.tags);
        if (options.persist === true) existing.persist = true;

        // Track usage in the current scope (increments refCount, releases on cleanup).
        acquireCacheKey(key, existing);
        return existing.resource as ResourceState<T>;
      }
    } else {
      // createdAt is treated as a last-used timestamp for TTL + LRU.
      existing.createdAt = now;
      // Update tags/persist behavior if caller provided them.
      if (options.tags) setEntryTags(key, existing, options.tags);
      if (options.persist === true) existing.persist = true;

      // Track usage in the current scope (increments refCount, releases on cleanup).
      acquireCacheKey(key, existing);
      return existing.resource as ResourceState<T>;
    }
  }

  /**
   * Create a dedicated scope for this cache entry.
   * This isolates the resource from caller scopes, preventing premature disposal.
   */
  const cacheScope = createScope(null);

  /**
   * Create the resource inside cacheScope so its subscriptions, effects, and abort handling
   * belong to the cache entry itself.
   */
  const resource = withScope(cacheScope, () => createResourceBase(wrappedFetch, options));

  const entry: CacheEntry = {
    resource,
    createdAt: now,
    ttlMs: options.ttlMs,
    tags: new Set<string>(),
    stale: false,
    refCount: 0,
    persist: options.persist === true,
    cacheScope,
  };

  resourceCache.set(key, entry);

  // Register tags for invalidation by tag.
  if (options.tags) setEntryTags(key, entry, options.tags);

  // Track this entry in the current scope if present.
  acquireCacheKey(key, entry);

  // Memory safety: evict old entries if cache is too large.
  evictIfNeeded();

  return resource;
}

/**
 * Convenience wrapper: builds the cache key from an id.
 */
function createCachedResourceById<T, I>(
  id: I,
  keyFn: (id: I) => string,
  fetchFn: (signal: AbortSignal, id: I) => Promise<T>,
  options: CachedResourceOptions<T> = {}
): ResourceState<T> {
  const key = keyFn(id);
  return createCachedResource<T>(key, (sig) => fetchFn(sig, id), options);
}

/**
 * Clears the cache:
 * - with no key: clears everything
 * - with key: clears a single entry
 *
 * Note: removing an entry disposes its cacheScope, aborting in-flight requests and running cleanups.
 */
export function clearResourceCache(key?: string): void {
  if (key == null) {
    for (const k of resourceCache.keys()) removeCacheKey(k);
    return;
  }
  removeCacheKey(key);
}

/**
 * Marks a cached entry stale and optionally revalidates it.
 *
 * Semantics:
 * - stale is a marker for debugging/inspection.
 * - by default we revalidate immediately (force by default).
 */
export function invalidateResourceCache(
  key: string,
  opts: { revalidate?: boolean; force?: boolean } = {}
): void {
  const entry = resourceCache.get(key);
  if (!entry) return;

  entry.stale = true;

  const shouldRevalidate = opts.revalidate ?? true;
  if (shouldRevalidate) {
    entry.resource.refresh({ force: opts.force ?? true }).catch(() => {});
  }
}

/**
 * Invalidates all cached resources registered under a given tag.
 */
export function invalidateResourceTag(
  tag: string,
  opts: { revalidate?: boolean; force?: boolean } = {}
): void {
  const keys = tagIndex.get(tag);
  if (!keys || keys.size === 0) return;

  for (const key of keys) invalidateResourceCache(key, opts);
}

/**
 * Invalidates multiple tags.
 */
export function invalidateResourceTags(
  tags: readonly string[],
  opts: { revalidate?: boolean; force?: boolean } = {}
): void {
  for (const t of tags) invalidateResourceTag(t, opts);
}

export function getResourceCacheData<T>(key: string): T | null | undefined {
  const entry = resourceCache.get(key);
  if (!entry) return undefined;
  return entry.resource.data() as T | null;
}

export function setResourceCacheData<T>(key: string, value: T | null): boolean {
  const entry = resourceCache.get(key);
  if (!entry) return false;
  entry.resource.setData(value);
  entry.resource.setError(null);
  entry.stale = false;
  entry.createdAt = Date.now();
  return true;
}

export function cancelResourceCache(key: string): void {
  const entry = resourceCache.get(key);
  if (!entry) return;
  entry.resource.cancel();
}

export function getResourceCacheKeys(): string[] {
  return Array.from(resourceCache.keys());
}

/**
 * Introspection helper: returns cache keys registered for a tag.
 */
export function getResourceCacheKeysByTag(tag: string): string[] {
  const keys = tagIndex.get(tag);
  return keys ? Array.from(keys) : [];
}

/**
 * Replaces the tag set for an entry and updates the global tag index.
 */
function setEntryTags(key: string, entry: CacheEntry, tags: readonly string[]): void {
  // Remove old tags from index.
  for (const t of entry.tags) {
    const set = tagIndex.get(t);
    set?.delete(key);
    if (set && set.size === 0) tagIndex.delete(t);
  }
  entry.tags.clear();

  // Add new tags to index.
  for (const t of tags) {
    entry.tags.add(t);
    let set = tagIndex.get(t);
    if (!set) {
      set = new Set<string>();
      tagIndex.set(t, set);
    }
    set.add(key);
  }
}

/**
 * Registers that the current scope is using `key`.
 *
 * Semantics:
 * - Each scope tracks acquired keys so it can release them on cleanup.
 * - refCount increments once per scope per key (deduped).
 *
 * Why WeakMap + per-scope Map?
 * - WeakMap avoids keeping scopes alive.
 * - Per-scope Map avoids double-release and supports key replacement.
 */
function acquireCacheKey(key: string, entry: CacheEntry): void {
  const scope = getCurrentScope();

  // Outside scope: allowed only when persisted (we checked before creating).
  if (!scope) return;

  let keys = scopeKeys.get(scope);
  if (!keys) {
    keys = new Map<string, CacheEntry>();
    scopeKeys.set(scope, keys);

    scope.onCleanup(() => {
      const entries = Array.from(keys!.entries());
      keys!.clear();
      for (const [cachedKey, cachedEntry] of entries) {
        releaseCacheEntry(cachedKey, cachedEntry);
      }
    });
  }

  const tracked = keys.get(key);
  if (tracked === entry) return;

  // If scope previously tracked a different entry under the same key, release it.
  if (tracked) {
    keys.delete(key);
    releaseCacheEntry(key, tracked);
  }

  keys.set(key, entry);
  entry.refCount++;
}

/**
 * Releases one scope reference from an entry.
 *
 * Lifetime:
 * - When refCount drops to 0 and the entry is not persisted, we remove it immediately.
 * - Persisted entries survive scope lifetimes but can still be evicted by LRU/limits.
 */
function releaseCacheEntry(key: string, entry: CacheEntry): void {
  entry.refCount = Math.max(0, entry.refCount - 1);

  if (entry.refCount === 0 && entry.persist !== true) {
    const current = resourceCache.get(key);
    if (current === entry) {
      removeCacheKey(key);
    }
  }
}

/**
 * Removes a cache entry:
 * - disposes cacheScope (aborts requests, clears subscriptions, runs cleanups)
 * - removes tag index registrations
 * - deletes from resourceCache
 */
function removeCacheKey(key: string): void {
  const entry = resourceCache.get(key);
  if (!entry) return;

  // Disposing the cache scope tears down the underlying resource safely.
  entry.cacheScope.dispose();

  for (const t of entry.tags) {
    const set = tagIndex.get(t);
    set?.delete(key);
    if (set && set.size === 0) tagIndex.delete(t);
  }

  resourceCache.delete(key);
}

/**
 * Auto-refreshing resource helper.
 *
 * Semantics:
 * - Requires a scope so the interval can be cleaned up automatically.
 * - Outside a scope, it warns and returns a normal resource (no interval).
 */
function createAutoRefreshResource<T>(
  fetchFn: (signal: AbortSignal) => Promise<T>,
  refreshInterval: number,
  options: ResourceOptions<T> = {}
): ResourceState<T> {
  const scope = getCurrentScope();
  const resource = createResourceBase(fetchFn, options);

  if (!scope) {
    if (isInDevMode()) {
      console.warn(
        `[Dalila] createAutoRefreshResource called outside a scope. ` +
          `Auto-refresh will not work. Use within a scope or manage cleanup manually.`
      );
    }
    return resource;
  }

  const intervalId = setInterval(() => {
    resource.refresh().catch(() => {});
  }, refreshInterval);

  scope.onCleanup(() => {
    clearInterval(intervalId);
  });

  return resource;
}

/**
 * Isolated cache instance for SSR and testing.
 *
 * Use this when you need complete cache isolation:
 * - SSR: each request gets its own cache
 * - Testing: each test gets fresh state
 *
 * Example:
 * ```ts
 * const { createCachedResource, clearCache, invalidateKey, getCache } = createIsolatedCache();
 *
 * // Use the isolated createCachedResource instead of the global one
 * const resource = createCachedResource('key', fetchFn);
 *
 * // Clean up when done
 * clearCache();
 * ```
 */
interface IsolatedCache {
  /**
   * Create a cached resource using this isolated cache.
   */
  createCachedResource: <T>(
    key: string,
    fetchFn: (signal: AbortSignal) => Promise<T>,
    options?: CachedResourceOptions<T>
  ) => ResourceState<T>;

  /**
   * Clear all entries in this isolated cache.
   */
  clearCache: (key?: string) => void;

  /**
   * Invalidate a specific key in this isolated cache.
   */
  invalidateKey: (key: string, opts?: { revalidate?: boolean; force?: boolean }) => void;

  /**
   * Invalidate all entries with a specific tag.
   */
  invalidateTag: (tag: string, opts?: { revalidate?: boolean; force?: boolean }) => void;

  /**
   * Invalidate all entries with any of the specified tags.
   */
  invalidateTags: (tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }) => void;

  /**
   * Get the underlying cache Map (for debugging/inspection).
   */
  getCache: () => Map<string, CacheEntry>;

  /**
   * Get cache keys by tag.
   */
  getKeysByTag: (tag: string) => string[];

  /**
   * Configure cache limits for this instance.
   */
  configure: (config: Partial<{ maxEntries: number; warnOnEviction: boolean }>) => void;
}

export interface ResourceCache {
  create: <T>(
    key: string,
    fetchFn: (signal: AbortSignal) => Promise<T>,
    options?: CachedResourceOptions<T>
  ) => ResourceState<T>;
  clear: (key?: string) => void;
  invalidate: (key: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTag: (tag: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTags: (tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }) => void;
  keys: () => string[];
  configure: (config: Partial<{ maxEntries: number; warnOnEviction: boolean }>) => void;
}

export function createResourceCache(
  config: Partial<{ maxEntries: number; warnOnEviction: boolean }> = {}
): ResourceCache {
  const isolated = createIsolatedCache();
  isolated.configure(config);

  return {
    create: isolated.createCachedResource,
    clear: isolated.clearCache,
    invalidate: isolated.invalidateKey,
    invalidateTag: isolated.invalidateTag,
    invalidateTags: isolated.invalidateTags,
    keys: () => Array.from(isolated.getCache().keys()),
    configure: isolated.configure,
  };
}

function createIsolatedCache(): IsolatedCache {
  // Isolated state
  const isolatedCache = new Map<string, CacheEntry>();
  const isolatedTagIndex = new Map<string, Set<string>>();
  const isolatedScopeKeys = new WeakMap<Scope, Map<string, CacheEntry>>();

  let isolatedConfig = {
    maxEntries: 500,
    warnOnEviction: true,
  };

  function configure(config: Partial<{ maxEntries: number; warnOnEviction: boolean }>): void {
    Object.assign(isolatedConfig, config);
  }

  function evictIfNeeded(): void {
    if (isolatedCache.size <= isolatedConfig.maxEntries) return;

    const evictable: Array<{ key: string; entry: CacheEntry }> = [];

    for (const [key, entry] of isolatedCache) {
      if (entry.refCount === 0) {
        evictable.push({ key, entry });
      }
    }

    evictable.sort((a, b) => a.entry.createdAt - b.entry.createdAt);

    const toEvict = isolatedCache.size - isolatedConfig.maxEntries;
    let evicted = 0;

    for (const { key } of evictable) {
      if (evicted >= toEvict) break;

      if (isolatedConfig.warnOnEviction) {
        console.warn(
          `[Dalila] Isolated cache evicting "${key}" (LRU). ` +
            `Cache size exceeded ${isolatedConfig.maxEntries} entries.`
        );
      }

      removeCacheKeyIsolated(key);
      evicted++;
    }
  }

  function setEntryTagsIsolated(key: string, entry: CacheEntry, tags: readonly string[]): void {
    for (const t of entry.tags) {
      const set = isolatedTagIndex.get(t);
      set?.delete(key);
      if (set && set.size === 0) isolatedTagIndex.delete(t);
    }
    entry.tags.clear();

    for (const t of tags) {
      entry.tags.add(t);
      let set = isolatedTagIndex.get(t);
      if (!set) {
        set = new Set<string>();
        isolatedTagIndex.set(t, set);
      }
      set.add(key);
    }
  }

  function acquireCacheKeyIsolated(key: string, entry: CacheEntry): void {
    const scope = getCurrentScope();
    if (!scope) return;

    let keys = isolatedScopeKeys.get(scope);
    if (!keys) {
      keys = new Map<string, CacheEntry>();
      isolatedScopeKeys.set(scope, keys);

      scope.onCleanup(() => {
        const entries = Array.from(keys!.entries());
        keys!.clear();
        for (const [cachedKey, cachedEntry] of entries) {
          releaseCacheEntryIsolated(cachedKey, cachedEntry);
        }
      });
    }

    const tracked = keys.get(key);
    if (tracked === entry) return;

    if (tracked) {
      keys.delete(key);
      releaseCacheEntryIsolated(key, tracked);
    }

    keys.set(key, entry);
    entry.refCount++;
  }

  function releaseCacheEntryIsolated(key: string, entry: CacheEntry): void {
    entry.refCount = Math.max(0, entry.refCount - 1);

    if (entry.refCount === 0 && entry.persist !== true) {
      const current = isolatedCache.get(key);
      if (current === entry) {
        removeCacheKeyIsolated(key);
      }
    }
  }

  function removeCacheKeyIsolated(key: string): void {
    const entry = isolatedCache.get(key);
    if (!entry) return;

    entry.cacheScope.dispose();

    for (const t of entry.tags) {
      const set = isolatedTagIndex.get(t);
      set?.delete(key);
      if (set && set.size === 0) isolatedTagIndex.delete(t);
    }

    isolatedCache.delete(key);
  }

  function createCachedResourceIsolated<T>(
    key: string,
    fetchFn: (signal: AbortSignal) => Promise<T>,
    options: CachedResourceOptions<T> = {}
  ): ResourceState<T> {
    const scope = getCurrentScope();
    const fetchScope =
      options.fetchScope && !isScopeDisposed(options.fetchScope) ? options.fetchScope : null;
    const wrappedFetch = fetchScope
      ? (signal: AbortSignal) => withScope(fetchScope, () => fetchFn(signal))
      : fetchFn;

    if (!scope && options.persist !== true) {
      if (options.warnIfNoScope !== false && isInDevMode()) {
        console.warn(
          `[Dalila] createCachedResource("${key}") called outside a scope. ` +
            `No caching will happen. Use persist: true for global cache.`
        );
      }
      return createResourceBase(wrappedFetch, options);
    }

    const now = Date.now();
    const existing = isolatedCache.get(key);

    if (existing) {
      if (existing.ttlMs != null && now - existing.createdAt > existing.ttlMs) {
        if (existing.refCount === 0) {
          removeCacheKeyIsolated(key);
        } else {
          existing.stale = true;
          existing.createdAt = now;
          existing.resource.refresh({ force: true }).catch(() => {});

          if (options.tags) setEntryTagsIsolated(key, existing, options.tags);
          if (options.persist === true) existing.persist = true;

          acquireCacheKeyIsolated(key, existing);
          return existing.resource as ResourceState<T>;
        }
      } else {
        existing.createdAt = now;
        if (options.tags) setEntryTagsIsolated(key, existing, options.tags);
        if (options.persist === true) existing.persist = true;

        acquireCacheKeyIsolated(key, existing);
        return existing.resource as ResourceState<T>;
      }
    }

    const cacheScope = createScope(null);
    const resource = withScope(cacheScope, () => createResourceBase(wrappedFetch, options));

    const entry: CacheEntry = {
      resource,
      createdAt: now,
      ttlMs: options.ttlMs,
      tags: new Set<string>(),
      stale: false,
      refCount: 0,
      persist: options.persist === true,
      cacheScope,
    };

    isolatedCache.set(key, entry);

    if (options.tags) setEntryTagsIsolated(key, entry, options.tags);

    acquireCacheKeyIsolated(key, entry);
    evictIfNeeded();

    return resource;
  }

  function clearCacheIsolated(key?: string): void {
    if (key == null) {
      for (const k of isolatedCache.keys()) removeCacheKeyIsolated(k);
      return;
    }
    removeCacheKeyIsolated(key);
  }

  function invalidateKeyIsolated(
    key: string,
    opts: { revalidate?: boolean; force?: boolean } = {}
  ): void {
    const entry = isolatedCache.get(key);
    if (!entry) return;

    entry.stale = true;

    const shouldRevalidate = opts.revalidate ?? true;
    if (shouldRevalidate) {
      entry.resource.refresh({ force: opts.force ?? true }).catch(() => {});
    }
  }

  function invalidateTagIsolated(
    tag: string,
    opts: { revalidate?: boolean; force?: boolean } = {}
  ): void {
    const keys = isolatedTagIndex.get(tag);
    if (!keys || keys.size === 0) return;

    for (const key of keys) invalidateKeyIsolated(key, opts);
  }

  function invalidateTagsIsolated(
    tags: readonly string[],
    opts: { revalidate?: boolean; force?: boolean } = {}
  ): void {
    for (const t of tags) invalidateTagIsolated(t, opts);
  }

  function getKeysByTagIsolated(tag: string): string[] {
    const keys = isolatedTagIndex.get(tag);
    return keys ? Array.from(keys) : [];
  }

  return {
    createCachedResource: createCachedResourceIsolated,
    clearCache: clearCacheIsolated,
    invalidateKey: invalidateKeyIsolated,
    invalidateTag: invalidateTagIsolated,
    invalidateTags: invalidateTagsIsolated,
    getCache: () => isolatedCache,
    getKeysByTag: getKeysByTagIsolated,
    configure,
  };
}
