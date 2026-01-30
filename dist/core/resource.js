import { signal, effectAsync } from "./signal.js";
import { isInDevMode } from "./dev.js";
import { getCurrentScope, createScope, isScopeDisposed, withScope } from "./scope.js";
function createDeferred() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}
/**
 * Async data primitive with cancellation + refresh correctness.
 *
 * Design goals:
 * - Scope-first: if created inside a scope, abort + cleanup on scope disposal.
 * - Abort-safe callbacks: do not call onSuccess/onError for aborted runs.
 * - Correct refresh: `await refresh()` must wait for the *new* fetch, not a stale inFlight.
 *
 * Semantics:
 * - A driver `effectAsync` runs `fetchFn(signal)` whenever `refreshTick` changes.
 * - Each run gets a fresh AbortController.
 * - Reruns abort the previous controller.
 *
 * Why a waiter system?
 * - Without it, refresh() can accidentally await an older promise and resolve early.
 * - We map each refresh request to a runId and resolve its waiter when that run finishes.
 *
 * Safety:
 * - If the driver reruns during a fetch, an aborted run must NOT resolve the latest waiter.
 *   Guard: only resolve if `lastRunController === controller` for that run.
 *
 * Lifetime:
 * - On parent scope cleanup:
 *   - abort current request
 *   - dispose the driver
 *   - resolve all pending waiters (avoid hanging Promises)
 */
export function createResource(fetchFn, options = {}) {
    const data = signal(options.initialValue ?? null);
    const loading = signal(false);
    const error = signal(null);
    /**
     * Reactive "kick" signal: bumping this triggers the driver.
     * We store runId here so the driver can resolve the correct waiter.
     */
    const refreshTick = signal(0);
    /** Tracks the currently running fetch promise (for non-forced refresh dedupe). */
    let inFlight = null;
    /** AbortController of the most recent run (force abort + "current run" guard). */
    let lastRunController = null;
    /** Monotonic run counter. */
    let runId = 0;
    /**
     * Waiters keyed by runId:
     * - refresh() creates a waiter for the next runId
     * - driver resolves it when that run finishes (if still current)
     */
    const waiters = new Map();
    const owningScope = getCurrentScope();
    /**
     * Requests a new run and returns a Promise that resolves when that run completes.
     */
    function requestRun() {
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
        if (waiter)
            waiter.controller = controller;
        // If the effect run is aborted (rerun or scope disposal), abort this request too.
        const onAbort = () => controller.abort();
        runSignal.addEventListener("abort", onAbort, { once: true });
        const requestSignal = controller.signal;
        loading.set(true);
        error.set(null);
        inFlight = (async () => {
            try {
                // NOTE: fetchFn runs inside the effect's sync tracking phase.
                // Synchronous signal reads before the first await may be tracked.
                // Use createDependentResource or QueryClient to opt out of this.
                const result = await fetchFn(requestSignal);
                if (requestSignal.aborted)
                    return;
                data.set(result);
                options.onSuccess?.(result);
            }
            catch (err) {
                if (requestSignal.aborted)
                    return;
                const errorObj = err instanceof Error ? err : new Error(String(err));
                error.set(errorObj);
                options.onError?.(errorObj);
            }
            finally {
                // Only flip loading off for non-aborted runs.
                if (!requestSignal.aborted) {
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
            for (const [, deferred] of waiters) {
                deferred.deferred.resolve();
            }
            waiters.clear();
        });
    }
    async function refresh(opts = {}) {
        // Dedupe: if already loading and not forced, just await the active run.
        if (loading() && !opts.force) {
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
    return { data, loading, error, refresh };
}
/**
 * Fetch helper built on top of createResource().
 *
 * Semantics:
 * - `url` may be static or dynamic (function).
 * - Uses fetch() with AbortSignal.
 * - Non-2xx responses throw (surfaced via resource.error()).
 */
export function createFetchResource(url, options = {}) {
    return createResource(async (signal) => {
        const fetchUrl = typeof url === "function" ? url() : url;
        const response = await fetch(fetchUrl, {
            ...options.fetchOptions,
            signal,
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json());
    }, options);
}
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
 *   Guard: early-return resolves only if `!loading()`.
 */
export function createDependentResource(fetchFn, deps, options = {}) {
    const data = signal(options.initialValue ?? null);
    const loading = signal(false);
    const error = signal(null);
    const refreshTick = signal(0);
    /** Last-seen deps snapshots for cheap "changed" detection. */
    let lastKey = Symbol("init");
    let lastArr = null;
    let lastVal = Symbol("init");
    let inFlight = null;
    let lastRunController = null;
    let runId = 0;
    const waiters = new Map();
    const owningScope = getCurrentScope();
    function requestRun() {
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
            if (!loading()) {
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
        if (waiter)
            waiter.controller = controller;
        const onAbort = () => controller.abort();
        runSignal.addEventListener("abort", onAbort, { once: true });
        const requestSignal = controller.signal;
        loading.set(true);
        error.set(null);
        inFlight = (async () => {
            try {
                // Break reactive tracking: run fetchFn outside effect's sync tracking phase.
                await Promise.resolve();
                const result = await fetchFn(requestSignal, resolved.deps);
                if (requestSignal.aborted)
                    return;
                data.set(result);
                options.onSuccess?.(result);
            }
            catch (err) {
                if (requestSignal.aborted)
                    return;
                const errorObj = err instanceof Error ? err : new Error(String(err));
                error.set(errorObj);
                options.onError?.(errorObj);
            }
            finally {
                if (!requestSignal.aborted) {
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
            for (const [, deferred] of waiters) {
                deferred.deferred.resolve();
            }
            waiters.clear();
        });
    }
    function depsChanged(resolved) {
        if (resolved.kind === "key") {
            if (Object.is(lastKey, resolved.key))
                return false;
            lastKey = resolved.key;
            return true;
        }
        if (resolved.kind === "array") {
            if (lastArr && shallowArrayEqual(lastArr, resolved.deps))
                return false;
            lastArr = resolved.deps.slice();
            return true;
        }
        if (Object.is(lastVal, resolved.deps))
            return false;
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
    async function refresh(opts = {}) {
        if (loading() && !opts.force) {
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
    return { data, loading, error, refresh };
}
function isSignalArray(value) {
    return Array.isArray(value);
}
function isDepAccessor(value) {
    return (typeof value === "object" &&
        value !== null &&
        "get" in value &&
        typeof value.get === "function");
}
function resolveDeps(src) {
    if (typeof src === "function") {
        return { deps: src(), kind: "value" };
    }
    if (isSignalArray(src)) {
        const values = src.map((s) => s());
        return { deps: values, kind: "array" };
    }
    if (!isDepAccessor(src)) {
        throw new Error("Invalid deps source passed to createDependentResource()");
    }
    const depsVal = src.get();
    if (src.key) {
        return { deps: depsVal, kind: "key", key: src.key() };
    }
    return { deps: depsVal, kind: "value" };
}
function shallowArrayEqual(a, b) {
    if (a === b)
        return true;
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++) {
        if (!Object.is(a[i], b[i]))
            return false;
    }
    return true;
}
const resourceCache = new Map();
const tagIndex = new Map();
/**
 * Tracks keys acquired per scope so we don't double-release.
 * WeakMap ensures we don't keep scopes alive through bookkeeping.
 */
const scopeKeys = new WeakMap();
const cacheConfig = {
    maxEntries: 500,
    warnOnEviction: true,
};
/**
 * Configure the global resource cache limits.
 * Call this early in your app initialization.
 */
export function configureResourceCache(config) {
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
function evictIfNeeded() {
    if (resourceCache.size <= cacheConfig.maxEntries)
        return;
    // Collect evictable entries (refCount 0, not actively used)
    const evictable = [];
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
        if (evicted >= toEvict)
            break;
        if (cacheConfig.warnOnEviction) {
            console.warn(`[Dalila] Cache evicting "${key}" (LRU). ` +
                `Cache size exceeded ${cacheConfig.maxEntries} entries.`);
        }
        removeCacheKey(key);
        evicted++;
    }
    // If we couldn't evict enough (all entries are actively referenced), warn
    if (evicted < toEvict && cacheConfig.warnOnEviction) {
        console.warn(`[Dalila] Cache has ${resourceCache.size} entries but only evicted ${evicted}. ` +
            `${resourceCache.size - cacheConfig.maxEntries} entries are still actively referenced.`);
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
export function createCachedResource(key, fetchFn, options = {}) {
    const scope = getCurrentScope();
    const fetchScope = options.fetchScope && !isScopeDisposed(options.fetchScope) ? options.fetchScope : null;
    const wrappedFetch = fetchScope
        ? (signal) => withScope(fetchScope, () => fetchFn(signal))
        : fetchFn;
    // Memory safety: persist without TTL can cause unbounded cache growth
    if (isInDevMode() &&
        options.persist === true &&
        options.ttlMs == null &&
        options.warnPersistWithoutTtl !== false) {
        console.warn(`[Dalila] createCachedResource("${key}") has persist: true without ttlMs. ` +
            `This can cause memory leaks. Consider adding a ttlMs or using maxEntries.`);
    }
    // Safe-by-default: outside scope, don't cache unless explicitly persisted.
    if (!scope && options.persist !== true) {
        if (options.warnIfNoScope !== false) {
            if (isInDevMode()) {
                console.warn(`[Dalila] createCachedResource("${key}") called outside a scope. ` +
                    `No caching will happen. Use persist: true (or q.queryGlobal) for global cache.`);
            }
        }
        return createResource(wrappedFetch, options);
    }
    const now = Date.now();
    const existing = resourceCache.get(key);
    if (existing) {
        // TTL expiry is checked lazily on access.
        if (existing.ttlMs != null && now - existing.createdAt > existing.ttlMs) {
            if (existing.refCount === 0) {
                removeCacheKey(key);
            }
            else {
                existing.stale = true;
                // createdAt is treated as a last-used timestamp for TTL + LRU.
                existing.createdAt = now;
                existing.resource.refresh({ force: true }).catch(() => { });
                // Update tags/persist behavior if caller provided them.
                if (options.tags)
                    setEntryTags(key, existing, options.tags);
                if (options.persist === true)
                    existing.persist = true;
                // Track usage in the current scope (increments refCount, releases on cleanup).
                acquireCacheKey(key, existing);
                return existing.resource;
            }
        }
        else {
            // createdAt is treated as a last-used timestamp for TTL + LRU.
            existing.createdAt = now;
            // Update tags/persist behavior if caller provided them.
            if (options.tags)
                setEntryTags(key, existing, options.tags);
            if (options.persist === true)
                existing.persist = true;
            // Track usage in the current scope (increments refCount, releases on cleanup).
            acquireCacheKey(key, existing);
            return existing.resource;
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
    const resource = withScope(cacheScope, () => createResource(wrappedFetch, options));
    const entry = {
        resource,
        createdAt: now,
        ttlMs: options.ttlMs,
        tags: new Set(),
        stale: false,
        refCount: 0,
        persist: options.persist === true,
        cacheScope,
    };
    resourceCache.set(key, entry);
    // Register tags for invalidation by tag.
    if (options.tags)
        setEntryTags(key, entry, options.tags);
    // Track this entry in the current scope if present.
    acquireCacheKey(key, entry);
    // Memory safety: evict old entries if cache is too large.
    evictIfNeeded();
    return resource;
}
/**
 * Convenience wrapper: builds the cache key from an id.
 */
export function createCachedResourceById(id, keyFn, fetchFn, options = {}) {
    const key = keyFn(id);
    return createCachedResource(key, (sig) => fetchFn(sig, id), options);
}
/**
 * Clears the cache:
 * - with no key: clears everything
 * - with key: clears a single entry
 *
 * Note: removing an entry disposes its cacheScope, aborting in-flight requests and running cleanups.
 */
export function clearResourceCache(key) {
    if (key == null) {
        for (const k of resourceCache.keys())
            removeCacheKey(k);
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
export function invalidateResourceCache(key, opts = {}) {
    const entry = resourceCache.get(key);
    if (!entry)
        return;
    entry.stale = true;
    const shouldRevalidate = opts.revalidate ?? true;
    if (shouldRevalidate) {
        entry.resource.refresh({ force: opts.force ?? true }).catch(() => { });
    }
}
/**
 * Invalidates all cached resources registered under a given tag.
 */
export function invalidateResourceTag(tag, opts = {}) {
    const keys = tagIndex.get(tag);
    if (!keys || keys.size === 0)
        return;
    for (const key of keys)
        invalidateResourceCache(key, opts);
}
/**
 * Invalidates multiple tags.
 */
export function invalidateResourceTags(tags, opts = {}) {
    for (const t of tags)
        invalidateResourceTag(t, opts);
}
/**
 * Introspection helper: returns cache keys registered for a tag.
 */
export function getResourceCacheKeysByTag(tag) {
    const keys = tagIndex.get(tag);
    return keys ? Array.from(keys) : [];
}
/**
 * Replaces the tag set for an entry and updates the global tag index.
 */
function setEntryTags(key, entry, tags) {
    // Remove old tags from index.
    for (const t of entry.tags) {
        const set = tagIndex.get(t);
        set?.delete(key);
        if (set && set.size === 0)
            tagIndex.delete(t);
    }
    entry.tags.clear();
    // Add new tags to index.
    for (const t of tags) {
        entry.tags.add(t);
        let set = tagIndex.get(t);
        if (!set) {
            set = new Set();
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
function acquireCacheKey(key, entry) {
    const scope = getCurrentScope();
    // Outside scope: allowed only when persisted (we checked before creating).
    if (!scope)
        return;
    let keys = scopeKeys.get(scope);
    if (!keys) {
        keys = new Map();
        scopeKeys.set(scope, keys);
        scope.onCleanup(() => {
            const entries = Array.from(keys.entries());
            keys.clear();
            for (const [cachedKey, cachedEntry] of entries) {
                releaseCacheEntry(cachedKey, cachedEntry);
            }
        });
    }
    const tracked = keys.get(key);
    if (tracked === entry)
        return;
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
function releaseCacheEntry(key, entry) {
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
function removeCacheKey(key) {
    const entry = resourceCache.get(key);
    if (!entry)
        return;
    // Disposing the cache scope tears down the underlying resource safely.
    entry.cacheScope.dispose();
    for (const t of entry.tags) {
        const set = tagIndex.get(t);
        set?.delete(key);
        if (set && set.size === 0)
            tagIndex.delete(t);
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
export function createAutoRefreshResource(fetchFn, refreshInterval, options = {}) {
    const scope = getCurrentScope();
    const resource = createResource(fetchFn, options);
    if (!scope) {
        if (isInDevMode()) {
            console.warn(`[Dalila] createAutoRefreshResource called outside a scope. ` +
                `Auto-refresh will not work. Use within a scope or manage cleanup manually.`);
        }
        return resource;
    }
    const intervalId = setInterval(() => {
        resource.refresh().catch(() => { });
    }, refreshInterval);
    scope.onCleanup(() => {
        clearInterval(intervalId);
    });
    return resource;
}
export function createIsolatedCache() {
    // Isolated state
    const isolatedCache = new Map();
    const isolatedTagIndex = new Map();
    const isolatedScopeKeys = new WeakMap();
    let isolatedConfig = {
        maxEntries: 500,
        warnOnEviction: true,
    };
    function configure(config) {
        Object.assign(isolatedConfig, config);
    }
    function evictIfNeeded() {
        if (isolatedCache.size <= isolatedConfig.maxEntries)
            return;
        const evictable = [];
        for (const [key, entry] of isolatedCache) {
            if (entry.refCount === 0) {
                evictable.push({ key, entry });
            }
        }
        evictable.sort((a, b) => a.entry.createdAt - b.entry.createdAt);
        const toEvict = isolatedCache.size - isolatedConfig.maxEntries;
        let evicted = 0;
        for (const { key } of evictable) {
            if (evicted >= toEvict)
                break;
            if (isolatedConfig.warnOnEviction) {
                console.warn(`[Dalila] Isolated cache evicting "${key}" (LRU). ` +
                    `Cache size exceeded ${isolatedConfig.maxEntries} entries.`);
            }
            removeCacheKeyIsolated(key);
            evicted++;
        }
    }
    function setEntryTagsIsolated(key, entry, tags) {
        for (const t of entry.tags) {
            const set = isolatedTagIndex.get(t);
            set?.delete(key);
            if (set && set.size === 0)
                isolatedTagIndex.delete(t);
        }
        entry.tags.clear();
        for (const t of tags) {
            entry.tags.add(t);
            let set = isolatedTagIndex.get(t);
            if (!set) {
                set = new Set();
                isolatedTagIndex.set(t, set);
            }
            set.add(key);
        }
    }
    function acquireCacheKeyIsolated(key, entry) {
        const scope = getCurrentScope();
        if (!scope)
            return;
        let keys = isolatedScopeKeys.get(scope);
        if (!keys) {
            keys = new Map();
            isolatedScopeKeys.set(scope, keys);
            scope.onCleanup(() => {
                const entries = Array.from(keys.entries());
                keys.clear();
                for (const [cachedKey, cachedEntry] of entries) {
                    releaseCacheEntryIsolated(cachedKey, cachedEntry);
                }
            });
        }
        const tracked = keys.get(key);
        if (tracked === entry)
            return;
        if (tracked) {
            keys.delete(key);
            releaseCacheEntryIsolated(key, tracked);
        }
        keys.set(key, entry);
        entry.refCount++;
    }
    function releaseCacheEntryIsolated(key, entry) {
        entry.refCount = Math.max(0, entry.refCount - 1);
        if (entry.refCount === 0 && entry.persist !== true) {
            const current = isolatedCache.get(key);
            if (current === entry) {
                removeCacheKeyIsolated(key);
            }
        }
    }
    function removeCacheKeyIsolated(key) {
        const entry = isolatedCache.get(key);
        if (!entry)
            return;
        entry.cacheScope.dispose();
        for (const t of entry.tags) {
            const set = isolatedTagIndex.get(t);
            set?.delete(key);
            if (set && set.size === 0)
                isolatedTagIndex.delete(t);
        }
        isolatedCache.delete(key);
    }
    function createCachedResourceIsolated(key, fetchFn, options = {}) {
        const scope = getCurrentScope();
        const fetchScope = options.fetchScope && !isScopeDisposed(options.fetchScope) ? options.fetchScope : null;
        const wrappedFetch = fetchScope
            ? (signal) => withScope(fetchScope, () => fetchFn(signal))
            : fetchFn;
        if (!scope && options.persist !== true) {
            if (options.warnIfNoScope !== false && isInDevMode()) {
                console.warn(`[Dalila] createCachedResource("${key}") called outside a scope. ` +
                    `No caching will happen. Use persist: true for global cache.`);
            }
            return createResource(wrappedFetch, options);
        }
        const now = Date.now();
        const existing = isolatedCache.get(key);
        if (existing) {
            if (existing.ttlMs != null && now - existing.createdAt > existing.ttlMs) {
                if (existing.refCount === 0) {
                    removeCacheKeyIsolated(key);
                }
                else {
                    existing.stale = true;
                    existing.createdAt = now;
                    existing.resource.refresh({ force: true }).catch(() => { });
                    if (options.tags)
                        setEntryTagsIsolated(key, existing, options.tags);
                    if (options.persist === true)
                        existing.persist = true;
                    acquireCacheKeyIsolated(key, existing);
                    return existing.resource;
                }
            }
            else {
                existing.createdAt = now;
                if (options.tags)
                    setEntryTagsIsolated(key, existing, options.tags);
                if (options.persist === true)
                    existing.persist = true;
                acquireCacheKeyIsolated(key, existing);
                return existing.resource;
            }
        }
        const cacheScope = createScope(null);
        const resource = withScope(cacheScope, () => createResource(wrappedFetch, options));
        const entry = {
            resource,
            createdAt: now,
            ttlMs: options.ttlMs,
            tags: new Set(),
            stale: false,
            refCount: 0,
            persist: options.persist === true,
            cacheScope,
        };
        isolatedCache.set(key, entry);
        if (options.tags)
            setEntryTagsIsolated(key, entry, options.tags);
        acquireCacheKeyIsolated(key, entry);
        evictIfNeeded();
        return resource;
    }
    function clearCacheIsolated(key) {
        if (key == null) {
            for (const k of isolatedCache.keys())
                removeCacheKeyIsolated(k);
            return;
        }
        removeCacheKeyIsolated(key);
    }
    function invalidateKeyIsolated(key, opts = {}) {
        const entry = isolatedCache.get(key);
        if (!entry)
            return;
        entry.stale = true;
        const shouldRevalidate = opts.revalidate ?? true;
        if (shouldRevalidate) {
            entry.resource.refresh({ force: opts.force ?? true }).catch(() => { });
        }
    }
    function invalidateTagIsolated(tag, opts = {}) {
        const keys = isolatedTagIndex.get(tag);
        if (!keys || keys.size === 0)
            return;
        for (const key of keys)
            invalidateKeyIsolated(key, opts);
    }
    function invalidateTagsIsolated(tags, opts = {}) {
        for (const t of tags)
            invalidateTagIsolated(t, opts);
    }
    function getKeysByTagIsolated(tag) {
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
