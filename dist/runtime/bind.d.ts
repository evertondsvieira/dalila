/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
import { Signal } from '../core/index.js';
import type { Component } from './component.js';
export interface BindOptions {
    /**
     * Event types to bind (default: click, input, change, submit, keydown, keyup)
     */
    events?: string[];
    /**
     * Selectors for elements where text interpolation should be skipped
     */
    rawTextSelectors?: string;
    /**
     * Optional runtime cache policy for text interpolation template plans.
     * Defaults are tuned for general SPA usage.
     */
    templatePlanCache?: {
        /** Maximum number of cached template plans (0 disables cache). */
        maxEntries?: number;
        /** Time-to-live (ms) per plan, refreshed on hit (0 disables cache). */
        ttlMs?: number;
    };
    /** Component registry — accepts map `{ tag: component }` or array `[component]` */
    components?: Record<string, Component> | Component[];
    /** Error policy for component `ctx.onMount()` callbacks. Default: 'log'. */
    onMountError?: 'log' | 'throw';
    /**
     * Optional runtime transition registry used by `d-transition`.
     */
    transitions?: TransitionConfig[];
    /**
     * Internal flag — set by fromHtml for router/template rendering.
     * Skips HMR context registration but KEEPS d-ready/d-loading lifecycle.
     * @internal
     */
    _internal?: boolean;
    /**
     * Internal flag — set by bindEach for clone bindings.
     * Skips both HMR context registration AND d-ready/d-loading lifecycle.
     * @internal
     */
    _skipLifecycle?: boolean;
}
export interface BindContext {
    [key: string]: unknown;
}
/**
 * Convenience alias: any object whose values are `unknown`.
 * Use the generic parameter on `bind<T>()` / `autoBind<T>()` / `fromHtml<T>()`
 * to preserve the concrete type at call sites while still satisfying internal
 * look-ups that index by string key.
 */
export type BindData<T extends Record<string, unknown> = Record<string, unknown>> = T;
export type DisposeFunction = () => void;
export interface BindHandle {
    (): void;
    getRef(name: string): Element | null;
    getRefs(): Readonly<Record<string, Element>>;
}
export interface TransitionConfig {
    name: string;
    enter?: (el: HTMLElement) => void;
    leave?: (el: HTMLElement) => void;
    duration?: number;
}
export type VirtualListAlign = 'start' | 'center' | 'end';
export interface VirtualScrollToIndexOptions {
    align?: VirtualListAlign;
    behavior?: ScrollBehavior;
}
export interface VirtualListController {
    scrollToIndex: (index: number, options?: VirtualScrollToIndexOptions) => void;
    refresh: () => void;
}
export declare function getVirtualListController(target: Element | null): VirtualListController | null;
export declare function scrollToVirtualIndex(target: Element | null, index: number, options?: VirtualScrollToIndexOptions): boolean;
export declare function createPortalTarget(id: string): Signal<Element | null>;
/**
 * Set global defaults for all `bind()` / `mount()` calls.
 *
 * Options set here are merged with per-call options (per-call wins).
 * Call with an empty object to reset.
 *
 * @example
 * ```ts
 * import { configure } from 'dalila/runtime';
 *
 * configure({
 *   components: [FruitPicker],
 *   onMountError: 'log',
 * });
 * ```
 */
export declare function configure(config: BindOptions): void;
/**
 * Bind a DOM tree to a reactive context.
 *
 * @param root - The root element to bind
 * @param ctx - The context object containing handlers and reactive values
 * @param options - Binding options
 * @returns A dispose function that removes all bindings
 *
 * @example
 * ```ts
 * import { bind } from 'dalila/runtime';
 *
 * const ctx = {
 *   count: signal(0),
 *   increment: () => count.update(n => n + 1),
 * };
 *
 * const dispose = bind(document.getElementById('app')!, ctx);
 *
 * // Later, to cleanup:
 * dispose();
 * ```
 */
export declare function bind<T extends Record<string, unknown> = BindContext>(root: Element | string, ctx: T, options?: BindOptions): BindHandle;
/**
 * Automatically bind when DOM is ready.
 * Useful for simple pages without a build step.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { autoBind } from 'dalila/runtime';
 *   autoBind('#app', { count: signal(0) });
 * </script>
 * ```
 */
export declare function autoBind<T extends Record<string, unknown> = BindContext>(selector: string, ctx: T, options?: BindOptions): Promise<BindHandle>;
/**
 * Mount a component imperatively, or bind a selector to a view-model.
 *
 * Overload 1 — `mount(selector, vm, options?)`:
 *   Shorthand for `bind(selector, vm, options)`.
 *
 * Overload 2 — `mount(component, target, props?)`:
 *   Mount a component created with defineComponent() into a target element.
 */
export declare function mount<T extends object>(selector: string, vm: T, options?: BindOptions): BindHandle;
export declare function mount(component: Component, target: Element, props?: Record<string, unknown>): BindHandle;
