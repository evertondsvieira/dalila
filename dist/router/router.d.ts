import { Signal } from '../core/signal.js';
import { RouteTable, RouteState, RouteTableMatch, RouteCtx, NavigateOptions, RouteManifestEntry, RouteMiddlewareResolver, RouteParamValue } from './route-tables.js';
/** Reactive navigation state exposed via `router.status`. */
export type RouterStatus = {
    state: 'idle';
} | {
    state: 'loading';
    to: RouteState;
} | {
    state: 'error';
    to: RouteState;
    error: unknown;
};
/** Public router API returned by `createRouter`. */
export interface Router {
    start(): void;
    stop(): void;
    navigate(path: string | RouterNavigateTarget, options?: NavigateOptions): Promise<void>;
    push(path: string | RouterNavigateTarget): Promise<void>;
    replace(path: string | RouterNavigateTarget): Promise<void>;
    back(): void;
    href(target: RouterNavigateTarget): string;
    preload(path: string): void;
    invalidateByTag(tag: string): void;
    invalidateWhere(predicate: (entry: RouterPreloadCacheEntry) => boolean): void;
    prefetchByTag(tag: string): Promise<void>;
    prefetchByScore(minScore: number): Promise<void>;
    link(event: MouseEvent): void;
    route: Signal<RouteState>;
    status: Signal<RouterStatus>;
}
export type ScrollBehavior = 'auto' | 'smooth' | 'none';
/** Navigation lifecycle hooks. */
export interface LifecycleHooks {
    beforeNavigate?: (to: RouteState, from: RouteState | null) => boolean | Promise<boolean>;
    afterNavigate?: (to: RouteState, from: RouteState | null) => void | Promise<void>;
    onError?: (error: unknown, ctx: RouteCtx) => void;
}
/**
 * Configuration for `createRouter`.
 *
 * Accepts the route tree, outlet element, optional manifest for
 * file-based routing, scroll/preload cache sizes, lifecycle hooks,
 * tag policies, and global state views.
 */
export interface RouterConfig {
    routes: RouteTable[];
    routeManifest?: RouteManifestEntry[];
    globalMiddleware?: RouteMiddlewareResolver;
    outlet: Element;
    basePath?: string;
    scrollBehavior?: ScrollBehavior;
    preloadCacheSize?: number;
    scrollPositionsCacheSize?: number;
    hooks?: LifecycleHooks;
    tagPolicies?: {
        guards?: Record<string, (ctx: RouteCtx, tagCtx: RouteTagContext) => boolean | string | null | undefined | Promise<boolean | string | null | undefined>>;
        layouts?: Record<string, (ctx: RouteCtx, child: Node[], data: any, tagCtx: RouteTagContext) => Node | DocumentFragment | Node[]>;
    };
    notFoundView?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
    errorView?: (ctx: RouteCtx, error: unknown) => Node | DocumentFragment | Node[];
    pendingView?: (ctx: RouteCtx) => Node | DocumentFragment | Node[];
}
export interface RouteTagContext {
    tag: string;
    tags: string[];
    match: RouteTableMatch;
    manifest?: RouteManifestEntry;
}
/** Read-only snapshot of a preload cache entry, passed to `invalidateWhere`. */
export interface RouterPreloadCacheEntry {
    key: string;
    path: string;
    fullPath: string;
    routePath: string;
    routeId?: string;
    params: Record<string, RouteParamValue>;
    queryString: string;
    query: URLSearchParams;
    tags: string[];
    score?: number;
    status: 'pending' | 'fulfilled' | 'rejected';
}
export interface RouterNavigateTarget {
    path: string;
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
    hash?: string;
}
/** Return the most recently created router instance (or null). */
export declare function getCurrentRouter(): Router | null;
/**
 * Create a client-side router.
 *
 * Compiles the route tree once, then uses the pre-built regex table
 * for all subsequent navigations. Manages preload cache, scroll
 * positions, lifecycle hooks, and declarative d-link interception.
 */
export declare function createRouter(config: RouterConfig): Router;
/**
 * Type-safe navigation wrapper.
 *
 * Binds a router instance to a generated `buildPath` function so that
 * route patterns and their params are validated at compile time.
 */
export interface TypedNavigate<TPatterns extends string = string, TParamMap extends Record<string, Record<string, any>> = Record<string, Record<string, any>>> {
    <P extends TPatterns>(pattern: P, params: TParamMap[P], options?: NavigateOptions): Promise<void>;
}
/** Create a type-safe navigate function bound to a router and a generated `buildPath`. */
export declare function createTypedNavigate<TPatterns extends string = string, TParamMap extends Record<TPatterns, Record<string, any>> = Record<string, Record<string, any>>>(router: Router, buildPath: (pattern: TPatterns, params: TParamMap[TPatterns]) => string): TypedNavigate<TPatterns, TParamMap>;
export declare function buildPath(pattern: string, params?: Record<string, unknown>): string;
export declare function buildHref(target: RouterNavigateTarget): string;
