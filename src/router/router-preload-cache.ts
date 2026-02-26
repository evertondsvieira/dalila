import type { Scope } from '../core/scope.js';
import { LRUCache } from './lru-cache.js';
import type { PreloadMetadata } from './preload-metadata.js';

export interface PreloadEntry {
  promise: Promise<any>;
  controller: AbortController;
  scope: Scope;
  status: 'pending' | 'fulfilled' | 'rejected';
  data?: any;
  error?: unknown;
}

interface RouterPreloadCacheManagerOptions<TPublicEntry> {
  size: number;
  toPublicEntry: (key: string, entry: PreloadEntry, metadata: PreloadMetadata) => TPublicEntry;
}

export interface RouterPreloadCacheManager<TPublicEntry> {
  cache: LRUCache<string, PreloadEntry>;
  getMetadata(key: string): PreloadMetadata | undefined;
  setMetadata(key: string, metadata: PreloadMetadata): void;
  invalidateByTag(tag: string): void;
  invalidateWhere(predicate: (entry: TPublicEntry) => boolean): void;
  clear(): void;
}

export function createRouterPreloadCacheManager<TPublicEntry>(
  options: RouterPreloadCacheManagerOptions<TPublicEntry>
): RouterPreloadCacheManager<TPublicEntry> {
  const preloadTagsByKey = new Map<string, Set<string>>();
  const preloadMetadataByKey = new Map<string, PreloadMetadata>();

  const cache = new LRUCache<string, PreloadEntry>(
    options.size,
    (key, entry) => {
      try {
        entry.controller.abort();
        entry.scope.dispose();
      } finally {
        preloadTagsByKey.delete(key);
        preloadMetadataByKey.delete(key);
      }
    }
  );

  function setMetadata(key: string, metadata: PreloadMetadata): void {
    preloadMetadataByKey.set(key, metadata);
    if (metadata.tags.length > 0) {
      preloadTagsByKey.set(key, new Set(metadata.tags));
    } else {
      preloadTagsByKey.delete(key);
    }
  }

  function getMetadata(key: string): PreloadMetadata | undefined {
    return preloadMetadataByKey.get(key);
  }

  function invalidateByTag(tag: string): void {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;

    for (const [key, tags] of [...preloadTagsByKey.entries()]) {
      if (!tags.has(normalizedTag)) continue;
      cache.delete(key);
    }
  }

  function invalidateWhere(predicate: (entry: TPublicEntry) => boolean): void {
    for (const [key, preloadEntry] of [...cache.entries()]) {
      const metadata = preloadMetadataByKey.get(key);
      if (!metadata) continue;

      let shouldInvalidate = false;
      try {
        shouldInvalidate = Boolean(predicate(options.toPublicEntry(key, preloadEntry, metadata)));
      } catch (error) {
        console.error('[Dalila] invalidateWhere predicate failed:', error);
        return;
      }

      if (shouldInvalidate) {
        cache.delete(key);
      }
    }
  }

  function clear(): void {
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
