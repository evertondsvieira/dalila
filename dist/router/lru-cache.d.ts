/**
 * Fixed-size LRU cache with optional eviction callback.
 *
 * Used by the router for preload data and scroll positions.
 */
export declare class LRUCache<K, V> {
    private cache;
    private maxSize;
    private onEvict?;
    constructor(maxSize: number, onEvict?: (key: K, value: V) => void);
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    has(key: K): boolean;
    delete(key: K): boolean;
    entries(): IterableIterator<[K, V]>;
    clear(): void;
}
