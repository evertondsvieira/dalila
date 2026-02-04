// Placeholder tokens injected into raw HTML so that dynamic values can be
// located and replaced after the browser parses the markup.
const TOKEN_PREFIX = '__DALILA_SLOT_';
const TOKEN_SUFFIX = '__';
const TOKEN_REGEX = /__DALILA_SLOT_(\d+)__/g;
function isNode(value) {
    return typeof Node !== 'undefined' && value instanceof Node;
}
/** Append a value to a fragment, recursing into arrays and converting primitives to text. */
function appendValue(fragment, value) {
    if (value === null || value === undefined || value === false)
        return;
    if (Array.isArray(value)) {
        for (const item of value) {
            appendValue(fragment, item);
        }
        return;
    }
    if (isNode(value)) {
        fragment.appendChild(value);
        return;
    }
    fragment.appendChild(document.createTextNode(String(value)));
}
/** Coerce a value to a string suitable for an HTML attribute. */
function toAttributeValue(value) {
    if (value === null || value === undefined || value === false)
        return '';
    if (Array.isArray(value)) {
        return value.map(toAttributeValue).join('');
    }
    if (isNode(value)) {
        return value.textContent ?? '';
    }
    return String(value);
}
/** Walk a text node, replacing placeholder tokens with their corresponding values. */
function replaceTextTokens(node, values) {
    const text = node.nodeValue ?? '';
    if (!text.includes(TOKEN_PREFIX))
        return;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match = null;
    while ((match = TOKEN_REGEX.exec(text))) {
        const matchIndex = match.index;
        const tokenLength = match[0].length;
        if (matchIndex > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }
        const valueIndex = Number(match[1]);
        const value = values[valueIndex];
        appendValue(fragment, value);
        lastIndex = matchIndex + tokenLength;
    }
    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    if (fragment.childNodes.length > 0) {
        node.replaceWith(fragment);
    }
    else {
        node.remove();
    }
}
/**
 * Replace placeholder tokens inside element attributes.
 *
 * Single-token attributes set to null/undefined/false are removed entirely
 * (useful for conditional boolean attributes like `disabled`).
 */
function replaceAttributeTokens(element, values) {
    for (const attr of Array.from(element.attributes)) {
        if (!attr.value.includes(TOKEN_PREFIX))
            continue;
        const tokenMatches = Array.from(attr.value.matchAll(TOKEN_REGEX));
        const singleTokenMatch = tokenMatches.length === 1 && attr.value.trim() === tokenMatches[0][0];
        if (singleTokenMatch) {
            const value = values[Number(tokenMatches[0][1])];
            if (value === null || value === undefined || value === false) {
                element.removeAttribute(attr.name);
                continue;
            }
        }
        const nextValue = attr.value.replace(TOKEN_REGEX, (_, index) => {
            const value = values[Number(index)];
            return toAttributeValue(value);
        });
        element.setAttribute(attr.name, nextValue);
    }
}
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
export function html(strings, ...values) {
    let markup = '';
    for (let i = 0; i < strings.length; i += 1) {
        markup += strings[i];
        if (i < values.length) {
            markup += `${TOKEN_PREFIX}${i}${TOKEN_SUFFIX}`;
        }
    }
    const template = document.createElement('template');
    template.innerHTML = markup;
    const fragment = template.content;
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            replaceTextTokens(node, values);
            continue;
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            replaceAttributeTokens(node, values);
        }
    }
    return fragment;
}
