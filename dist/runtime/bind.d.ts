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
export type DisposeFunction = () => void;
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
export declare function bind(root: Element, ctx: BindContext, options?: BindOptions): DisposeFunction;
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
export declare function autoBind(selector: string, ctx: BindContext, options?: BindOptions): Promise<DisposeFunction>;
