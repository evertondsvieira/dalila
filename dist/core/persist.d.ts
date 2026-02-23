import { type Signal } from './signal.js';
/**
 * Storage interface (compatible with localStorage, sessionStorage, etc.)
 */
export interface StateStorage {
    getItem(key: string): string | null | Promise<string | null>;
    setItem(key: string, value: string): void | Promise<void>;
    removeItem?(key: string): void | Promise<void>;
}
/**
 * Serialization interface
 */
export interface Serializer<T> {
    serialize(value: T): string;
    deserialize(value: string): T;
}
/**
 * Persist options
 */
export interface PersistOptions<T> {
    name: string;
    storage?: StateStorage;
    serializer?: Serializer<T>;
    version?: number;
    migrate?: (persistedState: unknown, version: number) => T;
    merge?: 'replace' | 'shallow';
    onRehydrate?: (state: T) => void;
    onError?: (error: Error) => void;
    /**
     * Dev-server only hint (not used by runtime yet).
     * Kept for forward-compat with preload injection.
     */
    preload?: boolean;
    /**
     * Sync persisted state across browser tabs using BroadcastChannel.
     * When enabled, changes in one tab will automatically reflect in other tabs.
     * Default: false
     */
    syncTabs?: boolean;
}
/**
 * Signal with optional dispose method for manual cleanup.
 * Returned when persist() is called outside of a scope.
 */
export interface PersistedSignal<T> extends Signal<T> {
    /** Cleanup resources. Only available when persist is called outside a scope. */
    dispose?: () => void;
}
/**
 * Create a persisted signal that automatically syncs with storage.
 */
export declare function persist<T>(baseSignal: Signal<T>, options: PersistOptions<T>): PersistedSignal<T>;
/**
 * Helper to create JSON storage wrapper
 */
export declare function createJSONStorage(getStorage: () => StateStorage): StateStorage;
/**
 * Clear persisted data for a given key
 */
export declare function clearPersisted(name: string, storage?: StateStorage): void;
/**
 * Options for preload script generation
 */
export interface PreloadScriptOptions {
    storageKey: string;
    defaultValue: string;
    target?: 'documentElement' | 'body';
    attribute?: string;
    storageType?: 'localStorage' | 'sessionStorage';
}
/**
 * Generate a minimal inline script to prevent FOUC.
 *
 * NOTE: Assumes the value in storage was JSON serialized (default serializer).
 */
export declare function createPreloadScript(options: PreloadScriptOptions): string;
export declare function createThemeScript(storageKey: string, defaultTheme?: string): string;
