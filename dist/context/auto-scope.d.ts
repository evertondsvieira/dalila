/**
 * Auto-scoping Context API.
 *
 * Goal:
 * - Remove the need for explicit `withScope()` in common app code.
 *
 * Auto-scope rules:
 * - `provide()` outside a scope creates a global root scope (warns once in dev).
 * - `inject()` outside a scope never creates global state; it only reads an existing global root.
 *
 * Rationale:
 * - Apps often want "global-ish" DI without Provider pyramids.
 * - Still keep things lifecycle-safe: the global scope can be disposed on page unload.
 */
import { type Scope } from '../core/scope.js';
import { type Signal } from '../core/signal.js';
import { createContext, type ContextToken, type TryInjectResult } from './context.js';
export type AutoScopePolicy = "warn" | "throw" | "silent";
export declare function setAutoScopePolicy(policy: AutoScopePolicy): void;
/**
 * Provide with auto-scope.
 *
 * Semantics:
 * - Inside a scope: behaves like the raw `provide()`.
 * - Outside a scope: creates/uses the global root scope (warns once in dev).
 */
export declare function provide<T>(token: ContextToken<T>, value: T): void;
/**
 * Provide explicitly in the global root scope.
 *
 * Semantics:
 * - Always uses the detached global scope (creates if needed).
 * - Never warns.
 */
export declare function provideGlobal<T>(token: ContextToken<T>, value: T): void;
/**
 * Inject with auto-scope.
 *
 * Semantics:
 * - Inside a scope: behaves like raw `inject()`, but throws a more descriptive error.
 * - Outside a scope:
 *   - If a global scope exists: reads from it (safe-by-default).
 *   - If no global scope exists: throws with guidance (does NOT create global state).
 */
export declare function inject<T>(token: ContextToken<T>): T;
/**
 * Try to inject a context value with auto-scope.
 *
 * Semantics:
 * - Returns { found: true, value } when the token is found.
 * - Returns { found: false, value: undefined } when not found.
 * - Works both inside and outside scopes (reads global if exists).
 */
export declare function tryInject<T>(token: ContextToken<T>): TryInjectResult<T>;
/**
 * Inject explicitly from the global root scope.
 *
 * Semantics:
 * - Reads only the global root scope.
 * - Throws if no global scope exists yet.
 */
export declare function injectGlobal<T>(token: ContextToken<T>): T;
/**
 * Convenience helper: create a scope, run `fn` inside it, and return `{ result, dispose }`.
 *
 * Semantics:
 * - If `fn` throws, the scope is disposed and the error is rethrown.
 * - Caller owns disposal.
 */
export declare function scope<T>(fn: () => T): {
    result: T;
    dispose: () => void;
};
/**
 * Provider helper that bundles:
 * - a dedicated provider scope
 * - a value created by `setup()`
 * - registration via `provide()`
 *
 * Useful for "feature modules" that want to expose a typed dependency with explicit lifetime.
 */
export declare function createProvider<T>(token: ContextToken<T>, setup: () => T): {
    create: () => {
        value: T;
        dispose: () => void;
    };
    use: () => T;
};
/**
 * Returns the global root scope (if it exists).
 * Intended for debugging/advanced usage only.
 */
export declare function getGlobalScope(): Scope | null;
/**
 * Returns true if a global root scope exists.
 */
export declare function hasGlobalScope(): boolean;
/**
 * Resets the global root scope.
 * Intended for tests to ensure isolation between runs.
 */
export declare function resetGlobalScope(): void;
/**
 * Creates a reactive context that wraps a signal.
 *
 * This is the recommended way to share reactive state across scopes.
 * It combines the hierarchical lookup of Context with the reactivity of Signals.
 *
 * Example:
 * ```ts
 * const Theme = createSignalContext("theme", "dark");
 *
 * scope(() => {
 *   // Parent scope: create and provide the signal
 *   const theme = Theme.provide();
 *
 *   effect(() => {
 *     console.log("Theme:", theme()); // Reactive!
 *   });
 *
 *   theme.set("light"); // Updates propagate to all consumers
 * });
 *
 * // Child scope somewhere in the tree
 * scope(() => {
 *   const theme = Theme.inject(); // Get the signal from parent
 *   console.log(theme()); // "light"
 * });
 * ```
 */
export interface SignalContext<T> {
    /**
     * Create a signal with the initial value and provide it in the current scope.
     * Returns the signal for immediate use.
     *
     * @param initialValue - Override the default initial value (optional)
     */
    provide: (initialValue?: T) => Signal<T>;
    /**
     * Inject the signal from an ancestor scope.
     * Throws if no provider exists in the scope hierarchy.
     */
    inject: () => Signal<T>;
    /**
     * Try to inject the signal from an ancestor scope.
     * Returns { found: true, signal } or { found: false, signal: undefined }.
     */
    tryInject: () => {
        found: true;
        signal: Signal<T>;
    } | {
        found: false;
        signal: undefined;
    };
    /**
     * The underlying context token (for advanced use cases).
     */
    token: ContextToken<Signal<T>>;
}
/**
 * Create a reactive context that wraps a signal.
 *
 * @param name - Debug name for the context
 * @param defaultValue - Default initial value for the signal
 */
export declare function createSignalContext<T>(name: string, defaultValue: T): SignalContext<T>;
export { createContext };
