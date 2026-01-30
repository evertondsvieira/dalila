import { getCurrentScope } from "../core/scope.js";
import { isInDevMode } from "../core/dev.js";
/**
 * Create a new context token.
 *
 * Notes:
 * - Tokens are identity-based: the same token instance is the key.
 * - `name` is for developer-facing errors and debugging only.
 * - `defaultValue` is returned by inject/tryInject when no provider is found.
 */
export function createContext(name, defaultValue) {
    return { name, defaultValue };
}
let globalRevision = 0;
let warnedDeepHierarchy = false;
/**
 * Configurable deep hierarchy warning threshold.
 */
let deepHierarchyWarnDepth = 50;
/**
 * Configure the depth at which context lookup warns about deep hierarchies.
 * Set to Infinity to disable the warning.
 */
export function setDeepHierarchyWarnDepth(depth) {
    deepHierarchyWarnDepth = depth;
}
function bumpRevision() {
    globalRevision++;
}
function maybeWarnDeepHierarchy(depth) {
    if (!isInDevMode())
        return;
    if (warnedDeepHierarchy)
        return;
    if (depth < deepHierarchyWarnDepth)
        return;
    warnedDeepHierarchy = true;
    console.warn(`[Dalila] Context lookup traversed ${depth} parent scopes. ` +
        `Consider flattening scope hierarchy or caching static contexts.`);
}
/**
 * Per-scope registry that stores context values and links to a parent registry.
 *
 * Lookup:
 * - `get()` checks current registry first.
 * - If not found, it delegates to the parent registry (if any).
 */
class ContextRegistry {
    constructor(ownerScope, parent) {
        this.contexts = new Map();
        this.resolveCache = new Map();
        this.ownerScope = ownerScope;
        this.parent = parent;
    }
    set(token, value) {
        this.contexts.set(token, { token, value });
        this.resolveCache.delete(token);
    }
    get(token) {
        const res = this.resolve(token);
        return res ? res.value : undefined;
    }
    resolve(token) {
        const cached = this.resolveCache.get(token);
        if (cached && cached.rev === globalRevision)
            return cached.res;
        const hit = this.contexts.get(token);
        if (hit !== undefined) {
            const res = { value: hit.value, ownerScope: this.ownerScope, depth: 0 };
            this.resolveCache.set(token, { rev: globalRevision, res });
            return res;
        }
        if (this.parent) {
            const parentRes = this.parent.resolve(token);
            if (parentRes) {
                const res = {
                    value: parentRes.value,
                    ownerScope: parentRes.ownerScope,
                    depth: parentRes.depth + 1,
                };
                this.resolveCache.set(token, { rev: globalRevision, res });
                return res;
            }
        }
        this.resolveCache.set(token, { rev: globalRevision, res: undefined });
        return undefined;
    }
    listTokens(maxPerLevel) {
        const tokens = [];
        for (const entry of this.contexts.values()) {
            tokens.push(entry.token);
            if (maxPerLevel != null && tokens.length >= maxPerLevel)
                break;
        }
        return tokens;
    }
    /**
     * Release references eagerly.
     *
     * Safety:
     * - Scopes in Dalila cascade: disposing a parent scope disposes children,
     *   so no child scope should outlive a parent registry.
     */
    clear() {
        bumpRevision();
        this.contexts.clear();
        this.parent = undefined;
        this.resolveCache.clear();
    }
}
/**
 * Registry storage keyed by Scope.
 *
 * Why WeakMap:
 * - Avoid keeping scopes alive through registry bookkeeping.
 */
const scopeRegistries = new WeakMap();
/**
 * Get (or lazily create) the registry for a given scope.
 *
 * Key detail:
 * - Parent linkage is derived from `scope.parent` (captured at createScope time),
 *   not from `getCurrentScope()`. This makes the hierarchy stable and explicit.
 *
 * Cleanup:
 * - When the scope is disposed, we clear the registry and remove it from the WeakMap.
 */
function getScopeRegistry(scope) {
    let registry = scopeRegistries.get(scope);
    if (registry)
        return registry;
    const parentScope = scope.parent;
    const parentRegistry = parentScope ? getScopeRegistry(parentScope) : undefined;
    registry = new ContextRegistry(scope, parentRegistry);
    scopeRegistries.set(scope, registry);
    const registryRef = registry;
    scope.onCleanup(() => {
        registryRef.clear();
        scopeRegistries.delete(scope);
    });
    return registry;
}
/**
 * Provide a context value in the current scope.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Overrides any existing value for the same token in this scope.
 */
export function provide(token, value) {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("[Dalila] provide() must be called within a scope. " +
            "Use withScope(createScope(), () => provide(...)) or the auto-scope API.");
    }
    const registry = getScopeRegistry(scope);
    bumpRevision();
    registry.set(token, value);
}
/**
 * Inject a context value from the current scope hierarchy.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Walks up the parent chain until it finds the token.
 * - If not found and token has a defaultValue, returns that.
 * - Throws a descriptive error if not found and no default.
 */
export function inject(token) {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("[Dalila] inject() must be called within a scope. " +
            "Wrap your code in withScope(...) or use the auto-scope API.");
    }
    const registry = getScopeRegistry(scope);
    const res = registry.resolve(token);
    if (res) {
        maybeWarnDeepHierarchy(res.depth);
        return res.value;
    }
    // Check for default value
    if (token.defaultValue !== undefined) {
        return token.defaultValue;
    }
    const name = token.name || "unnamed";
    let message = `[Dalila] Context "${name}" not found in scope hierarchy.`;
    if (isInDevMode()) {
        const levels = debugListAvailableContexts(8);
        if (levels.length > 0) {
            message += `\n\nAvailable contexts by depth:\n`;
            for (const level of levels) {
                const names = level.tokens.map((t) => t.name).join(", ") || "(none)";
                message += `  depth ${level.depth}: ${names}\n`;
            }
        }
    }
    throw new Error(message);
}
/**
 * Inject a context value from the current scope hierarchy if present.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Returns { found: true, value } when found.
 * - Returns { found: false, value: undefined } when not found (or uses defaultValue if available).
 */
export function tryInject(token) {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("[Dalila] tryInject() must be called within a scope. " +
            "Wrap your code in withScope(...) or use the auto-scope API.");
    }
    const registry = getScopeRegistry(scope);
    const res = registry.resolve(token);
    if (res) {
        maybeWarnDeepHierarchy(res.depth);
        return { found: true, value: res.value };
    }
    // Check for default value
    if (token.defaultValue !== undefined) {
        return { found: true, value: token.defaultValue };
    }
    return { found: false, value: undefined };
}
/**
 * Inject a context value and return metadata about where it was resolved.
 */
export function injectMeta(token) {
    const scope = getCurrentScope();
    if (!scope) {
        throw new Error("[Dalila] injectMeta() must be called within a scope. " +
            "Wrap your code in withScope(...) or use the auto-scope API.");
    }
    const registry = getScopeRegistry(scope);
    const res = registry.resolve(token);
    if (!res) {
        const name = token.name || "unnamed";
        let message = `[Dalila] Context "${name}" not found in scope hierarchy.`;
        if (isInDevMode()) {
            const levels = debugListAvailableContexts(8);
            if (levels.length > 0) {
                message += `\n\nAvailable contexts by depth:\n`;
                for (const level of levels) {
                    const names = level.tokens.map((t) => t.name).join(", ") || "(none)";
                    message += `  depth ${level.depth}: ${names}\n`;
                }
            }
        }
        throw new Error(message);
    }
    maybeWarnDeepHierarchy(res.depth);
    return { value: res.value, ownerScope: res.ownerScope, depth: res.depth };
}
/**
 * Debug helper: list available context tokens per depth.
 */
export function debugListAvailableContexts(maxPerLevel) {
    const scope = getCurrentScope();
    if (!scope)
        return [];
    const levels = [];
    let depth = 0;
    let current = scope;
    while (current) {
        const registry = scopeRegistries.get(current);
        const tokens = registry
            ? registry.listTokens(maxPerLevel).map((token) => ({
                name: token.name || "unnamed",
                token,
            }))
            : [];
        levels.push({ depth, tokens });
        current = current.parent;
        depth++;
    }
    return levels;
}
/**
 * Alias for debugListAvailableContexts (public helper name).
 */
export function listAvailableContexts(maxPerLevel) {
    return debugListAvailableContexts(maxPerLevel);
}
