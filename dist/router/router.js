import { signal } from '../core/signal.js';
import { createScope, withScope, withScopeAsync } from '../core/scope.js';
import { normalizeRules, validateValue } from '../form/index.js';
import { compileRoutes, findCompiledRouteStackResult, normalizePath } from './route-tables.js';
/** Singleton reference to the most recently created router. */
let currentRouter = null;
const LINK_ATTRIBUTE = 'd-link';
/**
 * Fixed-size LRU cache with optional eviction callback.
 *
 * Used for preload data and scroll positions — both need bounded
 * memory with automatic eviction of least-recently-used entries.
 */
class LRUCache {
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
/** Return the most recently created router instance (or null). */
export function getCurrentRouter() {
    return currentRouter;
}
/**
 * Create a client-side router.
 *
 * Compiles the route tree once, then uses the pre-built regex table
 * for all subsequent navigations. Manages preload cache, scroll
 * positions, lifecycle hooks, and declarative d-link interception.
 */
export function createRouter(config) {
    const routes = config.routes;
    const compiledRoutes = compileRoutes(routes);
    const globalMiddleware = config.globalMiddleware;
    const outletElement = config.outlet;
    const basePath = normalizePath(config.basePath ?? '/');
    const basePrefix = basePath === '/' ? '' : basePath;
    const scrollBehavior = config.scrollBehavior ?? 'auto';
    const hooks = config.hooks ?? {};
    const notFoundView = config.notFoundView;
    const errorView = config.errorView;
    const pendingView = config.pendingView;
    const tagGuardPolicies = config.tagPolicies?.guards ?? {};
    const tagLayoutPolicies = config.tagPolicies?.layouts ?? {};
    const routeManifestEntries = config.routeManifest ?? [];
    const routeManifestByPattern = new Map(routeManifestEntries.map(entry => [normalizePath(entry.pattern), entry]));
    const routeSignal = signal(createImmutableRouteState({
        path: '/',
        fullPath: '/',
        params: {},
        queryString: '',
        hash: ''
    }));
    const statusSignal = signal({ state: 'idle' });
    let currentScope = null;
    let currentRouteState = null;
    let currentLoaderController = null;
    let started = false;
    let navigationToken = 0;
    const transitionCoalescing = new Map();
    const scrollPositions = new LRUCache(config.scrollPositionsCacheSize ?? 100);
    const preloadTagsByKey = new Map();
    const preloadMetadataByKey = new Map();
    const preloadCache = new LRUCache(config.preloadCacheSize ?? 50, (key, entry) => {
        try {
            entry.controller.abort();
            entry.scope.dispose();
        }
        finally {
            preloadTagsByKey.delete(key);
            preloadMetadataByKey.delete(key);
        }
    });
    const preloadRouteIds = new WeakMap();
    let nextPreloadRouteId = 0;
    const resolvedValidationByRoute = new WeakMap();
    const queryValidatorsByRoute = new WeakMap();
    const paramsValidatorsByRoute = new WeakMap();
    function stripBase(pathname) {
        if (!basePrefix)
            return normalizePath(pathname);
        const normalized = normalizePath(pathname);
        if (normalized === basePrefix)
            return '/';
        if (normalized.startsWith(basePrefix + '/')) {
            const stripped = normalized.slice(basePrefix.length);
            return stripped ? normalizePath(stripped) : '/';
        }
        return normalizePath(pathname);
    }
    function applyBase(fullPath) {
        if (!basePrefix)
            return fullPath;
        const url = new URL(fullPath, window.location.origin);
        const pathname = url.pathname === '/' ? basePrefix : normalizePath(`${basePrefix}${url.pathname}`);
        return `${pathname}${url.search}${url.hash}`;
    }
    function parseLocation(to) {
        const url = new URL(to, window.location.href);
        const pathname = stripBase(url.pathname);
        const query = new URLSearchParams(url.search);
        const hash = url.hash ? url.hash.slice(1) : '';
        const fullPath = `${pathname}${url.search}${hash ? `#${hash}` : ''}`;
        return { pathname, query, hash, fullPath };
    }
    function joinRoutePaths(parent, child) {
        if (!child || child === '.')
            return normalizePath(parent || '/');
        if (child.startsWith('/'))
            return normalizePath(child);
        const base = normalizePath(parent || '/');
        const trimmedBase = base === '/' ? '' : base;
        return normalizePath(`${trimmedBase}/${child}`);
    }
    function getScrollKey(state) {
        const search = state.queryString;
        return search ? `${state.path}?${search}` : state.path;
    }
    function isAbortError(error) {
        return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
    }
    function createImmutableRouteState(input) {
        const queryString = input.queryString;
        return {
            path: input.path,
            fullPath: input.fullPath,
            params: { ...input.params },
            queryString,
            get query() {
                return new URLSearchParams(queryString);
            },
            hash: input.hash
        };
    }
    function createRouteState(match, location) {
        return createImmutableRouteState({
            path: location.pathname,
            fullPath: location.fullPath,
            params: match.params,
            queryString: location.query.toString(),
            hash: location.hash
        });
    }
    function createRouteCtx(state, scope, signal) {
        return {
            path: state.path,
            fullPath: state.fullPath,
            params: state.params,
            query: new URLSearchParams(state.queryString),
            hash: state.hash,
            signal,
            scope,
            navigate
        };
    }
    function resolveTo(to) {
        return parseLocation(to).fullPath;
    }
    function resolvePreloadRouteId(match) {
        const existing = preloadRouteIds.get(match.route);
        if (existing)
            return existing;
        const generated = `r${++nextPreloadRouteId}`;
        preloadRouteIds.set(match.route, generated);
        return generated;
    }
    function resolvePreloadKey(match, location) {
        const routeId = resolvePreloadRouteId(match);
        const search = location.query.toString();
        const urlKey = search ? `${location.pathname}?${search}` : location.pathname;
        return `${routeId}::${match.path}::${urlKey}`;
    }
    function normalizeTags(source) {
        if (!source || source.length === 0)
            return [];
        const tags = new Set();
        for (const tag of source) {
            const normalized = String(tag).trim();
            if (normalized)
                tags.add(normalized);
        }
        return [...tags];
    }
    function resolveStaticPrefetchPath(pattern) {
        const segments = normalizePath(pattern).split('/').filter(Boolean);
        const staticSegments = [];
        for (const segment of segments) {
            if (segment === '*')
                return null;
            if (!segment.startsWith(':')) {
                staticSegments.push(segment);
                continue;
            }
            const isOptionalCatchAll = segment.endsWith('*?');
            const isCatchAll = isOptionalCatchAll || segment.endsWith('*');
            if (isOptionalCatchAll)
                continue;
            if (isCatchAll)
                return null;
            return null;
        }
        return staticSegments.length > 0 ? `/${staticSegments.join('/')}` : '/';
    }
    function createRouteQueryValues(query) {
        const values = {};
        const seenKeys = new Set();
        for (const [key] of query.entries()) {
            if (seenKeys.has(key))
                continue;
            seenKeys.add(key);
            const all = query.getAll(key);
            if (all.length === 1) {
                values[key] = all[0];
            }
            else if (all.length > 1) {
                values[key] = all;
            }
        }
        return values;
    }
    function createRouteParamsValues(params) {
        return { ...params };
    }
    async function resolveRouteValidation(match) {
        if (resolvedValidationByRoute.has(match.route)) {
            return resolvedValidationByRoute.get(match.route) ?? null;
        }
        const source = match.route.validation;
        if (!source) {
            resolvedValidationByRoute.set(match.route, null);
            return null;
        }
        const resolved = typeof source === 'function'
            ? await source()
            : source;
        if (!resolved || typeof resolved !== 'object') {
            resolvedValidationByRoute.set(match.route, null);
            return null;
        }
        resolvedValidationByRoute.set(match.route, resolved);
        return resolved;
    }
    function resolveQueryValidators(route, querySchema) {
        if (queryValidatorsByRoute.has(route)) {
            return queryValidatorsByRoute.get(route) ?? null;
        }
        const validatorsByKey = new Map();
        for (const [key, rulesInput] of Object.entries(querySchema)) {
            if (!Array.isArray(rulesInput))
                continue;
            const validators = normalizeRules(rulesInput, `query.${key}`);
            if (validators.length > 0) {
                validatorsByKey.set(key, validators);
            }
        }
        const result = validatorsByKey.size > 0 ? validatorsByKey : null;
        queryValidatorsByRoute.set(route, result);
        return result;
    }
    function resolveParamsValidators(route, paramsSchema) {
        if (paramsValidatorsByRoute.has(route)) {
            return paramsValidatorsByRoute.get(route) ?? null;
        }
        const validatorsByKey = new Map();
        for (const [key, rulesInput] of Object.entries(paramsSchema)) {
            if (!Array.isArray(rulesInput))
                continue;
            const validators = normalizeRules(rulesInput, `params.${key}`);
            if (validators.length > 0) {
                validatorsByKey.set(key, validators);
            }
        }
        const result = validatorsByKey.size > 0 ? validatorsByKey : null;
        paramsValidatorsByRoute.set(route, result);
        return result;
    }
    async function resolveRouteQueryValidationError(match, queryValues) {
        const validation = await resolveRouteValidation(match);
        const querySchema = validation?.query;
        if (!querySchema)
            return null;
        const validatorsByKey = resolveQueryValidators(match.route, querySchema);
        if (!validatorsByKey)
            return null;
        for (const [key, validators] of validatorsByKey.entries()) {
            const value = queryValues[key];
            const message = validateValue(value, queryValues, validators, `query.${key}`);
            if (message) {
                return new Error(`Invalid query param "${key}": ${message}`);
            }
        }
        return null;
    }
    async function resolveRouteParamsValidationError(match, paramsValues) {
        const validation = await resolveRouteValidation(match);
        const paramsSchema = validation?.params;
        if (!paramsSchema)
            return null;
        const validatorsByKey = resolveParamsValidators(match.route, paramsSchema);
        if (!validatorsByKey)
            return null;
        for (const [key, validators] of validatorsByKey.entries()) {
            const value = paramsValues[key];
            const message = validateValue(value, paramsValues, validators, `params.${key}`);
            if (message) {
                return new Error(`Invalid route param "${key}": ${message}`);
            }
        }
        return null;
    }
    async function resolveRouteValidationError(match, queryValues, paramsValues) {
        const queryError = await resolveRouteQueryValidationError(match, queryValues);
        if (queryError)
            return queryError;
        return resolveRouteParamsValidationError(match, paramsValues);
    }
    async function resolveRouteData(match, ctx, location) {
        const preloadKey = resolvePreloadKey(match, location);
        const cached = preloadCache.get(preloadKey);
        if (cached) {
            try {
                const data = await cached.promise;
                if (data !== undefined || !match.route.loader) {
                    return data;
                }
            }
            catch {
                // Fall back to loader on preload errors.
            }
        }
        if (match.route.loader) {
            return withScopeAsync(ctx.scope, () => match.route.loader(ctx));
        }
        if (match.route.preload) {
            return withScopeAsync(ctx.scope, () => match.route.preload(ctx));
        }
        return undefined;
    }
    async function resolveRedirect(match, ctx) {
        if (!match.route.redirect)
            return null;
        if (typeof match.route.redirect === 'string') {
            return match.route.redirect;
        }
        return await match.route.redirect(ctx) ?? null;
    }
    async function resolveGuard(match, ctx) {
        if (!match.route.guard)
            return true;
        const result = await match.route.guard(ctx);
        if (typeof result === 'string')
            return result;
        if (result === false)
            return false;
        return true;
    }
    async function resolveMiddlewareSource(source, ctx) {
        if (!source)
            return true;
        const middlewares = Array.isArray(source)
            ? source
            : await source(ctx);
        if (!middlewares || middlewares.length === 0)
            return true;
        for (const middleware of middlewares) {
            const result = await middleware(ctx);
            if (typeof result === 'string')
                return result;
            if (result === false)
                return false;
        }
        return true;
    }
    async function resolveGlobalMiddleware(ctx) {
        return resolveMiddlewareSource(globalMiddleware, ctx);
    }
    async function resolveMiddleware(match, ctx) {
        return resolveMiddlewareSource(match.route.middleware, ctx);
    }
    function resolveManifestEntry(match) {
        return routeManifestByPattern.get(normalizePath(match.path));
    }
    function resolveMatchScore(match) {
        const manifest = resolveManifestEntry(match);
        if (typeof manifest?.score === 'number') {
            return manifest.score;
        }
        return typeof match.route.score === 'number' ? match.route.score : undefined;
    }
    function resolveMatchTags(match) {
        const manifest = resolveManifestEntry(match);
        const source = manifest?.tags ?? match.route.tags ?? [];
        return normalizeTags(source);
    }
    function resolveTagContext(match) {
        const manifest = resolveManifestEntry(match);
        const tags = manifest?.tags ?? match.route.tags ?? [];
        if (!tags || tags.length === 0)
            return null;
        const primaryTag = manifest?.primaryTag ?? tags[0];
        if (!primaryTag)
            return null;
        return {
            tag: primaryTag,
            tags,
            match,
            manifest
        };
    }
    async function resolveTagGuard(match, ctx) {
        const tagCtx = resolveTagContext(match);
        if (!tagCtx)
            return true;
        const guard = tagGuardPolicies[tagCtx.tag];
        if (!guard)
            return true;
        const result = await guard(ctx, tagCtx);
        if (typeof result === 'string')
            return result;
        if (result === false)
            return false;
        return true;
    }
    function resolveTagLayout(match) {
        const tagCtx = resolveTagContext(match);
        if (!tagCtx)
            return null;
        const layout = tagLayoutPolicies[tagCtx.tag];
        if (!layout)
            return null;
        return (ctx, child, data) => layout(ctx, child, data, tagCtx);
    }
    function createPreloadMetadata(match, location) {
        const manifest = resolveManifestEntry(match);
        return {
            path: location.pathname,
            fullPath: location.fullPath,
            routePath: match.path,
            routeId: manifest?.id,
            params: { ...match.params },
            queryString: location.query.toString(),
            tags: resolveMatchTags(match),
            score: resolveMatchScore(match)
        };
    }
    function toRouterPreloadCacheEntry(key, entry, metadata) {
        return {
            key,
            path: metadata.path,
            fullPath: metadata.fullPath,
            routePath: metadata.routePath,
            routeId: metadata.routeId,
            params: { ...metadata.params },
            queryString: metadata.queryString,
            query: new URLSearchParams(metadata.queryString),
            tags: [...metadata.tags],
            score: metadata.score,
            status: entry.status
        };
    }
    function collectPrefetchCandidatesFromRoutes(routeDefs, parentPath = '') {
        const out = [];
        for (const route of routeDefs) {
            const fullPath = joinRoutePaths(parentPath, route.path);
            if (route.view || route.redirect) {
                out.push({
                    pattern: fullPath,
                    tags: normalizeTags(route.tags),
                    score: route.score
                });
            }
            if (route.children && route.children.length > 0) {
                out.push(...collectPrefetchCandidatesFromRoutes(route.children, fullPath));
            }
        }
        return out;
    }
    function collectPrefetchCandidates() {
        if (routeManifestEntries.length > 0) {
            return routeManifestEntries.map((entry) => ({
                pattern: normalizePath(entry.pattern),
                tags: normalizeTags(entry.tags),
                score: entry.score,
                load: entry.load
            }));
        }
        return collectPrefetchCandidatesFromRoutes(routes);
    }
    async function prefetchCandidates(candidates) {
        if (candidates.length === 0)
            return;
        const seenStaticPaths = new Set();
        const seenDynamicPatterns = new Set();
        const tasks = [];
        for (const candidate of candidates) {
            const staticPath = resolveStaticPrefetchPath(candidate.pattern);
            if (staticPath) {
                if (seenStaticPaths.has(staticPath))
                    continue;
                seenStaticPaths.add(staticPath);
                tasks.push(preloadPath(staticPath).catch((error) => {
                    console.warn('[Dalila] Route prefetch failed:', error);
                }));
                continue;
            }
            if (!candidate.load)
                continue;
            if (seenDynamicPatterns.has(candidate.pattern))
                continue;
            seenDynamicPatterns.add(candidate.pattern);
            tasks.push(candidate.load().catch((error) => {
                console.warn('[Dalila] Route module prefetch failed:', error);
            }));
        }
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }
    function findDeepestBoundaryIndex(matchStack, type) {
        for (let i = matchStack.length - 1; i >= 0; i -= 1) {
            if (matchStack[i].route[type])
                return i;
        }
        return -1;
    }
    function toRedirectNavigationOptions(options) {
        return {
            ...options,
            history: 'replace',
            replace: true
        };
    }
    /**
     * Core navigation pipeline.
     *
     * Runs guards, middleware, validation, data loading, and view mounting
     * in sequence. Supports redirect chains (up to 10), cancellation via
     * navigation tokens, and error/notFound/pending boundary rendering.
     */
    async function runTransition(to, options = {}, redirectCount = 0) {
        if (redirectCount > 10) {
            console.error('[Dalila] Too many redirects detected');
            statusSignal.set({ state: 'idle' });
            return;
        }
        const token = (navigationToken += 1);
        const location = parseLocation(to);
        const stackResult = findCompiledRouteStackResult(location.pathname, compiledRoutes);
        const matchStack = stackResult?.stack ?? [];
        const isExactMatch = Boolean(stackResult?.exact);
        const fromState = currentRouteState;
        const leafMatch = matchStack[matchStack.length - 1];
        const toState = leafMatch
            ? createRouteState(leafMatch, location)
            : createImmutableRouteState({
                path: location.pathname,
                fullPath: location.fullPath,
                params: {},
                queryString: location.query.toString(),
                hash: location.hash
            });
        statusSignal.set({ state: 'loading', to: toState });
        if (hooks.beforeNavigate) {
            try {
                const shouldContinue = await hooks.beforeNavigate(toState, fromState);
                if (!shouldContinue) {
                    statusSignal.set({ state: 'idle' });
                    return;
                }
            }
            catch (error) {
                console.error('[Dalila] beforeNavigate hook failed:', error);
                const scope = createScope();
                const ctx = createRouteCtx(toState, scope, new AbortController().signal);
                if (hooks.onError) {
                    hooks.onError(error, ctx);
                }
                scope.dispose();
                statusSignal.set({ state: 'idle' });
                return;
            }
        }
        const guardScope = createScope();
        const guardController = new AbortController();
        try {
            const globalMiddlewareCtx = createRouteCtx(toState, guardScope, guardController.signal);
            const globalMiddlewareResult = await resolveGlobalMiddleware(globalMiddlewareCtx);
            if (typeof globalMiddlewareResult === 'string') {
                guardController.abort();
                return transition(globalMiddlewareResult, toRedirectNavigationOptions(options), redirectCount + 1);
            }
            if (!globalMiddlewareResult) {
                guardController.abort();
                statusSignal.set({ state: 'idle' });
                return;
            }
            if (token !== navigationToken) {
                guardController.abort();
                return;
            }
            if (isExactMatch && leafMatch) {
                const manifestEntry = resolveManifestEntry(leafMatch);
                if (manifestEntry) {
                    try {
                        await manifestEntry.load();
                    }
                    catch (error) {
                        if (token !== navigationToken) {
                            return;
                        }
                        console.error('[Dalila] Route manifest load failed:', error);
                        statusSignal.set({ state: 'error', to: toState, error });
                        if (currentLoaderController) {
                            currentLoaderController.abort();
                            currentLoaderController = null;
                        }
                        if (currentScope) {
                            currentScope.dispose();
                            currentScope = null;
                        }
                        const errorScope = createScope();
                        currentScope = errorScope;
                        currentLoaderController = new AbortController();
                        const errorSignal = currentLoaderController.signal;
                        const defaultErrorCtx = createRouteCtx(toState, errorScope, errorSignal);
                        const errorIndex = findDeepestBoundaryIndex(matchStack, 'error');
                        const errorFn = errorIndex !== -1 ? matchStack[errorIndex].route.error : errorView;
                        if (errorFn) {
                            try {
                                const errorCtx = errorIndex !== -1
                                    ? createRouteCtx(createRouteState(matchStack[errorIndex], location), errorScope, errorSignal)
                                    : defaultErrorCtx;
                                const result = withScope(errorScope, () => errorFn(errorCtx, error));
                                const wrapped = wrapWithLayouts(matchStack, errorCtx, result, [], errorIndex !== -1 ? errorIndex : matchStack.length - 1, true);
                                const nodes = Array.isArray(wrapped) ? wrapped : [wrapped];
                                outletElement.replaceChildren(...nodes);
                            }
                            catch (renderError) {
                                console.error('[Dalila] Error view failed:', renderError);
                            }
                        }
                        if (hooks.onError) {
                            hooks.onError(error, defaultErrorCtx);
                        }
                        return;
                    }
                }
            }
            for (const match of matchStack) {
                if (token !== navigationToken) {
                    guardController.abort();
                    return;
                }
                const matchState = createRouteState(match, location);
                const matchCtx = createRouteCtx(matchState, guardScope, guardController.signal);
                const middlewareResult = await resolveMiddleware(match, matchCtx);
                if (typeof middlewareResult === 'string') {
                    guardController.abort();
                    return transition(middlewareResult, toRedirectNavigationOptions(options), redirectCount + 1);
                }
                if (!middlewareResult) {
                    guardController.abort();
                    statusSignal.set({ state: 'idle' });
                    return;
                }
                const guardResult = await resolveGuard(match, matchCtx);
                if (typeof guardResult === 'string') {
                    guardController.abort();
                    return transition(guardResult, toRedirectNavigationOptions(options), redirectCount + 1);
                }
                if (!guardResult) {
                    guardController.abort();
                    statusSignal.set({ state: 'idle' });
                    return;
                }
                const tagGuardResult = await resolveTagGuard(match, matchCtx);
                if (typeof tagGuardResult === 'string') {
                    guardController.abort();
                    return transition(tagGuardResult, toRedirectNavigationOptions(options), redirectCount + 1);
                }
                if (!tagGuardResult) {
                    guardController.abort();
                    statusSignal.set({ state: 'idle' });
                    return;
                }
            }
            if (token !== navigationToken) {
                guardController.abort();
                return;
            }
        }
        catch (error) {
            console.error('[Dalila] Route guard failed:', error);
            const ctx = createRouteCtx(toState, guardScope, guardController.signal);
            if (hooks.onError) {
                hooks.onError(error, ctx);
            }
            statusSignal.set({ state: 'idle' });
            return;
        }
        finally {
            guardController.abort();
            guardScope.dispose();
        }
        if (fromState) {
            scrollPositions.set(getScrollKey(fromState), window.scrollY);
        }
        if (currentLoaderController) {
            currentLoaderController.abort();
            currentLoaderController = null;
        }
        if (currentScope) {
            currentScope.dispose();
            currentScope = null;
        }
        const scope = createScope();
        currentScope = scope;
        currentLoaderController = new AbortController();
        const signal = currentLoaderController.signal;
        const ctx = createRouteCtx(toState, scope, signal);
        const commitRouteState = () => {
            routeSignal.set(toState);
            currentRouteState = toState;
            if (options.history !== 'none') {
                if (options.replace) {
                    history.replaceState(null, '', applyBase(toState.fullPath));
                }
                else {
                    history.pushState(null, '', applyBase(toState.fullPath));
                }
            }
        };
        const finishSuccessfulTransition = async () => {
            restoreScroll(toState);
            statusSignal.set({ state: 'idle' });
            if (hooks.afterNavigate) {
                await hooks.afterNavigate(toState, fromState);
            }
        };
        if (matchStack.length === 0) {
            console.warn(`[Dalila] No route found for path: ${location.pathname}`);
            commitRouteState();
            try {
                if (notFoundView) {
                    const result = withScope(scope, () => notFoundView(ctx));
                    const nodes = Array.isArray(result) ? result : [result];
                    outletElement.replaceChildren(...nodes);
                }
                else {
                    outletElement.replaceChildren();
                }
            }
            catch (error) {
                console.error('[Dalila] notFoundView failed:', error);
            }
            try {
                await finishSuccessfulTransition();
            }
            catch (error) {
                console.error('[Dalila] afterNavigate failed:', error);
                if (hooks.onError) {
                    hooks.onError(error, ctx);
                }
            }
            return;
        }
        if (!isExactMatch) {
            commitRouteState();
            const notFoundIndex = findDeepestBoundaryIndex(matchStack, 'notFound');
            try {
                if (notFoundIndex !== -1) {
                    const boundaryMatch = matchStack[notFoundIndex];
                    const boundaryState = createRouteState(boundaryMatch, location);
                    const boundaryCtx = createRouteCtx(boundaryState, scope, signal);
                    const result = withScope(scope, () => boundaryMatch.route.notFound(boundaryCtx));
                    const wrapped = wrapWithLayouts(matchStack, boundaryCtx, result, [], notFoundIndex, true);
                    const nodes = Array.isArray(wrapped) ? wrapped : [wrapped];
                    outletElement.replaceChildren(...nodes);
                }
                else if (notFoundView) {
                    const result = withScope(scope, () => notFoundView(ctx));
                    const wrapped = wrapWithLayouts(matchStack, ctx, result, [], matchStack.length - 1, true);
                    const nodes = Array.isArray(wrapped) ? wrapped : [wrapped];
                    outletElement.replaceChildren(...nodes);
                }
                else {
                    outletElement.replaceChildren();
                }
            }
            catch (error) {
                console.error('[Dalila] Segment notFound render failed:', error);
                if (hooks.onError) {
                    hooks.onError(error, ctx);
                }
            }
            try {
                await finishSuccessfulTransition();
            }
            catch (error) {
                console.error('[Dalila] afterNavigate failed:', error);
                if (hooks.onError) {
                    hooks.onError(error, ctx);
                }
            }
            return;
        }
        const exactLeafMatch = matchStack[matchStack.length - 1];
        // Check for redirects across the full stack (parent -> leaf order)
        for (const stackMatch of matchStack) {
            const redirectTo = await resolveRedirect(stackMatch, ctx);
            if (redirectTo) {
                scope.dispose();
                currentScope = null;
                currentLoaderController = null;
                return transition(redirectTo, toRedirectNavigationOptions(options), redirectCount + 1);
            }
        }
        // Show deepest pending boundary if available
        const pendingIndex = findDeepestBoundaryIndex(matchStack, 'pending');
        if (pendingIndex !== -1 || pendingView) {
            try {
                if (pendingIndex !== -1) {
                    const pendingMatch = matchStack[pendingIndex];
                    const pendingState = createRouteState(pendingMatch, location);
                    const pendingCtx = createRouteCtx(pendingState, scope, signal);
                    const result = withScope(scope, () => pendingMatch.route.pending(pendingCtx));
                    const wrapped = wrapWithLayouts(matchStack, pendingCtx, result, [], pendingIndex, true);
                    const nodes = Array.isArray(wrapped) ? wrapped : [wrapped];
                    outletElement.replaceChildren(...nodes);
                }
                else if (pendingView) {
                    const result = withScope(scope, () => pendingView(ctx));
                    const nodes = Array.isArray(result) ? result : [result];
                    outletElement.replaceChildren(...nodes);
                }
            }
            catch (error) {
                console.error('[Dalila] Pending view failed:', error);
            }
        }
        // Validate all matches first, then load data in parallel
        let dataStack;
        try {
            const queryValues = createRouteQueryValues(location.query);
            // Phase 1: Validate (sequential -- fail fast on first error)
            for (const match of matchStack) {
                const paramsValues = createRouteParamsValues(match.params);
                const validationError = await resolveRouteValidationError(match, queryValues, paramsValues);
                if (validationError) {
                    throw validationError;
                }
            }
            // Phase 2: Load data (parallel -- all loaders run concurrently)
            dataStack = await Promise.all(matchStack.map(match => {
                const matchState = createRouteState(match, location);
                const matchCtx = createRouteCtx(matchState, scope, signal);
                return resolveRouteData(match, matchCtx, location);
            }));
        }
        catch (error) {
            if (!isAbortError(error)) {
                console.error('[Dalila] Loader failed:', error);
                statusSignal.set({ state: 'error', to: toState, error });
                const errorIndex = findDeepestBoundaryIndex(matchStack, 'error');
                const errorFn = errorIndex !== -1 ? matchStack[errorIndex].route.error : errorView;
                if (errorFn) {
                    try {
                        const errorCtx = errorIndex !== -1
                            ? createRouteCtx(createRouteState(matchStack[errorIndex], location), scope, signal)
                            : ctx;
                        const result = withScope(scope, () => errorFn(errorCtx, error));
                        const wrapped = wrapWithLayouts(matchStack, errorCtx, result, [], errorIndex !== -1 ? errorIndex : matchStack.length - 1, true);
                        const nodes = Array.isArray(wrapped) ? wrapped : [wrapped];
                        outletElement.replaceChildren(...nodes);
                    }
                    catch (err) {
                        console.error('[Dalila] Error view failed:', err);
                    }
                }
                if (hooks.onError) {
                    hooks.onError(error, ctx);
                }
            }
            return;
        }
        if (token !== navigationToken || currentLoaderController.signal.aborted) {
            return;
        }
        commitRouteState();
        try {
            mountViewStack(matchStack, ctx, dataStack);
            await finishSuccessfulTransition();
        }
        catch (error) {
            console.error('[Dalila] Navigation failed:', error);
            statusSignal.set({ state: 'error', to: toState, error });
            if (hooks.onError) {
                hooks.onError(error, ctx);
            }
        }
    }
    /**
     * Entry point for all navigations.
     *
     * Coalesces simultaneous calls to the same URL + history mode into a
     * single transition. Redirects bypass coalescing (they use `runTransition` directly).
     */
    function transition(to, options = {}, redirectCount = 0) {
        const shouldCoalesce = redirectCount === 0 && options.history !== 'none';
        if (!shouldCoalesce) {
            return runTransition(to, options, redirectCount);
        }
        const coalesceKey = `${to}::${options.history ?? 'push'}`;
        const existing = transitionCoalescing.get(coalesceKey);
        if (existing) {
            return existing;
        }
        const promise = runTransition(to, options, redirectCount).finally(() => {
            if (transitionCoalescing.get(coalesceKey) === promise) {
                transitionCoalescing.delete(coalesceKey);
            }
        });
        transitionCoalescing.set(coalesceKey, promise);
        return promise;
    }
    /** Compose and mount the view stack (leaf view wrapped by parent layouts). */
    function mountViewStack(matchStack, ctx, dataStack) {
        try {
            let content = null;
            for (let i = matchStack.length - 1; i >= 0; i--) {
                const match = matchStack[i];
                const data = dataStack[i];
                const route = match.route;
                if (i === matchStack.length - 1) {
                    if (!route.view) {
                        console.warn(`[Dalila] Leaf route ${match.path} has no view function`);
                        return;
                    }
                    content = withScope(ctx.scope, () => route.view(ctx, data));
                    if (!route.layout && content) {
                        const tagLayout = resolveTagLayout(match);
                        if (tagLayout) {
                            const childNodes = Array.isArray(content) ? content : [content];
                            content = withScope(ctx.scope, () => tagLayout(ctx, childNodes, data));
                        }
                    }
                }
                else {
                    if (content) {
                        const childNodes = Array.isArray(content) ? content : [content];
                        if (route.layout) {
                            content = withScope(ctx.scope, () => route.layout(ctx, childNodes, data));
                        }
                        else {
                            const tagLayout = resolveTagLayout(match);
                            if (tagLayout) {
                                content = withScope(ctx.scope, () => tagLayout(ctx, childNodes, data));
                            }
                        }
                    }
                }
            }
            if (content) {
                const nodes = Array.isArray(content) ? content : [content];
                outletElement.replaceChildren(...nodes);
            }
        }
        catch (error) {
            console.error('[Dalila] Error mounting view stack:', error);
            if (hooks.onError) {
                hooks.onError(error, ctx);
            }
            throw error;
        }
    }
    /** Wrap content with layout functions from the match stack (used by error/notFound boundaries). */
    function wrapWithLayouts(matchStack, ctx, content, dataStack = [], leafIndex = matchStack.length - 1, includeLeafLayout = false) {
        let wrapped = content;
        for (let i = leafIndex; i >= 0; i -= 1) {
            if (i === leafIndex && !includeLeafLayout)
                continue;
            const match = matchStack[i];
            const route = match.route;
            const childNodes = Array.isArray(wrapped) ? wrapped : [wrapped];
            const data = dataStack[i];
            if (route.layout) {
                wrapped = withScope(ctx.scope, () => route.layout(ctx, childNodes, data));
            }
            else {
                const tagLayout = resolveTagLayout(match);
                if (tagLayout) {
                    wrapped = withScope(ctx.scope, () => tagLayout(ctx, childNodes, data));
                }
            }
        }
        return wrapped;
    }
    function restoreScroll(state) {
        if (scrollBehavior === 'none')
            return;
        const scrollOptions = {
            top: 0,
            behavior: scrollBehavior === 'smooth' ? 'smooth' : 'auto'
        };
        if (state.hash) {
            const element = document.getElementById(state.hash);
            if (element) {
                element.scrollIntoView({ behavior: scrollOptions.behavior });
                return;
            }
        }
        const saved = scrollPositions.get(getScrollKey(state));
        if (saved !== undefined) {
            scrollOptions.top = saved;
        }
        window.scrollTo(scrollOptions);
    }
    /**
     * Resolve the navigation href from a d-link anchor.
     *
     * Handles both explicit values (d-link="/path") and boolean usage
     * (d-link as attribute with href fallback). Merges d-params, d-query,
     * and d-hash into the final URL. External/cross-origin URLs return null.
     */
    function resolveDLinkHref(anchor) {
        const linkValue = anchor.getAttribute(LINK_ATTRIBUTE);
        // When d-link is a boolean attribute (e.g. <a href="/x" d-link>),
        // getAttribute returns "". Fall back to href in that case.
        let resolved = linkValue || anchor.getAttribute('href');
        if (!resolved)
            return null;
        // Skip external URLs and non-http protocols regardless of source
        try {
            const url = new URL(resolved, window.location.href);
            if (url.origin !== window.location.origin)
                return null;
        }
        catch {
            return null;
        }
        let path = resolved;
        // Apply d-params: replace :param segments in path
        const paramsAttr = anchor.getAttribute('d-params');
        if (paramsAttr) {
            try {
                const params = JSON.parse(paramsAttr);
                for (const [key, value] of Object.entries(params)) {
                    // Try optional catch-all, then catch-all, then simple param
                    const optCatchAll = `:${key}*?`;
                    const catchAll = `:${key}*`;
                    const simple = `:${key}`;
                    if (path.includes(optCatchAll)) {
                        const resolved = Array.isArray(value)
                            ? value.map(v => encodeURIComponent(String(v))).join('/')
                            : encodeURIComponent(String(value));
                        path = path.replace(optCatchAll, resolved);
                    }
                    else if (path.includes(catchAll)) {
                        const resolved = Array.isArray(value)
                            ? value.map(v => encodeURIComponent(String(v))).join('/')
                            : encodeURIComponent(String(value));
                        path = path.replace(catchAll, resolved);
                    }
                    else if (path.includes(simple)) {
                        path = path.replace(simple, encodeURIComponent(String(value)));
                    }
                }
            }
            catch {
                console.warn('[Dalila] Invalid d-params JSON:', paramsAttr);
            }
        }
        // Parse existing query/hash from path (href may already contain them)
        let basePath = path;
        let baseSearch = '';
        let baseHash = '';
        const hashIdx = path.indexOf('#');
        if (hashIdx !== -1) {
            baseHash = path.slice(hashIdx);
            basePath = path.slice(0, hashIdx);
        }
        const qIdx = basePath.indexOf('?');
        if (qIdx !== -1) {
            baseSearch = basePath.slice(qIdx + 1);
            basePath = basePath.slice(0, qIdx);
        }
        // Apply d-query (merge with existing query params)
        const queryAttr = anchor.getAttribute('d-query');
        const searchParams = new URLSearchParams(baseSearch);
        if (queryAttr) {
            try {
                const queryObj = JSON.parse(queryAttr);
                for (const [key, value] of Object.entries(queryObj)) {
                    if (Array.isArray(value)) {
                        searchParams.delete(key);
                        for (const v of value)
                            searchParams.append(key, String(v));
                    }
                    else {
                        searchParams.set(key, String(value));
                    }
                }
            }
            catch {
                console.warn('[Dalila] Invalid d-query JSON:', queryAttr);
            }
        }
        const queryString = searchParams.toString();
        // Apply d-hash (override existing hash if provided)
        const hashAttr = anchor.getAttribute('d-hash');
        const hash = hashAttr ? `#${hashAttr}` : baseHash;
        return `${basePath}${queryString ? '?' + queryString : ''}${hash}`;
    }
    /** Filter clicks eligible for client-side interception (left button, no modifiers, same tab). */
    function shouldHandleLink(event, anchor) {
        if (event.defaultPrevented)
            return false;
        if (event.button !== 0)
            return false;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return false;
        if (anchor.target && anchor.target !== '_self')
            return false;
        if (anchor.hasAttribute('download'))
            return false;
        if (!anchor.hasAttribute(LINK_ATTRIBUTE))
            return false;
        return true;
    }
    function handlePopState() {
        transition(window.location.pathname + window.location.search + window.location.hash, { history: 'none' });
    }
    function handleLink(event) {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        const anchor = target.closest('a');
        if (!anchor)
            return;
        if (!shouldHandleLink(event, anchor))
            return;
        const href = resolveDLinkHref(anchor);
        if (!href)
            return;
        event.preventDefault();
        navigate(href);
    }
    function handleLinkIntent(event) {
        const target = event.target;
        if (!(target instanceof Element))
            return;
        const anchor = target.closest('a');
        if (!anchor || !anchor.hasAttribute(LINK_ATTRIBUTE))
            return;
        const prefetchMode = anchor.getAttribute('d-prefetch') ?? 'hover';
        if (prefetchMode === 'off')
            return;
        const isHover = event.type === 'pointerover';
        const isFocus = event.type === 'focusin';
        // d-prefetch="focus" -- only preload on focus, not hover
        if (prefetchMode === 'focus' && isHover)
            return;
        // d-prefetch="hover" (default) -- preload on hover or focus
        if (!isHover && !isFocus)
            return;
        const href = resolveDLinkHref(anchor);
        if (!href)
            return;
        preload(href);
    }
    function navigate(path, options = {}) {
        return transition(resolveTo(path), {
            replace: options.replace,
            history: options.replace ? 'replace' : 'push'
        });
    }
    function push(path) {
        return navigate(path);
    }
    function replace(path) {
        return navigate(path, { replace: true });
    }
    function back() {
        window.history.back();
    }
    function invalidateByTag(tag) {
        const normalizedTag = tag.trim();
        if (!normalizedTag)
            return;
        for (const [key, tags] of [...preloadTagsByKey.entries()]) {
            if (!tags.has(normalizedTag))
                continue;
            preloadCache.delete(key);
        }
    }
    function invalidateWhere(predicate) {
        for (const [key, preloadEntry] of [...preloadCache.entries()]) {
            const metadata = preloadMetadataByKey.get(key);
            if (!metadata)
                continue;
            let shouldInvalidate = false;
            try {
                shouldInvalidate = Boolean(predicate(toRouterPreloadCacheEntry(key, preloadEntry, metadata)));
            }
            catch (error) {
                console.error('[Dalila] invalidateWhere predicate failed:', error);
                return;
            }
            if (shouldInvalidate) {
                preloadCache.delete(key);
            }
        }
    }
    /**
     * Warm the preload cache for a path.
     *
     * Resolves the route stack, validates params, and starts preload/loader
     * functions. Awaits all pending entry promises before returning so that
     * callers like prefetchByTag can trust the data is ready.
     */
    async function preloadPath(path) {
        const location = parseLocation(path);
        const stackResult = findCompiledRouteStackResult(location.pathname, compiledRoutes);
        if (!stackResult || !stackResult.exact)
            return;
        const stack = stackResult.stack;
        const leafMatch = stack[stack.length - 1];
        if (leafMatch) {
            const manifestEntry = resolveManifestEntry(leafMatch);
            if (manifestEntry) {
                try {
                    await manifestEntry.load();
                }
                catch (error) {
                    console.warn('[Dalila] Route prefetch failed:', error);
                }
            }
        }
        const queryValues = createRouteQueryValues(location.query);
        const pending = [];
        for (const match of stack) {
            const preloadFn = match.route.preload ?? match.route.loader;
            if (!preloadFn)
                continue;
            const paramsValues = createRouteParamsValues(match.params);
            const validationError = await resolveRouteValidationError(match, queryValues, paramsValues);
            if (validationError) {
                console.warn(`[Dalila] Skipping preload for "${location.pathname}": ${validationError.message}`);
                return;
            }
            const key = resolvePreloadKey(match, location);
            const existingEntry = preloadCache.get(key);
            if (existingEntry) {
                if (existingEntry.status === 'pending') {
                    pending.push(existingEntry.promise);
                }
                continue;
            }
            const controller = new AbortController();
            const preloadScope = createScope();
            const state = createRouteState(match, location);
            const preloadCtx = createRouteCtx(state, preloadScope, controller.signal);
            const entry = {
                controller,
                scope: preloadScope,
                status: 'pending',
                promise: withScopeAsync(preloadScope, () => preloadFn(preloadCtx))
            };
            preloadCache.set(key, entry);
            const metadata = createPreloadMetadata(match, location);
            preloadMetadataByKey.set(key, metadata);
            if (metadata.tags.length > 0) {
                preloadTagsByKey.set(key, new Set(metadata.tags));
            }
            else {
                preloadTagsByKey.delete(key);
            }
            const settled = entry.promise
                .then((data) => {
                if (!controller.signal.aborted) {
                    entry.status = 'fulfilled';
                    entry.data = data;
                }
                preloadScope.dispose();
            })
                .catch((error) => {
                if (!isAbortError(error)) {
                    entry.status = 'rejected';
                    entry.error = error;
                }
                preloadScope.dispose();
            });
            pending.push(settled);
        }
        if (pending.length > 0) {
            await Promise.allSettled(pending);
        }
    }
    function preload(path) {
        void preloadPath(path).catch((error) => {
            console.warn('[Dalila] Route prefetch failed:', error);
        });
    }
    async function prefetchByTag(tag) {
        const normalizedTag = tag.trim();
        if (!normalizedTag)
            return;
        const candidates = collectPrefetchCandidates().filter((candidate) => candidate.tags.includes(normalizedTag));
        await prefetchCandidates(candidates);
    }
    async function prefetchByScore(minScore) {
        if (!Number.isFinite(minScore))
            return;
        const threshold = Number(minScore);
        const candidates = collectPrefetchCandidates().filter((candidate) => {
            if (typeof candidate.score !== 'number')
                return false;
            return candidate.score >= threshold;
        });
        await prefetchCandidates(candidates);
    }
    function start() {
        if (started)
            return;
        started = true;
        window.addEventListener('popstate', handlePopState);
        document.addEventListener('click', handleLink);
        document.addEventListener('pointerover', handleLinkIntent);
        document.addEventListener('focusin', handleLinkIntent);
        const initialPath = window.location.pathname + window.location.search + window.location.hash;
        transition(initialPath, { history: 'none' });
    }
    function stop() {
        if (!started)
            return;
        started = false;
        window.removeEventListener('popstate', handlePopState);
        document.removeEventListener('click', handleLink);
        document.removeEventListener('pointerover', handleLinkIntent);
        document.removeEventListener('focusin', handleLinkIntent);
        if (currentLoaderController) {
            currentLoaderController.abort();
            currentLoaderController = null;
        }
        if (currentScope) {
            currentScope.dispose();
            currentScope = null;
        }
        preloadCache.clear();
        transitionCoalescing.clear();
        preloadTagsByKey.clear();
        preloadMetadataByKey.clear();
        scrollPositions.clear();
    }
    const router = {
        start,
        stop,
        navigate,
        push,
        replace,
        back,
        preload,
        invalidateByTag,
        invalidateWhere,
        prefetchByTag,
        prefetchByScore,
        link: handleLink,
        route: routeSignal,
        status: statusSignal
    };
    currentRouter = router;
    return router;
}
/** Create a type-safe navigate function bound to a router and a generated `buildPath`. */
export function createTypedNavigate(router, buildPath) {
    return ((pattern, params, options) => {
        return router.navigate(buildPath(pattern, params), options);
    });
}
