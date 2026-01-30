import { type Scope } from "../core/scope.js";
/**
 * Context (Dependency Injection) — scope-based and hierarchical.
 *
 * Mental model:
 * - A context value lives in the current Scope.
 * - Child scopes can read values provided by ancestors (via Scope.parent chain).
 * - Values are cleaned up automatically when the owning scope is disposed.
 *
 * Constraints (raw API):
 * - `provide()` MUST be called inside a scope.
 * - `inject()` MUST be called inside a scope.
 *
 * (Auto-scope behavior belongs in `dalila/context` wrapper — not here.)
 */
/**
 * Branded type marker for compile-time type safety.
 * Using a unique symbol ensures tokens are not interchangeable even if they have the same T.
 */
declare const ContextBrand: unique symbol;
/**
 * ContextToken:
 * - `name` is optional (used for debugging/errors)
 * - `defaultValue` is optional (returned when no provider is found)
 * - Branded with a unique symbol for type safety
 */
export interface ContextToken<T> {
    readonly name?: string;
    readonly defaultValue?: T;
    readonly [ContextBrand]: T;
}
/**
 * Create a new context token.
 *
 * Notes:
 * - Tokens are identity-based: the same token instance is the key.
 * - `name` is for developer-facing errors and debugging only.
 * - `defaultValue` is returned by inject/tryInject when no provider is found.
 */
export declare function createContext<T>(name?: string, defaultValue?: T): ContextToken<T>;
/**
 * Configure the depth at which context lookup warns about deep hierarchies.
 * Set to Infinity to disable the warning.
 */
export declare function setDeepHierarchyWarnDepth(depth: number): void;
/**
 * Provide a context value in the current scope.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Overrides any existing value for the same token in this scope.
 */
export declare function provide<T>(token: ContextToken<T>, value: T): void;
/**
 * Inject a context value from the current scope hierarchy.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Walks up the parent chain until it finds the token.
 * - If not found and token has a defaultValue, returns that.
 * - Throws a descriptive error if not found and no default.
 */
export declare function inject<T>(token: ContextToken<T>): T;
/**
 * Result of tryInject - distinguishes between "not found" and "found with undefined value".
 */
export type TryInjectResult<T> = {
    found: true;
    value: T;
} | {
    found: false;
    value: undefined;
};
/**
 * Inject a context value from the current scope hierarchy if present.
 *
 * Rules:
 * - Must be called inside a scope.
 * - Returns { found: true, value } when found.
 * - Returns { found: false, value: undefined } when not found (or uses defaultValue if available).
 */
export declare function tryInject<T>(token: ContextToken<T>): TryInjectResult<T>;
/**
 * Inject a context value and return metadata about where it was resolved.
 */
export declare function injectMeta<T>(token: ContextToken<T>): {
    value: T;
    ownerScope: Scope;
    depth: number;
};
/**
 * Debug helper: list available context tokens per depth.
 */
export declare function debugListAvailableContexts(maxPerLevel?: number): Array<{
    depth: number;
    tokens: {
        name: string;
        token: ContextToken<any>;
    }[];
}>;
/**
 * Alias for debugListAvailableContexts (public helper name).
 */
export declare function listAvailableContexts(maxPerLevel?: number): Array<{
    depth: number;
    tokens: {
        name: string;
        token: ContextToken<any>;
    }[];
}>;
export {};
