import { signal } from '../core/signal.js';
import { createScope, withScope } from '../core/scope.js';
import { findRoute } from './route.js';
let currentRouter = null;
export function getCurrentRouter() {
    return currentRouter;
}
export function createRouter(config) {
    const routes = config.routes;
    const routeSignal = signal({
        path: '/',
        params: {},
        query: new URLSearchParams(),
        hash: ''
    });
    let outletElement = null;
    let currentScope = null;
    let currentRouteState = null;
    let scrollPositions = {};
    let currentLoaderController = null;
    async function updateRoute(path, replace = false) {
        const match = findRoute(path, routes);
        if (!match) {
            console.warn(`No route found for path: ${path}`);
            return;
        }
        const fromState = currentRouteState;
        const toState = {
            path: match.route.path,
            params: match.params,
            query: match.query,
            hash: match.hash
        };
        // Save scroll position before leaving current route
        if (fromState && outletElement) {
            scrollPositions[fromState.path] = window.scrollY;
        }
        // Call beforeEnter guard
        if (match.route.beforeEnter) {
            const canEnter = await match.route.beforeEnter(toState, fromState || toState);
            if (!canEnter) {
                console.log('Navigation cancelled by beforeEnter guard');
                return;
            }
        }
        // Abort any ongoing loader
        if (currentLoaderController) {
            currentLoaderController.abort();
        }
        // Dispose of previous scope
        if (currentScope) {
            // Call afterLeave hook
            if (match.route.afterLeave) {
                await match.route.afterLeave(fromState || toState, toState);
            }
            currentScope.dispose();
        }
        // Create new scope for this route
        currentScope = createScope();
        // Load data if route has a loader
        let routeData = undefined;
        if (match.route.loader) {
            currentLoaderController = new AbortController();
            try {
                routeData = await match.route.loader({
                    ...toState,
                    signal: currentLoaderController.signal
                });
            }
            catch (error) {
                if (error.name !== 'AbortError') {
                    console.error('Loader failed:', error);
                }
                return;
            }
        }
        // Update route signal
        routeSignal.set(toState);
        currentRouteState = toState;
        // Update browser history
        const url = path + (match.query.toString() ? `?${match.query}` : '') + (match.hash ? `#${match.hash}` : '');
        if (replace) {
            history.replaceState(null, '', url);
        }
        else {
            history.pushState(null, '', url);
        }
        // Mount the view if outlet exists
        if (outletElement) {
            await mountView(match, routeData);
        }
        // Restore scroll position
        if (toState.hash) {
            const element = document.getElementById(toState.hash.slice(1));
            if (element) {
                element.scrollIntoView();
            }
        }
        else if (scrollPositions[toState.path] !== undefined) {
            window.scrollTo(0, scrollPositions[toState.path]);
        }
        else {
            window.scrollTo(0, 0);
        }
    }
    async function mountView(match, routeData) {
        if (!outletElement || !currentScope)
            return;
        // Clear outlet
        outletElement.innerHTML = '';
        // Mount view within scope
        withScope(currentScope, () => {
            const viewResult = match.route.view();
            const nodes = Array.isArray(viewResult) ? viewResult : [viewResult];
            outletElement.append(...nodes);
        });
    }
    function handlePopState() {
        updateRoute(window.location.pathname + window.location.search + window.location.hash, true);
    }
    function handleLink(event) {
        const target = event.target;
        const anchor = target.closest('a');
        if (!anchor)
            return;
        const href = anchor.getAttribute('href');
        if (!href || href.startsWith('http') || href.startsWith('//') || anchor.target === '_blank') {
            return;
        }
        event.preventDefault();
        push(href);
    }
    function push(path) {
        updateRoute(path, false);
    }
    function replace(path) {
        updateRoute(path, true);
    }
    function back() {
        window.history.back();
    }
    function mount(outlet) {
        outletElement = outlet;
        // Set up history API listener
        window.addEventListener('popstate', handlePopState);
        // Initialize with current location
        const initialPath = window.location.pathname + window.location.search + window.location.hash;
        updateRoute(initialPath, true);
    }
    function outlet() {
        if (!outletElement) {
            outletElement = document.createElement('div');
        }
        return outletElement;
    }
    // Create router instance
    const router = {
        mount,
        push,
        replace,
        back,
        link: handleLink,
        outlet,
        route: routeSignal
    };
    // Set as current router
    currentRouter = router;
    return router;
}
