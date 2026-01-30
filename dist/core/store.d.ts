/**
 * Global Store - Matar necessidade de Zustand
 *
 * createStore() cria um objeto reativo global que:
 * - Não precisa de scope
 * - É singleton por padrão
 * - Suporta computed properties
 * - Suporta actions
 * - Totalmente type-safe
 */
type AnyFunction = (...args: any[]) => any;
type StoreActions<T> = {
    [K in keyof T as T[K] extends AnyFunction ? K : never]: T[K];
};
type StoreGetters<T> = {
    [K in keyof T as T[K] extends AnyFunction ? never : K]: () => T[K];
};
type Store<T> = StoreGetters<T> & StoreActions<T> & {
    /**
     * Subscribe to any state change (like Zustand)
     */
    subscribe(fn: (state: T) => void): () => void;
    /**
     * Get snapshot of current state (for devtools)
     */
    getState(): T;
    /**
     * Set multiple values at once (batched)
     */
    setState(partial: Partial<T> | ((state: T) => Partial<T>)): void;
    /**
     * Reset store to initial state
     */
    reset(): void;
};
/**
 * Create a global reactive store (Zustand-like but better)
 *
 * @example
 * ```typescript
 * const useCounter = createStore({
 *   count: 0,
 *   increment() {
 *     this.count++;
 *   },
 *   decrement() {
 *     this.count--;
 *   }
 * });
 *
 * // Use anywhere (no scope needed!)
 * console.log(useCounter.count()); // 0
 * useCounter.increment();
 * console.log(useCounter.count()); // 1
 *
 * // Reactive
 * effect(() => {
 *   console.log('Count:', useCounter.count());
 * });
 * ```
 */
export declare function createStore<T extends Record<string, any>>(initialState: T): Store<T>;
/**
 * Create a computed store (derived from other stores)
 *
 * @example
 * ```typescript
 * const todos = createStore({
 *   items: [{ done: false }, { done: true }]
 * });
 *
 * const stats = createComputedStore(() => ({
 *   total: todos.items().length,
 *   completed: todos.items().filter(t => t.done).length
 * }));
 *
 * console.log(stats.total()); // 2
 * console.log(stats.completed()); // 1
 * ```
 */
export declare function createComputedStore<T extends Record<string, any>>(compute: () => T): StoreGetters<T>;
/**
 * Persist store to localStorage
 *
 * @example
 * ```typescript
 * const settings = createStore({
 *   theme: 'dark',
 *   language: 'en'
 * });
 *
 * persistStore(settings, 'app-settings');
 * // Auto-saves on change, auto-loads on init
 * ```
 */
export declare function persistStore<T extends Record<string, any>>(store: Store<T>, key: string, options?: {
    storage?: Storage;
    serialize?: (state: T) => string;
    deserialize?: (str: string) => Partial<T>;
}): () => void;
/**
 * Create a store slice (like Redux Toolkit)
 *
 * @example
 * ```typescript
 * const auth = createStoreSlice('auth', {
 *   user: null,
 *   login(user) {
 *     this.user = user;
 *   },
 *   logout() {
 *     this.user = null;
 *   }
 * });
 *
 * const app = combineStores({ auth, theme, router });
 * ```
 */
export declare function createStoreSlice<T extends Record<string, any>>(name: string, initialState: T): Store<T> & {
    _name: string;
};
/**
 * Combine multiple store slices into one
 */
export declare function combineStores<T extends Record<string, Store<any> & {
    _name: string;
}>>(slices: T): {
    [K in keyof T]: T[K];
};
export {};
