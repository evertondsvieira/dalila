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
import { bind, resolveConfiguredRuntimeSecurityOptions, } from './bind.js';
import { setTemplateInnerHTML } from './html-sinks.js';
export function fromHtml(html, options = {}) {
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
            }
            else {
                slot.replaceChildren(children);
            }
        }
    }
    return container;
}
