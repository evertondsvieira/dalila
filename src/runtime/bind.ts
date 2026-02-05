/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */

import { effect, createScope, withScope, isInDevMode } from '../core/index.js';

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if a value is a Dalila signal
 */
function isSignal(value: unknown): value is (() => unknown) & { set: unknown; update: unknown } {
  return typeof value === 'function' && 'set' in value && 'update' in value;
}

/**
 * Resolve a value from ctx - handles signals, functions, and plain values.
 * Only zero-arity functions are called (getters/computed).  Functions with
 * parameters are almost certainly event handlers and must never be invoked
 * here — doing so would trigger side-effects silently.
 */
function resolve(value: unknown): unknown {
  if (isSignal(value)) return value();
  if (typeof value === 'function') {
    const fn = value as Function;
    if (fn.length === 0) return fn();
    warn(`resolve(): "${fn.name || 'anonymous'}" has parameters — not executed. Use a signal or a zero-arity getter.`);
    return undefined;
  }
  return value;
}

/**
 * Normalize binding attribute value
 * Attributes use plain identifiers only (e.g. "count")
 */
function normalizeBinding(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const braced = trimmed.match(/^\{\s*([a-zA-Z_$][\w$]*)\s*\}$/);
  if (braced) {
    warn(`Attribute bindings must use plain identifiers (no braces). Use "${braced[1]}" instead of "${trimmed}".`);
    return null;
  }

  return trimmed;
}

/**
 * querySelectorAll that also tests the root element itself.
 * Necessary because querySelectorAll only searches descendants.
 */
function qsaIncludingRoot(root: Element, selector: string): Element[] {
  const out: Element[] = [];
  if (root.matches(selector)) out.push(root);
  out.push(...Array.from(root.querySelectorAll(selector)));

  // Determine the "boundary" — the nearest already-bound ancestor of root
  // (or root itself when it carries the marker).  Only elements whose own
  // nearest bound ancestor matches this boundary belong to the current bind
  // scope; anything deeper was already bound by a nested bind() call.
  // This also handles manual bind() calls on elements inside a clone:
  // root won't have the marker, but root.closest() will find the clone.
  const boundary = root.closest('[data-dalila-internal-bound]');

  return out.filter(el => {
    const bound = el.closest('[data-dalila-internal-bound]');
    return bound === boundary;
  });
}

/**
 * Dev mode warning helper
 */
function warn(message: string): void {
  if (isInDevMode()) {
    console.warn(`[Dalila] ${message}`);
  }
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_EVENTS = ['click', 'input', 'change', 'submit', 'keydown', 'keyup'];
const DEFAULT_RAW_TEXT_SELECTORS = 'pre, code';

// ============================================================================
// Text Interpolation
// ============================================================================

/**
 * Process a text node and replace {tokens} with reactive bindings
 */
function bindTextNode(
  node: Text,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const text = node.data;
  const regex = /\{\s*([a-zA-Z_$][\w$]*)\s*\}/g;

  // Check if there are any tokens
  if (!regex.test(text)) return;

  // Reset regex
  regex.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the token
    const before = text.slice(cursor, match.index);
    if (before) {
      frag.appendChild(document.createTextNode(before));
    }

    const key = match[1];
    const value = ctx[key];

    if (value === undefined) {
      warn(`Text interpolation: "${key}" not found in context`);
      frag.appendChild(document.createTextNode(match[0]));
    } else if (isSignal(value) || (typeof value === 'function' && (value as Function).length === 0)) {
      // Signal or zero-arity getter — reactive text node.
      // resolve() inside the effect calls the value and tracks dependencies.
      const textNode = document.createTextNode('');
      effect(() => {
        const v = resolve(value);
        textNode.data = v == null ? '' : String(v);
      });
      frag.appendChild(textNode);
    } else {
      // Static value — or a function with params, in which case resolve()
      // warns and returns undefined, normalised to empty string below.
      const resolved = resolve(value);
      frag.appendChild(document.createTextNode(resolved == null ? '' : String(resolved)));
    }

    cursor = match.index + match[0].length;
  }

  // Add remaining text
  const after = text.slice(cursor);
  if (after) {
    frag.appendChild(document.createTextNode(after));
  }

  // Replace original node
  if (node.parentNode) {
    node.parentNode.replaceChild(frag, node);
  }
}

// ============================================================================
// Event Binding
// ============================================================================

/**
 * Bind all d-on-* events within root
 */
function bindEvents(
  root: Element,
  ctx: BindContext,
  events: string[],
  cleanups: DisposeFunction[]
): void {
  for (const eventName of events) {
    const attr = `d-on-${eventName}`;
    const elements = qsaIncludingRoot(root, `[${attr}]`);

    for (const el of elements) {
      const handlerName = normalizeBinding(el.getAttribute(attr));
      if (!handlerName) continue;

      const handler = ctx[handlerName];

      if (handler === undefined) {
        warn(`Event handler "${handlerName}" not found in context`);
        continue;
      }

      if (typeof handler !== 'function') {
        warn(`Event handler "${handlerName}" is not a function`);
        continue;
      }

      el.addEventListener(eventName, handler as EventListener);
      cleanups.push(() => el.removeEventListener(eventName, handler as EventListener));
    }
  }
}

// ============================================================================
// d-when Directive
// ============================================================================

/**
 * Bind all [d-when] directives within root
 */
function bindWhen(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[when], [d-when]');

  for (const el of elements) {
    const attrName = el.hasAttribute('when') ? 'when' : 'd-when';
    const bindingName = normalizeBinding(el.getAttribute(attrName));
    if (!bindingName) continue;

    const binding = ctx[bindingName];

    if (binding === undefined) {
      warn(`when: "${bindingName}" not found in context`);
      continue;
    }

    const htmlEl = el as HTMLElement;
    // Effect is owned by templateScope — no need to track stop manually
    effect(() => {
      const value = !!resolve(binding);
      htmlEl.style.display = value ? '' : 'none';
    });
  }
}

// ============================================================================
// d-match Directive
// ============================================================================

/**
 * Bind all [d-match] directives within root
 */
function bindMatch(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-match]');

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-match'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];

    if (binding === undefined) {
      warn(`d-match: "${bindingName}" not found in context`);
      continue;
    }

    effect(() => {
      // Re-query cases on every run so dynamically added/removed [case]
      // children (e.g. via d-if) are always up to date.
      const cases = Array.from(el.querySelectorAll('[case]')) as HTMLElement[];
      const v = resolve(binding);
      const value = v == null ? '' : String(v);
      let matchedEl: HTMLElement | null = null;
      let defaultEl: HTMLElement | null = null;

      // First pass: hide all and find match/default
      for (const caseEl of cases) {
        caseEl.style.display = 'none';
        const caseValue = caseEl.getAttribute('case');

        if (caseValue === 'default') {
          defaultEl = caseEl;
        } else if (caseValue === value && !matchedEl) {
          matchedEl = caseEl;
        }
      }

      // Second pass: show match OR default (not both)
      if (matchedEl) {
        matchedEl.style.display = '';
      } else if (defaultEl) {
        defaultEl.style.display = '';
      }
    });
  }
}

// ============================================================================
// d-each Directive
// ============================================================================

/**
 * Bind all [d-each] directives within root.
 * The element with d-each is used as a template: removed from DOM and cloned
 * once per item in the array. Each clone is independently bound with the
 * item's properties as its context.
 */
function bindEach(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  // Only bind top-level d-each elements.  Nested d-each (inside another
  // d-each template) must be left untouched here — they will be bound when
  // their parent clones are passed to bind() individually.
  const elements = qsaIncludingRoot(root, '[d-each]')
    .filter(el => !el.parentElement?.closest('[d-each]'));

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-each'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-each: "${bindingName}" not found in context`);
      continue;
    }

    const comment = document.createComment('d-each');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-each');

    const template = el;
    let currentClones: Element[] = [];
    let currentDisposes: DisposeFunction[] = [];

    function renderList(items: unknown[]) {
      for (const clone of currentClones) clone.remove();
      for (const dispose of currentDisposes) dispose();
      currentClones = [];
      currentDisposes = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const clone = template.cloneNode(true) as Element;

        // Inherit parent ctx via prototype so values and handlers defined
        // outside the loop remain accessible inside each iteration.
        const itemCtx = Object.create(ctx) as BindContext;
        if (typeof item === 'object' && item !== null) {
          Object.assign(itemCtx, item as Record<string, unknown>);
        }
        // Always expose raw item + positional / collection helpers
        itemCtx.item = item;
        itemCtx.$index = i;
        itemCtx.$count = items.length;
        itemCtx.$first = i === 0;
        itemCtx.$last = i === items.length - 1;
        itemCtx.$odd = i % 2 !== 0;
        itemCtx.$even = i % 2 === 0;

        // Mark BEFORE bind() so the parent's subsequent global passes
        // (text, attrs, events …) skip this subtree entirely.
        clone.setAttribute('data-dalila-internal-bound', '');

        const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
        currentDisposes.push(dispose);

        comment.parentNode?.insertBefore(clone, comment);
        currentClones.push(clone);
      }
    }

    if (isSignal(binding)) {
      // Effect owned by templateScope — no manual stop needed
      effect(() => {
        const value = binding();
        renderList(Array.isArray(value) ? value : []);
      });
    } else if (Array.isArray(binding)) {
      renderList(binding);
    } else {
      warn(`d-each: "${bindingName}" is not an array or signal`);
    }

    cleanups.push(() => {
      for (const clone of currentClones) clone.remove();
      for (const dispose of currentDisposes) dispose();
      currentClones = [];
      currentDisposes = [];
    });
  }
}

// ============================================================================
// d-if Directive
// ============================================================================

/**
 * Bind all [d-if] directives within root.
 * Unlike [d-when] which toggles display, d-if adds/removes the element from
 * the DOM entirely. A comment node is left as placeholder for insertion position.
 */
function bindIf(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-if]');

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-if'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-if: "${bindingName}" not found in context`);
      continue;
    }

    const comment = document.createComment('d-if');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-if');

    const htmlEl = el as HTMLElement;

    effect(() => {
      const value = !!resolve(binding);
      if (value) {
        if (!htmlEl.parentNode) {
          comment.parentNode?.insertBefore(htmlEl, comment);
        }
      } else {
        if (htmlEl.parentNode) {
          htmlEl.parentNode.removeChild(htmlEl);
        }
      }
    });
  }
}

// ============================================================================
// d-html Directive
// ============================================================================

/**
 * Bind all [d-html] directives within root.
 * Sets innerHTML instead of textContent — HTML tags in the value are rendered.
 * Counterpart to {placeholder} which always escapes HTML via createTextNode.
 */
function bindHtml(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-html]');

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-html'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-html: "${bindingName}" not found in context`);
      continue;
    }

    const htmlEl = el as HTMLElement;

    if (isSignal(binding)) {
      effect(() => {
        const v = binding();
        const html = v == null ? '' : String(v);
        if (isInDevMode() && /<script[\s>]|javascript:|onerror\s*=/i.test(html)) {
          warn(`d-html: potentially unsafe HTML in "${bindingName}". Never use with unsanitized user input.`);
        }
        htmlEl.innerHTML = html;
      });
    } else {
      const v = resolve(binding);
      const html = v == null ? '' : String(v);
      if (isInDevMode() && /<script[\s>]|javascript:|onerror\s*=/i.test(html)) {
        warn(`d-html: potentially unsafe HTML in "${bindingName}". Never use with unsanitized user input.`);
      }
      htmlEl.innerHTML = html;
    }
  }
}

// ============================================================================
// d-attr Directive
// ============================================================================

/**
 * Apply an attribute value with correct semantics:
 *   null | undefined | false  →  remove the attribute entirely
 *   true                      →  set as empty string (boolean attribute)
 *   anything else             →  stringify and set
 */
// Properties that must be set as IDL properties rather than attributes.
// setAttribute('checked') / setAttribute('value') do NOT update the live
// state of an input after the user has interacted with it.
const BOOLEAN_PROPS = new Set(['checked', 'selected', 'disabled', 'indeterminate']);
const STRING_PROPS = new Set(['value']);

function applyAttr(el: Element, attrName: string, value: unknown): void {
  // Fast-path: known IDL properties set as properties on the element
  if (BOOLEAN_PROPS.has(attrName) && attrName in el) {
    (el as any)[attrName] = !!value;
    return;
  }
  if (STRING_PROPS.has(attrName) && attrName in el) {
    (el as any)[attrName] = value == null ? '' : String(value);
    return;
  }

  // Generic attribute path
  if (value === null || value === undefined || value === false) {
    el.removeAttribute(attrName);
  } else if (value === true) {
    el.setAttribute(attrName, '');
  } else {
    el.setAttribute(attrName, String(value));
  }
}

function bindAttrs(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const PREFIX = 'd-attr-';
  const allElements = qsaIncludingRoot(root, '*');

  for (const el of allElements) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (!attr.name.startsWith(PREFIX)) continue;

      const attrName = attr.name.slice(PREFIX.length);
      const bindingName = normalizeBinding(attr.value);
      if (!bindingName) continue;

      const binding = ctx[bindingName];
      if (binding === undefined) {
        warn(`d-attr-${attrName}: "${bindingName}" not found in context`);
        continue;
      }

      el.removeAttribute(attr.name);

      if (isSignal(binding)) {
        effect(() => {
          applyAttr(el, attrName, binding());
        });
      } else {
        applyAttr(el, attrName, resolve(binding));
      }
    }
  }
}

// ============================================================================
// Main bind() Function
// ============================================================================

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
export function bind(
  root: Element,
  ctx: BindContext,
  options: BindOptions = {}
): DisposeFunction {
  const events = options.events ?? DEFAULT_EVENTS;
  const rawTextSelectors = options.rawTextSelectors ?? DEFAULT_RAW_TEXT_SELECTORS;

  const htmlRoot = root as HTMLElement;

  // HMR support: Register binding context globally in dev mode.
  // Skip for internal (d-each clone) bindings — only the top-level bind owns HMR.
  if (!options._internal && isInDevMode()) {
    (globalThis as any).__dalila_hmr_context = { root, ctx, options };
  }

  // Create a scope for this template binding
  const templateScope = createScope();
  const cleanups: DisposeFunction[] = [];

  // Run all bindings within the template scope
  withScope(templateScope, () => {
    // 1. d-each — must run first: removes templates before TreeWalker visits them
    bindEach(root, ctx, cleanups);

    // 2. Text interpolation
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    // Same boundary logic as qsaIncludingRoot: only visit text nodes that
    // belong to this bind scope, not to nested already-bound subtrees.
    const textBoundary = root.closest('[data-dalila-internal-bound]');

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      // Skip nodes inside raw text containers
      if (parent && parent.closest(rawTextSelectors)) {
        continue;
      }
      // Skip nodes inside already-bound subtrees (d-each clones)
      if (parent) {
        const bound = parent.closest('[data-dalila-internal-bound]');
        if (bound !== textBoundary) continue;
      }
      if (node.data.includes('{')) {
        textNodes.push(node);
      }
    }

    // Process text nodes (collect first, then process to avoid walker issues)
    for (const node of textNodes) {
      bindTextNode(node, ctx, cleanups);
    }

    // 3. d-attr bindings
    bindAttrs(root, ctx, cleanups);

    // 4. d-html bindings
    bindHtml(root, ctx, cleanups);

    // 5. Event bindings
    bindEvents(root, ctx, events, cleanups);

    // 6. d-when directive
    bindWhen(root, ctx, cleanups);

    // 7. d-match directive
    bindMatch(root, ctx, cleanups);

    // 8. d-if — must run last: elements are fully bound before conditional removal
    bindIf(root, ctx, cleanups);
  });

  // Bindings complete: remove loading state and mark as ready.
  // Only the top-level bind owns this lifecycle — d-each clones skip it.
  if (!options._skipLifecycle) {
    queueMicrotask(() => {
      htmlRoot.removeAttribute('d-loading');
      htmlRoot.setAttribute('d-ready', '');
    });
  }

  // Return dispose function
  return () => {
    // Run manual cleanups (event listeners)
    for (const cleanup of cleanups) {
      if (typeof cleanup === 'function') {
        try {
          cleanup();
        } catch (e) {
          if (isInDevMode()) {
            console.warn('[Dalila] Cleanup error:', e);
          }
        }
      }
    }
    cleanups.length = 0;

    // Dispose template scope (stops all effects)
    try {
      templateScope.dispose();
    } catch (e) {
      if (isInDevMode()) {
        console.warn('[Dalila] Scope dispose error:', e);
      }
    }
  };
}

// ============================================================================
// Convenience: Auto-bind on DOMContentLoaded
// ============================================================================

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
export function autoBind(
  selector: string,
  ctx: BindContext,
  options?: BindOptions
): Promise<DisposeFunction> {
  return new Promise((resolve, reject) => {
    const doBind = () => {
      const root = document.querySelector(selector);
      if (!root) {
        reject(new Error(`[Dalila] Element not found: ${selector}`));
        return;
      }
      resolve(bind(root, ctx, options));
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doBind, { once: true });
    } else {
      doBind();
    }
  });
}
