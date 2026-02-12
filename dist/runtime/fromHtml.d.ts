/**
 * Dalila fromHtml - HTML string → DOM with bind support
 *
 * Converts an HTML string into a bound DOM element.
 * Supports {placeholder} text interpolation via bind(),
 * layout children via [data-slot="children"], and
 * automatic cleanup when a scope is provided.
 *
 * @module dalila/runtime
 */
import type { Scope } from '../core/scope.js';
export interface FromHtmlOptions<T extends Record<string, unknown> = Record<string, unknown>> {
    /** Bind context — keys map to {placeholder} tokens in the HTML */
    data?: T;
    /** Child nodes to inject into [data-slot="children"] */
    children?: Node | DocumentFragment | Node[];
    /** Route scope — registers bind cleanup automatically */
    scope?: Scope;
}
/**
 * Parse an HTML string into a bound DOM element.
 *
 * @example
 * ```ts
 * // Static HTML
 * const el = fromHtml('<div><h1>Hello</h1></div>');
 *
 * // With data binding
 * const el = fromHtml('<div>{name}</div>', { data: { name: 'Dalila' } });
 *
 * // Layout with children slot
 * const el = fromHtml('<div><div data-slot="children"></div></div>', { children });
 * ```
 */
export declare function fromHtml<T extends Record<string, unknown>>(html: string, options: FromHtmlOptions<T>): HTMLElement;
export declare function fromHtml(html: string, options?: FromHtmlOptions): HTMLElement;
