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
import { signal, computed } from './signal.js';
import { batch } from './scheduler.js';
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
export function createStore(initialState) {
    const stateSignals = new Map();
    const initialStateCopy = { ...initialState };
    const subscribers = new Set();
    // Separate actions from state
    const actions = {};
    const stateKeys = [];
    for (const [key, value] of Object.entries(initialState)) {
        if (typeof value === 'function') {
            actions[key] = value;
        }
        else {
            stateKeys.push(key);
            stateSignals.set(key, signal(value));
        }
    }
    // Notify subscribers on any state change
    const notifySubscribers = () => {
        const currentState = getState();
        subscribers.forEach((fn) => fn(currentState));
    };
    // Proxy to intercept state access in actions
    const stateProxy = new Proxy({}, {
        get(_target, prop) {
            const sig = stateSignals.get(prop);
            if (sig)
                return sig();
            if (prop in actions)
                return actions[prop];
            return undefined;
        },
        set(_target, prop, value) {
            const sig = stateSignals.get(prop);
            if (sig) {
                sig.set(value);
                notifySubscribers();
                return true;
            }
            return false;
        },
    });
    // Bind actions to proxy (so `this` works)
    const boundActions = {};
    for (const [key, fn] of Object.entries(actions)) {
        boundActions[key] = fn.bind(stateProxy);
    }
    function getState() {
        const state = {};
        for (const key of stateKeys) {
            state[key] = stateSignals.get(key)();
        }
        return state;
    }
    function setState(partial) {
        const updates = typeof partial === 'function' ? partial(getState()) : partial;
        batch(() => {
            for (const [key, value] of Object.entries(updates)) {
                const sig = stateSignals.get(key);
                if (sig) {
                    sig.set(value);
                }
            }
            notifySubscribers();
        });
    }
    function reset() {
        batch(() => {
            for (const [key, value] of Object.entries(initialStateCopy)) {
                if (typeof value !== 'function') {
                    const sig = stateSignals.get(key);
                    if (sig) {
                        sig.set(value);
                    }
                }
            }
            notifySubscribers();
        });
    }
    function subscribe(fn) {
        subscribers.add(fn);
        return () => subscribers.delete(fn);
    }
    // Build store object
    const store = {
        ...boundActions,
        subscribe,
        getState,
        setState,
        reset,
    };
    // Add getters for state
    for (const key of stateKeys) {
        store[key] = () => stateSignals.get(key)();
    }
    return store;
}
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
export function createComputedStore(compute) {
    const computedValues = new Map();
    // Run once to get keys
    const initial = compute();
    for (const key of Object.keys(initial)) {
        computedValues.set(key, computed(() => compute()[key]));
    }
    const store = {};
    for (const [key, sig] of computedValues) {
        store[key] = () => sig();
    }
    return store;
}
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
export function persistStore(store, key, options = {}) {
    const storage = options.storage || localStorage;
    const serialize = options.serialize || JSON.stringify;
    const deserialize = options.deserialize || JSON.parse;
    // Load initial state
    try {
        const saved = storage.getItem(key);
        if (saved) {
            const parsed = deserialize(saved);
            store.setState(parsed);
        }
    }
    catch (err) {
        console.warn(`Failed to load persisted store "${key}":`, err);
    }
    // Save on change
    const unsubscribe = store.subscribe((state) => {
        try {
            storage.setItem(key, serialize(state));
        }
        catch (err) {
            console.warn(`Failed to persist store "${key}":`, err);
        }
    });
    return unsubscribe;
}
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
export function createStoreSlice(name, initialState) {
    const store = createStore(initialState);
    store._name = name;
    return store;
}
/**
 * Combine multiple store slices into one
 */
export function combineStores(slices) {
    return slices;
}
