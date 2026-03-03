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

import {
  bind,
  type RuntimeSecurityOptions,
  type SanitizeHtmlFn,
  resolveConfiguredRuntimeSecurityOptions,
} from './bind.js';
import type { Scope } from '../core/scope.js';
import { setTemplateInnerHTML } from './html-sinks.js';

export interface FromHtmlOptions<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Bind context — keys map to {placeholder} tokens in the HTML */
  data?: T;
  /** Child nodes to inject into [data-slot="children"] */
  children?: Node | DocumentFragment | Node[];
  /** Route scope — registers bind cleanup automatically */
  scope?: Scope;
  /** Optional sanitizer for local `d-html` binds inside this template. */
  sanitizeHtml?: SanitizeHtmlFn;
  /** Optional runtime security settings for parsing/binding this template. */
  security?: RuntimeSecurityOptions;
}

/**
 * Parse an HTML string into a bound DOM element.
 *
 * Security:
 * - `html` is parsed with `template.innerHTML`, so it must be trusted template markup.
 * - Do not concatenate unsanitized user input into `html`.
 * - For untrusted content, bind it as data (`{token}` / `d-text`) or sanitize first.
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
export function fromHtml<T extends Record<string, unknown>>(html: string, options: FromHtmlOptions<T>): HTMLElement;
export function fromHtml(html: string, options?: FromHtmlOptions): HTMLElement;
export function fromHtml(html: string, options: FromHtmlOptions = {}): HTMLElement {
  const { data, children, scope, sanitizeHtml, security } = options;
  const resolvedSecurity = resolveConfiguredRuntimeSecurityOptions(security);

  const template = document.createElement('template');
  setTemplateInnerHTML(template, html, resolvedSecurity);

  const container = document.createElement('div');
  container.style.display = 'contents';
  container.appendChild(template.content);

  // Bind BEFORE inserting children so the layout's bind() only processes
  // the layout's own HTML — children are already bound by their own fromHtml() call.
  const dispose = bind(container, data ?? {}, { _internal: true, sanitizeHtml, security });
  if (scope) {
    scope.onCleanup(dispose);
  }

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

  return container;
}
