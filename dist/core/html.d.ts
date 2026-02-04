/**
 * Values accepted by the `html` tagged template.
 *
 * Strings, numbers, and booleans are converted to text nodes.
 * Nodes and DocumentFragments are inserted directly. Arrays are
 * flattened recursively. null/undefined/false are omitted.
 */
type HTMLValue = string | number | boolean | null | undefined | Node | DocumentFragment | HTMLValue[];
/**
 * Tagged template for safe HTML construction.
 *
 * Interpolated values are injected as DOM nodes (not raw HTML),
 * preventing XSS. Returns a DocumentFragment ready for insertion.
 *
 * ```ts
 * const fragment = html`<p>Hello, ${name}!</p>`;
 * container.append(fragment);
 * ```
 */
export declare function html(strings: TemplateStringsArray, ...values: HTMLValue[]): DocumentFragment;
export type { HTMLValue };
