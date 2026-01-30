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
 * Resolve a value from ctx - handles signals, functions, and plain values
 */
function resolve(value: unknown): unknown {
  if (isSignal(value)) return value();
  if (typeof value === 'function') return value();
  return value;
}

/**
 * Normalize binding attribute value
 * Handles both "name" and "{name}" formats
 */
function normalizeBinding(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Match {name} format and extract name
  const match = trimmed.match(/^\{\s*([a-zA-Z_$][\w$]*)\s*\}$/);
  return match ? match[1] : trimmed;
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
    } else if (isSignal(value)) {
      // Reactive text node
      const textNode = document.createTextNode('');
      const stop = effect(() => {
        textNode.data = String(value());
      });
      if (typeof stop === 'function') {
        cleanups.push(stop);
      }
      frag.appendChild(textNode);
    } else {
      // Static value - render once
      frag.appendChild(document.createTextNode(String(value)));
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
    const elements = root.querySelectorAll(`[${attr}]`);

    elements.forEach((el) => {
      const handlerName = normalizeBinding(el.getAttribute(attr));
      if (!handlerName) return;

      const handler = ctx[handlerName];

      if (handler === undefined) {
        warn(`Event handler "${handlerName}" not found in context`);
        return;
      }

      if (typeof handler !== 'function') {
        warn(`Event handler "${handlerName}" is not a function`);
        return;
      }

      el.addEventListener(eventName, handler as EventListener);
      cleanups.push(() => el.removeEventListener(eventName, handler as EventListener));
    });
  }
}

// ============================================================================
// when Directive
// ============================================================================

/**
 * Bind all [when] directives within root
 */
function bindWhen(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = root.querySelectorAll('[when]');

  elements.forEach((el) => {
    const bindingName = normalizeBinding(el.getAttribute('when'));
    if (!bindingName) return;

    const binding = ctx[bindingName];

    if (binding === undefined) {
      warn(`when: "${bindingName}" not found in context`);
      return;
    }

    const htmlEl = el as HTMLElement;
    const stop = effect(() => {
      const value = !!resolve(binding);
      htmlEl.style.display = value ? '' : 'none';
    });

    if (typeof stop === 'function') {
      cleanups.push(stop);
    }
  });
}

// ============================================================================
// match Directive
// ============================================================================

/**
 * Bind all [match] directives within root
 */
function bindMatch(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = root.querySelectorAll('[match]');

  elements.forEach((el) => {
    const bindingName = normalizeBinding(el.getAttribute('match'));
    if (!bindingName) return;

    const binding = ctx[bindingName];

    if (binding === undefined) {
      warn(`match: "${bindingName}" not found in context`);
      return;
    }

    const cases = Array.from(el.querySelectorAll('[case]')) as HTMLElement[];

    const stop = effect(() => {
      const value = String(resolve(binding));
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

    if (typeof stop === 'function') {
      cleanups.push(stop);
    }
  });
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

  // HMR support: Register binding context globally in dev mode
  if (isInDevMode()) {
    (globalThis as any).__dalila_hmr_context = { root, ctx, options };
  }

  // Create a scope for this template binding
  const templateScope = createScope();
  const cleanups: DisposeFunction[] = [];

  // Run all bindings within the template scope
  withScope(templateScope, () => {
    // 1. Text interpolation
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      // Skip nodes inside raw text containers
      const parent = node.parentElement;
      if (parent && parent.closest(rawTextSelectors)) {
        continue;
      }
      if (node.data.includes('{')) {
        textNodes.push(node);
      }
    }

    // Process text nodes (collect first, then process to avoid walker issues)
    for (const node of textNodes) {
      bindTextNode(node, ctx, cleanups);
    }

    // 2. Event bindings
    bindEvents(root, ctx, events, cleanups);

    // 3. when directive
    bindWhen(root, ctx, cleanups);

    // 4. match directive
    bindMatch(root, ctx, cleanups);
  });

  // Bindings complete: remove loading state and mark as ready
  // Use microtask to ensure all effects have run at least once
  queueMicrotask(() => {
    htmlRoot.removeAttribute('d-loading');
    htmlRoot.setAttribute('d-ready', '');
  });

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
