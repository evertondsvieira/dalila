/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */

import { effect, createScope, withScope, isInDevMode, signal, Signal, computeVirtualRange } from '../core/index.js';
import { WRAPPED_HANDLER } from '../form/form.js';
import { linkScopeToDom, withDevtoolsDomTarget } from '../core/devtools.js';
import type { Component, SetupContext, ComponentDefinition } from './component.js';
import { isComponent, normalizePropDef, coercePropValue, kebabToCamel, camelToKebab } from './component.js';
import { observeLazyElement, getLazyComponent } from './lazy.js';
import { bindBoundary } from './boundary.js';

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
}

export interface BindContext {
  [key: string]: unknown;
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
function warn(message: string): void {
  if (isInDevMode()) {
    console.warn(`[Dalila] ${message}`);
  }
}

type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'parse' | 'missing_identifier'; message: string; identifier?: string };

type TransitionRegistry = Map<string, TransitionConfig>;

const portalSyncByElement = new WeakMap<HTMLElement, () => void>();

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

type BindBenchSession = {
  enabled: boolean;
  scanMs: number;
  parseMs: number;
  totalExpressions: number;
  fastPathExpressions: number;
  planCacheHit: boolean;
};

const BENCH_FLAG = '__dalila_bind_bench';
const BENCH_STATS_KEY = '__dalila_bind_bench_stats';

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
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

function createBindBenchSession(): BindBenchSession {
  const enabled = isInDevMode() && (globalThis as Record<string, unknown>)[BENCH_FLAG] === true;
  return {
    enabled,
    scanMs: 0,
    parseMs: 0,
    totalExpressions: 0,
    fastPathExpressions: 0,
    planCacheHit: false,
  };
}

function flushBindBenchSession(session: BindBenchSession): void {
  if (!session.enabled) return;

  const stats = {
    scanMs: Number(session.scanMs.toFixed(3)),
    parseMs: Number(session.parseMs.toFixed(3)),
    totalExpressions: session.totalExpressions,
    fastPathExpressions: session.fastPathExpressions,
    fastPathHitPercent: session.totalExpressions === 0
      ? 0
      : Number(((session.fastPathExpressions / session.totalExpressions) * 100).toFixed(2)),
    planCacheHit: session.planCacheHit,
  };

  const globalObj = globalThis as Record<string, unknown>;
  const bucket = (globalObj[BENCH_STATS_KEY] as { runs?: unknown[]; last?: unknown } | undefined) ?? {};
  const runs = Array.isArray(bucket.runs) ? bucket.runs : [];
  runs.push(stats);
  if (runs.length > 200) runs.shift();
  bucket.runs = runs;
  bucket.last = stats;
  globalObj[BENCH_STATS_KEY] = bucket;
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

function parseInterpolationExpression(
  expression: string,
  benchSession?: BindBenchSession
): { ok: true; ast: ExprNode } | { ok: false; message: string } {
  let ast = expressionCache.get(expression);
  if (ast === undefined) {
    const parseStart = benchSession?.enabled ? nowMs() : 0;
    try {
      ast = parseExpression(expression);
      expressionCache.set(expression, ast);
      if (benchSession?.enabled) {
        benchSession.parseMs += nowMs() - parseStart;
      }
    } catch (err) {
      expressionCache.set(expression, null);
      if (benchSession?.enabled) {
        benchSession.parseMs += nowMs() - parseStart;
      }
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
  compiled: CompiledExpression,
  benchSession: BindBenchSession | undefined
): { ok: true; ast: ExprNode } | { ok: false; message: string } {
  if (compiled.kind === 'fast_path') {
    return { ok: true, ast: compiled.ast };
  }
  return parseInterpolationExpression(compiled.expression, benchSession);
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
  ctx: BindContext,
  benchSession: BindBenchSession | undefined
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

    const parsed = resolveCompiledExpression(segment.compiled, benchSession);
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
  cacheConfig: TemplatePlanCacheConfig,
  benchSession?: BindBenchSession
): void {
  const signature = createInterpolationTemplateSignature(root, rawTextSelectors);
  const now = nowMs();
  let plan = getCachedTemplatePlan(signature, now, cacheConfig);

  const scanStart = benchSession?.enabled ? nowMs() : 0;
  if (!plan) {
    plan = createInterpolationTemplatePlan(root, rawTextSelectors);
    setCachedTemplatePlan(signature, plan, now, cacheConfig);
  } else if (benchSession) {
    benchSession.planCacheHit = true;
  }
  if (benchSession?.enabled) {
    benchSession.scanMs += nowMs() - scanStart;
    benchSession.totalExpressions = plan.totalExpressions;
    benchSession.fastPathExpressions = plan.fastPathExpressions;
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
    bindTextNodeFromPlan(item.node, item.binding, ctx, benchSession);
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

function syncPortalElement(el: HTMLElement): void {
  const sync = portalSyncByElement.get(el);
  sync?.();
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
  const elements = qsaIncludingRoot(root, '[d-portal]');

  for (const el of elements) {
    const rawExpression = el.getAttribute('d-portal')?.trim();
    if (!rawExpression) continue;

    let expressionAst: ExprNode | null = null;
    let fallbackSelector: string | null = null;
    try {
      expressionAst = parseExpression(rawExpression);
    } catch {
      // Allow selector shorthand: d-portal="#modal-root"
      fallbackSelector = rawExpression;
    }

    const htmlEl = el as HTMLElement;
    const anchor = document.createComment('d-portal');
    htmlEl.parentNode?.insertBefore(anchor, htmlEl);

    const coerceTarget = (value: unknown): Element | null => {
      const resolved = resolve(value);
      if (resolved == null || resolved === false) return null;

      if (typeof resolved === 'string') {
        const selector = resolved.trim();
        if (!selector) return null;
        if (typeof document === 'undefined') return null;
        const target = document.querySelector(selector);
        if (!target) {
          warn(`d-portal: target "${selector}" not found`);
          return null;
        }
        return target;
      }

      if (typeof Element !== 'undefined' && resolved instanceof Element) {
        return resolved;
      }

      warn('d-portal: expression must resolve to selector string, Element, or null');
      return null;
    };

    const restoreToAnchor = () => {
      const hostParent = anchor.parentNode;
      if (!hostParent) return;
      if (htmlEl.parentNode === hostParent) return;
      const next = anchor.nextSibling;
      if (next) hostParent.insertBefore(htmlEl, next);
      else hostParent.appendChild(htmlEl);
    };

    const syncPortal = () => {
      let target: Element | null = null;

      if (expressionAst) {
        const result = evalExpressionAst(expressionAst, ctx);
        if (!result.ok) {
          if (result.reason === 'missing_identifier') {
            warn(`d-portal: ${result.message}`);
          } else {
            warn(`d-portal: invalid expression "${rawExpression}"`);
          }
          target = null;
        } else {
          target = coerceTarget(result.value);
        }
      } else {
        target = coerceTarget(fallbackSelector);
      }

      if (!target) {
        restoreToAnchor();
        return;
      }

      if (htmlEl.parentNode !== target) {
        target.appendChild(htmlEl);
      }
    };

    portalSyncByElement.set(htmlEl, syncPortal);
    bindEffect(htmlEl, syncPortal);

    cleanups.push(() => {
      portalSyncByElement.delete(htmlEl);
      restoreToAnchor();
      anchor.remove();
    });
  }
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
  events: string[]
): void {
  const elements = qsaIncludingRoot(root, '[d-lazy]');

  for (const el of elements) {
    const lazyComponentName = normalizeBinding(el.getAttribute('d-lazy'));
    if (!lazyComponentName) continue;

    const lazyResult = getLazyComponent(lazyComponentName);
    if (!lazyResult) {
      warn(`d-lazy: component "${lazyComponentName}" not found. Use createLazyComponent() to create it.`);
      continue;
    }

    const { state } = lazyResult;
    const htmlEl = el as HTMLElement;

    // Get loading and error templates from attributes
    const loadingTemplate = el.getAttribute('d-lazy-loading') ?? state.loadingTemplate ?? '';
    const errorTemplate = el.getAttribute('d-lazy-error') ?? state.errorTemplate ?? '';

    // Remove the d-lazy attribute to prevent reprocessing
    el.removeAttribute('d-lazy');
    el.removeAttribute('d-lazy-loading');
    el.removeAttribute('d-lazy-error');

    // Track the current rendered node (starts as the original placeholder element)
    let currentNode: Node = htmlEl;
    let componentMounted = false;
    let componentDispose: (() => void) | null = null;
    let componentEl: HTMLElement | null = null;
    let hasIntersected = false;
    const refName = normalizeBinding(htmlEl.getAttribute('d-ref'));
    const syncRef = (node: Node): void => {
      if (!refName) return;
      if (node instanceof Element) {
        refs.set(refName, node);
      }
    };

    const replaceCurrentNode = (nextNode: Node): void => {
      const parent = currentNode.parentNode;
      if (!parent) return;
      parent.replaceChild(nextNode, currentNode);
      currentNode = nextNode;
      syncRef(nextNode);
    };

    const unmountComponent = (): void => {
      if (componentDispose) {
        componentDispose();
        componentDispose = null;
      }
      componentMounted = false;
      componentEl = null;
    };

    // Function to render the loaded component
    const renderComponent = () => {
      const comp = state.component();
      if (!comp) return;

      // Create component element
      const compDef = comp.definition;
      const compEl = document.createElement(compDef.tag);
      
      // Copy attributes from placeholder to component
      for (const attr of Array.from(htmlEl.attributes)) {
        if (!attr.name.startsWith('d-')) {
          compEl.setAttribute(attr.name, attr.value);
        }
      }

      if (componentMounted && componentEl === compEl) return;

      replaceCurrentNode(compEl);
      componentEl = compEl;

      // Bind the component
      const parentCtx: BindContext = Object.create(ctx);
      const parent = compEl.parentNode;
      const nextSibling = compEl.nextSibling;
      componentDispose = bind(compEl, parentCtx, {
        components: { [compDef.tag]: comp },
        events,
        _skipLifecycle: true,
      });

      // bind() may replace the component host node; keep currentNode/ref pointing to the connected node.
      if (!compEl.isConnected && parent) {
        const renderedNode = nextSibling ? nextSibling.previousSibling : parent.lastChild;
        if (renderedNode instanceof Node) {
          currentNode = renderedNode;
          syncRef(renderedNode);
        }
      }

      componentMounted = true;
    };

    // Function to show loading state
    const showLoading = () => {
      if (loadingTemplate) {
        if (componentMounted) {
          unmountComponent();
        }
        const loadingEl = document.createElement('div');
        loadingEl.innerHTML = loadingTemplate;
        replaceCurrentNode(loadingEl);
      }
    };

    // Function to show error state
    const showError = (err: Error) => {
      if (componentMounted) {
        unmountComponent();
      }

      if (errorTemplate) {
        const errorEl = document.createElement('div');
        errorEl.innerHTML = errorTemplate;
        replaceCurrentNode(errorEl);
      } else {
        warn(`d-lazy: failed to load "${lazyComponentName}": ${err.message}`);
      }
    };

    const syncFromState = () => {
      // Always read reactive state so this effect stays subscribed even before visibility.
      const loading = state.loading();
      const error = state.error();
      const comp = state.component();

      if (!hasIntersected) return;

      if (error) {
        showError(error);
        return;
      }

      if (loading && !comp) {
        showLoading();
        return;
      }

      if (comp && !componentMounted) {
        renderComponent();
      }
    };

    // React to loading state changes
    bindEffect(htmlEl, () => {
      syncFromState();
    });

    // Observe element for viewport visibility
    const cleanupObserver = observeLazyElement(
      htmlEl,
      () => {
        hasIntersected = true;
        syncFromState();
        state.load();
      },
      0 // Trigger when element enters viewport
    );

    cleanups.push(() => {
      cleanupObserver();
      unmountComponent();
    });
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

function readVirtualNumberOption(
  raw: string | null,
  ctx: BindContext,
  label: string
): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) {
    warn(`${label}: "${trimmed}" not found in context`);
    return null;
  }

  const resolved = resolve(fromCtx);
  if (typeof resolved === 'number' && Number.isFinite(resolved)) return resolved;

  const numericFromString = Number(resolved);
  if (Number.isFinite(numericFromString)) return numericFromString;

  warn(`${label}: "${trimmed}" must resolve to a finite number`);
  return null;
}

function readVirtualHeightOption(raw: string | null, ctx: BindContext): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return `${asNumber}px`;

  const fromCtx = ctx[trimmed];
  if (fromCtx !== undefined) {
    const resolved = resolve(fromCtx);
    if (typeof resolved === 'number' && Number.isFinite(resolved)) return `${resolved}px`;
    if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
  }

  return trimmed;
}

function readVirtualMeasureOption(raw: string | null, ctx: BindContext): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === 'auto') return true;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) return false;
  const resolved = resolve(fromCtx);
  if (resolved === true) return true;
  if (typeof resolved === 'string' && resolved.trim().toLowerCase() === 'auto') return true;
  return false;
}

function readVirtualCallbackOption(
  raw: string | null,
  ctx: BindContext,
  label: string
): (() => unknown) | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fromCtx = ctx[trimmed];
  if (fromCtx === undefined) {
    warn(`${label}: "${trimmed}" not found in context`);
    return null;
  }

  if (typeof fromCtx === 'function' && !isSignal(fromCtx)) {
    return fromCtx as () => unknown;
  }

  if (isSignal(fromCtx)) {
    const resolved = fromCtx();
    if (typeof resolved === 'function') {
      return resolved as () => unknown;
    }
  }

  warn(`${label}: "${trimmed}" must resolve to a function`);
  return null;
}

function createVirtualSpacer(template: Element, kind: 'top' | 'bottom'): HTMLElement {
  const spacer = template.cloneNode(false) as HTMLElement;

  spacer.removeAttribute('id');
  spacer.removeAttribute('class');

  for (const attr of Array.from(spacer.attributes)) {
    if (attr.name.startsWith('d-')) {
      spacer.removeAttribute(attr.name);
    }
  }

  spacer.textContent = '';
  spacer.setAttribute('aria-hidden', 'true');
  spacer.setAttribute('data-dalila-virtual-spacer', kind);
  spacer.style.height = '0px';
  spacer.style.margin = '0';
  spacer.style.padding = '0';
  spacer.style.border = '0';
  spacer.style.pointerEvents = 'none';
  spacer.style.visibility = 'hidden';
  spacer.style.listStyle = 'none';

  return spacer;
}

const virtualScrollRestoreCache = new Map<string, number>();
const VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES = 256;

function getVirtualScrollRestoreValue(key: string): number | undefined {
  const value = virtualScrollRestoreCache.get(key);
  if (value === undefined) return undefined;
  // Touch entry to keep LRU ordering.
  virtualScrollRestoreCache.delete(key);
  virtualScrollRestoreCache.set(key, value);
  return value;
}

function setVirtualScrollRestoreValue(key: string, value: number): void {
  virtualScrollRestoreCache.delete(key);
  virtualScrollRestoreCache.set(key, value);
  while (virtualScrollRestoreCache.size > VIRTUAL_SCROLL_RESTORE_CACHE_MAX_ENTRIES) {
    const oldestKey = virtualScrollRestoreCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    virtualScrollRestoreCache.delete(oldestKey);
  }
}

function clampVirtual(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getElementPositionPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current) {
    const tag = current.tagName.toLowerCase();
    const parentEl: Element | null = current.parentElement;
    if (!parentEl) {
      parts.push(tag);
      break;
    }

    let index = 1;
    let sib: Element | null = current.previousElementSibling;
    while (sib) {
      index++;
      sib = sib.previousElementSibling;
    }

    parts.push(`${tag}:${index}`);
    current = parentEl;
  }

  return parts.reverse().join('>');
}

const virtualRestoreDocumentIds = new WeakMap<Document, number>();
let nextVirtualRestoreDocumentId = 0;

function getVirtualRestoreDocumentId(doc: Document): number {
  const existing = virtualRestoreDocumentIds.get(doc);
  if (existing !== undefined) return existing;
  const next = ++nextVirtualRestoreDocumentId;
  virtualRestoreDocumentIds.set(doc, next);
  return next;
}

function getVirtualRestoreKey(
  doc: Document,
  templatePath: string,
  scrollContainer: HTMLElement | null,
  bindingName: string,
  keyBinding: string | null
): string {
  const locationPath = typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}`
    : '';
  const containerIdentity = scrollContainer?.id
    ? `#${scrollContainer.id}`
    : (scrollContainer ? getElementPositionPath(scrollContainer) : '');
  const docId = getVirtualRestoreDocumentId(doc);
  return `${docId}|${locationPath}|${bindingName}|${keyBinding ?? ''}|${containerIdentity}|${templatePath}`;
}

class VirtualHeightsIndex {
  private itemCount = 0;
  private estimatedHeight = 1;
  private tree: number[] = [0];
  private overrides = new Map<number, number>();

  constructor(itemCount: number, estimatedHeight: number) {
    this.reset(itemCount, estimatedHeight);
  }

  get count(): number {
    return this.itemCount;
  }

  snapshotOverrides(): Map<number, number> {
    return new Map(this.overrides);
  }

  reset(itemCount: number, estimatedHeight: number, seed?: Map<number, number>): void {
    this.itemCount = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
    this.estimatedHeight = Number.isFinite(estimatedHeight) ? Math.max(1, estimatedHeight) : 1;
    this.tree = new Array(this.itemCount + 1).fill(0);
    this.overrides.clear();

    for (let i = 0; i < this.itemCount; i++) {
      this.addAt(i + 1, this.estimatedHeight);
    }

    if (!seed) return;
    for (const [index, height] of seed.entries()) {
      if (index < 0 || index >= this.itemCount) continue;
      this.set(index, height);
    }
  }

  set(index: number, height: number): boolean {
    if (!Number.isFinite(height) || height <= 0) return false;
    if (index < 0 || index >= this.itemCount) return false;

    const next = Math.max(1, height);
    const current = this.get(index);
    if (Math.abs(next - current) < 0.5) return false;

    this.addAt(index + 1, next - current);
    if (Math.abs(next - this.estimatedHeight) < 0.5) {
      this.overrides.delete(index);
    } else {
      this.overrides.set(index, next);
    }
    return true;
  }

  get(index: number): number {
    if (index < 0 || index >= this.itemCount) return this.estimatedHeight;
    return this.overrides.get(index) ?? this.estimatedHeight;
  }

  prefix(endExclusive: number): number {
    if (endExclusive <= 0) return 0;
    const clampedEnd = Math.min(this.itemCount, Math.max(0, Math.floor(endExclusive)));
    let i = clampedEnd;
    let sum = 0;
    while (i > 0) {
      sum += this.tree[i];
      i -= i & -i;
    }
    return sum;
  }

  total(): number {
    return this.prefix(this.itemCount);
  }

  lowerBound(target: number): number {
    if (this.itemCount === 0 || target <= 0) return 0;

    let idx = 0;
    let bit = 1;
    while ((bit << 1) <= this.itemCount) bit <<= 1;

    let sum = 0;
    while (bit > 0) {
      const next = idx + bit;
      if (next <= this.itemCount && sum + this.tree[next] < target) {
        idx = next;
        sum += this.tree[next];
      }
      bit >>= 1;
    }
    return Math.min(this.itemCount, idx);
  }

  indexAtOffset(offset: number): number {
    if (this.itemCount === 0) return 0;
    if (!Number.isFinite(offset) || offset <= 0) return 0;
    const totalHeight = this.total();
    if (offset >= totalHeight) return this.itemCount - 1;
    const idx = this.lowerBound(offset + 0.0001);
    return clampVirtual(idx, 0, this.itemCount - 1);
  }

  private addAt(treeIndex: number, delta: number): void {
    let i = treeIndex;
    while (i <= this.itemCount) {
      this.tree[i] += delta;
      i += i & -i;
    }
  }
}

type VirtualListApi = VirtualListController;

type VirtualHostElement = HTMLElement & { __dalilaVirtualList?: VirtualListApi };

function readVirtualListApi(target: Element | null): VirtualListApi | null {
  if (!target) return null;
  return (target as VirtualHostElement).__dalilaVirtualList ?? null;
}

export function getVirtualListController(target: Element | null): VirtualListController | null {
  return readVirtualListApi(target);
}

export function scrollToVirtualIndex(
  target: Element | null,
  index: number,
  options?: VirtualScrollToIndexOptions
): boolean {
  const controller = readVirtualListApi(target);
  if (!controller) return false;
  controller.scrollToIndex(index, options);
  return true;
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
  cleanups: DisposeFunction[]
): void {
  const elements = qsaIncludingRoot(root, '[d-virtual-each]')
    .filter(el => !el.parentElement?.closest('[d-virtual-each], [d-each]'));

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-virtual-each'));
    if (!bindingName) continue;

    const itemHeightBinding = normalizeBinding(el.getAttribute('d-virtual-item-height'));
    const itemHeightRaw = itemHeightBinding ?? el.getAttribute('d-virtual-item-height');
    const itemHeightValue = readVirtualNumberOption(itemHeightRaw, ctx, 'd-virtual-item-height');
    const fixedItemHeight = Number.isFinite(itemHeightValue as number) && (itemHeightValue as number) > 0
      ? (itemHeightValue as number)
      : NaN;

    const dynamicHeight = readVirtualMeasureOption(
      normalizeBinding(el.getAttribute('d-virtual-measure')) ?? el.getAttribute('d-virtual-measure'),
      ctx
    );

    if (!dynamicHeight && (!Number.isFinite(fixedItemHeight) || fixedItemHeight <= 0)) {
      warn(`d-virtual-each: invalid item height on "${bindingName}". Falling back to d-each.`);
      el.setAttribute('d-each', bindingName);
      el.removeAttribute('d-virtual-each');
      el.removeAttribute('d-virtual-item-height');
      el.removeAttribute('d-virtual-estimated-height');
      el.removeAttribute('d-virtual-measure');
      el.removeAttribute('d-virtual-infinite');
      el.removeAttribute('d-virtual-overscan');
      el.removeAttribute('d-virtual-height');
      continue;
    }

    const estimatedHeightBinding = normalizeBinding(el.getAttribute('d-virtual-estimated-height'));
    const estimatedHeightRaw = estimatedHeightBinding ?? el.getAttribute('d-virtual-estimated-height');
    const estimatedHeightValue = readVirtualNumberOption(
      estimatedHeightRaw,
      ctx,
      'd-virtual-estimated-height'
    );
    const estimatedItemHeight = Number.isFinite(estimatedHeightValue as number) && (estimatedHeightValue as number) > 0
      ? (estimatedHeightValue as number)
      : (Number.isFinite(fixedItemHeight) ? fixedItemHeight : 48);

    const overscanBinding = normalizeBinding(el.getAttribute('d-virtual-overscan'));
    const overscanRaw = overscanBinding ?? el.getAttribute('d-virtual-overscan');
    const overscanValue = readVirtualNumberOption(overscanRaw, ctx, 'd-virtual-overscan');
    const overscan = Number.isFinite(overscanValue as number)
      ? Math.max(0, Math.floor(overscanValue as number))
      : 6;

    const viewportHeight = readVirtualHeightOption(
      normalizeBinding(el.getAttribute('d-virtual-height')) ?? el.getAttribute('d-virtual-height'),
      ctx
    );

    const onEndReached = readVirtualCallbackOption(
      normalizeBinding(el.getAttribute('d-virtual-infinite')) ?? el.getAttribute('d-virtual-infinite'),
      ctx,
      'd-virtual-infinite'
    );

    let binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-virtual-each: "${bindingName}" not found in context`);
      binding = [];
    }

    const templatePathBeforeDetach = getElementPositionPath(el);
    const comment = document.createComment('d-virtual-each');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-virtual-each');
    el.removeAttribute('d-virtual-item-height');
    el.removeAttribute('d-virtual-estimated-height');
    el.removeAttribute('d-virtual-measure');
    el.removeAttribute('d-virtual-infinite');
    el.removeAttribute('d-virtual-overscan');
    el.removeAttribute('d-virtual-height');

    const keyBinding = normalizeBinding(el.getAttribute('d-key'));
    el.removeAttribute('d-key');

    const template = el;
    const topSpacer = createVirtualSpacer(template, 'top');
    const bottomSpacer = createVirtualSpacer(template, 'bottom');

    comment.parentNode?.insertBefore(topSpacer, comment);
    comment.parentNode?.insertBefore(bottomSpacer, comment);

    const scrollContainer = comment.parentElement as HTMLElement | null;
    if (scrollContainer) {
      if (viewportHeight) scrollContainer.style.height = viewportHeight;
      if (!scrollContainer.style.overflowY) scrollContainer.style.overflowY = 'auto';
    }

    const restoreKey = getVirtualRestoreKey(
      el.ownerDocument,
      templatePathBeforeDetach,
      scrollContainer,
      bindingName,
      keyBinding
    );
    const savedScrollTop = getVirtualScrollRestoreValue(restoreKey);
    if (scrollContainer && Number.isFinite(savedScrollTop as number)) {
      scrollContainer.scrollTop = Math.max(0, savedScrollTop as number);
    }

    const clonesByKey = new Map<string, Element>();
    const disposesByKey = new Map<string, DisposeFunction>();
    const observedElements = new Set<Element>();
    type MetadataSignals = {
      $index: Signal<number>;
      $count: Signal<number>;
      $first: Signal<boolean>;
      $last: Signal<boolean>;
      $odd: Signal<boolean>;
      $even: Signal<boolean>;
    };
    const metadataByKey = new Map<string, MetadataSignals>();
    const itemsByKey = new Map<string, unknown>();
    const objectKeyIds = new WeakMap<object, number>();
    const symbolKeyIds = new Map<symbol, number>();
    let nextObjectKeyId = 0;
    let nextSymbolKeyId = 0;
    const missingKeyWarned = new Set<string>();
    let warnedNonArray = false;
    let warnedViewportFallback = false;
    let heightsIndex = dynamicHeight ? new VirtualHeightsIndex(0, estimatedItemHeight) : null;

    const getObjectKeyId = (value: object): number => {
      const existing = objectKeyIds.get(value);
      if (existing !== undefined) return existing;
      const next = ++nextObjectKeyId;
      objectKeyIds.set(value, next);
      return next;
    };

    const keyValueToString = (value: unknown, index: number): string => {
      if (value === null || value === undefined) return `idx:${index}`;
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
        return `${type}:${String(value)}`;
      }
      if (type === 'symbol') {
        const sym = value as symbol;
        let id = symbolKeyIds.get(sym);
        if (id === undefined) {
          id = ++nextSymbolKeyId;
          symbolKeyIds.set(sym, id);
        }
        return `sym:${id}`;
      }
      if (type === 'object' || type === 'function') {
        return `obj:${getObjectKeyId(value as object)}`;
      }
      return `idx:${index}`;
    };

    const readKeyValue = (item: unknown, index: number): unknown => {
      if (keyBinding) {
        if (keyBinding === '$index') return index;
        if (keyBinding === 'item') return item;
        if (typeof item === 'object' && item !== null && keyBinding in (item as Record<string, unknown>)) {
          return (item as Record<string, unknown>)[keyBinding];
        }
        const warnId = `${keyBinding}:${index}`;
        if (!missingKeyWarned.has(warnId)) {
          warn(`d-virtual-each: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
          missingKeyWarned.add(warnId);
        }
        return index;
      }

      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('id' in obj) return obj.id;
        if ('key' in obj) return obj.key;
      }
      return index;
    };

    let rowResizeObserver: ResizeObserver | null = null;

    function createClone(key: string, item: unknown, index: number, count: number): Element {
      const clone = template.cloneNode(true) as Element;

      const itemCtx = Object.create(ctx) as BindContext;
      if (typeof item === 'object' && item !== null) {
        Object.assign(itemCtx, item as Record<string, unknown>);
      }

      const metadata: MetadataSignals = {
        $index: signal(index),
        $count: signal(count),
        $first: signal(index === 0),
        $last: signal(index === count - 1),
        $odd: signal(index % 2 !== 0),
        $even: signal(index % 2 === 0),
      };
      metadataByKey.set(key, metadata);
      itemsByKey.set(key, item);

      itemCtx.item = item;
      itemCtx.key = key;
      itemCtx.$index = metadata.$index;
      itemCtx.$count = metadata.$count;
      itemCtx.$first = metadata.$first;
      itemCtx.$last = metadata.$last;
      itemCtx.$odd = metadata.$odd;
      itemCtx.$even = metadata.$even;

      clone.setAttribute('data-dalila-internal-bound', '');
      clone.setAttribute('data-dalila-virtual-index', String(index));
      const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
      disposesByKey.set(key, dispose);
      clonesByKey.set(key, clone);

      return clone;
    }

    function updateCloneMetadata(key: string, index: number, count: number): void {
      const metadata = metadataByKey.get(key);
      if (metadata) {
        metadata.$index.set(index);
        metadata.$count.set(count);
        metadata.$first.set(index === 0);
        metadata.$last.set(index === count - 1);
        metadata.$odd.set(index % 2 !== 0);
        metadata.$even.set(index % 2 === 0);
      }
      const clone = clonesByKey.get(key);
      if (clone) {
        clone.setAttribute('data-dalila-virtual-index', String(index));
      }
    }

    function removeKey(key: string): void {
      const clone = clonesByKey.get(key);
      if (clone && rowResizeObserver && observedElements.has(clone)) {
        rowResizeObserver.unobserve(clone);
        observedElements.delete(clone);
      }
      clone?.remove();
      clonesByKey.delete(key);
      metadataByKey.delete(key);
      itemsByKey.delete(key);
      const dispose = disposesByKey.get(key);
      if (dispose) {
        dispose();
        disposesByKey.delete(key);
      }
    }

    let currentItems: unknown[] = [];
    let lastEndReachedCount = -1;
    let endReachedPending = false;

    const remapDynamicHeights = (prevItems: unknown[], nextItems: unknown[]): void => {
      if (!dynamicHeight || !heightsIndex) return;

      const heightsByKey = new Map<string, number>();
      for (let i = 0; i < prevItems.length; i++) {
        const key = keyValueToString(readKeyValue(prevItems[i], i), i);
        if (!heightsByKey.has(key)) {
          heightsByKey.set(key, heightsIndex.get(i));
        }
      }

      heightsIndex.reset(nextItems.length, estimatedItemHeight);

      for (let i = 0; i < nextItems.length; i++) {
        const key = keyValueToString(readKeyValue(nextItems[i], i), i);
        const height = heightsByKey.get(key);
        if (height !== undefined) {
          heightsIndex.set(i, height);
        }
      }
    };

    const replaceItems = (nextItems: unknown[]): void => {
      remapDynamicHeights(currentItems, nextItems);
      currentItems = nextItems;
    };

    const maybeTriggerEndReached = (visibleEnd: number, totalCount: number) => {
      if (!onEndReached || totalCount === 0) return;
      if (visibleEnd < totalCount) return;
      if (lastEndReachedCount === totalCount || endReachedPending) return;

      lastEndReachedCount = totalCount;
      const result = onEndReached();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        endReachedPending = true;
        Promise.resolve(result)
          .catch(() => {})
          .finally(() => {
            endReachedPending = false;
          });
      }
    };

    function renderVirtualList(items: unknown[]): void {
      const parent = comment.parentNode;
      if (!parent) return;

      if (dynamicHeight && heightsIndex && heightsIndex.count !== items.length) {
        heightsIndex.reset(items.length, estimatedItemHeight);
      }

      const viewportHeightValue = scrollContainer?.clientHeight ?? 0;
      const effectiveViewportHeight = viewportHeightValue > 0
        ? viewportHeightValue
        : (dynamicHeight ? estimatedItemHeight * 10 : fixedItemHeight * 10);
      const scrollTop = scrollContainer?.scrollTop ?? 0;

      if (viewportHeightValue <= 0 && !warnedViewportFallback) {
        warnedViewportFallback = true;
        warn('d-virtual-each: scroll container has no measurable height. Using fallback viewport size.');
      }

      let start = 0;
      let end = 0;
      let topOffset = 0;
      let bottomOffset = 0;
      let totalHeight = 0;
      let visibleEndForEndReached = 0;

      if (dynamicHeight && heightsIndex) {
        totalHeight = heightsIndex.total();
        if (items.length > 0) {
          const visibleStart = heightsIndex.indexAtOffset(scrollTop);
          const visibleEnd = clampVirtual(
            heightsIndex.lowerBound(scrollTop + effectiveViewportHeight) + 1,
            visibleStart + 1,
            items.length
          );
          visibleEndForEndReached = visibleEnd;
          start = clampVirtual(visibleStart - overscan, 0, items.length);
          end = clampVirtual(visibleEnd + overscan, start, items.length);
          topOffset = heightsIndex.prefix(start);
          bottomOffset = Math.max(0, totalHeight - heightsIndex.prefix(end));
        }
      } else {
        const range = computeVirtualRange({
          itemCount: items.length,
          itemHeight: fixedItemHeight,
          scrollTop,
          viewportHeight: effectiveViewportHeight,
          overscan,
        });
        start = range.start;
        end = range.end;
        topOffset = range.topOffset;
        bottomOffset = range.bottomOffset;
        totalHeight = range.totalHeight;
        visibleEndForEndReached = clampVirtual(
          Math.ceil((scrollTop + effectiveViewportHeight) / fixedItemHeight),
          0,
          items.length
        );
      }

      topSpacer.style.height = `${topOffset}px`;
      bottomSpacer.style.height = `${bottomOffset}px`;
      topSpacer.setAttribute('data-dalila-virtual-total', String(totalHeight));

      const orderedClones: Element[] = [];
      const orderedKeys: string[] = [];
      const nextKeys = new Set<string>();
      const changedKeys = new Set<string>();

      for (let i = start; i < end; i++) {
        const item = items[i];
        let key = keyValueToString(readKeyValue(item, i), i);
        if (nextKeys.has(key)) {
          warn(`d-virtual-each: duplicate visible key "${key}" at index ${i}. Falling back to per-index key.`);
          key = `${key}:dup:${i}`;
        }
        nextKeys.add(key);

        let clone = clonesByKey.get(key);
        if (clone) {
          updateCloneMetadata(key, i, items.length);
          if (itemsByKey.get(key) !== item) {
            changedKeys.add(key);
          }
        } else {
          clone = createClone(key, item, i, items.length);
        }

        orderedClones.push(clone);
        orderedKeys.push(key);
      }

      for (let i = 0; i < orderedClones.length; i++) {
        const key = orderedKeys[i];
        if (!changedKeys.has(key)) continue;
        removeKey(key);
        orderedClones[i] = createClone(key, items[start + i], start + i, items.length);
      }

      for (const key of Array.from(clonesByKey.keys())) {
        if (nextKeys.has(key)) continue;
        removeKey(key);
      }

      let referenceNode: Node = bottomSpacer;
      for (let i = orderedClones.length - 1; i >= 0; i--) {
        const clone = orderedClones[i];
        if (clone.nextSibling !== referenceNode) {
          parent.insertBefore(clone, referenceNode);
        }
        referenceNode = clone;
      }

      if (dynamicHeight && rowResizeObserver) {
        const nextObserved = new Set<Element>(orderedClones);
        for (const clone of Array.from(observedElements)) {
          if (nextObserved.has(clone)) continue;
          rowResizeObserver.unobserve(clone);
          observedElements.delete(clone);
        }
        for (const clone of orderedClones) {
          if (observedElements.has(clone)) continue;
          rowResizeObserver.observe(clone);
          observedElements.add(clone);
        }
      }

      maybeTriggerEndReached(visibleEndForEndReached, items.length);
    }

    let framePending = false;
    let pendingRaf: number | null = null;
    let pendingTimeout: ReturnType<typeof setTimeout> | null = null;

    const scheduleRender = () => {
      if (framePending) return;
      framePending = true;

      const flush = () => {
        framePending = false;
        renderVirtualList(currentItems);
      };

      if (typeof requestAnimationFrame === 'function') {
        pendingRaf = requestAnimationFrame(() => {
          pendingRaf = null;
          flush();
        });
        return;
      }

      pendingTimeout = setTimeout(() => {
        pendingTimeout = null;
        flush();
      }, 0);
    };

    const onScroll = () => scheduleRender();
    const onResize = () => scheduleRender();

    scrollContainer?.addEventListener('scroll', onScroll, { passive: true });

    let containerResizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && scrollContainer) {
      containerResizeObserver = new ResizeObserver(() => scheduleRender());
      containerResizeObserver.observe(scrollContainer);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
    }

    if (dynamicHeight && typeof ResizeObserver !== 'undefined' && heightsIndex) {
      rowResizeObserver = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const target = entry.target as Element;
          const indexRaw = target.getAttribute('data-dalila-virtual-index');
          if (!indexRaw) continue;
          const index = Number(indexRaw);
          if (!Number.isFinite(index)) continue;
          const measured = entry.contentRect?.height;
          if (!Number.isFinite(measured) || measured <= 0) continue;
          changed = heightsIndex.set(index, measured) || changed;
        }
        if (changed) scheduleRender();
      });
    }

    const scrollToIndex = (
      index: number,
      options?: VirtualScrollToIndexOptions
    ) => {
      if (!scrollContainer || currentItems.length === 0) return;
      const safeIndex = clampVirtual(Math.floor(index), 0, currentItems.length - 1);
      const viewportSize = scrollContainer.clientHeight > 0
        ? scrollContainer.clientHeight
        : (dynamicHeight ? estimatedItemHeight * 10 : fixedItemHeight * 10);
      const align = options?.align ?? 'start';

      let top = dynamicHeight && heightsIndex
        ? heightsIndex.prefix(safeIndex)
        : safeIndex * fixedItemHeight;
      const itemSize = dynamicHeight && heightsIndex
        ? heightsIndex.get(safeIndex)
        : fixedItemHeight;

      if (align === 'center') {
        top = top - (viewportSize / 2) + (itemSize / 2);
      } else if (align === 'end') {
        top = top - viewportSize + itemSize;
      }
      top = Math.max(0, top);

      if (options?.behavior && typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top, behavior: options.behavior });
      } else {
        scrollContainer.scrollTop = top;
      }
      scheduleRender();
    };

    const virtualApi: VirtualListApi = {
      scrollToIndex,
      refresh: scheduleRender,
    };

    if (scrollContainer) {
      (scrollContainer as VirtualHostElement).__dalilaVirtualList = virtualApi;
    }

    if (isSignal(binding)) {
      bindEffect(scrollContainer ?? el, () => {
        const value = binding();
        if (Array.isArray(value)) {
          warnedNonArray = false;
          replaceItems(value);
        } else {
          if (!warnedNonArray) {
            warnedNonArray = true;
            warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
          }
          replaceItems([]);
        }
        renderVirtualList(currentItems);
      });
    } else if (Array.isArray(binding)) {
      replaceItems(binding);
      renderVirtualList(currentItems);
    } else {
      warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
    }

    cleanups.push(() => {
      scrollContainer?.removeEventListener('scroll', onScroll);
      if (containerResizeObserver) {
        containerResizeObserver.disconnect();
      } else if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
      if (pendingRaf != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(pendingRaf);
      }
      pendingRaf = null;
      if (pendingTimeout != null) clearTimeout(pendingTimeout);
      pendingTimeout = null;
      if (rowResizeObserver) {
        rowResizeObserver.disconnect();
      }
      observedElements.clear();
      if (scrollContainer) {
        setVirtualScrollRestoreValue(restoreKey, scrollContainer.scrollTop);
        const host = scrollContainer as VirtualHostElement;
        if (host.__dalilaVirtualList === virtualApi) {
          delete host.__dalilaVirtualList;
        }
      }
      for (const key of Array.from(clonesByKey.keys())) removeKey(key);
      topSpacer.remove();
      bottomSpacer.remove();
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
  // Only bind top-level d-each elements. Nested d-each inside d-each or
  // d-virtual-each templates must be left untouched here — they are bound when
  // parent clones are passed to bind() individually.
  const elements = qsaIncludingRoot(root, '[d-each]')
    .filter(el => !el.parentElement?.closest('[d-each], [d-virtual-each]'));

  for (const el of elements) {
    const rawValue = el.getAttribute('d-each')?.trim() ?? '';
    let bindingName: string | null;
    let alias = 'item'; // default
    const asMatch = rawValue.match(/^(\S+)\s+as\s+(\S+)$/);
    if (asMatch) {
      bindingName = normalizeBinding(asMatch[1]);
      alias = asMatch[2];
    } else {
      bindingName = normalizeBinding(rawValue);
    }
    if (!bindingName) continue;

    let binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-each: "${bindingName}" not found in context`);
      binding = [];
    }

    const comment = document.createComment('d-each');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-each');
    const keyBinding = normalizeBinding(el.getAttribute('d-key'));
    el.removeAttribute('d-key');

    const template = el;
    const clonesByKey = new Map<string, Element>();
    const disposesByKey = new Map<string, DisposeFunction>();
    type MetadataSignals = {
      $index: Signal<number>;
      $count: Signal<number>;
      $first: Signal<boolean>;
      $last: Signal<boolean>;
      $odd: Signal<boolean>;
      $even: Signal<boolean>;
    };
    const metadataByKey = new Map<string, MetadataSignals>();
    const itemsByKey = new Map<string, unknown>();
    const objectKeyIds = new WeakMap<object, number>();
    const symbolKeyIds = new Map<symbol, number>();
    let nextObjectKeyId = 0;
    let nextSymbolKeyId = 0;
    const missingKeyWarned = new Set<string>();

    const getObjectKeyId = (value: object): number => {
      const existing = objectKeyIds.get(value);
      if (existing !== undefined) return existing;
      const next = ++nextObjectKeyId;
      objectKeyIds.set(value, next);
      return next;
    };

    const keyValueToString = (value: unknown, index: number): string => {
      if (value === null || value === undefined) return `idx:${index}`;
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
        return `${type}:${String(value)}`;
      }
      if (type === 'symbol') {
        const sym = value as symbol;
        let id = symbolKeyIds.get(sym);
        if (id === undefined) {
          id = ++nextSymbolKeyId;
          symbolKeyIds.set(sym, id);
        }
        return `sym:${id}`;
      }
      if (type === 'object' || type === 'function') {
        return `obj:${getObjectKeyId(value as object)}`;
      }
      return `idx:${index}`;
    };

    const readKeyValue = (item: unknown, index: number): unknown => {
      if (keyBinding) {
        if (keyBinding === '$index') return index;
        if (keyBinding === alias || keyBinding === 'item') return item;
        if (typeof item === 'object' && item !== null && keyBinding in (item as Record<string, unknown>)) {
          return (item as Record<string, unknown>)[keyBinding];
        }
        const warnId = `${keyBinding}:${index}`;
        if (!missingKeyWarned.has(warnId)) {
          warn(`d-each: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
          missingKeyWarned.add(warnId);
        }
        return index;
      }

      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>;
        if ('id' in obj) return obj.id;
        if ('key' in obj) return obj.key;
      }
      return index;
    };

    function createClone(key: string, item: unknown, index: number, count: number): Element {
      const clone = template.cloneNode(true) as Element;

      // Inherit parent ctx via prototype so values and handlers defined
      // outside the loop remain accessible inside each iteration.
      const itemCtx = Object.create(ctx) as BindContext;
      if (typeof item === 'object' && item !== null) {
        Object.assign(itemCtx, item as Record<string, unknown>);
      }

      const metadata: MetadataSignals = {
        $index: signal(index),
        $count: signal(count),
        $first: signal(index === 0),
        $last: signal(index === count - 1),
        $odd: signal(index % 2 !== 0),
        $even: signal(index % 2 === 0),
      };
      metadataByKey.set(key, metadata);
      itemsByKey.set(key, item);

      // Expose item under the alias name + positional / collection helpers.
      itemCtx[alias] = item;
      if (alias !== 'item') {
        itemCtx.item = item; // backward compat
      }
      itemCtx.key = key;
      itemCtx.$index = metadata.$index;
      itemCtx.$count = metadata.$count;
      itemCtx.$first = metadata.$first;
      itemCtx.$last = metadata.$last;
      itemCtx.$odd = metadata.$odd;
      itemCtx.$even = metadata.$even;

      // Mark BEFORE bind() so the parent's subsequent global passes
      // (text, attrs, events …) skip this subtree entirely.
      clone.setAttribute('data-dalila-internal-bound', '');

      const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
      disposesByKey.set(key, dispose);
      clonesByKey.set(key, clone);

      return clone;
    }

    function updateCloneMetadata(key: string, index: number, count: number): void {
      const metadata = metadataByKey.get(key);
      if (metadata) {
        metadata.$index.set(index);
        metadata.$count.set(count);
        metadata.$first.set(index === 0);
        metadata.$last.set(index === count - 1);
        metadata.$odd.set(index % 2 !== 0);
        metadata.$even.set(index % 2 === 0);
      }
    }

    function renderList(items: unknown[]) {
      const orderedClones: Element[] = [];
      const orderedKeys: string[] = [];
      const nextKeys = new Set<string>();
      const changedKeys = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        let key = keyValueToString(readKeyValue(item, i), i);
        if (nextKeys.has(key)) {
          warn(`d-each: duplicate key "${key}" at index ${i}. Falling back to per-index key.`);
          key = `${key}:dup:${i}`;
        }
        nextKeys.add(key);

        let clone = clonesByKey.get(key);
        if (clone) {
          updateCloneMetadata(key, i, items.length);
          if (itemsByKey.get(key) !== item) {
            changedKeys.add(key);
          }
        } else {
          clone = createClone(key, item, i, items.length);
        }

        orderedClones.push(clone);
        orderedKeys.push(key);
      }

      for (let i = 0; i < orderedClones.length; i++) {
        const clone = orderedClones[i];
        const item = items[i];
        const key = orderedKeys[i];
        if (!changedKeys.has(key)) continue;

        clone.remove();
        const dispose = disposesByKey.get(key);
        if (dispose) {
          dispose();
          disposesByKey.delete(key);
        }
        clonesByKey.delete(key);
        metadataByKey.delete(key);
        itemsByKey.delete(key);

        orderedClones[i] = createClone(key, item, i, items.length);
      }

      for (const [key, clone] of clonesByKey) {
        if (nextKeys.has(key)) continue;
        clone.remove();
        clonesByKey.delete(key);
        metadataByKey.delete(key);
        itemsByKey.delete(key);
        const dispose = disposesByKey.get(key);
        if (dispose) {
          dispose();
          disposesByKey.delete(key);
        }
      }

      const parent = comment.parentNode;
      if (!parent) return;

      let referenceNode: Node = comment;
      for (let i = orderedClones.length - 1; i >= 0; i--) {
        const clone = orderedClones[i];
        if (clone.nextSibling !== referenceNode) {
          parent.insertBefore(clone, referenceNode);
        }
        referenceNode = clone;
      }
    }

    if (isSignal(binding)) {
      // Effect owned by templateScope — no manual stop needed
      bindEffect(el, () => {
        const value = binding();
        renderList(Array.isArray(value) ? value : []);
      });
    } else if (Array.isArray(binding)) {
      renderList(binding);
    } else {
      warn(`d-each: "${bindingName}" is not an array or signal`);
    }

    cleanups.push(() => {
      for (const clone of clonesByKey.values()) clone.remove();
      for (const dispose of disposesByKey.values()) dispose();
      clonesByKey.clear();
      disposesByKey.clear();
      metadataByKey.clear();
      itemsByKey.clear();
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
  cleanups: DisposeFunction[],
  transitionRegistry: TransitionRegistry
): void {
  const elements = qsaIncludingRoot(root, '[d-if]');
  const processedElse = new Set<Element>();

  for (const el of elements) {
    const bindingName = normalizeBinding(el.getAttribute('d-if'));
    if (!bindingName) continue;

    const binding = ctx[bindingName];
    if (binding === undefined) {
      warn(`d-if: "${bindingName}" not found in context`);
      continue;
    }

    // Detect d-else sibling BEFORE removing from DOM
    const elseEl = el.nextElementSibling?.hasAttribute('d-else') ? el.nextElementSibling : null;

    const comment = document.createComment('d-if');
    el.parentNode?.replaceChild(comment, el);
    el.removeAttribute('d-if');

    const htmlEl = el as HTMLElement;
    const transitions = createTransitionController(htmlEl, transitionRegistry, cleanups);

    // Handle d-else branch
    let elseHtmlEl: HTMLElement | null = null;
    let elseComment: Comment | null = null;
    let elseTransitions: ReturnType<typeof createTransitionController> | null = null;
    if (elseEl) {
      processedElse.add(elseEl);
      elseComment = document.createComment('d-else');
      elseEl.parentNode?.replaceChild(elseComment, elseEl);
      elseEl.removeAttribute('d-else');
      elseHtmlEl = elseEl as HTMLElement;
      elseTransitions = createTransitionController(elseHtmlEl, transitionRegistry, cleanups);
    }

    // Apply initial state synchronously to avoid FOUC
    const initialValue = !!resolve(binding);
    if (initialValue) {
      comment.parentNode?.insertBefore(htmlEl, comment);
      syncPortalElement(htmlEl);
      if (transitions.hasTransition) {
        htmlEl.removeAttribute('data-leave');
        htmlEl.setAttribute('data-enter', '');
      }
    } else if (elseHtmlEl && elseComment) {
      elseComment.parentNode?.insertBefore(elseHtmlEl, elseComment);
      syncPortalElement(elseHtmlEl);
      if (elseTransitions?.hasTransition) {
        elseHtmlEl.removeAttribute('data-leave');
        elseHtmlEl.setAttribute('data-enter', '');
      }
    }

    // Then create reactive effect to keep it updated
    if (elseHtmlEl && elseComment) {
      const capturedElseEl = elseHtmlEl;
      const capturedElseComment = elseComment;
      bindEffect(htmlEl, () => {
        const value = !!resolve(binding);
        if (value) {
          if (!htmlEl.parentNode) {
            comment.parentNode?.insertBefore(htmlEl, comment);
            syncPortalElement(htmlEl);
          }
          transitions.enter();
          elseTransitions?.leave(() => {
            if (capturedElseEl.parentNode) {
              capturedElseEl.parentNode.removeChild(capturedElseEl);
            }
          });
        } else {
          transitions.leave(() => {
            if (htmlEl.parentNode) {
              htmlEl.parentNode.removeChild(htmlEl);
            }
          });
          if (!capturedElseEl.parentNode) {
            capturedElseComment.parentNode?.insertBefore(capturedElseEl, capturedElseComment);
            syncPortalElement(capturedElseEl);
          }
          elseTransitions?.enter();
        }
      });
    } else {
      bindEffect(htmlEl, () => {
        const value = !!resolve(binding);
        if (value) {
          if (!htmlEl.parentNode) {
            comment.parentNode?.insertBefore(htmlEl, comment);
            syncPortalElement(htmlEl);
          }
          transitions.enter();
        } else {
          transitions.leave(() => {
            if (htmlEl.parentNode) {
              htmlEl.parentNode.removeChild(htmlEl);
            }
          });
        }
      });
    }
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
      bindEffect(htmlEl, () => {
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
        bindEffect(el, () => {
          applyAttr(el, attrName, binding());
        });
      } else {
        applyAttr(el, attrName, resolve(binding));
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
        // This avoids mutating the shared context
        el.addEventListener('submit', finalHandler);

        // Remove d-on-submit to prevent bindEvents from adding duplicate listener
        el.removeAttribute('d-on-submit');

        // Restore attribute on cleanup so dispose()+bind() (HMR) can rediscover it
        cleanups.push(() => {
          el.removeEventListener('submit', finalHandler);
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
  cleanups: DisposeFunction[]
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
      const fields: Element[] = [];
      if (clone.hasAttribute('d-field')) fields.push(clone);
      fields.push(...Array.from(clone.querySelectorAll('[d-field]')));

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
      const errors: Element[] = [];
      if (clone.hasAttribute('d-error')) errors.push(clone);
      errors.push(...Array.from(clone.querySelectorAll('[d-error]')));

      for (const errorEl of errors) {
        const relativeErrorPath = errorEl.getAttribute('d-error');
        if (relativeErrorPath) {
          const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
          errorEl.setAttribute('data-error-path', fullPath);
        }
      }

      // Update nested d-array elements to use full path (for nested field arrays)
      const nestedArrays = clone.querySelectorAll('[d-array]');
      for (const nestedArr of nestedArrays) {
        const relativeArrayPath = nestedArr.getAttribute('d-array');
        if (relativeArrayPath) {
          const fullPath = `${arrayPath}[${index}].${relativeArrayPath}`;
          nestedArr.setAttribute('data-array-path', fullPath);
        }
      }

      // Set type="button" on array control buttons to prevent form submit
      // Buttons like d-on-click="$remove" inside templates aren't processed by
      // bindArrayOperations (they don't exist yet), so set it here during clone creation
      const controlButtons = clone.querySelectorAll('button[d-on-click*="$remove"], button[d-on-click*="$moveUp"], button[d-on-click*="$moveDown"], button[d-on-click*="$swap"]');
      for (const btn of controlButtons) {
        if (btn.getAttribute('type') !== 'button') {
          btn.setAttribute('type', 'button');
        }
      }

      const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
      disposesByKey.set(key, dispose);
      clonesByKey.set(key, clone);

      return clone;
    }

    function updateCloneIndex(clone: Element, key: string, value: unknown, index: number, count: number): void {
      // Update field names with new index (values stay in DOM)
      // Include clone root itself (for primitive arrays)
      const fields: Element[] = [];
      if (clone.hasAttribute('d-field')) fields.push(clone);
      fields.push(...Array.from(clone.querySelectorAll('[d-field]')));

      for (const field of fields) {
        const relativeFieldPath = field.getAttribute('d-field');
        if (relativeFieldPath) {
          const fullPath = `${arrayPath}[${index}].${relativeFieldPath}`;
          field.setAttribute('name', fullPath);
          field.setAttribute('data-field-path', fullPath);
        }
      }

      // Update d-error elements (including root)
      const errors: Element[] = [];
      if (clone.hasAttribute('d-error')) errors.push(clone);
      errors.push(...Array.from(clone.querySelectorAll('[d-error]')));

      for (const errorEl of errors) {
        const relativeErrorPath = errorEl.getAttribute('d-error');
        if (relativeErrorPath) {
          const fullPath = `${arrayPath}[${index}].${relativeErrorPath}`;
          errorEl.setAttribute('data-error-path', fullPath);
        }
      }

      // Update nested d-array paths
      const nestedArrays = clone.querySelectorAll('[d-array]');
      for (const nestedArr of nestedArrays) {
        const relativeArrayPath = nestedArr.getAttribute('d-array');
        if (relativeArrayPath) {
          const fullPath = `${arrayPath}[${index}].${relativeArrayPath}`;
          nestedArr.setAttribute('data-array-path', fullPath);
        }
      }

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
  // d-append: append new item
  const appendButtons = container.querySelectorAll('[d-append]');
  for (const btn of appendButtons) {
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

  // d-remove: remove item (uses context from bindArray)
  const removeButtons = container.querySelectorAll('[d-remove]');
  for (const btn of removeButtons) {
    // This is handled in the item context during bindArray
    // Just prevent default if it's a button
    if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
      btn.setAttribute('type', 'button');
    }
  }

  // d-move-up, d-move-down: handled in item context
  const moveButtons = container.querySelectorAll('[d-move-up], [d-move-down]');
  for (const btn of moveButtons) {
    if (btn.getAttribute('type') !== 'button' && btn.tagName === 'BUTTON') {
      btn.setAttribute('type', 'button');
    }
  }
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

function extractSlots(el: Element): { defaultSlot: DocumentFragment; namedSlots: Map<string, DocumentFragment> } {
  const getSlotName = (node: Element): string | null => {
    const raw = node.getAttribute('d-slot') ?? node.getAttribute('slot');
    if (!raw) return null;
    const name = raw.trim();
    return name || null;
  };

  const namedSlots = new Map<string, DocumentFragment>();
  const defaultSlot = document.createDocumentFragment();
  for (const child of Array.from(el.childNodes)) {
    if (child instanceof Element && child.tagName === 'TEMPLATE') {
      const name = getSlotName(child);
      if (name) {
        const frag = namedSlots.get(name) ?? document.createDocumentFragment();
        frag.append(...Array.from((child as HTMLTemplateElement).content.childNodes));
        namedSlots.set(name, frag);
      } else {
        defaultSlot.appendChild(child);
      }
    } else if (child instanceof Element) {
      const name = getSlotName(child);
      if (name) {
        const frag = namedSlots.get(name) ?? document.createDocumentFragment();
        child.removeAttribute('d-slot');
        child.removeAttribute('slot');
        frag.appendChild(child);
        namedSlots.set(name, frag);
      } else {
        defaultSlot.appendChild(child);
      }
    } else {
      defaultSlot.appendChild(child);
    }
  }
  return { defaultSlot, namedSlots };
}

function fillSlots(root: Element, defaultSlot: DocumentFragment, namedSlots: Map<string, DocumentFragment>): void {
  for (const slotEl of Array.from(root.querySelectorAll('slot[name]'))) {
    const name = slotEl.getAttribute('name')!;
    const content = namedSlots.get(name);
    if (content && content.childNodes.length > 0) slotEl.replaceWith(content);
  }
  const defaultSlotEl = root.querySelector('slot:not([name])');
  if (defaultSlotEl && defaultSlot.childNodes.length > 0) defaultSlotEl.replaceWith(defaultSlot);
}

function bindSlotFragments(
  defaultSlot: DocumentFragment,
  namedSlots: Map<string, DocumentFragment>,
  parentCtx: BindContext,
  events: string[],
  cleanups: DisposeFunction[]
): void {
  const bindFrag = (frag: DocumentFragment) => {
    if (frag.childNodes.length === 0) return;
    const container = document.createElement('div');
    container.setAttribute('data-dalila-internal-bound', '');
    container.appendChild(frag);
    const handle = bind(container, parentCtx, { events, _skipLifecycle: true, _internal: true });
    cleanups.push(handle);
    while (container.firstChild) frag.appendChild(container.firstChild);
  };
  bindFrag(defaultSlot);
  for (const frag of namedSlots.values()) bindFrag(frag);
}

function resolveComponentProps(
  el: Element,
  parentCtx: BindContext,
  def: ComponentDefinition
): Record<string, Signal<unknown>> {
  const props: Record<string, Signal<unknown>> = {};
  const schema = def.props ?? {};
  const hasSchema = Object.keys(schema).length > 0;
  const PREFIX = 'd-props-';

  for (const attr of Array.from(el.attributes)) {
    if (!attr.name.startsWith(PREFIX)) continue;
    const kebab = attr.name.slice(PREFIX.length);
    const propName = kebabToCamel(kebab);
    if (hasSchema && !(propName in schema)) {
      warn(`Component <${def.tag}>: d-props-${kebab} is not declared in props schema`);
    }
    const bindingName = normalizeBinding(attr.value);
    if (!bindingName) continue;

    const parentValue = parentCtx[bindingName];
    if (parentValue === undefined) {
      warn(`d-props-${kebab}: "${bindingName}" not found in parent context`);
    }

    // Read raw value — signals and zero-arity functions (getters/computed-like) are
    // unwrapped reactively; everything else passes through as-is.
    const isGetter = !isSignal(parentValue) && typeof parentValue === 'function' && (parentValue as Function).length === 0;
    const raw = isSignal(parentValue) ? parentValue() : isGetter ? (parentValue as Function)() : parentValue;
    const propSignal = signal<unknown>(raw);

    // Reactive sync: signals and zero-arity getters
    if (isSignal(parentValue) || isGetter) {
      effect(() => { propSignal.set(isSignal(parentValue) ? parentValue() : (parentValue as Function)()); });
    }

    props[propName] = propSignal;
  }

  for (const [propName, propOption] of Object.entries(schema)) {
    if (props[propName]) continue;

    const propDef = normalizePropDef(propOption);
    const kebabPropName = camelToKebab(propName);
    const attrName = el.hasAttribute(propName)
      ? propName
      : (el.hasAttribute(kebabPropName) ? kebabPropName : null);

    if (attrName) {
      const raw = el.getAttribute(attrName)!;
      // Dev warning: Array/Object props should use d-props-*
      if (propDef.type === Array || propDef.type === Object) {
        warn(
          `Component <${def.tag}>: prop "${propName}" has type ${propDef.type === Array ? 'Array' : 'Object'} ` +
          `but received a static string attribute. Use d-props-${camelToKebab(propName)} to pass reactive data.`
        );
      }
      props[propName] = signal(coercePropValue(raw, propDef.type));
    } else {
      if (propDef.default !== undefined) {
        const defaultValue = typeof propDef.default === 'function'
          ? (propDef.default as () => unknown)()
          : propDef.default;
        props[propName] = signal(defaultValue);
      } else {
        if (propDef.required) {
          warn(`Component <${def.tag}>: required prop "${propName}" was not provided`);
        }
        props[propName] = signal(undefined);
      }
    }
  }

  return props;
}

function getComponentRegistry(ctx: BindContext): Map<string, Component> | null {
  const reg = ctx[COMPONENT_REGISTRY_KEY];
  return reg instanceof Map ? reg as Map<string, Component> : null;
}

function bindComponents(
  root: Element,
  ctx: BindContext,
  events: string[],
  cleanups: DisposeFunction[],
  onMountError: 'log' | 'throw'
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
    templateEl.innerHTML = def.template.trim();
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
      const propSignals = resolveComponentProps(el, ctx, def);

      // 4b. Create ref accessor + emit
      const setupCtx: SetupContext = {
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
          bindSlotFragments(defaultSlot, namedSlots, ctx, events, cleanups);
        });
      }

      // 4f. Fill slots
      fillSlots(componentRoot, defaultSlot, namedSlots);

      // 4g. Mark as bound boundary
      componentRoot.setAttribute('data-dalila-internal-bound', '');

      // 4h. Bind component template
      componentHandle = bind(componentRoot, componentCtx, { events, _skipLifecycle: true, _internal: true });
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

let globalConfig: BindOptions = {};

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
 * Call with an empty object to reset.
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
    globalConfig = {};
    return;
  }
  globalConfig = { ...globalConfig, ...config };
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
    const { components: globalComponents, transitions: globalTransitions, ...globalRest } = globalConfig;
    const { components: localComponents, transitions: localTransitions, ...localRest } = options;
    const mergedOpts: BindOptions = { ...globalRest, ...localRest };

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
            if (isComponent(comp)) combined[comp.definition.tag] = comp;
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
  const benchSession = createBindBenchSession();

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
  linkScopeToDom(templateScope, root, describeBindRoot(root));
  const bindScanPlan = createBindScanPlan(root);

  // Run all bindings within the template scope
  const previousScanPlan = activeBindScanPlan;
  try {
    activeBindScanPlan = bindScanPlan;
    withScope(templateScope, () => {
      // 1. Form setup — must run very early to register form instances
      bindForm(root, ctx, cleanups);

      // 2. d-array — must run before d-each to setup field arrays
      bindArray(root, ctx, cleanups);

      // 3. d-virtual-each — must run early for virtual template extraction
      bindVirtualEach(root, ctx, cleanups);

      // 4. d-each — must run early: removes templates before TreeWalker visits them
      bindEach(root, ctx, cleanups);

      // 5. d-boundary — must run before child directive/component passes
      // to avoid binding boundary children twice (original + cloned subtree).
      bindBoundary(root, ctx, cleanups);

      // 6. Components — must run after d-each but before d-ref / text interpolation
      bindComponents(root, ctx, events, cleanups, onMountError);

      // 7. d-ref — collect element references (after d-each removes templates)
      bindRef(root, refs);

      // 7.5. d-text — safe textContent binding (before text interpolation)
      bindText(root, ctx, cleanups);

      // 7. Text interpolation (template plan cache + lazy parser fallback)
      bindTextInterpolation(root, ctx, rawTextSelectors, templatePlanCacheConfig, benchSession);

      // 8. d-attr bindings
      bindAttrs(root, ctx, cleanups);

      // 9. d-bind-* two-way bindings
      bindTwoWay(root, ctx, cleanups);

      // 10. d-html bindings
      bindHtml(root, ctx, cleanups);

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
      bindLazy(root, ctx, cleanups, refs, events);

      bindPortal(root, ctx, cleanups);

      // 18. d-if — must run last: elements are fully bound before conditional removal
      bindIf(root, ctx, cleanups, transitionRegistry);
    });
  } finally {
    activeBindScanPlan = previousScanPlan;
  }

  // Bindings complete: remove loading state and mark as ready.
  // Only the top-level bind owns this lifecycle — d-each clones skip it.
  if (!options._skipLifecycle) {
    queueMicrotask(() => {
      htmlRoot.removeAttribute('d-loading');
      htmlRoot.setAttribute('d-ready', '');
    });
  }

  flushBindBenchSession(benchSession);

  // Return BindHandle (callable dispose + ref accessors)
  const dispose = (): void => {
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
    refs.clear();

    // Dispose template scope (stops all effects)
    try {
      templateScope.dispose();
    } catch (e) {
      if (isInDevMode()) {
        console.warn('[Dalila] Scope dispose error:', e);
      }
    }
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
