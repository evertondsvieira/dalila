/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
import { type Signal } from '../core/signal.js';
import type { Component } from './component.js';
import { type TrustedTypesHtmlPolicy } from './html-sinks.js';
export interface BindOptions {
    /**
     * Event types to bind (default: click, input, change, submit, keydown, keyup)
     */
    events?: string[];
    /**
     * Selectors for elements where text interpolation should be skipped.
     * `d-pre` / `d-raw` subtrees are always skipped regardless of this option.
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
    /**
     * Optional sanitizer for raw HTML sinks (currently applied to `d-html`).
     * Receives the HTML string and metadata about the sink.
     * When omitted, Dalila applies a built-in baseline sanitizer.
     */
    sanitizeHtml?: SanitizeHtmlFn;
    /**
     * Keep Dalila's framework default HTML sanitizer enabled.
     * Defaults to `true`.
     *
     * Set `false` when you want `sanitizeHtml` to be fully opt-in again for
     * a specific bind/config scope.
     */
    useDefaultSanitizeHtml?: boolean;
    /**
     * Optional security hardening settings (opt-in).
     */
    security?: RuntimeSecurityOptions;
}
export interface BindContext {
    [key: string]: unknown;
}
export interface SanitizeHtmlContext {
    sink: 'd-html';
    bindingName: string;
    element: Element;
}
export type SanitizeHtmlFn = (html: string, context: SanitizeHtmlContext) => string;
export interface RuntimeSecurityOptions {
    /**
     * Enables stricter defaults. Dalila enables this in the framework-level
     * production profile unless you override it via `configure()` / `bind()`.
     * Current effects:
     * - blocks `srcdoc` via `d-attr-*`
     * - requires a custom sanitizer for `d-html`
     */
    strict?: boolean;
    /**
     * Explicitly block HTML-bearing attributes like `srcdoc` in `d-attr-*`.
     * Defaults to `true` when `strict` is enabled.
     */
    blockRawHtmlAttrs?: boolean;
    /**
     * Require a configured sanitizer for `d-html`.
     * When enabled, the built-in baseline sanitizer is NOT used as fallback:
     * callers must provide `sanitizeHtml`, otherwise `d-html` renders empty
     * and emits a security warning (or throws when `warnAsError` is enabled).
     * Defaults to `true` when `strict` is enabled.
     */
    requireHtmlSanitizerForDHtml?: boolean;
    /**
     * Throw instead of warning in dev mode.
     * Useful for CI/test gates that should fail on unsafe patterns.
     */
    warnAsError?: boolean;
    /**
     * Enable Trusted Types for HTML sinks when browser support is available.
     * Opt-in. Explicitly set `trustedTypes: true`, or provide a policy name/policy.
     */
    trustedTypes?: boolean;
    /**
     * Trusted Types policy name used by runtime sinks.
     * Defaults to `"dalila"`.
     */
    trustedTypesPolicyName?: string;
    /**
     * Existing Trusted Types policy to reuse for HTML sinks.
     * Useful on browsers that enforce Trusted Types but do not expose a policy lookup API.
     */
    trustedTypesPolicy?: TrustedTypesHtmlPolicy | null;
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
/**
 * Dev mode warning helper
 */
export declare function warnRuntime(message: string): void;
export declare function warnSecurityRuntime(message: string, beforeThrow?: () => void): void;
declare const DEFAULT_RUNTIME_SANITIZE_HTML_MARKER: unique symbol;
export declare const DEFAULT_RUNTIME_SECURITY: Readonly<RuntimeSecurityOptions>;
export declare const defaultSanitizeHtml: SanitizeHtmlFn & {
    [DEFAULT_RUNTIME_SANITIZE_HTML_MARKER]: true;
};
export declare function getVirtualListController(target: Element | null): VirtualListController | null;
export declare function scrollToVirtualIndex(target: Element | null, index: number, options?: VirtualScrollToIndexOptions): boolean;
export declare function installProductionRuntimeDefaults(): void;
export declare function resolveConfiguredRuntimeSecurityOptions(security?: RuntimeSecurityOptions): RuntimeSecurityOptions | undefined;
export declare function createPortalTarget(id: string): Signal<Element | null>;
/**
 * Set global defaults for all `bind()` / `mount()` calls.
 *
 * Options set here are merged with per-call options (per-call wins).
 * Call with an empty object to reset back to Dalila's production defaults.
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
export {};
