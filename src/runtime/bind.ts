/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */

import { isInDevMode } from '../core/dev.js';
import { createScope, getCurrentScope, withScope } from '../core/scope.js';
import { effect, FatalEffectError, signal, type Signal } from '../core/signal.js';
import { schedule, withSchedulerPriority, type SchedulerPriority } from '../core/scheduler.js';
import { WRAPPED_HANDLER } from '../form/form.js';
import { linkScopeToDom, withDevtoolsDomTarget } from '../core/devtools.js';
import type { Component, TypedSetupContext, ComponentDefinition } from './component.js';
import { isComponent, camelToKebab } from './component.js';
import { bindBoundary } from './boundary.js';
import { bindPortalDirective, syncPortalElement } from './bind-portal.js';
import { bindLazyDirective as runBindLazyDirective } from './bind-lazy-directive.js';
import {
  bindEachDirective as runBindEachDirective,
  bindVirtualEachDirective as runBindVirtualEachDirective,
  getVirtualListController as getVirtualListControllerFromList,
  scrollToVirtualIndex as scrollToVirtualIndexFromList,
} from './bind-list-directives.js';
import { bindIfDirective as runBindIfDirective } from './bind-if-directive.js';
import {
  ensureButtonTypeForSelector,
  queryIncludingRoot,
  updateNestedArrayDataPaths,
} from './array-directive-dom.js';
import { bindSlotFragments, extractSlots, fillSlots } from './internal/components/component-slots.js';
import { resolveComponentProps as resolveComponentPropsFromElement } from './internal/components/component-props.js';
import {
  hasExecutableHtmlSinkPattern,
  resolveHtmlSinkSecurityOptions,
  setElementInnerHTML,
  setTemplateInnerHTML,
  setTemplateInnerHTMLForParsing,
  type HtmlSinkSecurityOptions,
  type TrustedTypesHtmlPolicy,
} from './html-sinks.js';

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
   * Optional runtime cache policy for text interpolation template plans.
   * Defaults are tuned for general SPA usage.
   */
  templatePlanCache?: {
    /** Maximum number of cached template plans (0 disables cache). */
    maxEntries?: number;
    /** Time-to-live (ms) per plan, refreshed on hit (0 disables cache). */
    ttlMs?: number;
  };

  /** Component registry — accepts map `{ tag: component }` or array `[component]` */
  components?: Record<string, Component> | Component[];

  /** Error policy for component `ctx.onMount()` callbacks. Default: 'log'. */
  onMountError?: 'log' | 'throw';

  /**
   * Optional runtime transition registry used by `d-transition`.
   */
  transitions?: TransitionConfig[];

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

  /**
   * Optional sanitizer for raw HTML sinks (currently applied to `d-html`).
   * Receives the HTML string and metadata about the sink.
   * When omitted, Dalila applies a built-in baseline sanitizer.
   */
  sanitizeHtml?: SanitizeHtmlFn;

  /**
   * Keep Dalila's framework default HTML sanitizer enabled.
   * Defaults to `true`.
   *
   * Set `false` when you want `sanitizeHtml` to be fully opt-in again for
   * a specific bind/config scope.
   */
  useDefaultSanitizeHtml?: boolean;

  /**
   * Optional security hardening settings (opt-in).
   */
  security?: RuntimeSecurityOptions;
}

export interface BindContext {
  [key: string]: unknown;
}

export interface SanitizeHtmlContext {
  sink: 'd-html';
  bindingName: string;
  element: Element;
}

export type SanitizeHtmlFn = (html: string, context: SanitizeHtmlContext) => string;

export interface RuntimeSecurityOptions {
  /**
   * Enables stricter defaults. Dalila enables this in the framework-level
   * production profile unless you override it via `configure()` / `bind()`.
   * Current effects:
   * - blocks `srcdoc` via `d-attr-*`
   * - requires a custom sanitizer for `d-html`
   */
  strict?: boolean;

  /**
   * Explicitly block HTML-bearing attributes like `srcdoc` in `d-attr-*`.
   * Defaults to `true` when `strict` is enabled.
   */
  blockRawHtmlAttrs?: boolean;

  /**
   * Require a configured sanitizer for `d-html`.
   * When enabled, the built-in baseline sanitizer is NOT used as fallback:
   * callers must provide `sanitizeHtml`, otherwise `d-html` renders empty
   * and emits a security warning (or throws when `warnAsError` is enabled).
   * Defaults to `true` when `strict` is enabled.
   */
  requireHtmlSanitizerForDHtml?: boolean;

  /**
   * Throw instead of warning in dev mode.
   * Useful for CI/test gates that should fail on unsafe patterns.
   */
  warnAsError?: boolean;

  /**
   * Enable Trusted Types for HTML sinks when browser support is available.
   * Opt-in. Explicitly set `trustedTypes: true`, or provide a policy name/policy.
   */
  trustedTypes?: boolean;

  /**
   * Trusted Types policy name used by runtime sinks.
   * Defaults to `"dalila"`.
   */
  trustedTypesPolicyName?: string;

  /**
   * Existing Trusted Types policy to reuse for HTML sinks.
   * Useful on browsers that enforce Trusted Types but do not expose a policy lookup API.
   */
  trustedTypesPolicy?: TrustedTypesHtmlPolicy | null;
}

/**
 * Convenience alias: any object whose values are `unknown`.
 * Use the generic parameter on `bind<T>()` / `autoBind<T>()` / `fromHtml<T>()`
 * to preserve the concrete type at call sites while still satisfying internal
 * look-ups that index by string key.
 */
export type BindData<T extends Record<string, unknown> = Record<string, unknown>> = T;

export type DisposeFunction = () => void;

export interface BindHandle {
  (): void;
  getRef(name: string): Element | null;
  getRefs(): Readonly<Record<string, Element>>;
}

export interface TransitionConfig {
  name: string;
  enter?: (el: HTMLElement) => void;
  leave?: (el: HTMLElement) => void;
  duration?: number;
}

export type VirtualListAlign = 'start' | 'center' | 'end';

export interface VirtualScrollToIndexOptions {
  align?: VirtualListAlign;
  behavior?: ScrollBehavior;
}

export interface VirtualListController {
  scrollToIndex: (index: number, options?: VirtualScrollToIndexOptions) => void;
  refresh: () => void;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Check if a value is a Dalila signal
 */
function isSignal(value: unknown): value is (() => unknown) & { set: unknown; update: unknown } {
  return typeof value === 'function' && 'set' in value && 'update' in value;
}

function isWritableSignal(value: unknown): value is Signal<unknown> {
  if (!isSignal(value)) return false;

  // `computed()` exposes set/update that always throw. Probe with a no-op write
  // (same value) to detect read-only signals without mutating state.
  try {
    const current = (value as Signal<unknown>).peek();
    (value as Signal<unknown>).set(current);
    return true;
  } catch {
    return false;
  }
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
type BindScanPlan = {
  root: Element;
  elements: Element[];
  attrIndex: Map<string, Element[]>;
  tagIndex: Map<string, Element[]>;
  selectorCache: Map<string, Element[]>;
};

let activeBindScanPlan: BindScanPlan | null = null;
let warnAsErrorDepth = 0;
const warnAsErrorScopes = new WeakSet<object>();

function withWarnAsError<T>(enabled: boolean, run: () => T): T {
  if (!enabled) return run();
  warnAsErrorDepth += 1;
  try {
    return run();
  } finally {
    warnAsErrorDepth = Math.max(0, warnAsErrorDepth - 1);
  }
}

function isWarnAsErrorEnabledForActiveScope(): boolean {
  let scope = getCurrentScope();
  while (scope) {
    if (warnAsErrorScopes.has(scope)) return true;
    scope = scope.parent;
  }
  return false;
}

function createBindScanPlan(root: Element): BindScanPlan {
  const boundary = root.closest('[data-dalila-internal-bound]');
  const elements: Element[] = [];
  const attrIndex = new Map<string, Element[]>();
  const tagIndex = new Map<string, Element[]>();

  const indexElement = (el: Element) => {
    const tag = el.tagName.toLowerCase();
    const byTag = tagIndex.get(tag);
    if (byTag) byTag.push(el);
    else tagIndex.set(tag, [el]);

    for (const attr of Array.from(el.attributes)) {
      const byAttr = attrIndex.get(attr.name);
      if (byAttr) byAttr.push(el);
      else attrIndex.set(attr.name, [el]);
    }
  };

  if (root.matches('*')) {
    const rootBoundary = root.closest('[data-dalila-internal-bound]');
    if (rootBoundary === boundary) {
      elements.push(root);
      indexElement(root);
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const el = walker.currentNode as Element;
    const nearestBound = el.closest('[data-dalila-internal-bound]');
    if (nearestBound !== boundary) continue;
    elements.push(el);
    indexElement(el);
  }

  return {
    root,
    elements,
    attrIndex,
    tagIndex,
    selectorCache: new Map(),
  };
}

function mergeSelectorResults(plan: BindScanPlan, chunks: Element[][]): Element[] {
  const hit = new Set<Element>();
  for (const chunk of chunks) {
    for (const el of chunk) hit.add(el);
  }
  return plan.elements.filter(el => hit.has(el));
}

function resolveSelectorFromIndex(plan: BindScanPlan, selector: string): Element[] | null {
  const trimmed = selector.trim();
  if (!trimmed) return [];

  if (trimmed.includes(',')) {
    const parts = trimmed
      .split(',')
      .map(part => part.trim())
      .filter(Boolean);

    if (parts.length === 0) return [];

    const chunks: Element[][] = [];
    for (const part of parts) {
      const partial = resolveSelectorFromIndex(plan, part);
      if (partial === null) return null;
      chunks.push(partial);
    }
    return mergeSelectorResults(plan, chunks);
  }

  if (trimmed === '*') return [...plan.elements];

  const slotNameMatch = trimmed.match(/^slot\[name\]$/i);
  if (slotNameMatch) {
    const slotEls = plan.tagIndex.get('slot') ?? [];
    return slotEls.filter(el => el.hasAttribute('name'));
  }

  const attrMatch = trimmed.match(/^\[([^\]=\s]+)\]$/);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const hit = new Set<Element>();
    const out: Element[] = [];

    for (const el of plan.attrIndex.get(attrName) ?? []) {
      if (!el.hasAttribute(attrName) || hit.has(el)) continue;
      hit.add(el);
      out.push(el);
    }

    for (const el of plan.elements) {
      if (!el.hasAttribute(attrName) || hit.has(el)) continue;
      hit.add(el);
      out.push(el);
    }

    return out;
  }

  const tagMatch = trimmed.match(/^[a-zA-Z][a-zA-Z0-9-]*$/);
  if (tagMatch) {
    return [...(plan.tagIndex.get(trimmed.toLowerCase()) ?? [])];
  }

  return null;
}

function qsaFromPlan(plan: BindScanPlan, selector: string): Element[] {
  const cacheable = !selector.includes('[');
  if (cacheable) {
    const cached = plan.selectorCache.get(selector);
    if (cached) {
      return cached.filter(el => el === plan.root || plan.root.contains(el));
    }
  }

  const indexed = resolveSelectorFromIndex(plan, selector);
  const source = indexed ?? plan.elements.filter(el => el.matches(selector));
  const matches = source.filter(el => el === plan.root || plan.root.contains(el));

  if (cacheable) plan.selectorCache.set(selector, matches);
  return matches;
}

function qsaIncludingRoot(root: Element, selector: string): Element[] {
  if (activeBindScanPlan && activeBindScanPlan.root === root) {
    return qsaFromPlan(activeBindScanPlan, selector);
  }

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
export function warnRuntime(message: string): void {
  if (!isInDevMode()) return;
  const formatted = `[Dalila] ${message}`;
  console.warn(formatted);
}

export function warnSecurityRuntime(
  message: string,
  beforeThrow?: () => void
): void {
  if (!isInDevMode()) return;
  const formatted = `[Dalila] ${message}`;
  if (warnAsErrorDepth > 0 || isWarnAsErrorEnabledForActiveScope()) {
    beforeThrow?.();
    throw new FatalEffectError(formatted);
  }
  console.warn(formatted);
}

const warn = warnRuntime;
const warnSecurity = warnSecurityRuntime;

function clearHtmlSink(el: Element): void {
  if (typeof (el as ParentNode).replaceChildren === 'function') {
    (el as ParentNode).replaceChildren();
    return;
  }

  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

function warnRawHtmlSinkHeuristic(
  sink: string,
  source: string,
  html: string,
  beforeThrow?: () => void
): void {
  if (!isInDevMode() || !hasExecutableHtmlSinkPattern(html)) return;
  warnSecurityRuntime(
    `${sink}: suspicious HTML detected in "${source}". Dev warning is heuristic only (not sanitization). Use trusted templates or sanitize before use.`,
    beforeThrow
  );
}

function mergeSecurityOptions(
  base?: RuntimeSecurityOptions,
  overrides?: RuntimeSecurityOptions
): RuntimeSecurityOptions | undefined {
  if (!base && !overrides) return undefined;
  return {
    ...(base ?? {}),
    ...(overrides ?? {}),
  };
}

function resolveSecurityOptions(options: BindOptions): Required<RuntimeSecurityOptions> {
  const base = resolveHtmlSinkSecurityOptions(options.security as HtmlSinkSecurityOptions | undefined);
  return {
    strict: base.strict,
    blockRawHtmlAttrs: options.security?.blockRawHtmlAttrs ?? base.strict,
    requireHtmlSanitizerForDHtml: options.security?.requireHtmlSanitizerForDHtml ?? base.strict,
    warnAsError: options.security?.warnAsError ?? false,
    trustedTypes: base.trustedTypes,
    trustedTypesPolicyName: base.trustedTypesPolicyName,
    trustedTypesPolicy: base.trustedTypesPolicy,
  };
}

const DEFAULT_SANITIZE_BLOCKED_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
]);

const VOID_HTML_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

interface ParsedHtmlAttribute {
  name: string;
  value: string | null;
}

interface ParsedHtmlTag {
  tagName: string;
  attrs: ParsedHtmlAttribute[];
  closing: boolean;
  selfClosing: boolean;
  endIndex: number;
}

function parseHtmlTag(source: string, startIndex: number): ParsedHtmlTag | null {
  if (source[startIndex] !== '<') return null;

  let i = startIndex + 1;
  let closing = false;
  if (source[i] === '/') {
    closing = true;
    i += 1;
  }

  if (!/[a-zA-Z]/.test(source[i] ?? '')) return null;

  const tagNameStart = i;
  while (i < source.length && /[\w:-]/.test(source[i])) {
    i += 1;
  }

  const tagName = source.slice(tagNameStart, i);
  if (!tagName) return null;

  if (closing) {
    while (i < source.length && source[i] !== '>') {
      i += 1;
    }
    if (source[i] === '>') i += 1;
    return {
      tagName,
      attrs: [],
      closing: true,
      selfClosing: false,
      endIndex: i,
    };
  }

  const attrs: ParsedHtmlAttribute[] = [];
  let selfClosing = false;

  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) {
      i += 1;
    }

    if (i >= source.length) break;
    if (source[i] === '>') {
      i += 1;
      return {
        tagName,
        attrs,
        closing: false,
        selfClosing,
        endIndex: i,
      };
    }
    if (source[i] === '/' && source[i + 1] === '>') {
      i += 2;
      selfClosing = true;
      return {
        tagName,
        attrs,
        closing: false,
        selfClosing,
        endIndex: i,
      };
    }
    if (source[i] === '/') {
      i += 1;
      continue;
    }

    const attrStart = i;
    while (i < source.length && !/[\s=/>]/.test(source[i])) {
      i += 1;
    }

    if (i === attrStart) {
      i += 1;
      continue;
    }

    const name = source.slice(attrStart, i);
    while (i < source.length && /\s/.test(source[i])) {
      i += 1;
    }

    let value: string | null = null;
    if (source[i] === '=') {
      i += 1;
      while (i < source.length && /\s/.test(source[i])) {
        i += 1;
      }

      if (i >= source.length) break;

      const quote = source[i];
      if (quote === '"' || quote === '\'') {
        i += 1;
        const valueStart = i;
        while (i < source.length && source[i] !== quote) {
          i += 1;
        }
        value = source.slice(valueStart, i);
        if (source[i] === quote) i += 1;
      } else {
        const valueStart = i;
        while (i < source.length && !/[\s>]/.test(source[i])) {
          i += 1;
        }
        value = source.slice(valueStart, i);
      }
    }

    attrs.push({ name, value });
  }

  return null;
}

function findBlockedTagEnd(source: string, tagName: string, startIndex: number): number {
  if (VOID_HTML_TAGS.has(tagName)) {
    return startIndex;
  }

  let depth = 1;
  let i = startIndex;

  while (i < source.length) {
    if (source.startsWith('<!--', i)) {
      const commentEnd = source.indexOf('-->', i + 4);
      i = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    if (source[i] !== '<') {
      i += 1;
      continue;
    }

    const parsed = parseHtmlTag(source, i);
    if (!parsed) {
      i += 1;
      continue;
    }

    const normalizedTagName = parsed.tagName.toLowerCase();
    if (normalizedTagName === tagName) {
      if (parsed.closing) {
        depth -= 1;
        if (depth === 0) return parsed.endIndex;
      } else if (!parsed.selfClosing && !VOID_HTML_TAGS.has(normalizedTagName)) {
        depth += 1;
      }
    }

    i = Math.max(parsed.endIndex, i + 1);
  }

  return source.length;
}

function escapeHtmlAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isDangerousUrlAttributeValueForTag(
  tagName: string,
  attrName: string,
  value: string
): boolean {
  const normalizedAttrName = normalizeAttrName(attrName);
  if (!URL_ATTRS.has(normalizedAttrName)) return false;
  if (normalizedAttrName === 'data' && tagName !== 'object') {
    return false;
  }
  const normalized = normalizeProtocolCheckValue(value);
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../') ||
    normalized.startsWith('?') ||
    normalized.startsWith('#')
  ) {
    return false;
  }

  const protocol = extractUrlProtocol(normalized);
  if (!protocol) return false;

  return !SAFE_URL_PROTOCOLS.has(protocol);
}

function sanitizeHtmlByStringScan(html: string): string {
  let out = '';
  let i = 0;

  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const commentEnd = html.indexOf('-->', i + 4);
      const end = commentEnd === -1 ? html.length : commentEnd + 3;
      out += html.slice(i, end);
      i = end;
      continue;
    }

    if (html[i] !== '<') {
      out += html[i];
      i += 1;
      continue;
    }

    const parsed = parseHtmlTag(html, i);
    if (!parsed) {
      out += html[i];
      i += 1;
      continue;
    }

    const normalizedTagName = parsed.tagName.toLowerCase();
    if (DEFAULT_SANITIZE_BLOCKED_TAGS.has(normalizedTagName)) {
      i = parsed.selfClosing || parsed.closing
        ? parsed.endIndex
        : findBlockedTagEnd(html, normalizedTagName, parsed.endIndex);
      continue;
    }

    if (parsed.closing) {
      out += `</${parsed.tagName}>`;
      i = parsed.endIndex;
      continue;
    }

    let tagOut = `<${parsed.tagName}`;
    for (const attr of parsed.attrs) {
      const normalizedAttrName = normalizeAttrName(attr.name);
      if (normalizedAttrName.startsWith('on')) continue;
      if (normalizedAttrName === 'style') continue;
      if (normalizedAttrName === 'srcdoc') continue;
      if (
        attr.value != null
        && isDangerousUrlAttributeValueForTag(normalizedTagName, normalizedAttrName, attr.value)
      ) {
        continue;
      }

      tagOut += ` ${attr.name}`;
      if (attr.value != null) {
        tagOut += `="${escapeHtmlAttributeValue(attr.value)}"`;
      }
    }

    tagOut += parsed.selfClosing ? ' />' : '>';
    out += tagOut;
    i = parsed.endIndex;
  }

  return out;
}

function sanitizeHtmlSubtree(root: ParentNode): void {
  const all = Array.from(root.querySelectorAll('*'));
  for (const el of all) {
    const tag = el.tagName.toLowerCase();
    if (DEFAULT_SANITIZE_BLOCKED_TAGS.has(tag)) {
      el.remove();
      continue;
    }

    for (const attr of Array.from(el.attributes)) {
      const normalizedAttrName = normalizeAttrName(attr.name);
      if (normalizedAttrName.startsWith('on')) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (normalizedAttrName === 'style') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (normalizedAttrName === 'srcdoc') {
        el.removeAttribute(attr.name);
        continue;
      }
      if (isDangerousUrlAttributeValue(el, normalizedAttrName, attr.value)) {
        el.removeAttribute(attr.name);
      }
    }

    if (tag === 'template') {
      sanitizeHtmlSubtree((el as HTMLTemplateElement).content);
    }
  }
}

function builtInSanitizeHtml(html: string, security: RuntimeSecurityOptions): string {
  if (typeof document === 'undefined') return '';

  const template = document.createElement('template');
  const rawParsingSecurity = security.trustedTypes
    ? { ...security, trustedTypes: false, trustedTypesPolicy: null }
    : security;

  try {
    // Prefer the raw parse path when the environment does not actually enforce
    // Trusted Types. This preserves the pre-sanitization ordering and avoids
    // creating an extra parsing policy unnecessarily.
    setTemplateInnerHTML(template, html, rawParsingSecurity);
  } catch (err) {
    if (!security.trustedTypes) throw err;

    if (security.trustedTypesPolicy) {
      return sanitizeHtmlByStringScan(html);
    }

    // Under enforced TT, fall back to a dedicated identity parsing policy so
    // sanitization still happens before the final sink policy is applied.
    setTemplateInnerHTMLForParsing(template, html, security);
  }
  sanitizeHtmlSubtree(template.content);

  return template.innerHTML;
}

function applyHtmlSinkValue(
  htmlEl: HTMLElement,
  sanitized: string,
  bindingName: string,
  options: BindOptions
): void {
  const security = resolveSecurityOptions(options);

  try {
    setElementInnerHTML(htmlEl, sanitized, security);
  } catch (err) {
    clearHtmlSink(htmlEl);
    const error = err instanceof Error ? err : new Error(String(err));
    if (security.warnAsError && isInDevMode()) {
      throw new FatalEffectError(
        `[Dalila] d-html: failed to apply Trusted Types HTML for "${bindingName}" (${error.message}); rendering empty string`
      );
    }
    if (isInDevMode()) {
      throw error;
    }
  }
}

function inheritNestedBindOptions(parent: BindOptions, overrides: BindOptions): BindOptions {
  const next: BindOptions = { ...overrides };

  if (parent.sanitizeHtml !== undefined && overrides.sanitizeHtml === undefined) {
    next.sanitizeHtml = parent.sanitizeHtml;
  }
  if (
    parent.useDefaultSanitizeHtml !== undefined
    && overrides.useDefaultSanitizeHtml === undefined
  ) {
    next.useDefaultSanitizeHtml = parent.useDefaultSanitizeHtml;
  }

  const mergedSecurity = mergeSecurityOptions(parent.security, overrides.security);
  if (mergedSecurity) {
    next.security = mergedSecurity;
  }

  return next;
}

function runSanitizeHtml(
  html: string,
  bindingName: string,
  el: Element,
  options: BindOptions
): string {
  const security = resolveSecurityOptions(options);
  const sanitizer = options.sanitizeHtml;
  const allowFrameworkDefaultSanitizer = options.useDefaultSanitizeHtml !== false;
  const effectiveSanitizer = !allowFrameworkDefaultSanitizer && isFrameworkDefaultSanitizeHtml(sanitizer)
    ? undefined
    : sanitizer;
  const useFrameworkDefaultSanitizer = allowFrameworkDefaultSanitizer
    && (effectiveSanitizer === undefined || isFrameworkDefaultSanitizeHtml(effectiveSanitizer));

  if (security.requireHtmlSanitizerForDHtml && effectiveSanitizer === undefined && !allowFrameworkDefaultSanitizer) {
    warnSecurity(
      `d-html: "${bindingName}" requires a custom sanitizeHtml() when security.requireHtmlSanitizerForDHtml is enabled; rendering empty string`,
      () => clearHtmlSink(el)
    );
    return '';
  }
  const sanitize = useFrameworkDefaultSanitizer
    ? (value: string, context: SanitizeHtmlContext) => runDefaultSanitizeHtml(value, context, security)
    : effectiveSanitizer ?? ((value: string) => value);

  try {
    const sanitized = sanitize(html, {
      sink: 'd-html',
      bindingName,
      element: el,
    });
    return typeof sanitized === 'string' ? sanitized : '';
  } catch (err) {
    warnSecurity(
      `d-html: sanitizeHtml() failed for "${bindingName}" (${err instanceof Error ? err.message : String(err)}); rendering empty string`,
      () => clearHtmlSink(el)
    );
    return '';
  }
}

type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'parse' | 'missing_identifier'; message: string; identifier?: string };

type TransitionRegistry = Map<string, TransitionConfig>;

interface DomPurifyLike {
  sanitize: (html: string, config?: Record<string, unknown>) => string | { toString(): string };
}

const DEFAULT_RUNTIME_SANITIZE_HTML_MARKER = Symbol.for('dalila.runtime.defaultSanitizeHtml');
const DEFAULT_RUNTIME_DOMPURIFY_OPTIONS = Object.freeze({
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style', 'link', 'meta', 'base', 'form'],
  FORBID_ATTR: ['srcdoc', 'style'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
  RETURN_TRUSTED_TYPE: false,
});

export const DEFAULT_RUNTIME_SECURITY: Readonly<RuntimeSecurityOptions> = Object.freeze({
  strict: true,
  blockRawHtmlAttrs: true,
  requireHtmlSanitizerForDHtml: true,
  warnAsError: false,
  trustedTypes: false,
  trustedTypesPolicyName: 'dalila',
  trustedTypesPolicy: null,
});

function createProductionRuntimeSecurityConfig(): RuntimeSecurityOptions {
  return {
    strict: DEFAULT_RUNTIME_SECURITY.strict,
    warnAsError: DEFAULT_RUNTIME_SECURITY.warnAsError,
    trustedTypes: DEFAULT_RUNTIME_SECURITY.trustedTypes,
    trustedTypesPolicyName: DEFAULT_RUNTIME_SECURITY.trustedTypesPolicyName,
    trustedTypesPolicy: DEFAULT_RUNTIME_SECURITY.trustedTypesPolicy,
  };
}

function isDomPurifyLike(value: unknown): value is DomPurifyLike {
  return !!value && typeof (value as DomPurifyLike).sanitize === 'function';
}

function resolveGlobalDomPurify(): DomPurifyLike | null {
  const maybeGlobal = (globalThis as { DOMPurify?: unknown }).DOMPurify;
  if (isDomPurifyLike(maybeGlobal)) {
    return maybeGlobal;
  }

  const maybeFactory = (globalThis as { createDOMPurify?: unknown }).createDOMPurify;
  if (
    typeof maybeFactory === 'function'
    && typeof window !== 'undefined'
    && typeof window.document !== 'undefined'
  ) {
    try {
      const created = (maybeFactory as (host: Window) => unknown)(window);
      if (isDomPurifyLike(created)) {
        return created;
      }
    } catch {
      // Fall back to the built-in sanitizer below.
    }
  }

  return null;
}

function runDefaultSanitizeHtml(
  html: string,
  context: SanitizeHtmlContext,
  security: RuntimeSecurityOptions
): string {
  const domPurify = resolveGlobalDomPurify();
  if (domPurify) {
    try {
      const sanitized = domPurify.sanitize(html, DEFAULT_RUNTIME_DOMPURIFY_OPTIONS);
      return typeof sanitized === 'string' ? sanitized : String(sanitized ?? '');
    } catch (err) {
      warnSecurityRuntime(
        `d-html: default DOMPurify sanitizer failed for "${context.bindingName}" (${err instanceof Error ? err.message : String(err)}); falling back to built-in sanitizer`
      );
    }
  }

  return builtInSanitizeHtml(html, security);
}

export const defaultSanitizeHtml = Object.assign(
  (html: string, context: SanitizeHtmlContext) => runDefaultSanitizeHtml(html, context, DEFAULT_RUNTIME_SECURITY),
  { [DEFAULT_RUNTIME_SANITIZE_HTML_MARKER]: true as const }
) as SanitizeHtmlFn & { [DEFAULT_RUNTIME_SANITIZE_HTML_MARKER]: true };

function isFrameworkDefaultSanitizeHtml(
  sanitizer: SanitizeHtmlFn | undefined
): sanitizer is typeof defaultSanitizeHtml {
  return !!sanitizer && (sanitizer as typeof defaultSanitizeHtml)[DEFAULT_RUNTIME_SANITIZE_HTML_MARKER] === true;
}

function createDefaultRuntimeConfig(): BindOptions {
  return {
    sanitizeHtml: defaultSanitizeHtml,
    useDefaultSanitizeHtml: true,
    security: createProductionRuntimeSecurityConfig(),
  };
}

function describeBindRoot(root: Element): string {
  const explicit =
    root.getAttribute('data-component') ||
    root.getAttribute('data-devtools-label') ||
    root.getAttribute('aria-label') ||
    root.getAttribute('id');
  if (explicit) return String(explicit);

  const className = root.getAttribute('class');
  if (className) {
    const first = className.split(/\s+/).find(Boolean);
    if (first) return `${root.tagName.toLowerCase()}.${first}`;
  }

  return root.tagName.toLowerCase();
}

function bindEffect(target: Element | null | undefined, fn: () => void): void {
  withDevtoolsDomTarget(target ?? null, () => {
    effect(fn);
  });
}

type ExprToken =
  | { type: 'identifier'; value: string }
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'literal'; value: unknown }
  | { type: 'operator'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'bracket'; value: '[' | ']' };

type ExprNode =
  | { type: 'literal'; value: unknown }
  | { type: 'identifier'; name: string }
  | { type: 'unary'; op: string; arg: ExprNode }
  | { type: 'binary'; op: string; left: ExprNode; right: ExprNode }
  | { type: 'conditional'; condition: ExprNode; trueBranch: ExprNode; falseBranch: ExprNode }
  | { type: 'member'; object: ExprNode; property: ExprNode; computed: boolean; optional: boolean };

const expressionCache = new Map<string, ExprNode | null>();
type TemplatePlanCacheEntry = {
  plan: InterpolationTemplatePlan;
  lastUsedAt: number;
  expiresAt: number;
};

type TemplatePlanCacheConfig = {
  maxEntries: number;
  ttlMs: number;
};

const templateInterpolationPlanCache = new Map<string, TemplatePlanCacheEntry>();
const TEMPLATE_PLAN_CACHE_MAX_ENTRIES = 250;
const TEMPLATE_PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const TEMPLATE_PLAN_CACHE_CONFIG_KEY = '__dalila_bind_template_cache';

type CompiledExpression =
  | { kind: 'fast_path'; ast: ExprNode }
  | { kind: 'parser'; expression: string };

type TextInterpolationSegment =
  | { type: 'text'; value: string }
  | { type: 'expr'; rawToken: string; expression: string; compiled: CompiledExpression };

type TextInterpolationPlan = {
  path: number[];
  segments: TextInterpolationSegment[];
};

type InterpolationTemplatePlan = {
  bindings: TextInterpolationPlan[];
  totalExpressions: number;
  fastPathExpressions: number;
};

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resolveListRenderPriority(): SchedulerPriority {
  return 'low';
}

function coerceCacheSetting(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function resolveTemplatePlanCacheConfig(options: BindOptions): TemplatePlanCacheConfig {
  const globalRaw = (globalThis as Record<string, unknown>)[TEMPLATE_PLAN_CACHE_CONFIG_KEY] as
    | { maxEntries?: unknown; ttlMs?: unknown }
    | undefined;
  const fromOptions = options.templatePlanCache;

  const maxEntries = coerceCacheSetting(
    fromOptions?.maxEntries ?? globalRaw?.maxEntries,
    TEMPLATE_PLAN_CACHE_MAX_ENTRIES
  );
  const ttlMs = coerceCacheSetting(
    fromOptions?.ttlMs ?? globalRaw?.ttlMs,
    TEMPLATE_PLAN_CACHE_TTL_MS
  );

  return { maxEntries, ttlMs };
}

function compileFastPathExpression(expression: string): ExprNode | null {
  let i = 0;
  const literalKeywords: Record<string, unknown> = {
    true: true,
    false: false,
    null: null,
    undefined: undefined,
  };

  const skipSpaces = (): void => {
    while (i < expression.length && /\s/.test(expression[i])) i++;
  };

  const readIdentifier = (): string | null => {
    if (i >= expression.length || !isIdentStart(expression[i])) return null;
    const start = i;
    i++;
    while (i < expression.length && isIdentPart(expression[i])) i++;
    return expression.slice(start, i);
  };

  const readNumericIndex = (): number | null => {
    if (i >= expression.length || !/[0-9]/.test(expression[i])) return null;
    const start = i;
    i++;
    while (i < expression.length && /[0-9]/.test(expression[i])) i++;
    return Number(expression.slice(start, i));
  };

  skipSpaces();
  const root = readIdentifier();
  if (!root) return null;

  if (Object.prototype.hasOwnProperty.call(literalKeywords, root)) {
    skipSpaces();
    if (i === expression.length) {
      return { type: 'literal', value: literalKeywords[root] };
    }
    // Keep parser behavior for keyword literals followed by extra syntax.
    return null;
  }

  let node: ExprNode = { type: 'identifier', name: root };
  skipSpaces();

  while (i < expression.length) {
    if (expression[i] === '.') {
      i++;
      skipSpaces();
      const prop = readIdentifier();
      if (!prop) return null;
      node = {
        type: 'member',
        object: node,
        property: { type: 'literal', value: prop },
        computed: false,
        optional: false,
      };
      skipSpaces();
      continue;
    }

    if (expression[i] === '[') {
      i++;
      skipSpaces();
      const index = readNumericIndex();
      if (index === null) return null;
      skipSpaces();
      if (expression[i] !== ']') return null;
      i++;
      node = {
        type: 'member',
        object: node,
        property: { type: 'literal', value: index },
        computed: true,
        optional: false,
      };
      skipSpaces();
      continue;
    }

    return null;
  }

  return node;
}

function isIdentStart(ch: string): boolean {
  return /[a-zA-Z_$]/.test(ch);
}

function isIdentPart(ch: string): boolean {
  return /[a-zA-Z0-9_$]/.test(ch);
}

function tokenizeExpression(input: string): ExprToken[] {
  const tokens: ExprToken[] = [];
  let i = 0;

  const pushOp = (op: string): void => {
    tokens.push({ type: 'operator', value: op });
    i += op.length;
  };

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (isIdentStart(ch)) {
      const start = i;
      i++;
      while (i < input.length && isIdentPart(input[i])) i++;
      const ident = input.slice(start, i);
      if (ident === 'true') tokens.push({ type: 'literal', value: true });
      else if (ident === 'false') tokens.push({ type: 'literal', value: false });
      else if (ident === 'null') tokens.push({ type: 'literal', value: null });
      else if (ident === 'undefined') tokens.push({ type: 'literal', value: undefined });
      else tokens.push({ type: 'identifier', value: ident });
      continue;
    }

    if (/[0-9]/.test(ch)) {
      const start = i;
      i++;
      while (i < input.length && /[0-9]/.test(input[i])) i++;
      if (input[i] === '.') {
        i++;
        while (i < input.length && /[0-9]/.test(input[i])) i++;
      }
      const num = Number(input.slice(start, i));
      tokens.push({ type: 'number', value: num });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let value = '';
      let closed = false;
      while (i < input.length) {
        const c = input[i];
        if (c === '\\') {
          const next = input[i + 1];
          if (next === undefined) break;
          value += next;
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      if (!closed) {
        throw new Error('Unterminated string literal');
      }
      tokens.push({ type: 'string', value });
      continue;
    }

    const three = input.slice(i, i + 3);
    const two = input.slice(i, i + 2);

    if (three === '===' || three === '!==') {
      pushOp(three);
      continue;
    }
    if (
      two === '&&' || two === '||' || two === '??' || two === '?.' || two === '==' || two === '!='
      || two === '>=' || two === '<='
    ) {
      pushOp(two);
      continue;
    }
    if ('+-*/%!<>.?:'.includes(ch)) {
      pushOp(ch);
      continue;
    }
    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch });
      i++;
      continue;
    }
    if (ch === '[' || ch === ']') {
      tokens.push({ type: 'bracket', value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected token "${ch}"`);
  }

  return tokens;
}

function parseExpression(input: string): ExprNode {
  const tokens = tokenizeExpression(input);
  let index = 0;

  const peek = (): ExprToken | undefined => tokens[index];
  const next = (): ExprToken | undefined => tokens[index++];

  const matchOperator = (...ops: string[]): string | null => {
    const token = peek();
    if (token?.type === 'operator' && ops.includes(token.value)) {
      index++;
      return token.value;
    }
    return null;
  };

  const expectOperator = (value: string): void => {
    const token = next();
    if (!token || token.type !== 'operator' || token.value !== value) {
      throw new Error(`Expected "${value}"`);
    }
  };

  const expectParen = (value: ')' | '('): void => {
    const token = next();
    if (!token || token.type !== 'paren' || token.value !== value) {
      throw new Error(`Expected "${value}"`);
    }
  };

  const expectBracket = (value: ']' | '['): void => {
    const token = next();
    if (!token || token.type !== 'bracket' || token.value !== value) {
      throw new Error(`Expected "${value}"`);
    }
  };

  const parsePrimary = (): ExprNode => {
    const token = next();
    if (!token) throw new Error('Unexpected end of expression');

    if (token.type === 'number') return { type: 'literal', value: token.value };
    if (token.type === 'string') return { type: 'literal', value: token.value };
    if (token.type === 'literal') return { type: 'literal', value: token.value };
    if (token.type === 'identifier') return { type: 'identifier', name: token.value };
    if (token.type === 'paren' && token.value === '(') {
      const expr = parseConditional();
      expectParen(')');
      return expr;
    }

    throw new Error('Invalid expression');
  };

  const parseMember = (): ExprNode => {
    let node = parsePrimary();

    while (true) {
      const token = peek();
      if (token?.type === 'operator' && token.value === '.') {
        next();
        const prop = next();
        if (!prop || prop.type !== 'identifier') {
          throw new Error('Expected identifier after "."');
        }
        node = {
          type: 'member',
          object: node,
          property: { type: 'literal', value: prop.value },
          computed: false,
          optional: false,
        };
        continue;
      }

      if (token?.type === 'operator' && token.value === '?.') {
        next();
        const nextToken = peek();
        if (nextToken?.type === 'identifier') {
          const prop = nextToken.value;
          next();
          node = {
            type: 'member',
            object: node,
            property: { type: 'literal', value: prop },
            computed: false,
            optional: true,
          };
          continue;
        }
        if (nextToken?.type === 'bracket' && nextToken.value === '[') {
          expectBracket('[');
          const propertyExpr = parseConditional();
          expectBracket(']');
          node = {
            type: 'member',
            object: node,
            property: propertyExpr,
            computed: true,
            optional: true,
          };
          continue;
        }
        throw new Error('Expected identifier or "[" after "?."');
      }

      if (token?.type === 'bracket' && token.value === '[') {
        expectBracket('[');
        const propertyExpr = parseConditional();
        expectBracket(']');
        node = {
          type: 'member',
          object: node,
          property: propertyExpr,
          computed: true,
          optional: false,
        };
        continue;
      }

      break;
    }

    return node;
  };

  const parseUnary = (): ExprNode => {
    const op = matchOperator('!', '+', '-');
    if (op) {
      return { type: 'unary', op, arg: parseUnary() };
    }
    return parseMember();
  };

  const parseMultiplicative = (): ExprNode => {
    let node = parseUnary();
    while (true) {
      const op = matchOperator('*', '/', '%');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseUnary() };
    }
    return node;
  };

  const parseAdditive = (): ExprNode => {
    let node = parseMultiplicative();
    while (true) {
      const op = matchOperator('+', '-');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseMultiplicative() };
    }
    return node;
  };

  const parseComparison = (): ExprNode => {
    let node = parseAdditive();
    while (true) {
      const op = matchOperator('<', '>', '<=', '>=');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseAdditive() };
    }
    return node;
  };

  const parseEquality = (): ExprNode => {
    let node = parseComparison();
    while (true) {
      const op = matchOperator('==', '!=', '===', '!==');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseComparison() };
    }
    return node;
  };

  const parseLogicalAnd = (): ExprNode => {
    let node = parseEquality();
    while (true) {
      const op = matchOperator('&&');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseEquality() };
    }
    return node;
  };

  const parseLogicalOr = (): ExprNode => {
    let node = parseLogicalAnd();
    while (true) {
      const op = matchOperator('||');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseLogicalAnd() };
    }
    return node;
  };

  const parseNullish = (): ExprNode => {
    let node = parseLogicalOr();
    while (true) {
      const op = matchOperator('??');
      if (!op) break;
      node = { type: 'binary', op, left: node, right: parseLogicalOr() };
    }
    return node;
  };

  const parseConditional = (): ExprNode => {
    const condition = parseNullish();
    if (!matchOperator('?')) return condition;

    const trueBranch = parseConditional();
    expectOperator(':');
    const falseBranch = parseConditional();
    return { type: 'conditional', condition, trueBranch, falseBranch };
  };

  const root = parseConditional();
  if (index < tokens.length) {
    throw new Error('Unexpected token after end of expression');
  }
  return root;
}

function evalExpressionAst(node: ExprNode, ctx: BindContext): EvalResult {
  const evalNode = (current: ExprNode): EvalResult => {
    if (current.type === 'literal') return { ok: true, value: current.value };

    if (current.type === 'identifier') {
      if (!(current.name in ctx)) {
        return {
          ok: false,
          reason: 'missing_identifier',
          message: `Text interpolation: "${current.name}" not found in context`,
          identifier: current.name,
        };
      }
      return { ok: true, value: resolve(ctx[current.name]) };
    }

    if (current.type === 'member') {
      const objectEval = evalNode(current.object);
      if (!objectEval.ok) return objectEval;

      const obj = objectEval.value;
      if (obj == null) return { ok: true, value: undefined };

      if (!current.computed) {
        const key = (current.property as { type: 'literal'; value: unknown }).value;
        return { ok: true, value: resolve((obj as Record<string, unknown>)[String(key)]) };
      }

      const propEval = evalNode(current.property);
      if (!propEval.ok) return propEval;
      return { ok: true, value: resolve((obj as Record<string, unknown>)[String(propEval.value)]) };
    }

    if (current.type === 'unary') {
      const arg = evalNode(current.arg);
      if (!arg.ok) return arg;
      if (current.op === '!') return { ok: true, value: !arg.value };
      if (current.op === '+') return { ok: true, value: +(arg.value as any) };
      return { ok: true, value: -(arg.value as any) };
    }

    if (current.type === 'conditional') {
      const condition = evalNode(current.condition);
      if (!condition.ok) return condition;
      return condition.value ? evalNode(current.trueBranch) : evalNode(current.falseBranch);
    }

    const left = evalNode(current.left);
    if (!left.ok) return left;

    if (current.op === '&&') {
      return left.value ? evalNode(current.right) : left;
    }
    if (current.op === '||') {
      return left.value ? left : evalNode(current.right);
    }
    if (current.op === '??') {
      return left.value == null ? evalNode(current.right) : left;
    }

    const right = evalNode(current.right);
    if (!right.ok) return right;

    switch (current.op) {
      case '+': return { ok: true, value: (left.value as any) + (right.value as any) };
      case '-': return { ok: true, value: (left.value as any) - (right.value as any) };
      case '*': return { ok: true, value: (left.value as any) * (right.value as any) };
      case '/': return { ok: true, value: (left.value as any) / (right.value as any) };
      case '%': return { ok: true, value: (left.value as any) % (right.value as any) };
      case '<': return { ok: true, value: (left.value as any) < (right.value as any) };
      case '>': return { ok: true, value: (left.value as any) > (right.value as any) };
      case '<=': return { ok: true, value: (left.value as any) <= (right.value as any) };
      case '>=': return { ok: true, value: (left.value as any) >= (right.value as any) };
      case '==': return { ok: true, value: (left.value as any) == (right.value as any) };
      case '!=': return { ok: true, value: (left.value as any) != (right.value as any) };
      case '===': return { ok: true, value: (left.value as any) === (right.value as any) };
      case '!==': return { ok: true, value: (left.value as any) !== (right.value as any) };
      default:
        return { ok: false, reason: 'parse', message: `Unsupported operator "${current.op}"` };
    }
  };

  return evalNode(node);
}

function compileInterpolationExpression(expression: string): CompiledExpression {
  const fastPathAst = compileFastPathExpression(expression);
  if (fastPathAst) {
    return { kind: 'fast_path', ast: fastPathAst };
  }

  return { kind: 'parser', expression };
}

function parseInterpolationExpression(expression: string): { ok: true; ast: ExprNode } | { ok: false; message: string } {
  let ast = expressionCache.get(expression);
  if (ast === undefined) {
    try {
      ast = parseExpression(expression);
      expressionCache.set(expression, ast);
    } catch (err) {
      expressionCache.set(expression, null);
      return {
        ok: false,
        message: `Text interpolation parse error in "{${expression}}": ${(err as Error).message}`,
      };
    }
  }

  if (ast === null) {
    return {
      ok: false,
      message: `Text interpolation parse error in "{${expression}}"`,
    };
  }

  return { ok: true, ast };
}

function evaluateExpressionRaw(node: ExprNode, ctx: BindContext): EvalResult {
  if (node.type === 'literal') return { ok: true, value: node.value };

  if (node.type === 'identifier') {
    if (!(node.name in ctx)) {
      return {
        ok: false,
        reason: 'missing_identifier',
        message: `Text interpolation: "${node.name}" not found in context`,
        identifier: node.name,
      };
    }
    return { ok: true, value: ctx[node.name] };
  }

  if (node.type === 'member') {
    const objectEval = evaluateExpressionRaw(node.object, ctx);
    if (!objectEval.ok) return objectEval;

    const obj = objectEval.value;
    if (obj == null) return { ok: true, value: undefined };

    if (!node.computed) {
      const key = (node.property as { type: 'literal'; value: unknown }).value;
      return { ok: true, value: (obj as Record<string, unknown>)[String(key)] };
    }

    const propEval = evalExpressionAst(node.property, ctx);
    if (!propEval.ok) return propEval;
    return { ok: true, value: (obj as Record<string, unknown>)[String(propEval.value)] };
  }

  // For non-member expressions, the regular evaluator is fine.
  return evalExpressionAst(node, ctx);
}

function expressionDependsOnReactiveSource(node: ExprNode, ctx: BindContext): boolean {
  if (node.type === 'identifier') {
    const value = ctx[node.name];
    return isSignal(value) || (typeof value === 'function' && (value as Function).length === 0);
  }
  if (node.type === 'literal') return false;
  if (node.type === 'unary') return expressionDependsOnReactiveSource(node.arg, ctx);
  if (node.type === 'binary') {
    return expressionDependsOnReactiveSource(node.left, ctx) || expressionDependsOnReactiveSource(node.right, ctx);
  }
  if (node.type === 'conditional') {
    return expressionDependsOnReactiveSource(node.condition, ctx)
      || expressionDependsOnReactiveSource(node.trueBranch, ctx)
      || expressionDependsOnReactiveSource(node.falseBranch, ctx);
  }
  if (node.type === 'member') {
    if (
      expressionDependsOnReactiveSource(node.object, ctx)
      || (node.computed ? expressionDependsOnReactiveSource(node.property, ctx) : false)
    ) {
      return true;
    }

    const memberValue = evaluateExpressionRaw(node, ctx);
    if (!memberValue.ok) return false;
    const value = memberValue.value;
    return isSignal(value) || (typeof value === 'function' && (value as Function).length === 0);
  }
  return false;
}

// ============================================================================
// Default Options
// ============================================================================

const DEFAULT_EVENTS = ['click', 'input', 'change', 'submit', 'keydown', 'keyup'];
const DEFAULT_RAW_TEXT_SELECTORS = 'pre, code';

const COMPONENT_REGISTRY_KEY = '__dalila_component_registry__';
const COMPONENT_EMIT_KEY = '__dalila_component_emit__';

// ============================================================================
// Text Interpolation
// ============================================================================

/**
 * Build interpolation segments for one text node.
 */
function buildTextInterpolationSegments(text: string): TextInterpolationSegment[] {
  const regex = /\{([^{}]+)\}/g;
  const segments: TextInterpolationSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before) {
      segments.push({ type: 'text', value: before });
    }

    const rawToken = match[0];
    const expression = match[1].trim();
    segments.push({
      type: 'expr',
      rawToken,
      expression,
      compiled: compileInterpolationExpression(expression),
    });

    cursor = match.index + match[0].length;
  }

  const after = text.slice(cursor);
  if (after) {
    segments.push({ type: 'text', value: after });
  }

  return segments;
}

function getNodePath(root: Element, node: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = node;

  while (current && current !== root) {
    const parentNode: Node | null = current.parentNode as Node | null;
    if (!parentNode) return null;
    path.push(Array.prototype.indexOf.call(parentNode.childNodes, current));
    current = parentNode;
  }

  if (current !== root) return null;
  path.reverse();
  return path;
}

function getNodeAtPath(root: Element, path: number[]): Node | null {
  let current: Node = root;
  for (const index of path) {
    const child = current.childNodes[index];
    if (!child) return null;
    current = child;
  }
  return current;
}

function fnv1aStep(hash: number, value: number): number {
  let h = hash ^ value;
  h = Math.imul(h, 0x01000193);
  return h >>> 0;
}

function fnv1aString(hash: number, value: string): number {
  let h = hash;
  for (let i = 0; i < value.length; i++) {
    h = fnv1aStep(h, value.charCodeAt(i));
  }
  return h;
}

function hashNodeStructure(hash: number, node: Node): number {
  let h = fnv1aStep(hash, node.nodeType);

  if (node.nodeType === 1) {
    const el = node as Element;
    h = fnv1aString(h, el.tagName);
    h = fnv1aStep(h, el.attributes.length);
    const attrs = Array.from(el.attributes)
      .map((attr) => `${attr.name}=${attr.value}`)
      .sort();
    for (const attr of attrs) {
      h = fnv1aString(h, attr);
    }
  } else if (node.nodeType === 3) {
    h = fnv1aString(h, (node as Text).data);
  } else if (node.nodeType === 8) {
    h = fnv1aString(h, (node as Comment).data);
  }

  h = fnv1aStep(h, node.childNodes.length);
  for (let i = 0; i < node.childNodes.length; i++) {
    h = hashNodeStructure(h, node.childNodes[i]);
  }
  return h;
}

function createInterpolationTemplateSignature(root: Element, rawTextSelectors: string): string {
  let hash = 0x811c9dc5;
  hash = fnv1aString(hash, rawTextSelectors);
  hash = fnv1aString(hash, root.tagName);
  hash = hashNodeStructure(hash, root);
  return `${root.tagName}:${hash.toString(16)}`;
}

function createInterpolationTemplatePlan(
  root: Element,
  rawTextSelectors: string
): InterpolationTemplatePlan {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const bindings: TextInterpolationPlan[] = [];
  let totalExpressions = 0;
  let fastPathExpressions = 0;
  const textBoundary = root.closest('[data-dalila-internal-bound]');

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (parent && parent.closest(rawTextSelectors)) continue;
    if (parent) {
      const bound = parent.closest('[data-dalila-internal-bound]');
      if (bound !== textBoundary) continue;
    }
    if (!node.data.includes('{')) continue;

    const segments = buildTextInterpolationSegments(node.data);
    const hasExpression = segments.some((segment) => segment.type === 'expr');
    if (!hasExpression) continue;
    const path = getNodePath(root, node);
    if (!path) continue;

    for (const segment of segments) {
      if (segment.type !== 'expr') continue;
      totalExpressions++;
      if (segment.compiled.kind === 'fast_path') fastPathExpressions++;
    }

    bindings.push({ path, segments });
  }

  return {
    bindings,
    totalExpressions,
    fastPathExpressions,
  };
}

function resolveCompiledExpression(
  compiled: CompiledExpression
): { ok: true; ast: ExprNode } | { ok: false; message: string } {
  if (compiled.kind === 'fast_path') {
    return { ok: true, ast: compiled.ast };
  }
  return parseInterpolationExpression(compiled.expression);
}

function pruneTemplatePlanCache(now: number, config: TemplatePlanCacheConfig): void {
  // 1) Remove expired plans first.
  for (const [key, entry] of templateInterpolationPlanCache) {
    if (entry.expiresAt <= now) {
      templateInterpolationPlanCache.delete(key);
    }
  }

  // 2) Enforce LRU cap.
  while (templateInterpolationPlanCache.size > config.maxEntries) {
    const oldestKey = templateInterpolationPlanCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    templateInterpolationPlanCache.delete(oldestKey);
  }
}

function getCachedTemplatePlan(
  signature: string,
  now: number,
  config: TemplatePlanCacheConfig
): InterpolationTemplatePlan | null {
  if (config.maxEntries === 0 || config.ttlMs === 0) return null;
  const entry = templateInterpolationPlanCache.get(signature);
  if (!entry) return null;

  if (entry.expiresAt <= now) {
    templateInterpolationPlanCache.delete(signature);
    return null;
  }

  // Refresh recency and TTL window.
  templateInterpolationPlanCache.delete(signature);
  templateInterpolationPlanCache.set(signature, {
    plan: entry.plan,
    lastUsedAt: now,
    expiresAt: now + config.ttlMs,
  });

  return entry.plan;
}

function setCachedTemplatePlan(
  signature: string,
  plan: InterpolationTemplatePlan,
  now: number,
  config: TemplatePlanCacheConfig
): void {
  if (config.maxEntries === 0 || config.ttlMs === 0) return;
  templateInterpolationPlanCache.set(signature, {
    plan,
    lastUsedAt: now,
    expiresAt: now + config.ttlMs,
  });
  pruneTemplatePlanCache(now, config);
}

function bindTextNodeFromPlan(
  node: Text,
  plan: TextInterpolationPlan,
  ctx: BindContext
): void {
  const frag = document.createDocumentFragment();

  for (const segment of plan.segments) {
    if (segment.type === 'text') {
      frag.appendChild(document.createTextNode(segment.value));
      continue;
    }

    const textNode = document.createTextNode('');
    let warnedParse = false;
    let warnedMissingIdentifier = false;
    const applyResult = (result: EvalResult): void => {
      if (!result.ok) {
        if (result.reason === 'parse') {
          if (!warnedParse) {
            warn(result.message);
            warnedParse = true;
          }
        } else if (!warnedMissingIdentifier) {
          warn(result.message);
          warnedMissingIdentifier = true;
        }

        // Backward compatibility for "{identifier}" missing from context:
        // preserve the literal token exactly as before.
        const simpleIdent = segment.expression.match(/^[a-zA-Z_$][\w$]*$/);
        if (result.reason === 'missing_identifier' && simpleIdent && result.identifier === simpleIdent[0]) {
          textNode.data = segment.rawToken;
        } else {
          textNode.data = '';
        }
        return;
      }

      textNode.data = result.value == null ? '' : String(result.value);
    };

    const parsed = resolveCompiledExpression(segment.compiled);
    if (!parsed.ok) {
      applyResult({ ok: false, reason: 'parse', message: parsed.message });
      frag.appendChild(textNode);
      continue;
    }

    // First render is synchronous to avoid empty text until microtask flush.
    applyResult(evalExpressionAst(parsed.ast, ctx));

    // Only schedule reactive updates when expression depends on reactive sources.
    if (expressionDependsOnReactiveSource(parsed.ast, ctx)) {
      bindEffect(node.parentElement, () => {
        applyResult(evalExpressionAst(parsed.ast, ctx));
      });
    }

    frag.appendChild(textNode);
  }

  if (node.parentNode) {
    node.parentNode.replaceChild(frag, node);
  }
}

function bindTextInterpolation(
  root: Element,
  ctx: BindContext,
  rawTextSelectors: string,
  cacheConfig: TemplatePlanCacheConfig
): void {
  const signature = createInterpolationTemplateSignature(root, rawTextSelectors);
  const now = nowMs();
  let plan = getCachedTemplatePlan(signature, now, cacheConfig);

  if (!plan) {
    plan = createInterpolationTemplatePlan(root, rawTextSelectors);
    setCachedTemplatePlan(signature, plan, now, cacheConfig);
  }

  if (plan.bindings.length === 0) return;

  const nodesToBind: Array<{ node: Text; binding: TextInterpolationPlan }> = [];
  for (const binding of plan.bindings) {
    const target = getNodeAtPath(root, binding.path);
    if (target && target.nodeType === 3) {
      nodesToBind.push({ node: target as Text, binding });
    }
  }

  for (const item of nodesToBind) {
    bindTextNodeFromPlan(item.node, item.binding, ctx);
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

      const wrappedHandler: EventListener = function (this: EventTarget, event: Event) {
        return withSchedulerPriority(
          'high',
          () => (handler as (this: EventTarget, event: Event) => unknown).call(this, event),
          { warnOnAsync: false }
        );
      };

      el.addEventListener(eventName, wrappedHandler);
      cleanups.push(() => el.removeEventListener(eventName, wrappedHandler));
    }
  }
}

// ============================================================================
// d-emit-<event> Directive
// ============================================================================

/**
 * Bind all [d-emit-<event>] directives within root.
 * Only active inside component contexts (where COMPONENT_EMIT_KEY exists).
 * Works inside d-each because child contexts inherit via prototype chain.
 */
function bindEmit(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const emitFn = ctx[COMPONENT_EMIT_KEY];
  if (typeof emitFn !== 'function') return;

  const elements = qsaIncludingRoot(root, '*');
  for (const el of elements) {
    for (const attrNode of Array.from(el.attributes)) {
      if (!attrNode.name.startsWith('d-emit-')) continue;
      if (attrNode.name === 'd-emit-value') continue;
      const eventName = attrNode.name.slice('d-emit-'.length).trim();
      const attr = attrNode.name;

      if (!eventName) {
        warn(`${attr}: missing DOM event name`);
        continue;
      }

      const emitName = normalizeBinding(attrNode.value);
      if (!emitName) {
        warn(`${attr}: empty value ignored`);
        continue;
      }

      const payloadExpr = el.getAttribute('d-emit-value');
      const payloadRaw = payloadExpr?.trim();
      let payloadAst: ExprNode | null = null;
      if (payloadRaw) {
        try {
          payloadAst = parseExpression(payloadRaw);
        } catch (err) {
          warn(`${attr}: invalid d-emit-value="${payloadRaw}" (${(err as Error).message})`);
          continue;
        }
      } else if (payloadExpr !== null) {
        warn(`${attr}: d-emit-value is empty; emitting DOM Event instead`);
      }

      if (emitName.includes(':')) {
        warn(`${attr}: ":" syntax is no longer supported. Use d-emit-value instead.`);
        continue;
      }

      const handler = (e: Event) => {
        if (payloadAst) {
          const eventCtx = Object.create(ctx) as BindContext;
          eventCtx.$event = e;
          const result = evalExpressionAst(payloadAst, eventCtx);
          (emitFn as Function)(emitName, result.ok ? result.value : undefined);
        } else {
          (emitFn as Function)(emitName, e);
        }
      };

      el.addEventListener(eventName, handler);
      cleanups.push(() => el.removeEventListener(eventName, handler));
    }
  }
}

function createTransitionRegistry(transitions: TransitionConfig[] | undefined): TransitionRegistry {
  const registry: TransitionRegistry = new Map();
  if (!transitions) return registry;

  for (const cfg of transitions) {
    if (!cfg || typeof cfg !== 'object') continue;
    const name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
    if (!name) {
      warn('configure({ transitions }): each transition must have a non-empty "name"');
      continue;
    }
    registry.set(name, cfg);
  }

  return registry;
}

function readTransitionNames(el: Element): string[] {
  const raw = el.getAttribute('d-transition');
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map(v => v.trim())
    .filter(Boolean);
}

function parseCssTimeToMs(value: string): number {
  const token = value.trim();
  if (!token) return 0;
  if (token.endsWith('ms')) {
    const ms = Number(token.slice(0, -2));
    return Number.isFinite(ms) ? Math.max(0, ms) : 0;
  }
  if (token.endsWith('s')) {
    const seconds = Number(token.slice(0, -1));
    return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
  }
  const fallback = Number(token);
  return Number.isFinite(fallback) ? Math.max(0, fallback) : 0;
}

function getTransitionDurationMs(el: HTMLElement, names: string[], registry: TransitionRegistry): number {
  let durationFromRegistry = 0;
  for (const name of names) {
    const cfg = registry.get(name);
    if (!cfg) continue;
    if (typeof cfg.duration === 'number' && Number.isFinite(cfg.duration)) {
      durationFromRegistry = Math.max(durationFromRegistry, Math.max(0, cfg.duration));
    }
  }

  let durationFromCss = 0;
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    const durations = style.transitionDuration.split(',');
    const delays = style.transitionDelay.split(',');
    const total = Math.max(durations.length, delays.length);
    for (let i = 0; i < total; i++) {
      const duration = parseCssTimeToMs(durations[Math.min(i, durations.length - 1)] ?? '0ms');
      const delay = parseCssTimeToMs(delays[Math.min(i, delays.length - 1)] ?? '0ms');
      durationFromCss = Math.max(durationFromCss, duration + delay);
    }
  }

  return Math.max(durationFromRegistry, durationFromCss);
}

function runTransitionHook(
  phase: 'enter' | 'leave',
  el: HTMLElement,
  names: string[],
  registry: TransitionRegistry
): void {
  for (const name of names) {
    const cfg = registry.get(name);
    const hook = phase === 'enter' ? cfg?.enter : cfg?.leave;
    if (typeof hook !== 'function') continue;
    try {
      hook(el);
    } catch (err) {
      warn(`d-transition (${name}): ${phase} hook failed (${(err as Error).message || String(err)})`);
    }
  }
}

function createTransitionController(
  el: HTMLElement,
  registry: TransitionRegistry,
  cleanups: DisposeFunction[]
): {
  hasTransition: boolean;
  enter: () => void;
  leave: (onDone: () => void) => void;
} {
  const names = readTransitionNames(el);
  const hasTransition = names.length > 0;
  let token = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelPending = () => {
    token++;
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  cleanups.push(cancelPending);

  const enter = () => {
    cancelPending();
    if (!hasTransition) return;
    el.removeAttribute('data-leave');
    el.setAttribute('data-enter', '');
    runTransitionHook('enter', el, names, registry);
  };

  const leave = (onDone: () => void) => {
    cancelPending();
    if (!hasTransition) {
      onDone();
      return;
    }

    const current = ++token;
    el.removeAttribute('data-enter');
    el.setAttribute('data-leave', '');
    runTransitionHook('leave', el, names, registry);

    const durationMs = getTransitionDurationMs(el, names, registry);
    if (durationMs <= 0) {
      if (current === token) onDone();
      return;
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      if (current !== token) return;
      onDone();
    }, durationMs);
  };

  return { hasTransition, enter, leave };
}

function bindPortal(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  bindPortalDirective(root, ctx, cleanups, {
    qsaIncludingRoot,
    parseExpression,
    evalExpressionAst,
    resolve,
    warn,
    bindEffect,
  });
}

// ============================================================================
// d-lazy Directive
// ============================================================================

/**
 * Bind all [d-lazy] directives within root.
 * Loads a lazy component when it enters the viewport.
 */
function bindLazy(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  refs: Map<string, Element>,
  events: string[],
  options: BindOptions
): void {
  runBindLazyDirective(root, ctx, cleanups, refs, events, options, {
    qsaIncludingRoot,
    normalizeBinding,
    warn,
    warnRawHtmlSinkHeuristic,
    resolveSecurityOptions,
    bind,
    bindEffect,
    inheritNestedBindOptions,
  });
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
  cleanups: DisposeFunction[],
  transitionRegistry: TransitionRegistry
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
    const transitions = createTransitionController(htmlEl, transitionRegistry, cleanups);

    // Apply initial state synchronously to avoid FOUC (flash of unstyled content)
    const initialValue = !!resolve(binding);
    if (initialValue) {
      htmlEl.style.display = '';
      if (transitions.hasTransition) {
        htmlEl.removeAttribute('data-leave');
        htmlEl.setAttribute('data-enter', '');
      }
    } else {
      htmlEl.style.display = 'none';
      htmlEl.removeAttribute('data-enter');
      htmlEl.removeAttribute('data-leave');
    }

    // Then create reactive effect to keep it updated
    bindEffect(htmlEl, () => {
      const value = !!resolve(binding);
      if (value) {
        htmlEl.style.display = '';
        transitions.enter();
        return;
      }
      transitions.leave(() => {
        htmlEl.style.display = 'none';
      });
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

    // Apply initial state synchronously to avoid FOUC
    const applyMatch = () => {
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
    };

    // Apply initial state
    applyMatch();

    // Then create reactive effect to keep it updated
    bindEffect(el, () => {
      applyMatch();
    });
  }
}

// ============================================================================
// d-virtual-each Directive
// ============================================================================

export function getVirtualListController(target: Element | null): VirtualListController | null {
  return getVirtualListControllerFromList(target);
}

export function scrollToVirtualIndex(
  target: Element | null,
  index: number,
  options?: VirtualScrollToIndexOptions
): boolean {
  return scrollToVirtualIndexFromList(target, index, options);
}

/**
 * Bind all [d-virtual-each] directives within root.
 *
 * Supports:
 * - Fixed item height (`d-virtual-item-height`)
 * - Dynamic item height (`d-virtual-measure="auto"`)
 * - Infinite scroll callback (`d-virtual-infinite`)
 * - Parent element as vertical scroll container
 */
function bindVirtualEach(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  options: BindOptions
): void {
  runBindVirtualEachDirective(root, ctx, cleanups, options, {
    qsaIncludingRoot,
    normalizeBinding,
    warn,
    resolve,
    bind,
    bindEffect,
    inheritNestedBindOptions,
    isSignal,
    resolveListRenderPriority,
  });
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
  cleanups: DisposeFunction[],
  options: BindOptions
): void {
  runBindEachDirective(root, ctx, cleanups, options, {
    qsaIncludingRoot,
    normalizeBinding,
    warn,
    resolve,
    bind,
    bindEffect,
    inheritNestedBindOptions,
    isSignal,
    resolveListRenderPriority,
  });
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
  cleanups: DisposeFunction[],
  transitionRegistry: TransitionRegistry
): void {
  runBindIfDirective(root, ctx, cleanups, transitionRegistry, {
    qsaIncludingRoot,
    normalizeBinding,
    warn,
    resolve,
    bindEffect,
    createTransitionController,
    syncPortalElement,
  });
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
  cleanups: DisposeFunction[],
  options: BindOptions
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
      bindEffect(htmlEl, () => {
        const v = binding();
        const html = v == null ? '' : String(v);
        const sanitized = runSanitizeHtml(html, bindingName, htmlEl, options);
        const security = resolveSecurityOptions(options);
        const customSanitizeHtml = options.sanitizeHtml;
        const heuristicSourceHtml = security.warnAsError
          || (customSanitizeHtml && !isFrameworkDefaultSanitizeHtml(customSanitizeHtml))
          ? sanitized
          : html;
        warnRawHtmlSinkHeuristic(
          'd-html',
          bindingName,
          heuristicSourceHtml,
          () => clearHtmlSink(htmlEl)
        );
        applyHtmlSinkValue(htmlEl, sanitized, bindingName, options);
      });
    } else {
      const v = resolve(binding);
      const html = v == null ? '' : String(v);
      const sanitized = runSanitizeHtml(html, bindingName, htmlEl, options);
      const security = resolveSecurityOptions(options);
      const customSanitizeHtml = options.sanitizeHtml;
      const heuristicSourceHtml = security.warnAsError
        || (customSanitizeHtml && !isFrameworkDefaultSanitizeHtml(customSanitizeHtml))
        ? sanitized
        : html;
      warnRawHtmlSinkHeuristic(
        'd-html',
        bindingName,
        heuristicSourceHtml,
        () => clearHtmlSink(htmlEl)
      );
      applyHtmlSinkValue(htmlEl, sanitized, bindingName, options);
    }
  }
}

// ============================================================================
// d-text Directive
// ============================================================================

/**
 * Bind all [d-text] directives within root.
 * Sets textContent — safe from XSS by design (no HTML parsing).
 * Counterpart to d-html which renders raw HTML.
 */
function bindText(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-text]');

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-text'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-text: "${bindingName}" not found in context`);
      continue;
    }

    const htmlEl = el as HTMLElement;

    // Sync initial render
    const initial = resolve(binding);
    htmlEl.textContent = initial == null ? '' : String(initial);

    // Reactive effect only if needed
    if (isSignal(binding) || (typeof binding === 'function' && (binding as Function).length === 0)) {
      bindEffect(htmlEl, () => {
        const v = resolve(binding);
        htmlEl.textContent = v == null ? '' : String(v);
      });
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
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'formaction', 'action', 'poster', 'data']);
const RAW_HTML_ATTRS = new Set(['srcdoc']);
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:', 'sms:', 'blob:']);
const KNOWN_INLINE_EVENT_HANDLER_ATTRS = new Set([
  'onabort',
  'onafterprint',
  'onanimationcancel',
  'onanimationend',
  'onanimationiteration',
  'onanimationstart',
  'onauxclick',
  'onbeforeinput',
  'onbeforematch',
  'onbeforeprint',
  'onbeforetoggle',
  'onbeforeunload',
  'onbegin',
  'onblur',
  'oncancel',
  'oncanplay',
  'oncanplaythrough',
  'onchange',
  'onclick',
  'onclose',
  'oncontextlost',
  'oncontextmenu',
  'oncontextrestored',
  'oncopy',
  'oncuechange',
  'oncut',
  'ondblclick',
  'ondrag',
  'ondragend',
  'ondragenter',
  'ondragleave',
  'ondragover',
  'ondragstart',
  'ondrop',
  'ondurationchange',
  'onemptied',
  'onend',
  'onended',
  'onerror',
  'onfocus',
  'onformdata',
  'onfullscreenchange',
  'onfullscreenerror',
  'ongotpointercapture',
  'onhashchange',
  'oninput',
  'oninvalid',
  'onkeydown',
  'onkeypress',
  'onkeyup',
  'onlanguagechange',
  'onload',
  'onloadeddata',
  'onloadedmetadata',
  'onloadstart',
  'onlostpointercapture',
  'onmessage',
  'onmessageerror',
  'onmousedown',
  'onmouseenter',
  'onmouseleave',
  'onmousemove',
  'onmouseout',
  'onmouseover',
  'onmouseup',
  'onoffline',
  'ononline',
  'onpagehide',
  'onpageshow',
  'onpaste',
  'onpause',
  'onplay',
  'onplaying',
  'onpointercancel',
  'onpointerdown',
  'onpointerenter',
  'onpointerleave',
  'onpointermove',
  'onpointerout',
  'onpointerover',
  'onpointerrawupdate',
  'onpointerup',
  'onpopstate',
  'onprogress',
  'onratechange',
  'onrepeat',
  'onreset',
  'onresize',
  'onscroll',
  'onscrollend',
  'onsecuritypolicyviolation',
  'onseeked',
  'onseeking',
  'onselect',
  'onselectionchange',
  'onselectstart',
  'onslotchange',
  'onstalled',
  'onstorage',
  'onsubmit',
  'onsuspend',
  'ontimeupdate',
  'ontoggle',
  'ontransitioncancel',
  'ontransitionend',
  'ontransitionrun',
  'ontransitionstart',
  'onunhandledrejection',
  'onunload',
  'onvolumechange',
  'onwaiting',
  'onwebkitanimationend',
  'onwebkitanimationiteration',
  'onwebkitanimationstart',
  'onwebkittransitionend',
  'onwheel',
]);

function normalizeAttrName(attrName: string): string {
  return attrName.toLowerCase();
}

function normalizeProtocolCheckValue(value: string): string {
  return value.replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
}

function extractUrlProtocol(value: string): string | null {
  const match = value.match(/^([a-z][a-z0-9+\-.]*):/i);
  return match ? `${match[1].toLowerCase()}:` : null;
}

function isDangerousUrlAttributeValue(el: Element, attrName: string, value: string): boolean {
  return isDangerousUrlAttributeValueForTag(el.tagName.toLowerCase(), attrName, value);
}

function isInlineEventHandlerAttribute(el: Element, normalizedAttrName: string): boolean {
  return KNOWN_INLINE_EVENT_HANDLER_ATTRS.has(normalizedAttrName)
    || (normalizedAttrName.startsWith('on') && normalizedAttrName in el);
}

function applyAttr(el: Element, attrName: string, value: unknown, options?: BindOptions): void {
  const normalizedAttrName = normalizeAttrName(attrName);
  const security = resolveSecurityOptions(options ?? {});

  if (isInlineEventHandlerAttribute(el, normalizedAttrName)) {
    warnSecurity(
      `d-attr-${attrName}: inline event handler attributes are blocked for security. Use d-on-* instead.`,
      () => el.removeAttribute(attrName)
    );
    el.removeAttribute(attrName);
    return;
  }

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
    const next = String(value);

    if (isDangerousUrlAttributeValue(el, normalizedAttrName, next)) {
      warnSecurity(
        `d-attr-${attrName}: blocked dangerous URL protocol in attribute value`,
        () => el.removeAttribute(attrName)
      );
      el.removeAttribute(attrName);
      return;
    }

    if (RAW_HTML_ATTRS.has(normalizedAttrName)) {
      if (security.blockRawHtmlAttrs) {
        warnSecurity(
          `d-attr-${attrName}: blocked raw HTML attribute in security.strict mode`,
          () => el.removeAttribute(attrName)
        );
        el.removeAttribute(attrName);
        return;
      }
      warnRawHtmlSinkHeuristic(
        `d-attr-${attrName}`,
        attrName,
        next,
        () => el.removeAttribute(attrName)
      );
    }

    el.setAttribute(attrName, next);
  }
}

function bindAttrs(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  options: BindOptions
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
        bindEffect(el, () => {
          applyAttr(el, attrName, binding(), options);
        });
      } else {
        applyAttr(el, attrName, resolve(binding), options);
      }
    }
  }
}

// ============================================================================
// d-bind-* Directive (Two-way Binding)
// ============================================================================

/**
 * Bind all [d-bind-*] directives within root.
 * Two-way bindings:
 * - d-bind-value
 * - d-bind-checked
 *
 * One-way reactive property bindings:
 * - d-bind-readonly
 * - d-bind-disabled
 * - d-bind-maxlength
 * - d-bind-placeholder
 * - d-bind-pattern
 * - d-bind-multiple
 *
 * Optional transform/parse hooks:
 * - d-bind-transform="fnName" (signal -> view)
 * - d-bind-parse="fnName" (view -> signal)
 */
function bindTwoWay(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  type BindDirective = {
    attr: string;
    prop: string;
    twoWay: boolean;
  };

  const SUPPORTED: readonly BindDirective[] = [
    { attr: 'd-bind-value', prop: 'value', twoWay: true },
    { attr: 'd-bind-checked', prop: 'checked', twoWay: true },
    { attr: 'd-bind-readonly', prop: 'readOnly', twoWay: false },
    { attr: 'd-bind-disabled', prop: 'disabled', twoWay: false },
    { attr: 'd-bind-maxlength', prop: 'maxLength', twoWay: false },
    { attr: 'd-bind-placeholder', prop: 'placeholder', twoWay: false },
    { attr: 'd-bind-pattern', prop: 'pattern', twoWay: false },
    { attr: 'd-bind-multiple', prop: 'multiple', twoWay: false },
  ] as const;

  const BOOLEAN_PROPS = new Set(['checked', 'readOnly', 'disabled', 'multiple']);
  const STRING_PROPS = new Set(['value', 'placeholder', 'pattern']);

  const applyBoundProp = (el: Element, prop: string, value: unknown): void => {
    if (!(prop in el)) return;

    if (BOOLEAN_PROPS.has(prop)) {
      (el as any)[prop] = !!value;
      return;
    }

    if (STRING_PROPS.has(prop)) {
      (el as any)[prop] = value == null ? '' : String(value);
      return;
    }

    if (prop === 'maxLength') {
      if (value == null || value === '') {
        (el as any).maxLength = -1;
        return;
      }
      const parsed = Number(value);
      (el as any).maxLength = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : -1;
      return;
    }

    (el as any)[prop] = value;
  };

  const resolveFunctionBinding = (
    el: Element,
    attrName: 'd-bind-transform' | 'd-bind-parse'
  ): ((value: unknown, el: Element) => unknown) | null => {
    const fnBindingName = normalizeBinding(el.getAttribute(attrName));
    if (!fnBindingName) return null;

    const fnBinding = ctx[fnBindingName];
    if (fnBinding === undefined) {
      warn(`${attrName}: "${fnBindingName}" not found in context`);
      return null;
    }

    const resolved = isSignal(fnBinding) ? fnBinding() : fnBinding;
    if (typeof resolved !== 'function') {
      warn(`${attrName}: "${fnBindingName}" must be a function (or signal-of-function)`);
      return null;
    }

    return resolved as (value: unknown, el: Element) => unknown;
  };

  for (const directive of SUPPORTED) {
    const attr = directive.attr;
    const elements = qsaIncludingRoot(root, `[${attr}]`);

    for (const el of elements) {
      const bindingName = normalizeBinding(el.getAttribute(attr));
      if (!bindingName) continue;

      const binding = ctx[bindingName];

      if (!isSignal(binding)) {
        warn(`${attr}: "${bindingName}" must be a signal`);
        continue;
      }

      const writable = isWritableSignal(binding);
      if (directive.twoWay && !writable) {
        warn(`${attr}: "${bindingName}" is read-only (inbound updates disabled)`);
      }

      el.removeAttribute(attr);
      const transformFn = resolveFunctionBinding(el, 'd-bind-transform');
      const parseFn = resolveFunctionBinding(el, 'd-bind-parse');
      if (directive.twoWay) {
        el.removeAttribute('d-bind-transform');
        el.removeAttribute('d-bind-parse');
      }

      // Outbound: signal → DOM
      bindEffect(el, () => {
        const rawValue = binding();
        let value = rawValue;
        if (transformFn) {
          try {
            value = transformFn(rawValue, el);
          } catch (err) {
            warn(`d-bind-transform: "${bindingName}" failed (${(err as Error).message || String(err)})`);
            value = rawValue;
          }
        }
        applyBoundProp(el, directive.prop, value);
      });

      // Inbound: DOM → signal
      if (directive.twoWay && writable) {
        const eventName = (el as HTMLElement).tagName === 'SELECT' || directive.prop === 'checked'
          ? 'change'
          : 'input';
        const handler = () => {
          const rawValue = directive.prop === 'checked'
            ? (el as HTMLInputElement).checked
            : (el as HTMLInputElement).value;
          let nextValue: unknown = rawValue;

          if (parseFn) {
            try {
              nextValue = parseFn(rawValue, el);
            } catch (err) {
              warn(`d-bind-parse: "${bindingName}" failed (${(err as Error).message || String(err)})`);
              nextValue = rawValue;
            }
          }

          (binding as Signal<unknown>).set(nextValue);
        };
        el.addEventListener(eventName, handler);
        cleanups.push(() => el.removeEventListener(eventName, handler));
      }
    }
  }
}

// ============================================================================
// Form Directives
// ============================================================================

/**
 * Bind all [d-form] directives within root.
 * Associates a form element with a Form instance from the context.
 * Also auto-wraps d-on-submit handlers through form.handleSubmit().
 */
function bindForm(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-form]');

  for (const el of elements) {
    // Skip forms inside d-each templates
    // They'll be bound when the template is cloned and bound individually
    if (el.closest('[d-each]')) {
      continue;
    }

    if (!(el instanceof HTMLFormElement)) {
      warn('d-form: must be used on a <form> element');
      continue;
    }

    const bindingName = normalizeBinding(el.getAttribute('d-form'));
    if (!bindingName) continue;

    const form = ctx[bindingName];
    if (!form || typeof form !== 'object' || !('handleSubmit' in form)) {
      warn(`d-form: "${bindingName}" is not a valid Form instance`);
      continue;
    }

    // Register form element with the Form instance
    if ('_setFormElement' in form && typeof form._setFormElement === 'function') {
      (form as any)._setFormElement(el);
    }

    // Auto-wrap d-on-submit handler through form.handleSubmit()
    // Don't mutate shared ctx - add listener directly to this form element
    const submitHandlerName = normalizeBinding(el.getAttribute('d-on-submit'));
    if (submitHandlerName) {
      const originalHandler = ctx[submitHandlerName];
      if (typeof originalHandler === 'function') {
        // Check if handler is already wrapped to avoid double-wrapping
        // If user did: const save = form.handleSubmit(...), don't wrap again
        const isAlreadyWrapped = (originalHandler as any)[WRAPPED_HANDLER] === true;
        const finalHandler = isAlreadyWrapped
          ? originalHandler
          : (form as any).handleSubmit(originalHandler);

        // Add submit listener directly to form element (not via d-on-submit)
        // This avoids mutating the shared context while preserving high-priority event context.
        const wrappedSubmitHandler: EventListener = function (this: EventTarget, event: Event) {
          return withSchedulerPriority(
            'high',
            () => (finalHandler as (this: EventTarget, event: Event) => unknown).call(this, event),
            { warnOnAsync: false }
          );
        };
        el.addEventListener('submit', wrappedSubmitHandler);

        // Remove d-on-submit to prevent bindEvents from adding duplicate listener
        el.removeAttribute('d-on-submit');

        // Restore attribute on cleanup so dispose()+bind() (HMR) can rediscover it
        cleanups.push(() => {
          el.removeEventListener('submit', wrappedSubmitHandler);
          el.setAttribute('d-on-submit', submitHandlerName);
        });
      }
    }
  }
}

/**
 * Bind all [d-field] directives within root.
 * Registers field elements with their Form instance and sets up a11y attributes.
 */
function bindField(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-field]');

  for (const el of elements) {
    // Prefer data-field-path (set by d-array) over d-field for full path
    const dataFieldPath = el.getAttribute('data-field-path');
    const dFieldPath = normalizeBinding(el.getAttribute('d-field'));
    const fieldPath = dataFieldPath || dFieldPath;
    if (!fieldPath) continue;

    // Find the form element - use context first (for detached clones), then closest()
    // When bind() runs on d-array clones, the clone is still detached from DOM,
    // so el.closest('form[d-form]') returns null. We pass form refs through context.
    const formEl = (ctx as any)._formElement || el.closest('form[d-form]');
    if (!formEl) {
      warn(`d-field: field "${fieldPath}" must be inside a [d-form]`);
      continue;
    }

    const formBinding = (ctx as any)._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
    if (!formBinding) continue;

    const form = ctx[formBinding];
    if (!form || typeof form !== 'object') continue;

    const htmlEl = el as HTMLElement;

    // Set name attribute if not already set (use full path)
    if (!htmlEl.getAttribute('name')) {
      htmlEl.setAttribute('name', fieldPath);
    }

    // Register field with form using full path
    if ('_registerField' in form && typeof form._registerField === 'function') {
      const unregister = (form as any)._registerField(fieldPath, htmlEl);
      cleanups.push(unregister);
    }

    // Setup reactive aria-invalid based on error state
    if ('error' in form && typeof form.error === 'function') {
      bindEffect(htmlEl, () => {
        // Read current path from DOM attribute inside effect
        // This allows the effect to see updated paths after array reorder
        const currentPath = htmlEl.getAttribute('data-field-path') || htmlEl.getAttribute('name') || fieldPath;
        const errorMsg = (form as any).error(currentPath);
        if (errorMsg) {
          htmlEl.setAttribute('aria-invalid', 'true');
          // Use form prefix for unique IDs across multiple forms
          const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
          htmlEl.setAttribute('aria-describedby', errorId);
        } else {
          htmlEl.removeAttribute('aria-invalid');
          htmlEl.removeAttribute('aria-describedby');
        }
      });
    }
  }
}

/**
 * Bind all [d-error] directives within root.
 * Displays error messages for specific fields.
 */
function bindError(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-error]');

  for (const el of elements) {
    // Prefer data-error-path (set by d-array) over d-error for full path
    const dataErrorPath = el.getAttribute('data-error-path');
    const dErrorPath = normalizeBinding(el.getAttribute('d-error'));
    const fieldPath = dataErrorPath || dErrorPath;
    if (!fieldPath) continue;

    // Find the form element - use context first (for detached clones), then closest()
    // When bind() runs on d-array clones, the clone is still detached from DOM,
    // so el.closest('form[d-form]') returns null. We pass form refs through context.
    const formEl = (ctx as any)._formElement || el.closest('form[d-form]');
    if (!formEl) {
      warn(`d-error: error for "${fieldPath}" must be inside a [d-form]`);
      continue;
    }

    const formBinding = (ctx as any)._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
    if (!formBinding) continue;

    const form = ctx[formBinding];
    if (!form || typeof form !== 'object' || !('error' in form)) continue;

    const htmlEl = el as HTMLElement;

    // Generate stable ID with form prefix to avoid duplicate IDs
    // Multiple forms on same page can have fields with same names
    const errorId = `${formBinding}_${fieldPath.replace(/[.\[\]]/g, '_')}_error`;
    htmlEl.id = errorId;

    // Set role for accessibility
    htmlEl.setAttribute('role', 'alert');
    htmlEl.setAttribute('aria-live', 'polite');

    // Reactive error display
    bindEffect(htmlEl, () => {
      // Read current path from DOM attribute inside effect
      // This allows the effect to see updated paths after array reorder
      const currentPath = htmlEl.getAttribute('data-error-path') || fieldPath;
      const errorMsg = (form as any).error(currentPath);
      if (errorMsg) {
        // Update ID to match current path (with form prefix for uniqueness)
        const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
        htmlEl.id = errorId;
        htmlEl.textContent = errorMsg;
        htmlEl.style.display = '';
      } else {
        htmlEl.textContent = '';
        htmlEl.style.display = 'none';
      }
    });
  }
}

/**
 * Bind all [d-form-error] directives within root.
 * Displays form-level error messages.
 */
function bindFormError(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-form-error]');

  for (const el of elements) {
    // Use the attribute value as explicit form binding name when provided
    const explicitBinding = normalizeBinding(el.getAttribute('d-form-error'));

    // Fall back to finding the form element via context or closest()
    const formEl = (ctx as any)._formElement || el.closest('form[d-form]');
    const formBinding = explicitBinding
      || (ctx as any)._formBinding
      || (formEl ? normalizeBinding(formEl.getAttribute('d-form')) : null);

    if (!formBinding) {
      warn('d-form-error: must specify a form binding or be inside a [d-form]');
      continue;
    }

    const form = ctx[formBinding];
    if (!form || typeof form !== 'object' || !('formError' in form)) continue;

    const htmlEl = el as HTMLElement;

    // Set role for accessibility
    htmlEl.setAttribute('role', 'alert');
    htmlEl.setAttribute('aria-live', 'polite');

    // Reactive form error display
    bindEffect(htmlEl, () => {
      const errorMsg = (form as any).formError();
      if (errorMsg) {
        htmlEl.textContent = errorMsg;
        htmlEl.style.display = '';
      } else {
        htmlEl.textContent = '';
        htmlEl.style.display = 'none';
      }
    });
  }
}

/**
 * Bind all [d-array] directives within root.
 * Renders field arrays with stable keys for reordering.
 * Preserves DOM state by reusing keyed nodes instead of full teardown.
 */
function bindArray(
  root: Element,
  ctx: BindContext,
  cleanups: DisposeFunction[],
  options: BindOptions
): void {
  const elements = qsaIncludingRoot(root, '[d-array]')
    // Skip d-array inside d-each templates
    // They'll be bound when the template is cloned
    // Note: qsaIncludingRoot's boundary logic already prevents duplicate processing,
    // so we don't need an additional filter for nested d-arrays
    .filter(el => !el.closest('[d-each]'));

  for (const el of elements) {
    // Prefer data-array-path (set by parent d-array for nested arrays) over d-array
    const dataArrayPath = el.getAttribute('data-array-path');
    const dArrayAttr = normalizeBinding(el.getAttribute('d-array'));
    const arrayPath = dataArrayPath || dArrayAttr;
    if (!arrayPath) continue;

    // Find the form element — use context first (for detached clones), then closest()
    const formEl = (ctx as any)._formElement || el.closest('form[d-form]');
    if (!formEl) {
      warn(`d-array: array "${arrayPath}" must be inside a [d-form]`);
      continue;
    }

    const formBinding = (ctx as any)._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
    if (!formBinding) continue;

    const form = ctx[formBinding];
    if (!form || typeof form !== 'object' || !('fieldArray' in form)) continue;

    // Get or create the field array
    const fieldArray = (form as any).fieldArray(arrayPath);

    // Find the template element (d-each inside d-array)
    const templateElement = el.querySelector('[d-each]');
    if (!templateElement) {
      warn(`d-array: array "${arrayPath}" must contain a [d-each] template`);
      continue;
    }

    // Store template reference for closure (TypeScript assertion)
    const template: Element = templateElement;

    const comment = document.createComment(`d-array:${arrayPath}`);
    template.parentNode?.replaceChild(comment, template);
    template.removeAttribute('d-each');

    // Track clones by key to preserve DOM state on reorder
    const clonesByKey = new Map<string, Element>();
    const disposesByKey = new Map<string, DisposeFunction>();

    // Track metadata signals by key to update when index changes
    type MetadataSignals = {
      $index: Signal<number>;
      $count: Signal<number>;
      $first: Signal<boolean>;
      $last: Signal<boolean>;
      $odd: Signal<boolean>;
      $even: Signal<boolean>;
    };
    const metadataByKey = new Map<string, MetadataSignals>();

    // Track item signals by key to update when value changes via updateAt()
    type ItemSignals = {
      item: Signal<unknown>;
      spreadProps: Map<string, Signal<unknown>>;
    };
    const itemSignalsByKey = new Map<string, ItemSignals>();

    function createClone(key: string, value: unknown, index: number, count: number): Element {
      const clone = template.cloneNode(true) as Element;

      // Create context for this item
      const itemCtx = Object.create(ctx) as BindContext;

      // Create signal for item so bindings can react to updates
      const itemSignal = signal(value);

      // Create signals for spread properties (if value is an object)
      // This allows {propName} bindings to update when value changes
      const spreadProps = new Map<string, Signal<unknown>>();
      if (typeof value === 'object' && value !== null) {
        for (const [propKey, propValue] of Object.entries(value as Record<string, unknown>)) {
          const propSignal = signal(propValue);
          spreadProps.set(propKey, propSignal);
          itemCtx[propKey] = propSignal;
        }
      }

      itemSignalsByKey.set(key, { item: itemSignal, spreadProps });

      // Use signals for metadata so they can be updated on reorder
      const metadata: MetadataSignals = {
        $index: signal(index),
        $count: signal(count),
        $first: signal(index === 0),
        $last: signal(index === count - 1),
        $odd: signal(index % 2 !== 0),
        $even: signal(index % 2 === 0),
      };
      metadataByKey.set(key, metadata);

      // Expose item signal and metadata to context
      itemCtx.item = itemSignal;
      itemCtx.key = key;
      itemCtx.$index = metadata.$index;
      itemCtx.$count = metadata.$count;
      itemCtx.$first = metadata.$first;
      itemCtx.$last = metadata.$last;
      itemCtx.$odd = metadata.$odd;
      itemCtx.$even = metadata.$even;

      // Pass form reference for bindField/bindError to use
      // When clone is detached, el.closest('form[d-form]') returns null
      itemCtx._formElement = formEl;
      itemCtx._formBinding = formBinding;

      // Expose array operations bound to this item's key (not index)
      itemCtx.$remove = () => fieldArray.remove(key);
      itemCtx.$moveUp = () => {
        const currentIndex = fieldArray._getIndex(key);
        if (currentIndex > 0) fieldArray.move(currentIndex, currentIndex - 1);
      };
      itemCtx.$moveDown = () => {
        const currentIndex = fieldArray._getIndex(key);
        if (currentIndex < fieldArray.length() - 1) fieldArray.move(currentIndex, currentIndex + 1);
      };

      // Mark and bind clone
      clone.setAttribute('data-dalila-internal-bound', '');
      clone.setAttribute('data-array-key', key);

      // Update field names and d-field to include full path
      // Include clone root itself (for primitive arrays like <input d-each="items" d-field="value">)
      const fields = queryIncludingRoot(clone, 'd-field');

      for (const field of fields) {
        const relativeFieldPath = field.getAttribute('d-field');
        if (relativeFieldPath) {
          const fullPath = `${arrayPath}[${index}].${relativeFieldPath}`;
          field.setAttribute('name', fullPath);
          // Set data-field-path for bindField to use full path
          field.setAttribute('data-field-path', fullPath);
        }
      }

      // Also update d-error elements to use full path (including root)
      const errors = queryIncludingRoot(clone, 'd-error');

      for (const errorEl of errors) {
        const relativeErrorPath = errorEl.getAttribute('d-error');
        if (relativeErrorPath) {
          const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
          errorEl.setAttribute('data-error-path', fullPath);
        }
      }

      // Update nested d-array elements to use full path (for nested field arrays)
      updateNestedArrayDataPaths(clone, arrayPath, index);

      // Set type="button" on array control buttons to prevent form submit
      // Buttons like d-on-click="$remove" inside templates aren't processed by
      // bindArrayOperations (they don't exist yet), so set it here during clone creation
      ensureButtonTypeForSelector(
        clone,
        'button[d-on-click*="$remove"], button[d-on-click*="$moveUp"], button[d-on-click*="$moveDown"], button[d-on-click*="$swap"]'
      );

      const dispose = bind(clone, itemCtx, inheritNestedBindOptions(options, { _skipLifecycle: true }));
      disposesByKey.set(key, dispose);
      clonesByKey.set(key, clone);

      return clone;
    }

    function updateCloneIndex(clone: Element, key: string, value: unknown, index: number, count: number): void {
      // Update field names with new index (values stay in DOM)
      // Include clone root itself (for primitive arrays)
      const fields = queryIncludingRoot(clone, 'd-field');

      for (const field of fields) {
        const relativeFieldPath = field.getAttribute('d-field');
        if (relativeFieldPath) {
          const fullPath = `${arrayPath}[${index}].${relativeFieldPath}`;
          field.setAttribute('name', fullPath);
          field.setAttribute('data-field-path', fullPath);
        }
      }

      // Update d-error elements (including root)
      const errors = queryIncludingRoot(clone, 'd-error');

      for (const errorEl of errors) {
        const relativeErrorPath = errorEl.getAttribute('d-error');
        if (relativeErrorPath) {
          const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
          errorEl.setAttribute('data-error-path', fullPath);
        }
      }

      // Update nested d-array paths
      updateNestedArrayDataPaths(clone, arrayPath, index);

      // Update metadata signals with new index values
      const metadata = metadataByKey.get(key);
      if (metadata) {
        metadata.$index.set(index);
        metadata.$count.set(count);
        metadata.$first.set(index === 0);
        metadata.$last.set(index === count - 1);
        metadata.$odd.set(index % 2 !== 0);
        metadata.$even.set(index % 2 === 0);
      }

      // Update item signals when value changes via updateAt()
      const itemSignals = itemSignalsByKey.get(key);
      if (itemSignals) {
        // Update the item signal
        itemSignals.item.set(value);

        // Update spread property signals
        if (typeof value === 'object' && value !== null) {
          const newProps = new Set(Object.keys(value as Record<string, unknown>));

          // Update existing props and clear removed ones
          for (const [propKey, propSignal] of itemSignals.spreadProps) {
            if (newProps.has(propKey)) {
              propSignal.set((value as Record<string, unknown>)[propKey]);
            } else {
              // Property was removed - clear to undefined
              propSignal.set(undefined);
            }
          }
        } else {
          // Value is not an object (null, primitive, etc) - clear all spread props
          for (const [, propSignal] of itemSignals.spreadProps) {
            propSignal.set(undefined);
          }
        }
      }
    }

    function renderList(): void {
      const items = fieldArray.fields();
      const newKeys = new Set(items.map((item: any) => item.key));

      // Remove clones for keys that no longer exist
      for (const [key, clone] of clonesByKey) {
        if (!newKeys.has(key)) {
          clone.remove();
          clonesByKey.delete(key);
          metadataByKey.delete(key);
          itemSignalsByKey.delete(key);
          const dispose = disposesByKey.get(key);
          if (dispose) {
            dispose();
            disposesByKey.delete(key);
          }
        }
      }

      // Build new DOM order, reusing existing clones
      const parent = comment.parentNode;
      if (!parent) return;

      // Collect all clones in new order
      const orderedClones: Element[] = [];

      for (let i = 0; i < items.length; i++) {
        const { key, value } = items[i];
        let clone = clonesByKey.get(key);

        if (clone) {
          // Reuse existing clone, update index-based attributes and item value
          updateCloneIndex(clone, key, value, i, items.length);
        } else {
          // Create new clone for new key
          clone = createClone(key, value, i, items.length);
        }

        orderedClones.push(clone);
      }

      // Reorder DOM nodes efficiently
      // Remove all clones from current positions
      for (const clone of orderedClones) {
        if (clone.parentNode) {
          clone.parentNode.removeChild(clone);
        }
      }

      // Insert in correct order before the comment
      for (const clone of orderedClones) {
        parent.insertBefore(clone, comment);
      }
    }

    // Reactive rendering
    bindEffect(el, () => {
      renderList();
    });

    // Bind array operation buttons
    bindArrayOperations(el, fieldArray, cleanups);

    cleanups.push(() => {
      for (const clone of clonesByKey.values()) {
        clone.remove();
      }
      for (const dispose of disposesByKey.values()) {
        dispose();
      }
      clonesByKey.clear();
      disposesByKey.clear();
      metadataByKey.clear();
      itemSignalsByKey.clear();
    });
  }
}

/**
 * Bind array operation buttons: d-append, d-remove, d-insert, d-move-up, d-move-down, d-swap
 */
function bindArrayOperations(
  container: Element,
  fieldArray: any,
  cleanups: DisposeFunction[]
): void {
  ensureButtonTypeForSelector(container, '[d-remove]');
  ensureButtonTypeForSelector(container, '[d-move-up], [d-move-down]');

  // d-append: append new item
  const appendButtons = container.querySelectorAll('[d-append]');
  for (const btn of Array.from(appendButtons)) {
    // Set type="button" to prevent form submit
    // Inside <form>, buttons default to type="submit"
    if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
      btn.setAttribute('type', 'button');
    }

    const handler = (e: Event) => {
      e.preventDefault(); // Extra safety
      const defaultValue = btn.getAttribute('d-append');
      try {
        const value = defaultValue ? JSON.parse(defaultValue) : {};
        fieldArray.append(value);
      } catch {
        fieldArray.append({});
      }
    };
    btn.addEventListener('click', handler);
    cleanups.push(() => btn.removeEventListener('click', handler));
  }

  // d-remove / d-move-* handlers are provided by item context in bindArray.
  // We only normalize button type above to avoid accidental form submission.
}

// ============================================================================
// d-ref — declarative element references
// ============================================================================

function bindRef(root: Element, refs: Map<string, Element>): void {
  const elements = qsaIncludingRoot(root, '[d-ref]');
  for (const el of elements) {
    const name = el.getAttribute('d-ref');
    if (!name || !name.trim()) {
      warn('d-ref: empty ref name ignored');
      continue;
    }
    const trimmed = name.trim();
    if (refs.has(trimmed)) {
      warn(`d-ref: duplicate ref name "${trimmed}" in the same scope`);
    }
    refs.set(trimmed, el);
  }
}

// ============================================================================
// Component System
// ============================================================================

function getComponentRegistry(ctx: BindContext): Map<string, Component> | null {
  const reg = ctx[COMPONENT_REGISTRY_KEY];
  return reg instanceof Map ? reg as Map<string, Component> : null;
}

function bindComponents(
  root: Element,
  ctx: BindContext,
  events: string[],
  cleanups: DisposeFunction[],
  onMountError: 'log' | 'throw',
  options: BindOptions
): void {
  const registry = getComponentRegistry(ctx);
  if (!registry || registry.size === 0) return;

  const tagSelector = Array.from(registry.keys()).join(', ');
  const elements = qsaIncludingRoot(root, tagSelector);
  const boundary = root.closest('[data-dalila-internal-bound]');

  for (const el of elements) {
    // Skip stale entries from the initial snapshot.
    // Earlier iterations may replace/move nodes (e.g. slot projection),
    // so this element might no longer belong to the current bind boundary.
    if (!root.contains(el)) continue;
    if (el.closest('[data-dalila-internal-bound]') !== boundary) continue;

    const tag = el.tagName.toLowerCase();
    const component = registry.get(tag);
    if (!component) continue;
    const def = component.definition;

    // 1. Extract slots
    const { defaultSlot, namedSlots } = extractSlots(el);

    // 2. Create component DOM
    const templateEl = document.createElement('template');
    setTemplateInnerHTML(templateEl, def.template.trim(), resolveSecurityOptions(options));
    const content = templateEl.content;

    // Dev-mode template validation
    if (isInDevMode()) {
      if (!def.template.trim()) {
        warn(`Component <${def.tag}>: template is empty`);
      } else if (content.childNodes.length === 0) {
        warn(`Component <${def.tag}>: template produced no DOM nodes`);
      }
    }

    // Single-root optimization: no wrapper needed
    // A d-each on the sole element will clone siblings at runtime, so it needs a container.
    const elementChildren = Array.from(content.children);
    const hasOnlyOneElement = elementChildren.length === 1
      && !elementChildren[0].hasAttribute('d-each')
      && Array.from(content.childNodes).every(
        n => n === elementChildren[0] || (n.nodeType === 3 && !n.textContent!.trim())
      );

    let componentRoot: Element;
    if (hasOnlyOneElement) {
      componentRoot = elementChildren[0] as Element;
      content.removeChild(componentRoot);
    } else {
      componentRoot = document.createElement('dalila-c');
      (componentRoot as HTMLElement).style.display = 'contents';
      componentRoot.appendChild(content);
    }

    // 3. Create component scope (child of current template scope)
    const componentScope = createScope();
    const pendingMountCallbacks: Array<() => void> = [];

    // 4. Within component scope: resolve props, run setup, bind
    let componentHandle: BindHandle | null = null;

    // Collect d-on-* event handlers from the component tag for ctx.emit()
    const componentEventHandlers: Record<string, Function> = {};
    for (const attr of Array.from(el.attributes)) {
      if (!attr.name.startsWith('d-on-')) continue;
      const eventName = attr.name.slice(5); // "d-on-select" → "select"
      const handlerName = normalizeBinding(attr.value);
      if (!handlerName) continue;
      const handler = ctx[handlerName];
      if (typeof handler === 'function') {
        componentEventHandlers[eventName] = handler as Function;
      } else if (handler !== undefined) {
        warn(`Component <${def.tag}>: d-on-${eventName}="${handlerName}" is not a function`);
      }
    }

    withScope(componentScope, () => {
      // 4a. Resolve props
      const propSignals = resolveComponentPropsFromElement(el, ctx, def, {
        warn,
        normalizeBinding,
        isSignal,
      });

      // 4b. Create ref accessor + emit
      const setupCtx: TypedSetupContext = {
        ref: (name: string) => componentHandle?.getRef(name) ?? null,
        refs: () => componentHandle?.getRefs() ?? Object.freeze({}),
        emit: (event: string, ...args: unknown[]) => {
          const handler = componentEventHandlers[event];
          if (typeof handler === 'function') handler(...args);
        },
        onMount: (fn: () => void) => {
          pendingMountCallbacks.push(fn);
        },
        onCleanup: (fn: () => void) => {
          componentScope.onCleanup(fn);
        },
      };

      // 4c. Run setup
      let setupReturn: Record<string, unknown> = {};
      if (def.setup) {
        setupReturn = def.setup(propSignals as any, setupCtx);
        for (const key of Object.keys(setupReturn)) {
          if (key in propSignals) {
            warn(`Component <${def.tag}>: setup() returned "${key}" which overrides a prop binding`);
          }
        }
      }

      // 4d. Build component bind context (propagate registry for nested components)
      const componentCtx: BindContext = { ...propSignals, ...setupReturn };
      const parentRegistry = getComponentRegistry(ctx);
      if (parentRegistry) {
        componentCtx[COMPONENT_REGISTRY_KEY] = parentRegistry;
      }

      // 4d'. Store emit function for d-emit-* directives
      componentCtx[COMPONENT_EMIT_KEY] = (event: string, ...args: unknown[]) => {
        const handler = componentEventHandlers[event];
        if (typeof handler === 'function') handler(...args);
      };

      // 4e. Bind slot content with PARENT context/scope
      const parentScope = componentScope.parent;
      if (parentScope) {
        withScope(parentScope, () => {
          bindSlotFragments(defaultSlot, namedSlots, ctx, events, cleanups, bind as any);
        });
      }

      // 4f. Fill slots
      fillSlots(componentRoot, defaultSlot, namedSlots);

      // 4g. Mark as bound boundary
      componentRoot.setAttribute('data-dalila-internal-bound', '');

      // 4h. Bind component template
      componentHandle = bind(
        componentRoot,
        componentCtx,
        inheritNestedBindOptions(options, { events, _skipLifecycle: true, _internal: true })
      );
      cleanups.push(componentHandle);
    });

    // 5. Replace original tag with component DOM
    el.replaceWith(componentRoot);

    // 6. Run component onMount callbacks after the DOM swap.
    if (pendingMountCallbacks.length > 0) {
      withScope(componentScope, () => {
        for (const cb of pendingMountCallbacks) {
          if (onMountError === 'throw') {
            cb();
          } else {
            try {
              cb();
            } catch (err) {
              console.error(`[Dalila] Component <${def.tag}> onMount() threw:`, err);
            }
          }
        }
      });
    }

    // 7. Register scope cleanup
    cleanups.push(() => componentScope.dispose());
  }
}

// ============================================================================
// Global Configuration
// ============================================================================

let globalConfig: BindOptions = createDefaultRuntimeConfig();

export function installProductionRuntimeDefaults(): void {
  globalConfig = createDefaultRuntimeConfig();
}

export function resolveConfiguredRuntimeSecurityOptions(
  security?: RuntimeSecurityOptions
): RuntimeSecurityOptions | undefined {
  return mergeSecurityOptions(globalConfig.security, security);
}

export function createPortalTarget(id: string): Signal<Element | null> {
  const targetSignal = signal<Element | null>(null);

  if (typeof document === 'undefined') {
    return targetSignal;
  }

  let target = document.getElementById(id);
  if (!target) {
    target = document.createElement('div');
    target.id = id;
    document.body.appendChild(target);
  }

  targetSignal.set(target);
  return targetSignal;
}

/**
 * Set global defaults for all `bind()` / `mount()` calls.
 *
 * Options set here are merged with per-call options (per-call wins).
 * Call with an empty object to reset back to Dalila's production defaults.
 *
 * @example
 * ```ts
 * import { configure } from 'dalila/runtime';
 *
 * configure({
 *   components: [FruitPicker],
 *   onMountError: 'log',
 * });
 * ```
 */
export function configure(config: BindOptions): void {
  if (Object.keys(config).length === 0) {
    installProductionRuntimeDefaults();
    return;
  }
  const nextConfig: BindOptions = {
    ...globalConfig,
    ...config,
  };
  const mergedSecurity = mergeSecurityOptions(globalConfig.security, config.security);
  if (mergedSecurity) {
    nextConfig.security = mergedSecurity;
  }
  globalConfig = nextConfig;
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
export function bind<T extends Record<string, unknown> = BindContext>(
  root: Element | string,
  ctx: T,
  options: BindOptions = {}
): BindHandle {
  // ── Merge global config with per-call options ──
  if (Object.keys(globalConfig).length > 0) {
    const { components: globalComponents, transitions: globalTransitions, security: globalSecurity, ...globalRest } = globalConfig;
    const { components: localComponents, transitions: localTransitions, security: localSecurity, ...localRest } = options;
    const mergedOpts: BindOptions = { ...globalRest, ...localRest };
    const mergedSecurity = mergeSecurityOptions(globalSecurity, localSecurity);
    if (mergedSecurity) {
      mergedOpts.security = mergedSecurity;
    }

    // Combine component registries: local takes precedence over global
    if (globalComponents || localComponents) {
      const combined: Record<string, Component> = {};

      const mergeComponents = (src: Record<string, Component> | Component[] | undefined) => {
        if (!src) return;
        if (Array.isArray(src)) {
          for (const comp of src) {
            if (isComponent(comp)) combined[comp.definition.tag] = comp;
          }
        } else {
          for (const [key, comp] of Object.entries(src)) {
            if (isComponent(comp)) combined[key] = comp;
          }
        }
      };

      mergeComponents(globalComponents);
      mergeComponents(localComponents); // local wins
      mergedOpts.components = combined;
    }

    if (globalTransitions || localTransitions) {
      const byName = new Map<string, TransitionConfig>();
      for (const item of globalTransitions ?? []) {
        if (!item || typeof item.name !== 'string') continue;
        byName.set(item.name, item);
      }
      for (const item of localTransitions ?? []) {
        if (!item || typeof item.name !== 'string') continue;
        byName.set(item.name, item);
      }
      mergedOpts.transitions = Array.from(byName.values());
    }

    options = mergedOpts;
  }

  // ── Resolve string selector ──
  if (typeof root === 'string') {
    const found = document.querySelector(root);
    if (!found) throw new Error(`[Dalila] bind: element not found: ${root}`);
    root = found;
  }

  // ── Component registry propagation via context ──
  if (options.components) {
    const existing = (ctx as BindContext)[COMPONENT_REGISTRY_KEY];
    const merged = new Map(existing instanceof Map ? existing as Map<string, Component> : []);
    if (Array.isArray(options.components)) {
      for (const comp of options.components) {
        if (!isComponent(comp)) {
          warn('bind: components[] contains an invalid component entry');
          continue;
        }
        merged.set(comp.definition.tag, comp);
      }
    } else {
      for (const [key, comp] of Object.entries(options.components)) {
        if (!isComponent(comp)) {
          warn(`bind: components["${key}"] is not a valid component`);
          continue;
        }
        const tag = comp.definition.tag;
        if (key !== tag) {
          warn(`bind: components key "${key}" differs from component tag "${tag}" (using "${tag}")`);
        }
        merged.set(tag, comp);
      }
    }
    // Preserve prototype/inherited lookups from the original context.
    const ctxWithRegistry = Object.create(ctx) as BindContext;
    ctxWithRegistry[COMPONENT_REGISTRY_KEY] = merged;
    ctx = ctxWithRegistry as T;
  }

  const events = options.events ?? DEFAULT_EVENTS;
  const onMountError = options.onMountError ?? 'log';
  const rawTextSelectors = options.rawTextSelectors ?? DEFAULT_RAW_TEXT_SELECTORS;
  const templatePlanCacheConfig = resolveTemplatePlanCacheConfig(options);
  const transitionRegistry = createTransitionRegistry(options.transitions);

  const htmlRoot = root as HTMLElement;

  // HMR support: Register binding context globally in dev mode.
  // Skip for internal (d-each clone) bindings — only the top-level bind owns HMR.
  if (!options._internal && isInDevMode()) {
    (globalThis as any).__dalila_hmr_context = { root, ctx, options };
  }

  // Create a scope for this template binding
  const templateScope = createScope();
  const cleanups: DisposeFunction[] = [];
  const refs = new Map<string, Element>();
  const resolvedSecurity = resolveSecurityOptions(options);
  if (resolvedSecurity.warnAsError) {
    warnAsErrorScopes.add(templateScope);
  }
  linkScopeToDom(templateScope, root, describeBindRoot(root));
  const bindScanPlan = createBindScanPlan(root);
  let bindCompleted = false;
  let disposed = false;

  const disposeBindingResources = (): void => {
    if (disposed) return;
    disposed = true;
    if (resolvedSecurity.warnAsError) {
      warnAsErrorScopes.delete(templateScope);
    }

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
    refs.clear();

    try {
      templateScope.dispose();
    } catch (e) {
      if (isInDevMode()) {
        console.warn('[Dalila] Scope dispose error:', e);
      }
    }
  };

  // Run all bindings within the template scope
  const previousScanPlan = activeBindScanPlan;
  try {
    activeBindScanPlan = bindScanPlan;
    withWarnAsError(resolvedSecurity.warnAsError, () => {
      withScope(templateScope, () => {
        // 1. Form setup — must run very early to register form instances
        bindForm(root, ctx, cleanups);

        // 2. d-array — must run before d-each to setup field arrays
        bindArray(root, ctx, cleanups, options);

        // 3. d-virtual-each — must run early for virtual template extraction
        bindVirtualEach(root, ctx, cleanups, options);

        // 4. d-each — must run early: removes templates before TreeWalker visits them
        bindEach(root, ctx, cleanups, options);

        // 5. d-boundary — must run before child directive/component passes
        // to avoid binding boundary children twice (original + cloned subtree).
        bindBoundary(root, ctx, cleanups, options);

        // 6. Components — must run after d-each but before d-ref / text interpolation
        bindComponents(root, ctx, events, cleanups, onMountError, options);

        // 7. d-ref — collect element references (after d-each removes templates)
        bindRef(root, refs);

        // 7.5. d-text — safe textContent binding (before text interpolation)
        bindText(root, ctx, cleanups);

        // 7. Text interpolation (template plan cache + lazy parser fallback)
        bindTextInterpolation(root, ctx, rawTextSelectors, templatePlanCacheConfig);

        // 8. d-attr bindings
        bindAttrs(root, ctx, cleanups, options);

        // 9. d-bind-* two-way bindings
        bindTwoWay(root, ctx, cleanups);

        // 10. d-html bindings
        bindHtml(root, ctx, cleanups, options);

        // 11. Form fields — register fields with form instances
        bindField(root, ctx, cleanups);

        // 12. Event bindings
        bindEvents(root, ctx, events, cleanups);

        // 13. d-emit-* bindings (component template → parent)
        bindEmit(root, ctx, cleanups);

        // 14. d-when directive
        bindWhen(root, ctx, cleanups, transitionRegistry);

        // 15. d-match directive
        bindMatch(root, ctx, cleanups);

        // 16. Form error displays — BEFORE d-if to bind errors in conditionally rendered sections
        bindError(root, ctx, cleanups);
        bindFormError(root, ctx, cleanups);

        // 17. d-portal — move already-bound elements to external targets
        // d-lazy directive - loads component when it enters viewport
        bindLazy(root, ctx, cleanups, refs, events, options);

        bindPortal(root, ctx, cleanups);

        // 18. d-if — must run last: elements are fully bound before conditional removal
        bindIf(root, ctx, cleanups, transitionRegistry);
      });
    });
    bindCompleted = true;
  } finally {
    activeBindScanPlan = previousScanPlan;
    if (!bindCompleted) {
      disposeBindingResources();
    }
  }

  // Bindings complete: remove loading state and mark as ready.
  // Only the top-level bind owns this lifecycle — d-each clones skip it.
  if (!options._skipLifecycle) {
    queueMicrotask(() => {
      htmlRoot.removeAttribute('d-loading');
      htmlRoot.setAttribute('d-ready', '');
    });
  }

  // Return BindHandle (callable dispose + ref accessors)
  const dispose = (): void => {
    disposeBindingResources();
  };

  const handle: BindHandle = Object.assign(dispose, {
    getRef(name: string): Element | null {
      return refs.get(name) ?? null;
    },
    getRefs(): Readonly<Record<string, Element>> {
      return Object.freeze(Object.fromEntries(refs));
    },
  });

  return handle;
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
export function autoBind<T extends Record<string, unknown> = BindContext>(
  selector: string,
  ctx: T,
  options?: BindOptions
): Promise<BindHandle> {
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

// ============================================================================
// mount() — Imperative Component Mounting + Shorthand bind()
// ============================================================================

/**
 * Mount a component imperatively, or bind a selector to a view-model.
 *
 * Overload 1 — `mount(selector, vm, options?)`:
 *   Shorthand for `bind(selector, vm, options)`.
 *
 * Overload 2 — `mount(component, target, props?)`:
 *   Mount a component created with defineComponent() into a target element.
 */
export function mount<T extends object>(
  selector: string,
  vm: T,
  options?: BindOptions
): BindHandle;
export function mount(
  component: Component,
  target: Element,
  props?: Record<string, unknown>
): BindHandle;
export function mount(
  first: Component | string,
  second: Element | object,
  third?: Record<string, unknown> | BindOptions
): BindHandle {
  // Overload 1: mount(selector, vm, options?)
  if (typeof first === 'string' && !isComponent(first)) {
    return bind(first, second as Record<string, unknown>, (third ?? {}) as BindOptions);
  }

  // Overload 2: mount(component, target, props?)
  const component = first as Component;
  const target = second as Element;
  const props = third as Record<string, unknown> | undefined;

  const def = component.definition;

  const el = document.createElement(def.tag);
  if (props) {
    for (const key of Object.keys(props)) {
      el.setAttribute(`d-props-${camelToKebab(key)}`, key);
    }
  }
  target.appendChild(el);

  const parentCtx: BindContext = {};
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      parentCtx[key] = isSignal(value) ? value : signal(value);
    }
  }

  return bind(el, parentCtx, {
    components: { [def.tag]: component },
    _skipLifecycle: true,
    _internal: true,
  });
}
