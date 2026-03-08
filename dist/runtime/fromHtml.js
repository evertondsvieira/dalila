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
    const singleRoot = resolveSingleRootElement(template.content);
    const container = singleRoot ?? document.createElement('div');
    if (!singleRoot) {
        container.style.display = 'contents';
        container.appendChild(template.content);
    }
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
function resolveSingleRootElement(fragment) {
    let root = null;
    for (const node of Array.from(fragment.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim()) {
            continue;
        }
        if (node.nodeType === Node.ELEMENT_NODE && node instanceof HTMLElement && !root) {
            root = node;
            continue;
        }
        return null;
    }
    return root;
}
