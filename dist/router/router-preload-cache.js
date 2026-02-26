import { LRUCache } from './lru-cache.js';
export function createRouterPreloadCacheManager(options) {
    const preloadTagsByKey = new Map();
    const preloadMetadataByKey = new Map();
    const cache = new LRUCache(options.size, (key, entry) => {
        try {
            entry.controller.abort();
            entry.scope.dispose();
        }
        finally {
            preloadTagsByKey.delete(key);
            preloadMetadataByKey.delete(key);
        }
    });
    function setMetadata(key, metadata) {
        preloadMetadataByKey.set(key, metadata);
        if (metadata.tags.length > 0) {
            preloadTagsByKey.set(key, new Set(metadata.tags));
        }
        else {
            preloadTagsByKey.delete(key);
        }
    }
    function getMetadata(key) {
        return preloadMetadataByKey.get(key);
    }
    function invalidateByTag(tag) {
        const normalizedTag = tag.trim();
        if (!normalizedTag)
            return;
        for (const [key, tags] of [...preloadTagsByKey.entries()]) {
            if (!tags.has(normalizedTag))
                continue;
            cache.delete(key);
        }
    }
    function invalidateWhere(predicate) {
        for (const [key, preloadEntry] of [...cache.entries()]) {
            const metadata = preloadMetadataByKey.get(key);
            if (!metadata)
                continue;
            let shouldInvalidate = false;
            try {
                shouldInvalidate = Boolean(predicate(options.toPublicEntry(key, preloadEntry, metadata)));
            }
            catch (error) {
                console.error('[Dalila] invalidateWhere predicate failed:', error);
                return;
            }
            if (shouldInvalidate) {
                cache.delete(key);
            }
        }
    }
    function clear() {
        cache.clear();
        preloadTagsByKey.clear();
        preloadMetadataByKey.clear();
    }
    return {
        cache,
        getMetadata,
        setMetadata,
        invalidateByTag,
        invalidateWhere,
        clear
    };
}
