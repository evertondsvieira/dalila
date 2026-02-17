/**
 * Dalila Lazy Components
 *
 * Provides lazy loading for components with:
 * - createLazyComponent: Create a component that loads on demand
 * - d-lazy directive: Load component when it enters viewport
 * - d-suspense: Show fallback while component is loading
 *
 * @module dalila/runtime/lazy
 */
import { signal } from '../core/index.js';
import { defineComponent, isComponent } from './component.js';
// ============================================================================
// Lazy Component Registry
// ============================================================================
/**
 * Global registry for lazy-loaded components
 */
const lazyComponentRegistry = new Map();
/**
 * Get a lazy component by its tag name
 */
export function getLazyComponent(tag) {
    return lazyComponentRegistry.get(tag);
}
// ============================================================================
// createLazyComponent
// ============================================================================
/**
 * Creates a lazy-loaded component that defers loading until needed.
 *
 * @param loader - Function that returns a promise resolving to the component
 * @param options - Configuration options for the lazy component
 * @returns Component definition with loading state
 *
 * @example
 * ```ts
 * const LazyModal = createLazyComponent(() => import('./Modal.svelte'));
 *
 * // With custom loading template
 * const LazyModal = createLazyComponent(
 *   () => import('./Modal.svelte'),
 *   { loading: '<div>Loading...</div>' }
 * );
 * ```
 */
export function createLazyComponent(loader, options = {}) {
    const { loadingDelay = 0, loading = '', error = '' } = options;
    // Create signals for tracking load state
    const loadingSignal = signal(false);
    const errorSignal = signal(null);
    const componentSignal = signal(null);
    const loadedSignal = signal(false);
    let loadingTimeout = null;
    let loadInFlight = false;
    const load = () => {
        if (loadedSignal() || loadInFlight)
            return;
        loadInFlight = true;
        // Handle loading delay
        if (loadingDelay > 0) {
            loadingTimeout = setTimeout(() => {
                loadingSignal.set(true);
            }, loadingDelay);
        }
        else {
            loadingSignal.set(true);
        }
        errorSignal.set(null);
        Promise.resolve()
            .then(() => loader())
            .then((module) => {
            // Clear timeout if still pending
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
            const loadedComp = isComponent(module)
                ? module
                : ('default' in module ? module.default : null);
            if (!loadedComp) {
                throw new Error('Lazy component: failed to load component from module');
            }
            componentSignal.set(loadedComp);
            loadingSignal.set(false);
            loadedSignal.set(true);
            loadInFlight = false;
        })
            .catch((err) => {
            if (loadingTimeout) {
                clearTimeout(loadingTimeout);
                loadingTimeout = null;
            }
            errorSignal.set(err instanceof Error ? err : new Error(String(err)));
            loadingSignal.set(false);
            loadInFlight = false;
        });
    };
    const retry = () => {
        errorSignal.set(null);
        load();
    };
    // Create the wrapper component
    const tag = `lazy-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const wrapperComponent = defineComponent({
        tag,
        template: '', // Required: empty template for lazy wrapper
        props: {},
        setup: () => {
            // Auto-load when component is mounted
            // The actual loading is triggered by the d-lazy directive or manually
            return {
                $$lazyLoading: loadingSignal,
                $$lazyError: errorSignal,
                $$lazyComponent: componentSignal,
                $$lazyLoad: load,
                $$lazyRetry: retry,
                $$lazyLoaded: loadedSignal,
            };
        }
    });
    // Register in global registry for lookup by d-lazy directive
    const result = {
        component: wrapperComponent,
        state: {
            loading: loadingSignal,
            error: errorSignal,
            component: componentSignal,
            load,
            retry,
            loaded: loadedSignal,
            loadingTemplate: loading,
            errorTemplate: error,
        }
    };
    lazyComponentRegistry.set(tag, result);
    return wrapperComponent;
}
// ============================================================================
// d-suspense Component
// ============================================================================
/**
 * Creates a suspense component that shows loading/ error states
 * while child components are loading.
 *
 * @param options - Configuration for suspense behavior
 * @returns Component that wraps children with suspense behavior
 *
 * @example
 * ```html
 * <d-suspense>
 *   <d-placeholder>Loading...</d-placeholder>
 *   <my-heavy-component></my-heavy-component>
 * </d-suspense>
 * ```
 */
export function createSuspense(options = {}) {
    const suspenseTag = `d-suspense-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    return defineComponent({
        tag: suspenseTag,
        props: {},
        // Keep children rendered; loading/error orchestration can be layered on top.
        template: `<div data-suspense=""><slot></slot></div>`,
        setup: () => {
            // Reserved for future suspense orchestration (loading/error/loadingDelay).
            void options;
            return {};
        }
    });
}
// ============================================================================
// Lazy Loading Utilities
// ============================================================================
/**
 * Preload a lazy component
 */
export function preloadLazyComponent(tag) {
    const lazyResult = lazyComponentRegistry.get(tag);
    if (lazyResult) {
        lazyResult.state.load();
    }
}
/**
 * Check if a lazy component is loaded
 */
export function isLazyComponentLoaded(tag) {
    const lazyResult = lazyComponentRegistry.get(tag);
    return lazyResult?.state.loaded() ?? false;
}
/**
 * Get lazy component loading state
 */
export function getLazyComponentState(tag) {
    return lazyComponentRegistry.get(tag)?.state;
}
// ============================================================================
// Intersection Observer for d-lazy
// ============================================================================
const lazyObserverElements = new WeakMap();
const lazyObservers = new Map();
function getLazyIntersectionObserver(threshold = 0) {
    const currentCtor = globalThis.IntersectionObserver;
    const cached = lazyObservers.get(threshold);
    if (cached && cached.ctor === currentCtor) {
        return cached.observer;
    }
    const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                const data = lazyObserverElements.get(entry.target);
                if (data?.callback) {
                    data.callback();
                }
                // Stop observing after triggering
                observer?.unobserve(entry.target);
            }
        }
    }, {
        root: null, // viewport
        rootMargin: '0px',
        threshold,
    });
    lazyObservers.set(threshold, { observer, ctor: currentCtor });
    return observer;
}
/**
 * Observe an element for lazy loading when it enters viewport
 */
export function observeLazyElement(el, loadCallback, threshold = 0) {
    if (typeof globalThis.IntersectionObserver !== 'function') {
        // Graceful fallback for environments without IntersectionObserver.
        // Load only if still connected after the current bind pass.
        // This avoids eager loading elements removed by directives like d-if.
        let canceled = false;
        queueMicrotask(() => {
            if (canceled)
                return;
            if (el.isConnected) {
                loadCallback();
            }
        });
        return () => {
            canceled = true;
        };
    }
    const observer = getLazyIntersectionObserver(threshold);
    lazyObserverElements.set(el, { callback: loadCallback, threshold });
    observer.observe(el);
    // Return cleanup function
    return () => {
        lazyObserverElements.delete(el);
        observer.unobserve(el);
    };
}
