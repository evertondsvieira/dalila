/**
 * Values accepted by the `html` tagged template.
 *
 * Strings, numbers, and booleans are converted to text nodes.
 * Nodes and DocumentFragments are inserted directly. Arrays are
 * flattened recursively. null/undefined/false are omitted.
 */
type HTMLValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Node
  | DocumentFragment
  | HTMLValue[];

// Placeholder tokens injected into raw HTML so that dynamic values can be
// located and replaced after the browser parses the markup.
const TOKEN_SUFFIX = '__';
let tokenNamespaceCounter = 0;

interface HtmlTokenSpec {
  prefix: string;
  regex: RegExp;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createTokenSpec(strings: TemplateStringsArray): HtmlTokenSpec {
  const source = strings.join('');
  let prefix = '';

  do {
    prefix = `__DALILA_SLOT_${(tokenNamespaceCounter++).toString(36)}_`;
  } while (source.includes(prefix));

  return {
    prefix,
    regex: new RegExp(`${escapeRegExp(prefix)}(\\d+)${escapeRegExp(TOKEN_SUFFIX)}`, 'g'),
  };
}

function isNode(value: unknown): value is Node {
  return typeof Node !== 'undefined' && value instanceof Node;
}

/** Append a value to a fragment, recursing into arrays and converting primitives to text. */
function appendValue(fragment: DocumentFragment, value: HTMLValue): void {
  if (value === null || value === undefined || value === false) return;

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
function toAttributeValue(value: HTMLValue): string {
  if (value === null || value === undefined || value === false) return '';

  if (Array.isArray(value)) {
    return value.map(toAttributeValue).join('');
  }

  if (isNode(value)) {
    return value.textContent ?? '';
  }

  return String(value);
}

/** Walk a text node, replacing placeholder tokens with their corresponding values. */
function replaceTextTokens(node: Text, values: HTMLValue[], tokenSpec: HtmlTokenSpec): void {
  const text = node.nodeValue ?? '';
  if (!text.includes(tokenSpec.prefix)) return;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  tokenSpec.regex.lastIndex = 0;

  while ((match = tokenSpec.regex.exec(text))) {
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
  } else {
    node.remove();
  }
}

/**
 * Replace placeholder tokens inside element attributes.
 *
 * Single-token attributes set to null/undefined/false are removed entirely
 * (useful for conditional boolean attributes like `disabled`).
 */
function replaceAttributeTokens(
  element: Element,
  values: HTMLValue[],
  tokenSpec: HtmlTokenSpec
): void {
  for (const attr of Array.from(element.attributes)) {
    if (!attr.value.includes(tokenSpec.prefix)) continue;
    tokenSpec.regex.lastIndex = 0;
    const tokenMatches = Array.from(attr.value.matchAll(tokenSpec.regex));
    const singleTokenMatch = tokenMatches.length === 1 && attr.value.trim() === tokenMatches[0][0];

    if (singleTokenMatch) {
      const value = values[Number(tokenMatches[0][1])];
      if (value === null || value === undefined || value === false) {
        element.removeAttribute(attr.name);
        continue;
      }
    }

    tokenSpec.regex.lastIndex = 0;
    const nextValue = attr.value.replace(tokenSpec.regex, (_, index) => {
      const value = values[Number(index)];
      return toAttributeValue(value);
    });
    element.setAttribute(attr.name, nextValue);
  }
}

/**
 * Tagged template for safer HTML construction.
 *
 * Interpolated values are injected as DOM nodes (not raw HTML) for text/structure
 * contexts, which prevents markup breakout in those positions.
 *
 * Security note:
 * - This does NOT sanitize attribute values or URL protocols.
 * - Interpolating untrusted values into attributes like `href`, `src`, `srcdoc`,
 *   `on*`, etc. can still be unsafe.
 *
 * Returns a DocumentFragment ready for insertion.
 *
 * ```ts
 * const fragment = html`<p>Hello, ${name}!</p>`;
 * container.append(fragment);
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: HTMLValue[]): DocumentFragment {
  const tokenSpec = createTokenSpec(strings);
  let markup = '';
  for (let i = 0; i < strings.length; i += 1) {
    markup += strings[i];
    if (i < values.length) {
      markup += `${tokenSpec.prefix}${i}${TOKEN_SUFFIX}`;
    }
  }

  const template = document.createElement('template');
  template.innerHTML = markup;

  const fragment = template.content;
  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT
  );

  const nodes: Node[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      replaceTextTokens(node as Text, values, tokenSpec);
      continue;
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      replaceAttributeTokens(node as Element, values, tokenSpec);
    }
  }

  return fragment;
}

export type { HTMLValue };
