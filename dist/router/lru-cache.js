/**
 * Fixed-size LRU cache with optional eviction callback.
 *
 * Used by the router for preload data and scroll positions.
 */
export class LRUCache {
    constructor(maxSize, onEvict) {
        this.cache = new Map();
        this.maxSize = maxSize;
        this.onEvict = onEvict;
    }
    get(key) {
        const value = this.cache.get(key);
        if (value !== undefined) {
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }
    set(key, value) {
        if (this.cache.has(key)) {
            const existing = this.cache.get(key);
            if (existing !== undefined && this.onEvict) {
                this.onEvict(key, existing);
            }
            this.cache.delete(key);
        }
        else if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                const evicted = this.cache.get(firstKey);
                if (evicted !== undefined && this.onEvict) {
                    this.onEvict(firstKey, evicted);
                }
                this.cache.delete(firstKey);
            }
        }
        this.cache.set(key, value);
    }
    has(key) {
        return this.cache.has(key);
    }
    delete(key) {
        const value = this.cache.get(key);
        if (value === undefined)
            return false;
        if (this.onEvict) {
            this.onEvict(key, value);
        }
        return this.cache.delete(key);
    }
    entries() {
        return this.cache.entries();
    }
    clear() {
        if (this.onEvict) {
            for (const [key, value] of this.cache.entries()) {
                this.onEvict(key, value);
            }
        }
        this.cache.clear();
    }
}
