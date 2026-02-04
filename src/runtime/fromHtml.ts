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

import { bind } from './bind.js';
import type { Scope } from '../core/scope.js';

export interface FromHtmlOptions {
  /** Bind context — keys map to {placeholder} tokens in the HTML */
  data?: Record<string, unknown>;
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
export function fromHtml(html: string, options: FromHtmlOptions = {}): HTMLElement {
  const { data, children, scope } = options;

  const template = document.createElement('template');
  template.innerHTML = html;

  const container = document.createElement('div');
  container.style.display = 'contents';
  container.appendChild(template.content);

  if (children) {
    const slot = container.querySelector('[data-slot="children"]');
    if (slot) {
      if (Array.isArray(children)) {
        slot.replaceChildren(...children);
      } else {
        slot.replaceChildren(children);
      }
    }
  }

  const dispose = bind(container, data ?? {});
  if (scope) {
    scope.onCleanup(dispose);
  }

  return container;
}
