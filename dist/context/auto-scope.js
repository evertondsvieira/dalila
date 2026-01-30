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
import { getCurrentScope, createScope, isScopeDisposed, withScope } from '../core/scope.js';
import { isInDevMode } from '../core/dev.js';
import { signal as createSignal } from '../core/signal.js';
import { createContext, provide as rawProvide, tryInject as rawTryInject, debugListAvailableContexts, } from './context.js';
/**
 * Symbol key for storing the global root scope.
 * Using Symbol.for() allows multiple instances of Dalila to share the same global scope,
 * preventing conflicts when multiple libs use Dalila in the same app.
 */
const DALILA_GLOBAL_SCOPE_KEY = Symbol.for('dalila:global-scope');
/**
 * Global storage for the root scope using the symbol key.
 * This allows sharing across multiple Dalila instances.
 */
const globalStorage = globalThis;
/**
 * Global root scope (lazy initialized).
 *
 * Used only when `provide()` is called outside a scope.
 * `inject()` is safe-by-default and never creates this scope.
 */
function getGlobalRootScope() {
    return globalStorage[DALILA_GLOBAL_SCOPE_KEY] ?? null;
}
function setGlobalRootScope(scope) {
    globalStorage[DALILA_GLOBAL_SCOPE_KEY] = scope;
}
/** Dev warning guard so we only warn once per page lifecycle. */
let warnedGlobalProvide = false;
/** Browser-only unload handler for global scope cleanup. */
let beforeUnloadHandler = null;
let autoScopePolicy = "throw";
export function setAutoScopePolicy(policy) {
    autoScopePolicy = policy;
}
function warnGlobalProvideOnce() {
    if (!isInDevMode())
        return;
    if (warnedGlobalProvide)
        return;
    warnedGlobalProvide = true;
    console.warn('[Dalila] provide() called outside a scope. Using a global root scope (auto-scope). ' +
        'Prefer scope(() => { ... }) or provideGlobal() for explicit globals. ' +
        'You can also setAutoScopePolicy("throw") to prevent accidental globals.');
}
function detachBeforeUnloadListener() {
    if (typeof window === 'undefined')
        return;
    if (!beforeUnloadHandler)
        return;
    if (!window.removeEventListener)
        return;
    window.removeEventListener('beforeunload', beforeUnloadHandler);
    beforeUnloadHandler = null;
}
/**
 * Returns the global root scope, creating it if needed.
 *
 * Notes:
 * - Only `provide()` is allowed to create the global scope.
 * - On browsers, we dispose the global scope on `beforeunload` to release resources.
 * - We intentionally swallow errors during unload to avoid noisy teardown failures.
 */
// Note: provideGlobal() can also create this scope explicitly.
function getOrCreateGlobalScope() {
    let globalRootScope = getGlobalRootScope();
    if (globalRootScope && isScopeDisposed(globalRootScope)) {
        detachBeforeUnloadListener();
        setGlobalRootScope(null);
        warnedGlobalProvide = false;
        globalRootScope = null;
    }
    if (!globalRootScope) {
        globalRootScope = createScope(null);
        setGlobalRootScope(globalRootScope);
        if (typeof window !== 'undefined' && window.addEventListener && !beforeUnloadHandler) {
            beforeUnloadHandler = () => {
                detachBeforeUnloadListener();
                try {
                    getGlobalRootScope()?.dispose();
                }
                catch {
                    // Do not throw during unload.
                }
                setGlobalRootScope(null);
                warnedGlobalProvide = false;
            };
            window.addEventListener('beforeunload', beforeUnloadHandler);
        }
    }
    return globalRootScope;
}
/**
 * Provide with auto-scope.
 *
 * Semantics:
 * - Inside a scope: behaves like the raw `provide()`.
 * - Outside a scope: creates/uses the global root scope (warns once in dev).
 */
export function provide(token, value) {
    const currentScope = getCurrentScope();
    if (currentScope) {
        rawProvide(token, value);
    }
    else {
        if (autoScopePolicy === "throw") {
            throw new Error("[Dalila] provide() called outside a scope. " +
                "Use scope(() => provide(...)) or provideGlobal() instead.");
        }
        if (autoScopePolicy === "warn") {
            warnGlobalProvideOnce();
        }
        const globalScope = getOrCreateGlobalScope();
        withScope(globalScope, () => {
            rawProvide(token, value);
        });
    }
}
/**
 * Provide explicitly in the global root scope.
 *
 * Semantics:
 * - Always uses the detached global scope (creates if needed).
 * - Never warns.
 */
export function provideGlobal(token, value) {
    const globalScope = getOrCreateGlobalScope();
    withScope(globalScope, () => {
        rawProvide(token, value);
    });
}
/**
 * Inject with auto-scope.
 *
 * Semantics:
 * - Inside a scope: behaves like raw `inject()`, but throws a more descriptive error.
 * - Outside a scope:
 *   - If a global scope exists: reads from it (safe-by-default).
 *   - If no global scope exists: throws with guidance (does NOT create global state).
 */
export function inject(token) {
    if (getCurrentScope()) {
        const result = rawTryInject(token);
        if (result.found)
            return result.value;
        throw new Error(createContextNotFoundError(token));
    }
    let globalRootScope = getGlobalRootScope();
    if (globalRootScope && isScopeDisposed(globalRootScope)) {
        setGlobalRootScope(null);
        warnedGlobalProvide = false;
        globalRootScope = null;
    }
    if (!globalRootScope) {
        // Check for default value before throwing
        if (token.defaultValue !== undefined) {
            return token.defaultValue;
        }
        throw createInjectOutsideScopeError(token, 'No global scope exists yet.');
    }
    return withScope(globalRootScope, () => {
        const result = rawTryInject(token);
        if (result.found)
            return result.value;
        throw createInjectOutsideScopeError(token);
    });
}
/**
 * Try to inject a context value with auto-scope.
 *
 * Semantics:
 * - Returns { found: true, value } when the token is found.
 * - Returns { found: false, value: undefined } when not found.
 * - Works both inside and outside scopes (reads global if exists).
 */
export function tryInject(token) {
    if (getCurrentScope()) {
        return rawTryInject(token);
    }
    let globalRootScope = getGlobalRootScope();
    if (globalRootScope && isScopeDisposed(globalRootScope)) {
        setGlobalRootScope(null);
        warnedGlobalProvide = false;
        globalRootScope = null;
    }
    if (!globalRootScope) {
        // Check for default value
        if (token.defaultValue !== undefined) {
            return { found: true, value: token.defaultValue };
        }
        return { found: false, value: undefined };
    }
    return withScope(globalRootScope, () => rawTryInject(token));
}
/**
 * Inject explicitly from the global root scope.
 *
 * Semantics:
 * - Reads only the global root scope.
 * - Throws if no global scope exists yet.
 */
export function injectGlobal(token) {
    let globalRootScope = getGlobalRootScope();
    if (globalRootScope && isScopeDisposed(globalRootScope)) {
        setGlobalRootScope(null);
        warnedGlobalProvide = false;
        globalRootScope = null;
    }
    if (!globalRootScope) {
        // Check for default value before throwing
        if (token.defaultValue !== undefined) {
            return token.defaultValue;
        }
        throw new Error("[Dalila] injectGlobal() called but no global scope exists yet. " +
            "Use provideGlobal() first.");
    }
    return withScope(globalRootScope, () => {
        const result = rawTryInject(token);
        if (result.found)
            return result.value;
        throw new Error("[Dalila] injectGlobal() token not found in global scope. " +
            "Provide it via provideGlobal() or call inject() inside the correct scope.");
    });
}
/**
 * Convenience helper: create a scope, run `fn` inside it, and return `{ result, dispose }`.
 *
 * Semantics:
 * - If `fn` throws, the scope is disposed and the error is rethrown.
 * - Caller owns disposal.
 */
export function scope(fn) {
    const parent = getCurrentScope();
    const newScope = createScope(parent ?? null);
    try {
        const result = withScope(newScope, fn);
        return {
            result,
            dispose: () => newScope.dispose(),
        };
    }
    catch (err) {
        newScope.dispose();
        throw err;
    }
}
/**
 * Provider helper that bundles:
 * - a dedicated provider scope
 * - a value created by `setup()`
 * - registration via `provide()`
 *
 * Useful for "feature modules" that want to expose a typed dependency with explicit lifetime.
 */
export function createProvider(token, setup) {
    return {
        create() {
            const parent = getCurrentScope();
            const providerScope = createScope(parent ?? null);
            const value = withScope(providerScope, () => {
                const result = setup();
                provide(token, result);
                return result;
            });
            return {
                value,
                dispose: () => providerScope.dispose(),
            };
        },
        use() {
            return inject(token);
        },
    };
}
/**
 * Builds a descriptive error message for missing contexts inside a scope hierarchy.
 */
function createContextNotFoundError(token) {
    const contextName = token.name || 'unnamed';
    let message = `[Dalila] Context '${contextName}' not found in scope hierarchy.\n\n`;
    message += `Possible causes:\n`;
    message += `  1. You forgot to call provide(token, value) in an ancestor scope\n`;
    message += `  2. You're calling inject() in a child scope, but provide() was in a sibling scope\n`;
    message += `  3. The scope where provide() was called has already been disposed\n\n`;
    message += `How to fix:\n`;
    message += `  • Make sure provide() is called in a parent scope\n`;
    message += `  • Use scope(() => { provide(...); inject(...); }) to ensure the same hierarchy\n`;
    message += `  • Check that the scope hasn't been disposed\n\n`;
    if (isInDevMode()) {
        const levels = debugListAvailableContexts(8);
        if (levels.length > 0) {
            message += `Available contexts by depth:\n`;
            for (const level of levels) {
                const names = level.tokens.map((t) => t.name).join(', ') || '(none)';
                message += `  depth ${level.depth}: ${names}\n`;
            }
            message += `\n`;
        }
    }
    message += `Learn more: https://github.com/evertondsvieira/dalila/blob/main/docs/context.md`;
    return message;
}
function createInjectOutsideScopeError(token, extra) {
    const name = token.name || 'unnamed';
    return new Error(`[Dalila] Context '${name}' not found.\n\n` +
        (extra ? `${extra}\n` : '') +
        `You called inject() outside a scope. Either:\n` +
        `  1. Call provide(token, value) first, or\n` +
        `  2. Wrap your code in scope(() => { ... })\n\n` +
        `Learn more: https://github.com/evertondsvieira/dalila/blob/main/docs/context.md`);
}
/**
 * Returns the global root scope (if it exists).
 * Intended for debugging/advanced usage only.
 */
export function getGlobalScope() {
    return getGlobalRootScope();
}
/**
 * Returns true if a global root scope exists.
 */
export function hasGlobalScope() {
    return getGlobalRootScope() != null;
}
/**
 * Resets the global root scope.
 * Intended for tests to ensure isolation between runs.
 */
export function resetGlobalScope() {
    detachBeforeUnloadListener();
    const globalRootScope = getGlobalRootScope();
    if (globalRootScope) {
        globalRootScope.dispose();
        setGlobalRootScope(null);
    }
    warnedGlobalProvide = false;
    autoScopePolicy = "throw";
}
/**
 * Create a reactive context that wraps a signal.
 *
 * @param name - Debug name for the context
 * @param defaultValue - Default initial value for the signal
 */
export function createSignalContext(name, defaultValue) {
    const token = createContext(name);
    return {
        provide(initialValue) {
            const sig = createSignal(initialValue !== undefined ? initialValue : defaultValue);
            provide(token, sig);
            return sig;
        },
        inject() {
            return inject(token);
        },
        tryInject() {
            const result = tryInject(token);
            if (result.found) {
                return { found: true, signal: result.value };
            }
            return { found: false, signal: undefined };
        },
        token,
    };
}
// Re-export createContext for convenience.
export { createContext };
