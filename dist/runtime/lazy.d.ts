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
import { type SchedulerPriority } from '../core/scheduler.js';
import type { Component } from './component.js';
export interface LazyComponentOptions {
    /** Loading fallback template */
    loading?: string;
    /** Error template to show on failure */
    error?: string;
    /** Delay before showing loading state (ms) */
    loadingDelay?: number;
}
export interface LazyComponentState {
    /** Whether the component is currently loading */
    loading: ReturnType<typeof signal<boolean>>;
    /** Whether the component has failed to load */
    error: ReturnType<typeof signal<Error | null>>;
    /** The loaded component (if successful) */
    component: ReturnType<typeof signal<Component | null>>;
    /** Function to trigger loading */
    load: (priority?: SchedulerPriority) => void;
    /** Function to retry after error */
    retry: () => void;
    /** Whether the component has been loaded */
    loaded: ReturnType<typeof signal<boolean>>;
    /** Default loading template (used by d-lazy when attribute is omitted) */
    loadingTemplate: string;
    /** Default error template (used by d-lazy when attribute is omitted) */
    errorTemplate: string;
}
export type LazyComponentLoader = () => Promise<{
    default: Component;
} | Component>;
export interface LazyComponentResult {
    /** The lazy component definition */
    component: Component;
    /** Access to lazy loading state */
    state: LazyComponentState;
}
/**
 * Get a lazy component by its tag name
 */
export declare function getLazyComponent(tag: string): LazyComponentResult | undefined;
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
export declare function createLazyComponent(loader: LazyComponentLoader, options?: LazyComponentOptions): Component;
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
export declare function createSuspense(options?: {
    /** Template to show while loading */
    loading?: string;
    /** Template to show on error */
    error?: string;
    /** Delay before showing loading state */
    loadingDelay?: number;
}): Component;
/**
 * Preload a lazy component
 */
export declare function preloadLazyComponent(tag: string): void;
/**
 * Check if a lazy component is loaded
 */
export declare function isLazyComponentLoaded(tag: string): boolean;
/**
 * Get lazy component loading state
 */
export declare function getLazyComponentState(tag: string): LazyComponentState | undefined;
/**
 * Observe an element for lazy loading when it enters viewport
 */
export declare function observeLazyElement(el: Element, loadCallback: () => void, threshold?: number): () => void;
