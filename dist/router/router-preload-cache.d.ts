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
export declare function createRouterPreloadCacheManager<TPublicEntry>(options: RouterPreloadCacheManagerOptions<TPublicEntry>): RouterPreloadCacheManager<TPublicEntry>;
export {};
