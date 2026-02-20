import { computed, effect, signal } from "./signal.js";
import { getCurrentScope, createScope, withScope } from "./scope.js";
import { key as keyBuilder, encodeKey } from "./key.js";
import { createResource, invalidateResourceCache, invalidateResourceTag, invalidateResourceTags, getResourceCacheData, getResourceCacheKeys, getResourceCacheKeysByTag, setResourceCacheData, cancelResourceCache, } from "./resource.js";
import { createMutation } from "./mutation.js";
import { isInDevMode } from "./dev.js";
function isKeyPrefixMatch(key, prefix) {
    if (typeof prefix === "string") {
        if (typeof key !== "string")
            return false;
        return key.startsWith(prefix);
    }
    if (typeof key === "string")
        return false;
    if (prefix.length > key.length)
        return false;
    for (let i = 0; i < prefix.length; i++) {
        if (!Object.is(key[i], prefix[i]))
            return false;
    }
    return true;
}
function isQueryFiltersInput(value) {
    return typeof value === "object" && value !== null;
}
function normalizeQueryFilters(filters) {
    if (filters === undefined)
        return {};
    if (Array.isArray(filters) || typeof filters === "string") {
        return { keyPrefix: filters };
    }
    if (isQueryFiltersInput(filters)) {
        return filters;
    }
    return {};
}
function abortError() {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
}
async function waitForRetry(ms, signal) {
    if (ms <= 0)
        return;
    await new Promise((resolve, reject) => {
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
function shouldRetry(retry, failureCount, error, key) {
    if (typeof retry === "function")
        return retry(failureCount, error, key);
    const maxRetries = retry ?? 0;
    return failureCount <= maxRetries;
}
function retryDelayMs(retryDelay, failureCount, error, key) {
    if (typeof retryDelay === "function") {
        return Math.max(0, retryDelay(failureCount, error, key));
    }
    return Math.max(0, retryDelay ?? 300);
}
async function runWithRetry(signal, key, run, retry, retryDelay) {
    let failureCount = 0;
    while (true) {
        try {
            return await run();
        }
        catch (error) {
            if (signal.aborted)
                throw abortError();
            const err = error instanceof Error ? error : new Error(String(error));
            failureCount++;
            if (!shouldRetry(retry, failureCount, err, key)) {
                throw err;
            }
            await waitForRetry(retryDelayMs(retryDelay, failureCount, err, key), signal);
        }
    }
}
function getFilteredCacheKeys(filters, managedKeys) {
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
export function createQueryClient() {
    const registry = new Set();
    const managedCacheKeyRefs = new Map();
    const persistentManagedKeys = new Set();
    const registryKeyVersionSignals = new Map();
    const cacheVersionSignals = new Map();
    const selectRefsByKey = new Map();
    const sharedSelectByKey = new Map();
    function retainManagedCacheKey(key) {
        managedCacheKeyRefs.set(key, (managedCacheKeyRefs.get(key) ?? 0) + 1);
    }
    function releaseManagedCacheKey(key) {
        const current = managedCacheKeyRefs.get(key) ?? 0;
        if (current <= 1) {
            managedCacheKeyRefs.delete(key);
            maybeCleanupKeyState(key);
            return;
        }
        managedCacheKeyRefs.set(key, current - 1);
    }
    function listManagedCacheKeys() {
        const existing = new Set(getResourceCacheKeys());
        for (const key of managedCacheKeyRefs.keys()) {
            if (!existing.has(key)) {
                managedCacheKeyRefs.delete(key);
                maybeCleanupKeyState(key);
            }
        }
        for (const key of persistentManagedKeys) {
            if (!existing.has(key)) {
                persistentManagedKeys.delete(key);
                maybeCleanupKeyState(key);
            }
        }
        return Array.from(new Set([...managedCacheKeyRefs.keys(), ...persistentManagedKeys]));
    }
    function trackPersistentManagedKey(key) {
        persistentManagedKeys.add(key);
    }
    function retainSelectKey(key) {
        selectRefsByKey.set(key, (selectRefsByKey.get(key) ?? 0) + 1);
    }
    function releaseSelectKey(key) {
        const current = selectRefsByKey.get(key) ?? 0;
        if (current <= 1) {
            selectRefsByKey.delete(key);
            maybeCleanupKeyState(key);
            return;
        }
        selectRefsByKey.set(key, current - 1);
    }
    function hasRegistryEntryForKey(key) {
        for (const entry of registry) {
            if (entry.getCacheKey() === key)
                return true;
        }
        return false;
    }
    function maybeCleanupKeyState(key) {
        const stillInCache = getResourceCacheKeys().includes(key);
        if (stillInCache)
            return;
        if (managedCacheKeyRefs.has(key))
            return;
        if (persistentManagedKeys.has(key))
            return;
        if (selectRefsByKey.has(key))
            return;
        if (hasRegistryEntryForKey(key))
            return;
        cacheVersionSignals.delete(key);
        registryKeyVersionSignals.delete(key);
        sharedSelectByKey.delete(key);
    }
    function getCacheVersionSignal(key) {
        let version = cacheVersionSignals.get(key);
        if (!version) {
            version = signal(0);
            cacheVersionSignals.set(key, version);
        }
        return version;
    }
    function bumpCacheVersion(key) {
        getCacheVersionSignal(key).update((n) => n + 1);
    }
    function getRegistryKeyVersionSignal(key) {
        let version = registryKeyVersionSignals.get(key);
        if (!version) {
            version = signal(0);
            registryKeyVersionSignals.set(key, version);
        }
        return version;
    }
    function bumpRegistryKeyVersion(key) {
        getRegistryKeyVersionSignal(key).update((n) => n + 1);
    }
    function getOrCreateSharedSelectAccessor(encodedKey, selector) {
        let bySelector = sharedSelectByKey.get(encodedKey);
        if (!bySelector) {
            bySelector = new WeakMap();
            sharedSelectByKey.set(encodedKey, bySelector);
        }
        const existing = bySelector.get(selector);
        if (existing) {
            return existing;
        }
        const selected = computed(() => {
            getRegistryKeyVersionSignal(encodedKey)();
            let source;
            let found = false;
            for (const entry of registry) {
                if (entry.getCacheKey() !== encodedKey)
                    continue;
                source = entry.getData();
                found = true;
                break;
            }
            if (!found) {
                getCacheVersionSignal(encodedKey)();
                source = getResourceCacheData(encodedKey);
            }
            return selector(source);
        });
        const accessor = () => selected();
        bySelector.set(selector, accessor);
        return accessor;
    }
    function makeQuery(cfg, behavior) {
        const scope = getCurrentScope();
        const parentScope = scope;
        const staleTime = cfg.staleTime ?? 0;
        let staleTimer = null;
        let cleanupRegistered = false;
        let keyScope = null;
        let keyScopeCk = null;
        if (isInDevMode() && !parentScope && behavior.persist === false) {
            console.warn(`[Dalila] q.query() called outside a scope. ` +
                `It will not cache and may leak. Use within a scope or q.queryGlobal().`);
        }
        function ensureKeyScope(ck) {
            if (!parentScope)
                return null;
            if (keyScope && keyScopeCk === ck)
                return keyScope;
            if (staleTimer != null) {
                clearTimeout(staleTimer);
                staleTimer = null;
            }
            keyScope?.dispose();
            keyScopeCk = ck;
            keyScope = createScope(parentScope);
            return keyScope;
        }
        const scheduleStaleRevalidate = (r, expectedCk) => {
            if (staleTime <= 0)
                return;
            if (!scope) {
                if (isInDevMode()) {
                    console.warn(`[Dalila] staleTime requires a scope for cleanup. ` +
                        `Run the query inside a scope or disable staleTime.`);
                }
                return;
            }
            if (encodeKey(cfg.key()) !== expectedCk)
                return;
            if (!cleanupRegistered) {
                cleanupRegistered = true;
                scope.onCleanup(() => {
                    if (staleTimer != null)
                        clearTimeout(staleTimer);
                    staleTimer = null;
                });
            }
            if (staleTimer != null) {
                clearTimeout(staleTimer);
                staleTimer = null;
            }
            staleTimer = setTimeout(() => {
                if (encodeKey(cfg.key()) !== expectedCk)
                    return;
                r.refresh({ force: false }).catch(() => { });
            }, staleTime);
        };
        const resource = computed(() => {
            const k = cfg.key();
            const ck = encodeKey(k);
            let r;
            const ks = ensureKeyScope(ck);
            const opts = {
                onError: cfg.onError,
                onSuccess: (data) => {
                    bumpCacheVersion(ck);
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
            if (cfg.initialValue !== undefined)
                opts.initialValue = cfg.initialValue;
            const make = () => createResource(async (sig) => {
                await Promise.resolve();
                return runWithRetry(sig, k, () => cfg.fetch(sig, k), cfg.retry, cfg.retryDelay);
            }, opts);
            r = ks ? withScope(ks, make) : make();
            return r;
        });
        const status = computed(() => {
            const r = resource();
            if (r.loading())
                return "loading";
            if (r.error())
                return "error";
            return "success";
        });
        const cacheKeySig = computed(() => encodeKey(cfg.key()));
        const rawKeySig = computed(() => cfg.key());
        let trackedManagedKey = null;
        resource();
        effect(() => {
            resource();
        });
        effect(() => {
            const current = cacheKeySig();
            if (trackedManagedKey === current)
                return;
            if (trackedManagedKey != null) {
                bumpRegistryKeyVersion(trackedManagedKey);
                releaseManagedCacheKey(trackedManagedKey);
            }
            retainManagedCacheKey(current);
            if (behavior.persist) {
                trackPersistentManagedKey(current);
            }
            trackedManagedKey = current;
            bumpRegistryKeyVersion(current);
        });
        const entry = {
            getRawKey: () => rawKeySig(),
            getCacheKey: () => cacheKeySig(),
            getData: () => resource().data(),
            getLoading: () => resource().loading(),
            getFetching: () => resource().fetching(),
            getError: () => resource().error(),
            setData: (value) => {
                resource().setData(value);
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
                    bumpRegistryKeyVersion(trackedManagedKey);
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
    function query(cfg) {
        return makeQuery(cfg, { persist: false });
    }
    function queryGlobal(cfg) {
        return makeQuery(cfg, { persist: true });
    }
    function getQueryData(k) {
        const encoded = encodeKey(k);
        for (const entry of registry) {
            if (entry.getCacheKey() === encoded) {
                return entry.getData();
            }
        }
        return getResourceCacheData(encoded);
    }
    function setQueryData(k, updater) {
        const encoded = encodeKey(k);
        const current = getQueryData(k);
        const next = typeof updater === "function"
            ? updater(current)
            : updater;
        let appliedToRegistry = false;
        for (const entry of registry) {
            if (entry.getCacheKey() !== encoded)
                continue;
            appliedToRegistry = true;
            entry.setData(next);
        }
        const appliedToCache = setResourceCacheData(encoded, next);
        bumpCacheVersion(encoded);
        if (!appliedToRegistry && !appliedToCache) {
            return next;
        }
        return next;
    }
    function select(inputKey, selector) {
        const keySig = computed(() => typeof inputKey === "function" ? inputKey() : inputKey);
        const ownerScope = getCurrentScope();
        let ownedKey = null;
        if (ownerScope) {
            ownerScope.onCleanup(() => {
                if (ownedKey != null) {
                    releaseSelectKey(ownedKey);
                    ownedKey = null;
                }
            });
        }
        return () => {
            const resolvedKey = keySig();
            const encoded = encodeKey(resolvedKey);
            if (ownedKey !== encoded) {
                if (ownedKey != null) {
                    releaseSelectKey(ownedKey);
                }
                ownedKey = encoded;
                retainSelectKey(encoded);
            }
            return getOrCreateSharedSelectAccessor(encoded, selector)();
        };
    }
    function findQueries(filters) {
        const normalized = normalizeQueryFilters(filters);
        const exactKey = normalized.key;
        const hasExactKey = exactKey !== undefined;
        const exactEncoded = hasExactKey ? encodeKey(exactKey) : null;
        const prefix = normalized.keyPrefix;
        const out = [];
        for (const entry of registry) {
            if (hasExactKey && entry.getCacheKey() !== exactEncoded)
                continue;
            if (!hasExactKey && prefix !== undefined && !isKeyPrefixMatch(entry.getRawKey(), prefix))
                continue;
            const info = {
                key: entry.getRawKey(),
                cacheKey: entry.getCacheKey(),
                data: entry.getData(),
                loading: entry.getLoading(),
                fetching: entry.getFetching(),
                error: entry.getError(),
            };
            if (normalized.predicate && !normalized.predicate(info))
                continue;
            out.push(info);
        }
        return out;
    }
    function cancelQueries(filters) {
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
            if (!keys.has(entry.getCacheKey()))
                continue;
            entry.cancel();
        }
    }
    async function prefetchQuery(cfg) {
        const resolvedKey = typeof cfg.key === "function" ? cfg.key() : cfg.key;
        const encoded = encodeKey(resolvedKey);
        if (cfg.persist ?? true) {
            trackPersistentManagedKey(encoded);
        }
        const prefetched = createResource(async (sig) => runWithRetry(sig, resolvedKey, () => cfg.fetch(sig, resolvedKey), cfg.retry, cfg.retryDelay), {
            cache: {
                key: encoded,
                tags: cfg.tags,
                persist: cfg.persist ?? true,
            },
            staleTime: cfg.staleTime,
            staleWhileRevalidate: cfg.staleWhileRevalidate ?? true,
        });
        await prefetched.refresh();
        const data = prefetched.data();
        bumpCacheVersion(encoded);
        return data;
    }
    function invalidateKey(k, opts = {}) {
        const encoded = encodeKey(k);
        invalidateResourceCache(encoded, opts);
        bumpCacheVersion(encoded);
    }
    function invalidateTag(tag, opts = {}) {
        const affected = getResourceCacheKeysByTag(tag);
        invalidateResourceTag(tag, opts);
        for (const key of affected) {
            bumpCacheVersion(key);
        }
    }
    function invalidateTags(tags, opts = {}) {
        const affected = new Set();
        for (const tag of tags) {
            for (const key of getResourceCacheKeysByTag(tag))
                affected.add(key);
        }
        invalidateResourceTags(tags, opts);
        for (const key of affected) {
            bumpCacheVersion(key);
        }
    }
    function refetchQueries(filters, opts = {}) {
        const keys = new Set(findQueries(filters).map((q) => q.cacheKey));
        for (const entry of registry) {
            if (!keys.has(entry.getCacheKey()))
                continue;
            entry.refresh({ force: opts.force ?? true }).catch(() => { });
        }
    }
    function invalidateQueries(filters, opts = {}) {
        const normalized = normalizeQueryFilters(filters);
        if (!normalized.predicate) {
            for (const key of getFilteredCacheKeys(normalized, listManagedCacheKeys())) {
                invalidateResourceCache(key, { revalidate: true, force: opts.force ?? true });
                bumpCacheVersion(key);
            }
            return;
        }
        refetchQueries(normalized, opts);
    }
    function observeQuery(state, listener, opts = {}) {
        let first = true;
        return effect(() => {
            const snapshot = {
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
    function infiniteQuery(cfg) {
        const pages = signal([]);
        const pageParams = signal([]);
        const loading = signal(true);
        const fetching = signal(false);
        const error = signal(null);
        const hasNextPage = signal(true);
        let controller = null;
        let activeEncodedKey = null;
        const resolveKey = () => {
            if (typeof cfg.queryKey === "function") {
                return cfg.queryKey();
            }
            return cfg.queryKey;
        };
        const runPage = async (pageParam, append, expectedKey) => {
            controller?.abort();
            controller = new AbortController();
            const sig = controller.signal;
            fetching.set(true);
            if (!append)
                loading.set(true);
            if (!append)
                error.set(null);
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
                const page = await runWithRetry(sig, queryKey, () => cfg.queryFn({
                    signal: sig,
                    queryKey,
                    pageParam,
                }), cfg.retry, cfg.retryDelay);
                if (sig.aborted)
                    return null;
                const nextPages = append ? [...pages(), page] : [page];
                const nextParams = append ? [...pageParams(), pageParam] : [pageParam];
                pages.set(nextPages);
                pageParams.set(nextParams);
                const next = cfg.getNextPageParam(page, nextPages, nextParams);
                hasNextPage.set(next !== undefined && next !== null);
                error.set(null);
                return page;
            }
            catch (e) {
                if (sig.aborted)
                    return null;
                const err = e instanceof Error ? e : new Error(String(e));
                error.set(err);
                return null;
            }
            finally {
                if (!sig.aborted) {
                    fetching.set(false);
                    loading.set(false);
                }
            }
        };
        const refresh = async () => {
            pages.set([]);
            pageParams.set([]);
            hasNextPage.set(true);
            await runPage(cfg.initialPageParam, false);
        };
        const fetchNextPage = async () => {
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
            const next = cfg.getNextPageParam(currentPages[currentPages.length - 1], currentPages, currentParams);
            if (next === undefined || next === null) {
                hasNextPage.set(false);
                return null;
            }
            return runPage(next, true, key);
        };
        fetchNextPage().catch(() => { });
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
        select,
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
