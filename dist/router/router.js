import { signal } from '../core/signal.js';
import { withSchedulerPriority } from '../core/scheduler.js';
import { createScope, withScope, withScopeAsync } from '../core/scope.js';
import { LRUCache } from './lru-cache.js';
import { createLocationUtils } from './location-utils.js';
import { createPreloadMetadataHelpers } from './preload-metadata.js';
import { findDeepestBoundaryIndex, runRouteUnmountLifecycleEffects } from './router-lifecycle.js';
import { scheduleRouteMountLifecycle } from './router-mount-lifecycle.js';
import { createRouterPreloadCacheManager } from './router-preload-cache.js';
import { createRouterPrefetchHelpers } from './router-prefetch.js';
import { mountRenderedContent, renderWrappedBoundary } from './router-render-utils.js';
import { composeViewStack } from './router-view-composer.js';
import { createRouteValidationHelpers } from './router-validation.js';
import { compileRoutes, findCompiledRouteStackResult, normalizePath } from './route-tables.js';
/** Singleton reference to the most recently created router. */
let currentRouter = null;
const LINK_ATTRIBUTE = 'd-link';
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
    let activeLeafRoute = null;
    let activeRouteMountCleanup = null;
    let activeRouteUnmountHook = null;
    let activeLeafData = undefined;
    let activeLeafCtx = null;
    const transitionCoalescing = new Map();
    const scrollPositions = new LRUCache(config.scrollPositionsCacheSize ?? 100);
    const preloadCacheManager = createRouterPreloadCacheManager({
        size: config.preloadCacheSize ?? 50,
        toPublicEntry: toRouterPreloadCacheEntry
    });
    const preloadCache = preloadCacheManager.cache;
    const { applyBase, parseLocation, getLocationQuery, } = createLocationUtils({ basePrefix, normalizePath });
    const { normalizeTags, resolveManifestEntry, resolveMatchScore, resolveMatchTags, resolvePreloadKey, createPreloadMetadata, } = createPreloadMetadataHelpers({ routeManifestByPattern, normalizePath });
    const { resolveRouteValidationError } = createRouteValidationHelpers();
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
            queryString: location.queryString,
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
        if (typeof to === 'string')
            return parseLocation(to).fullPath;
        return buildHref(to);
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
    function toRedirectNavigationOptions(options) {
        return {
            ...options,
            history: 'replace',
            replace: true
        };
    }
    function runRouteUnmountLifecycle() {
        const cleanup = activeRouteMountCleanup;
        const onRouteUnmount = activeRouteUnmountHook;
        const data = activeLeafData;
        const ctx = activeLeafCtx;
        activeRouteMountCleanup = null;
        activeRouteUnmountHook = null;
        activeLeafRoute = null;
        activeLeafData = undefined;
        activeLeafCtx = null;
        runRouteUnmountLifecycleEffects({
            cleanup,
            onRouteUnmount,
            outletElement,
            data,
            ctx
        });
    }
    /**
     * Mount nodes into outlet and remove loading state
     */
    function mountToOutlet(...nodes) {
        runRouteUnmountLifecycle();
        outletElement.replaceChildren(...nodes);
        queueMicrotask(() => {
            outletElement.removeAttribute('d-loading');
            outletElement.setAttribute('d-ready', '');
        });
    }
    async function runAfterNavigateSafely(finishSuccessfulTransition, ctx) {
        try {
            await finishSuccessfulTransition();
        }
        catch (error) {
            console.error('[Dalila] afterNavigate failed:', error);
            if (hooks.onError) {
                hooks.onError(error, ctx);
            }
        }
    }
    function renderErrorBoundary(matchStack, location, scope, signal, fallbackCtx, error) {
        const errorIndex = findDeepestBoundaryIndex(matchStack, 'error');
        const errorFn = errorIndex !== -1 ? matchStack[errorIndex].route.error : errorView;
        if (!errorFn)
            return;
        try {
            const errorCtx = errorIndex !== -1
                ? createRouteCtx(createRouteState(matchStack[errorIndex], location), scope, signal)
                : fallbackCtx;
            const result = withScope(scope, () => errorFn(errorCtx, error));
            renderWrappedBoundary({
                matchStack,
                ctx: errorCtx,
                content: result,
                leafIndex: errorIndex !== -1 ? errorIndex : matchStack.length - 1,
                wrapWithLayouts,
                mountToOutlet
            });
        }
        catch (renderError) {
            console.error('[Dalila] Error view failed:', renderError);
        }
    }
    function renderGlobalNotFound(ctx, scope) {
        try {
            if (notFoundView) {
                const result = withScope(scope, () => notFoundView(ctx));
                mountRenderedContent(mountToOutlet, result);
            }
            else {
                mountToOutlet();
            }
        }
        catch (error) {
            console.error('[Dalila] notFoundView failed:', error);
        }
    }
    function renderSegmentNotFound(matchStack, location, scope, signal, ctx) {
        const notFoundIndex = findDeepestBoundaryIndex(matchStack, 'notFound');
        try {
            if (notFoundIndex !== -1) {
                const boundaryMatch = matchStack[notFoundIndex];
                const boundaryState = createRouteState(boundaryMatch, location);
                const boundaryCtx = createRouteCtx(boundaryState, scope, signal);
                const result = withScope(scope, () => boundaryMatch.route.notFound(boundaryCtx));
                renderWrappedBoundary({
                    matchStack,
                    ctx: boundaryCtx,
                    content: result,
                    leafIndex: notFoundIndex,
                    wrapWithLayouts,
                    mountToOutlet
                });
            }
            else if (notFoundView) {
                const result = withScope(scope, () => notFoundView(ctx));
                renderWrappedBoundary({
                    matchStack,
                    ctx,
                    content: result,
                    leafIndex: matchStack.length - 1,
                    wrapWithLayouts,
                    mountToOutlet
                });
            }
            else {
                mountToOutlet();
            }
        }
        catch (error) {
            console.error('[Dalila] Segment notFound render failed:', error);
            if (hooks.onError) {
                hooks.onError(error, ctx);
            }
        }
    }
    function renderPendingBoundary(matchStack, location, scope, signal, ctx) {
        const pendingIndex = findDeepestBoundaryIndex(matchStack, 'pending');
        if (pendingIndex === -1 && !pendingView)
            return;
        try {
            if (pendingIndex !== -1) {
                const pendingMatch = matchStack[pendingIndex];
                const pendingState = createRouteState(pendingMatch, location);
                const pendingCtx = createRouteCtx(pendingState, scope, signal);
                const result = withScope(scope, () => pendingMatch.route.pending(pendingCtx));
                renderWrappedBoundary({
                    matchStack,
                    ctx: pendingCtx,
                    content: result,
                    leafIndex: pendingIndex,
                    wrapWithLayouts,
                    mountToOutlet
                });
            }
            else if (pendingView) {
                const result = withScope(scope, () => pendingView(ctx));
                mountRenderedContent(mountToOutlet, result);
            }
        }
        catch (error) {
            console.error('[Dalila] Pending view failed:', error);
        }
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
                queryString: location.queryString,
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
                        renderErrorBoundary(matchStack, location, errorScope, errorSignal, defaultErrorCtx, error);
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
            renderGlobalNotFound(ctx, scope);
            await runAfterNavigateSafely(finishSuccessfulTransition, ctx);
            return;
        }
        if (!isExactMatch) {
            commitRouteState();
            renderSegmentNotFound(matchStack, location, scope, signal, ctx);
            await runAfterNavigateSafely(finishSuccessfulTransition, ctx);
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
        renderPendingBoundary(matchStack, location, scope, signal, ctx);
        // Validate all matches first, then load data in parallel
        let dataStack;
        try {
            const queryValues = createRouteQueryValues(getLocationQuery(location));
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
                renderErrorBoundary(matchStack, location, scope, signal, ctx, error);
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
            mountViewStack(matchStack, ctx, dataStack, token);
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
    function mountViewStack(matchStack, ctx, dataStack, navToken) {
        try {
            const { content, leafRoute, leafData } = composeViewStack({
                matchStack,
                ctx,
                dataStack,
                withScopeRender: (fn) => withScope(ctx.scope, fn),
                resolveTagLayout
            });
            if (content) {
                const nodes = Array.isArray(content) ? content : [content];
                mountToOutlet(...nodes);
                activeLeafRoute = leafRoute ?? null;
                activeRouteUnmountHook = leafRoute?.onRouteUnmount ?? null;
                activeLeafData = leafData;
                activeLeafCtx = ctx;
                scheduleRouteMountLifecycle({
                    onRouteMount: leafRoute?.onRouteMount,
                    outletElement,
                    leafData,
                    ctx,
                    isCurrent: () => navigationToken === navToken && activeLeafRoute === leafRoute,
                    setCleanup: (cleanup) => {
                        activeRouteMountCleanup = cleanup;
                    }
                });
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
    function href(target) {
        return applyBase(buildHref(target));
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
        preloadCacheManager.invalidateByTag(tag);
    }
    function invalidateWhere(predicate) {
        preloadCacheManager.invalidateWhere(predicate);
    }
    /**
     * Warm the preload cache for a path.
     *
     * Resolves the route stack, validates params, and starts preload/loader
     * functions. Awaits all pending entry promises before returning so that
     * callers like prefetchByTag can trust the data is ready.
     */
    async function preloadPath(path, priority = 'medium') {
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
        const queryValues = createRouteQueryValues(getLocationQuery(location));
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
            preloadCacheManager.setMetadata(key, metadata);
            const settled = entry.promise
                .then((data) => {
                withSchedulerPriority(priority, () => {
                    if (!controller.signal.aborted) {
                        entry.status = 'fulfilled';
                        entry.data = data;
                    }
                    preloadScope.dispose();
                });
            })
                .catch((error) => {
                withSchedulerPriority(priority, () => {
                    if (!isAbortError(error)) {
                        entry.status = 'rejected';
                        entry.error = error;
                    }
                    preloadScope.dispose();
                });
            });
            pending.push(settled);
        }
        if (pending.length > 0) {
            await Promise.allSettled(pending);
        }
    }
    const { collectPrefetchCandidates, prefetchCandidates } = createRouterPrefetchHelpers({
        routes,
        routeManifestEntries,
        normalizePath,
        normalizeTags,
        joinRoutePaths,
        preloadPath
    });
    function preload(path) {
        void preloadPath(path, 'low').catch((error) => {
            console.warn('[Dalila] Route prefetch failed:', error);
        });
    }
    async function prefetchByTag(tag) {
        const candidates = withSchedulerPriority('low', () => {
            const normalizedTag = tag.trim();
            if (!normalizedTag)
                return null;
            return collectPrefetchCandidates().filter((candidate) => candidate.tags.includes(normalizedTag));
        });
        if (!candidates)
            return;
        await prefetchCandidates(candidates, 'low');
    }
    async function prefetchByScore(minScore) {
        if (!Number.isFinite(minScore))
            return;
        const candidates = withSchedulerPriority('low', () => {
            const threshold = Number(minScore);
            return collectPrefetchCandidates().filter((candidate) => {
                if (typeof candidate.score !== 'number')
                    return false;
                return candidate.score >= threshold;
            });
        });
        await prefetchCandidates(candidates, 'low');
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
        runRouteUnmountLifecycle();
        if (currentLoaderController) {
            currentLoaderController.abort();
            currentLoaderController = null;
        }
        if (currentScope) {
            currentScope.dispose();
            currentScope = null;
        }
        preloadCacheManager.clear();
        transitionCoalescing.clear();
        scrollPositions.clear();
    }
    const router = {
        start,
        stop,
        navigate,
        push,
        replace,
        back,
        href,
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
function encodePathParam(value) {
    return encodeURIComponent(String(value));
}
function encodeCatchAllParam(value) {
    if (Array.isArray(value))
        return value.map(encodePathParam).join('/');
    return encodePathParam(value);
}
export function buildPath(pattern, params = {}) {
    let path = pattern;
    const usedKeys = new Set();
    path = path.replace(/:([A-Za-z0-9_]+)\*\?/g, (_m, key) => {
        usedKeys.add(key);
        const value = params[key];
        if (value == null || value === '')
            return '';
        return encodeCatchAllParam(value);
    });
    path = path.replace(/:([A-Za-z0-9_]+)\*/g, (_m, key) => {
        usedKeys.add(key);
        const value = params[key];
        if (value == null || value === '') {
            throw new Error(`[Dalila] Missing required catch-all route param "${key}" for pattern "${pattern}"`);
        }
        return encodeCatchAllParam(value);
    });
    path = path.replace(/:([A-Za-z0-9_]+)/g, (_m, key) => {
        usedKeys.add(key);
        const value = params[key];
        if (value == null || value === '') {
            throw new Error(`[Dalila] Missing required route param "${key}" for pattern "${pattern}"`);
        }
        return encodePathParam(value);
    });
    path = path.replace(/\/{2,}/g, '/');
    return normalizePath(path);
}
export function buildHref(target) {
    const path = buildPath(target.path, target.params);
    const query = new URLSearchParams();
    if (target.query) {
        for (const [key, raw] of Object.entries(target.query)) {
            if (raw == null)
                continue;
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    if (item == null)
                        continue;
                    query.append(key, String(item));
                }
                continue;
            }
            query.set(key, String(raw));
        }
    }
    const queryString = query.toString();
    const hashValue = target.hash ? (target.hash.startsWith('#') ? target.hash : `#${target.hash}`) : '';
    return `${path}${queryString ? `?${queryString}` : ''}${hashValue}`;
}
