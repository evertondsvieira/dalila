/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
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
export declare function bind<T extends Record<string, unknown> = BindContext>(root: Element, ctx: T, options?: BindOptions): BindHandle;
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
