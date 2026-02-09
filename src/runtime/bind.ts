/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */

import { effect, createScope, withScope, isInDevMode, signal, Signal } from '../core/index.js';
import { WRAPPED_HANDLER } from '../form/index.js';

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

type EvalResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'parse' | 'missing_identifier'; message: string; identifier?: string };

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
  const regex = /\{([^{}]+)\}/g;

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

    const rawToken = match[0];
    const expression = match[1].trim();
    const textNode = document.createTextNode('');
    let warnedParse = false;
    let warnedMissingIdentifier = false;
    const parsed = parseInterpolationExpression(expression);
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
        const simpleIdent = expression.match(/^[a-zA-Z_$][\w$]*$/);
        if (result.reason === 'missing_identifier' && simpleIdent && result.identifier === simpleIdent[0]) {
          textNode.data = rawToken;
        } else {
          textNode.data = '';
        }
        return;
      }

      textNode.data = result.value == null ? '' : String(result.value);
    };

    if (!parsed.ok) {
      applyResult({ ok: false, reason: 'parse', message: parsed.message });
      frag.appendChild(textNode);
      cursor = match.index + match[0].length;
      continue;
    }

    // First render is synchronous to avoid empty text until microtask flush.
    applyResult(evalExpressionAst(parsed.ast, ctx));

    // Only schedule reactive updates when expression depends on reactive sources.
    if (expressionDependsOnReactiveSource(parsed.ast, ctx)) {
      effect(() => {
        applyResult(evalExpressionAst(parsed.ast, ctx));
      });
    }

    frag.appendChild(textNode);

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

    // Apply initial state synchronously to avoid FOUC (flash of unstyled content)
    const initialValue = !!resolve(binding);
    htmlEl.style.display = initialValue ? '' : 'none';

    // Then create reactive effect to keep it updated
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
    effect(() => {
      applyMatch();
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
        if (keyBinding === 'item') return item;
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

      // Expose item + positional / collection helpers.
      itemCtx.item = item;
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

    // Apply initial state synchronously to avoid FOUC
    const initialValue = !!resolve(binding);
    if (initialValue) {
      comment.parentNode?.insertBefore(htmlEl, comment);
    }

    // Then create reactive effect to keep it updated
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
      effect(() => {
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
    effect(() => {
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
    effect(() => {
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
    effect(() => {
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
    // 1. Form setup — must run very early to register form instances
    bindForm(root, ctx, cleanups);

    // 2. d-array — must run before d-each to setup field arrays
    bindArray(root, ctx, cleanups);

    // 3. d-each — must run early: removes templates before TreeWalker visits them
    bindEach(root, ctx, cleanups);

    // 4. Text interpolation
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

    // 5. d-attr bindings
    bindAttrs(root, ctx, cleanups);

    // 6. d-html bindings
    bindHtml(root, ctx, cleanups);

    // 7. Form fields — register fields with form instances
    bindField(root, ctx, cleanups);

    // 8. Event bindings
    bindEvents(root, ctx, events, cleanups);

    // 9. d-when directive
    bindWhen(root, ctx, cleanups);

    // 10. d-match directive
    bindMatch(root, ctx, cleanups);

    // 11. Form error displays — BEFORE d-if to bind errors in conditionally rendered sections
    bindError(root, ctx, cleanups);
    bindFormError(root, ctx, cleanups);

    // 12. d-if — must run last: elements are fully bound before conditional removal
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
