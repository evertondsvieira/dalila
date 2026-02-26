/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
import { effect, createScope, withScope, isInDevMode, signal, computeVirtualRange } from '../core/index.js';
import { withSchedulerPriority } from '../core/scheduler.js';
import { WRAPPED_HANDLER } from '../form/form.js';
import { linkScopeToDom, withDevtoolsDomTarget } from '../core/devtools.js';
import { isComponent, camelToKebab } from './component.js';
import { observeLazyElement, getLazyComponent } from './lazy.js';
import { bindBoundary } from './boundary.js';
import { ensureButtonTypeForSelector, queryIncludingRoot, updateNestedArrayDataPaths, } from './array-directive-dom.js';
import { bindSlotFragments, extractSlots, fillSlots } from './internal/components/component-slots.js';
import { resolveComponentProps as resolveComponentPropsFromElement } from './internal/components/component-props.js';
import { createListCloneRegistry } from './internal/list/list-clone-registry.js';
import { createListBoundCloneFactory } from './internal/list/list-clone-factory.js';
import { createListKeyResolver } from './internal/list/list-keying.js';
import { updateListItemMetadata } from './internal/list/list-metadata.js';
import { insertOrderedClonesBefore, recreateChangedOrderedClones, removeMissingKeys } from './internal/list/list-reconcile.js';
import { createFrameRerender, createQueuedListRerender, runWithResolvedPriority } from './internal/list/list-scheduler.js';
import { clearVirtualListApi, clampVirtual, createVirtualSpacer, getElementPositionPath, getVirtualRestoreKey, getVirtualScrollRestoreValue, readVirtualCallbackOption, readVirtualHeightOption, readVirtualListApi, readVirtualMeasureOption, readVirtualNumberOption, setVirtualListApi, setVirtualScrollRestoreValue, VirtualHeightsIndex, } from './internal/virtual/virtual-list-helpers.js';
// ============================================================================
// Utilities
// ============================================================================
/**
 * Check if a value is a Dalila signal
 */
function isSignal(value) {
    return typeof value === 'function' && 'set' in value && 'update' in value;
}
function isWritableSignal(value) {
    if (!isSignal(value))
        return false;
    // `computed()` exposes set/update that always throw. Probe with a no-op write
    // (same value) to detect read-only signals without mutating state.
    try {
        const current = value.peek();
        value.set(current);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Resolve a value from ctx - handles signals, functions, and plain values.
 * Only zero-arity functions are called (getters/computed).  Functions with
 * parameters are almost certainly event handlers and must never be invoked
 * here — doing so would trigger side-effects silently.
 */
function resolve(value) {
    if (isSignal(value))
        return value();
    if (typeof value === 'function') {
        const fn = value;
        if (fn.length === 0)
            return fn();
        warn(`resolve(): "${fn.name || 'anonymous'}" has parameters — not executed. Use a signal or a zero-arity getter.`);
        return undefined;
    }
    return value;
}
/**
 * Normalize binding attribute value
 * Attributes use plain identifiers only (e.g. "count")
 */
function normalizeBinding(raw) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const braced = trimmed.match(/^\{\s*([a-zA-Z_$][\w$]*)\s*\}$/);
    if (braced) {
        warn(`Attribute bindings must use plain identifiers (no braces). Use "${braced[1]}" instead of "${trimmed}".`);
        return null;
    }
    return trimmed;
}
let activeBindScanPlan = null;
function createBindScanPlan(root) {
    const boundary = root.closest('[data-dalila-internal-bound]');
    const elements = [];
    const attrIndex = new Map();
    const tagIndex = new Map();
    const indexElement = (el) => {
        const tag = el.tagName.toLowerCase();
        const byTag = tagIndex.get(tag);
        if (byTag)
            byTag.push(el);
        else
            tagIndex.set(tag, [el]);
        for (const attr of Array.from(el.attributes)) {
            const byAttr = attrIndex.get(attr.name);
            if (byAttr)
                byAttr.push(el);
            else
                attrIndex.set(attr.name, [el]);
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
        const el = walker.currentNode;
        const nearestBound = el.closest('[data-dalila-internal-bound]');
        if (nearestBound !== boundary)
            continue;
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
function mergeSelectorResults(plan, chunks) {
    const hit = new Set();
    for (const chunk of chunks) {
        for (const el of chunk)
            hit.add(el);
    }
    return plan.elements.filter(el => hit.has(el));
}
function resolveSelectorFromIndex(plan, selector) {
    const trimmed = selector.trim();
    if (!trimmed)
        return [];
    if (trimmed.includes(',')) {
        const parts = trimmed
            .split(',')
            .map(part => part.trim())
            .filter(Boolean);
        if (parts.length === 0)
            return [];
        const chunks = [];
        for (const part of parts) {
            const partial = resolveSelectorFromIndex(plan, part);
            if (partial === null)
                return null;
            chunks.push(partial);
        }
        return mergeSelectorResults(plan, chunks);
    }
    if (trimmed === '*')
        return [...plan.elements];
    const slotNameMatch = trimmed.match(/^slot\[name\]$/i);
    if (slotNameMatch) {
        const slotEls = plan.tagIndex.get('slot') ?? [];
        return slotEls.filter(el => el.hasAttribute('name'));
    }
    const attrMatch = trimmed.match(/^\[([^\]=\s]+)\]$/);
    if (attrMatch) {
        const attrName = attrMatch[1];
        const hit = new Set();
        const out = [];
        for (const el of plan.attrIndex.get(attrName) ?? []) {
            if (!el.hasAttribute(attrName) || hit.has(el))
                continue;
            hit.add(el);
            out.push(el);
        }
        for (const el of plan.elements) {
            if (!el.hasAttribute(attrName) || hit.has(el))
                continue;
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
function qsaFromPlan(plan, selector) {
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
    if (cacheable)
        plan.selectorCache.set(selector, matches);
    return matches;
}
function qsaIncludingRoot(root, selector) {
    if (activeBindScanPlan && activeBindScanPlan.root === root) {
        return qsaFromPlan(activeBindScanPlan, selector);
    }
    const out = [];
    if (root.matches(selector))
        out.push(root);
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
function warn(message) {
    if (isInDevMode()) {
        console.warn(`[Dalila] ${message}`);
    }
}
const portalSyncByElement = new WeakMap();
function describeBindRoot(root) {
    const explicit = root.getAttribute('data-component') ||
        root.getAttribute('data-devtools-label') ||
        root.getAttribute('aria-label') ||
        root.getAttribute('id');
    if (explicit)
        return String(explicit);
    const className = root.getAttribute('class');
    if (className) {
        const first = className.split(/\s+/).find(Boolean);
        if (first)
            return `${root.tagName.toLowerCase()}.${first}`;
    }
    return root.tagName.toLowerCase();
}
function bindEffect(target, fn) {
    withDevtoolsDomTarget(target ?? null, () => {
        effect(fn);
    });
}
const expressionCache = new Map();
const templateInterpolationPlanCache = new Map();
const TEMPLATE_PLAN_CACHE_MAX_ENTRIES = 250;
const TEMPLATE_PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const TEMPLATE_PLAN_CACHE_CONFIG_KEY = '__dalila_bind_template_cache';
function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}
function resolveListRenderPriority() {
    return 'low';
}
function coerceCacheSetting(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.max(0, Math.floor(value));
}
function resolveTemplatePlanCacheConfig(options) {
    const globalRaw = globalThis[TEMPLATE_PLAN_CACHE_CONFIG_KEY];
    const fromOptions = options.templatePlanCache;
    const maxEntries = coerceCacheSetting(fromOptions?.maxEntries ?? globalRaw?.maxEntries, TEMPLATE_PLAN_CACHE_MAX_ENTRIES);
    const ttlMs = coerceCacheSetting(fromOptions?.ttlMs ?? globalRaw?.ttlMs, TEMPLATE_PLAN_CACHE_TTL_MS);
    return { maxEntries, ttlMs };
}
function compileFastPathExpression(expression) {
    let i = 0;
    const literalKeywords = {
        true: true,
        false: false,
        null: null,
        undefined: undefined,
    };
    const skipSpaces = () => {
        while (i < expression.length && /\s/.test(expression[i]))
            i++;
    };
    const readIdentifier = () => {
        if (i >= expression.length || !isIdentStart(expression[i]))
            return null;
        const start = i;
        i++;
        while (i < expression.length && isIdentPart(expression[i]))
            i++;
        return expression.slice(start, i);
    };
    const readNumericIndex = () => {
        if (i >= expression.length || !/[0-9]/.test(expression[i]))
            return null;
        const start = i;
        i++;
        while (i < expression.length && /[0-9]/.test(expression[i]))
            i++;
        return Number(expression.slice(start, i));
    };
    skipSpaces();
    const root = readIdentifier();
    if (!root)
        return null;
    if (Object.prototype.hasOwnProperty.call(literalKeywords, root)) {
        skipSpaces();
        if (i === expression.length) {
            return { type: 'literal', value: literalKeywords[root] };
        }
        // Keep parser behavior for keyword literals followed by extra syntax.
        return null;
    }
    let node = { type: 'identifier', name: root };
    skipSpaces();
    while (i < expression.length) {
        if (expression[i] === '.') {
            i++;
            skipSpaces();
            const prop = readIdentifier();
            if (!prop)
                return null;
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
            if (index === null)
                return null;
            skipSpaces();
            if (expression[i] !== ']')
                return null;
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
function isIdentStart(ch) {
    return /[a-zA-Z_$]/.test(ch);
}
function isIdentPart(ch) {
    return /[a-zA-Z0-9_$]/.test(ch);
}
function tokenizeExpression(input) {
    const tokens = [];
    let i = 0;
    const pushOp = (op) => {
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
            while (i < input.length && isIdentPart(input[i]))
                i++;
            const ident = input.slice(start, i);
            if (ident === 'true')
                tokens.push({ type: 'literal', value: true });
            else if (ident === 'false')
                tokens.push({ type: 'literal', value: false });
            else if (ident === 'null')
                tokens.push({ type: 'literal', value: null });
            else if (ident === 'undefined')
                tokens.push({ type: 'literal', value: undefined });
            else
                tokens.push({ type: 'identifier', value: ident });
            continue;
        }
        if (/[0-9]/.test(ch)) {
            const start = i;
            i++;
            while (i < input.length && /[0-9]/.test(input[i]))
                i++;
            if (input[i] === '.') {
                i++;
                while (i < input.length && /[0-9]/.test(input[i]))
                    i++;
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
                    if (next === undefined)
                        break;
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
        if (two === '&&' || two === '||' || two === '??' || two === '?.' || two === '==' || two === '!='
            || two === '>=' || two === '<=') {
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
function parseExpression(input) {
    const tokens = tokenizeExpression(input);
    let index = 0;
    const peek = () => tokens[index];
    const next = () => tokens[index++];
    const matchOperator = (...ops) => {
        const token = peek();
        if (token?.type === 'operator' && ops.includes(token.value)) {
            index++;
            return token.value;
        }
        return null;
    };
    const expectOperator = (value) => {
        const token = next();
        if (!token || token.type !== 'operator' || token.value !== value) {
            throw new Error(`Expected "${value}"`);
        }
    };
    const expectParen = (value) => {
        const token = next();
        if (!token || token.type !== 'paren' || token.value !== value) {
            throw new Error(`Expected "${value}"`);
        }
    };
    const expectBracket = (value) => {
        const token = next();
        if (!token || token.type !== 'bracket' || token.value !== value) {
            throw new Error(`Expected "${value}"`);
        }
    };
    const parsePrimary = () => {
        const token = next();
        if (!token)
            throw new Error('Unexpected end of expression');
        if (token.type === 'number')
            return { type: 'literal', value: token.value };
        if (token.type === 'string')
            return { type: 'literal', value: token.value };
        if (token.type === 'literal')
            return { type: 'literal', value: token.value };
        if (token.type === 'identifier')
            return { type: 'identifier', name: token.value };
        if (token.type === 'paren' && token.value === '(') {
            const expr = parseConditional();
            expectParen(')');
            return expr;
        }
        throw new Error('Invalid expression');
    };
    const parseMember = () => {
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
    const parseUnary = () => {
        const op = matchOperator('!', '+', '-');
        if (op) {
            return { type: 'unary', op, arg: parseUnary() };
        }
        return parseMember();
    };
    const parseMultiplicative = () => {
        let node = parseUnary();
        while (true) {
            const op = matchOperator('*', '/', '%');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseUnary() };
        }
        return node;
    };
    const parseAdditive = () => {
        let node = parseMultiplicative();
        while (true) {
            const op = matchOperator('+', '-');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseMultiplicative() };
        }
        return node;
    };
    const parseComparison = () => {
        let node = parseAdditive();
        while (true) {
            const op = matchOperator('<', '>', '<=', '>=');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseAdditive() };
        }
        return node;
    };
    const parseEquality = () => {
        let node = parseComparison();
        while (true) {
            const op = matchOperator('==', '!=', '===', '!==');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseComparison() };
        }
        return node;
    };
    const parseLogicalAnd = () => {
        let node = parseEquality();
        while (true) {
            const op = matchOperator('&&');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseEquality() };
        }
        return node;
    };
    const parseLogicalOr = () => {
        let node = parseLogicalAnd();
        while (true) {
            const op = matchOperator('||');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseLogicalAnd() };
        }
        return node;
    };
    const parseNullish = () => {
        let node = parseLogicalOr();
        while (true) {
            const op = matchOperator('??');
            if (!op)
                break;
            node = { type: 'binary', op, left: node, right: parseLogicalOr() };
        }
        return node;
    };
    const parseConditional = () => {
        const condition = parseNullish();
        if (!matchOperator('?'))
            return condition;
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
function evalExpressionAst(node, ctx) {
    const evalNode = (current) => {
        if (current.type === 'literal')
            return { ok: true, value: current.value };
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
            if (!objectEval.ok)
                return objectEval;
            const obj = objectEval.value;
            if (obj == null)
                return { ok: true, value: undefined };
            if (!current.computed) {
                const key = current.property.value;
                return { ok: true, value: resolve(obj[String(key)]) };
            }
            const propEval = evalNode(current.property);
            if (!propEval.ok)
                return propEval;
            return { ok: true, value: resolve(obj[String(propEval.value)]) };
        }
        if (current.type === 'unary') {
            const arg = evalNode(current.arg);
            if (!arg.ok)
                return arg;
            if (current.op === '!')
                return { ok: true, value: !arg.value };
            if (current.op === '+')
                return { ok: true, value: +arg.value };
            return { ok: true, value: -arg.value };
        }
        if (current.type === 'conditional') {
            const condition = evalNode(current.condition);
            if (!condition.ok)
                return condition;
            return condition.value ? evalNode(current.trueBranch) : evalNode(current.falseBranch);
        }
        const left = evalNode(current.left);
        if (!left.ok)
            return left;
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
        if (!right.ok)
            return right;
        switch (current.op) {
            case '+': return { ok: true, value: left.value + right.value };
            case '-': return { ok: true, value: left.value - right.value };
            case '*': return { ok: true, value: left.value * right.value };
            case '/': return { ok: true, value: left.value / right.value };
            case '%': return { ok: true, value: left.value % right.value };
            case '<': return { ok: true, value: left.value < right.value };
            case '>': return { ok: true, value: left.value > right.value };
            case '<=': return { ok: true, value: left.value <= right.value };
            case '>=': return { ok: true, value: left.value >= right.value };
            case '==': return { ok: true, value: left.value == right.value };
            case '!=': return { ok: true, value: left.value != right.value };
            case '===': return { ok: true, value: left.value === right.value };
            case '!==': return { ok: true, value: left.value !== right.value };
            default:
                return { ok: false, reason: 'parse', message: `Unsupported operator "${current.op}"` };
        }
    };
    return evalNode(node);
}
function compileInterpolationExpression(expression) {
    const fastPathAst = compileFastPathExpression(expression);
    if (fastPathAst) {
        return { kind: 'fast_path', ast: fastPathAst };
    }
    return { kind: 'parser', expression };
}
function parseInterpolationExpression(expression) {
    let ast = expressionCache.get(expression);
    if (ast === undefined) {
        try {
            ast = parseExpression(expression);
            expressionCache.set(expression, ast);
        }
        catch (err) {
            expressionCache.set(expression, null);
            return {
                ok: false,
                message: `Text interpolation parse error in "{${expression}}": ${err.message}`,
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
function evaluateExpressionRaw(node, ctx) {
    if (node.type === 'literal')
        return { ok: true, value: node.value };
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
        if (!objectEval.ok)
            return objectEval;
        const obj = objectEval.value;
        if (obj == null)
            return { ok: true, value: undefined };
        if (!node.computed) {
            const key = node.property.value;
            return { ok: true, value: obj[String(key)] };
        }
        const propEval = evalExpressionAst(node.property, ctx);
        if (!propEval.ok)
            return propEval;
        return { ok: true, value: obj[String(propEval.value)] };
    }
    // For non-member expressions, the regular evaluator is fine.
    return evalExpressionAst(node, ctx);
}
function expressionDependsOnReactiveSource(node, ctx) {
    if (node.type === 'identifier') {
        const value = ctx[node.name];
        return isSignal(value) || (typeof value === 'function' && value.length === 0);
    }
    if (node.type === 'literal')
        return false;
    if (node.type === 'unary')
        return expressionDependsOnReactiveSource(node.arg, ctx);
    if (node.type === 'binary') {
        return expressionDependsOnReactiveSource(node.left, ctx) || expressionDependsOnReactiveSource(node.right, ctx);
    }
    if (node.type === 'conditional') {
        return expressionDependsOnReactiveSource(node.condition, ctx)
            || expressionDependsOnReactiveSource(node.trueBranch, ctx)
            || expressionDependsOnReactiveSource(node.falseBranch, ctx);
    }
    if (node.type === 'member') {
        if (expressionDependsOnReactiveSource(node.object, ctx)
            || (node.computed ? expressionDependsOnReactiveSource(node.property, ctx) : false)) {
            return true;
        }
        const memberValue = evaluateExpressionRaw(node, ctx);
        if (!memberValue.ok)
            return false;
        const value = memberValue.value;
        return isSignal(value) || (typeof value === 'function' && value.length === 0);
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
function buildTextInterpolationSegments(text) {
    const regex = /\{([^{}]+)\}/g;
    const segments = [];
    let cursor = 0;
    let match;
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
function getNodePath(root, node) {
    const path = [];
    let current = node;
    while (current && current !== root) {
        const parentNode = current.parentNode;
        if (!parentNode)
            return null;
        path.push(Array.prototype.indexOf.call(parentNode.childNodes, current));
        current = parentNode;
    }
    if (current !== root)
        return null;
    path.reverse();
    return path;
}
function getNodeAtPath(root, path) {
    let current = root;
    for (const index of path) {
        const child = current.childNodes[index];
        if (!child)
            return null;
        current = child;
    }
    return current;
}
function fnv1aStep(hash, value) {
    let h = hash ^ value;
    h = Math.imul(h, 0x01000193);
    return h >>> 0;
}
function fnv1aString(hash, value) {
    let h = hash;
    for (let i = 0; i < value.length; i++) {
        h = fnv1aStep(h, value.charCodeAt(i));
    }
    return h;
}
function hashNodeStructure(hash, node) {
    let h = fnv1aStep(hash, node.nodeType);
    if (node.nodeType === 1) {
        const el = node;
        h = fnv1aString(h, el.tagName);
        h = fnv1aStep(h, el.attributes.length);
        const attrs = Array.from(el.attributes)
            .map((attr) => `${attr.name}=${attr.value}`)
            .sort();
        for (const attr of attrs) {
            h = fnv1aString(h, attr);
        }
    }
    else if (node.nodeType === 3) {
        h = fnv1aString(h, node.data);
    }
    else if (node.nodeType === 8) {
        h = fnv1aString(h, node.data);
    }
    h = fnv1aStep(h, node.childNodes.length);
    for (let i = 0; i < node.childNodes.length; i++) {
        h = hashNodeStructure(h, node.childNodes[i]);
    }
    return h;
}
function createInterpolationTemplateSignature(root, rawTextSelectors) {
    let hash = 0x811c9dc5;
    hash = fnv1aString(hash, rawTextSelectors);
    hash = fnv1aString(hash, root.tagName);
    hash = hashNodeStructure(hash, root);
    return `${root.tagName}:${hash.toString(16)}`;
}
function createInterpolationTemplatePlan(root, rawTextSelectors) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const bindings = [];
    let totalExpressions = 0;
    let fastPathExpressions = 0;
    const textBoundary = root.closest('[data-dalila-internal-bound]');
    while (walker.nextNode()) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (parent && parent.closest(rawTextSelectors))
            continue;
        if (parent) {
            const bound = parent.closest('[data-dalila-internal-bound]');
            if (bound !== textBoundary)
                continue;
        }
        if (!node.data.includes('{'))
            continue;
        const segments = buildTextInterpolationSegments(node.data);
        const hasExpression = segments.some((segment) => segment.type === 'expr');
        if (!hasExpression)
            continue;
        const path = getNodePath(root, node);
        if (!path)
            continue;
        for (const segment of segments) {
            if (segment.type !== 'expr')
                continue;
            totalExpressions++;
            if (segment.compiled.kind === 'fast_path')
                fastPathExpressions++;
        }
        bindings.push({ path, segments });
    }
    return {
        bindings,
        totalExpressions,
        fastPathExpressions,
    };
}
function resolveCompiledExpression(compiled) {
    if (compiled.kind === 'fast_path') {
        return { ok: true, ast: compiled.ast };
    }
    return parseInterpolationExpression(compiled.expression);
}
function pruneTemplatePlanCache(now, config) {
    // 1) Remove expired plans first.
    for (const [key, entry] of templateInterpolationPlanCache) {
        if (entry.expiresAt <= now) {
            templateInterpolationPlanCache.delete(key);
        }
    }
    // 2) Enforce LRU cap.
    while (templateInterpolationPlanCache.size > config.maxEntries) {
        const oldestKey = templateInterpolationPlanCache.keys().next().value;
        if (!oldestKey)
            break;
        templateInterpolationPlanCache.delete(oldestKey);
    }
}
function getCachedTemplatePlan(signature, now, config) {
    if (config.maxEntries === 0 || config.ttlMs === 0)
        return null;
    const entry = templateInterpolationPlanCache.get(signature);
    if (!entry)
        return null;
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
function setCachedTemplatePlan(signature, plan, now, config) {
    if (config.maxEntries === 0 || config.ttlMs === 0)
        return;
    templateInterpolationPlanCache.set(signature, {
        plan,
        lastUsedAt: now,
        expiresAt: now + config.ttlMs,
    });
    pruneTemplatePlanCache(now, config);
}
function bindTextNodeFromPlan(node, plan, ctx) {
    const frag = document.createDocumentFragment();
    for (const segment of plan.segments) {
        if (segment.type === 'text') {
            frag.appendChild(document.createTextNode(segment.value));
            continue;
        }
        const textNode = document.createTextNode('');
        let warnedParse = false;
        let warnedMissingIdentifier = false;
        const applyResult = (result) => {
            if (!result.ok) {
                if (result.reason === 'parse') {
                    if (!warnedParse) {
                        warn(result.message);
                        warnedParse = true;
                    }
                }
                else if (!warnedMissingIdentifier) {
                    warn(result.message);
                    warnedMissingIdentifier = true;
                }
                // Backward compatibility for "{identifier}" missing from context:
                // preserve the literal token exactly as before.
                const simpleIdent = segment.expression.match(/^[a-zA-Z_$][\w$]*$/);
                if (result.reason === 'missing_identifier' && simpleIdent && result.identifier === simpleIdent[0]) {
                    textNode.data = segment.rawToken;
                }
                else {
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
function bindTextInterpolation(root, ctx, rawTextSelectors, cacheConfig) {
    const signature = createInterpolationTemplateSignature(root, rawTextSelectors);
    const now = nowMs();
    let plan = getCachedTemplatePlan(signature, now, cacheConfig);
    if (!plan) {
        plan = createInterpolationTemplatePlan(root, rawTextSelectors);
        setCachedTemplatePlan(signature, plan, now, cacheConfig);
    }
    if (plan.bindings.length === 0)
        return;
    const nodesToBind = [];
    for (const binding of plan.bindings) {
        const target = getNodeAtPath(root, binding.path);
        if (target && target.nodeType === 3) {
            nodesToBind.push({ node: target, binding });
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
function bindEvents(root, ctx, events, cleanups) {
    for (const eventName of events) {
        const attr = `d-on-${eventName}`;
        const elements = qsaIncludingRoot(root, `[${attr}]`);
        for (const el of elements) {
            const handlerName = normalizeBinding(el.getAttribute(attr));
            if (!handlerName)
                continue;
            const handler = ctx[handlerName];
            if (handler === undefined) {
                warn(`Event handler "${handlerName}" not found in context`);
                continue;
            }
            if (typeof handler !== 'function') {
                warn(`Event handler "${handlerName}" is not a function`);
                continue;
            }
            const wrappedHandler = function (event) {
                return withSchedulerPriority('high', () => handler.call(this, event), { warnOnAsync: false });
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
function bindEmit(root, ctx, cleanups) {
    const emitFn = ctx[COMPONENT_EMIT_KEY];
    if (typeof emitFn !== 'function')
        return;
    const elements = qsaIncludingRoot(root, '*');
    for (const el of elements) {
        for (const attrNode of Array.from(el.attributes)) {
            if (!attrNode.name.startsWith('d-emit-'))
                continue;
            if (attrNode.name === 'd-emit-value')
                continue;
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
            let payloadAst = null;
            if (payloadRaw) {
                try {
                    payloadAst = parseExpression(payloadRaw);
                }
                catch (err) {
                    warn(`${attr}: invalid d-emit-value="${payloadRaw}" (${err.message})`);
                    continue;
                }
            }
            else if (payloadExpr !== null) {
                warn(`${attr}: d-emit-value is empty; emitting DOM Event instead`);
            }
            if (emitName.includes(':')) {
                warn(`${attr}: ":" syntax is no longer supported. Use d-emit-value instead.`);
                continue;
            }
            const handler = (e) => {
                if (payloadAst) {
                    const eventCtx = Object.create(ctx);
                    eventCtx.$event = e;
                    const result = evalExpressionAst(payloadAst, eventCtx);
                    emitFn(emitName, result.ok ? result.value : undefined);
                }
                else {
                    emitFn(emitName, e);
                }
            };
            el.addEventListener(eventName, handler);
            cleanups.push(() => el.removeEventListener(eventName, handler));
        }
    }
}
function createTransitionRegistry(transitions) {
    const registry = new Map();
    if (!transitions)
        return registry;
    for (const cfg of transitions) {
        if (!cfg || typeof cfg !== 'object')
            continue;
        const name = typeof cfg.name === 'string' ? cfg.name.trim() : '';
        if (!name) {
            warn('configure({ transitions }): each transition must have a non-empty "name"');
            continue;
        }
        registry.set(name, cfg);
    }
    return registry;
}
function readTransitionNames(el) {
    const raw = el.getAttribute('d-transition');
    if (!raw)
        return [];
    return raw
        .split(/\s+/)
        .map(v => v.trim())
        .filter(Boolean);
}
function parseCssTimeToMs(value) {
    const token = value.trim();
    if (!token)
        return 0;
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
function getTransitionDurationMs(el, names, registry) {
    let durationFromRegistry = 0;
    for (const name of names) {
        const cfg = registry.get(name);
        if (!cfg)
            continue;
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
function runTransitionHook(phase, el, names, registry) {
    for (const name of names) {
        const cfg = registry.get(name);
        const hook = phase === 'enter' ? cfg?.enter : cfg?.leave;
        if (typeof hook !== 'function')
            continue;
        try {
            hook(el);
        }
        catch (err) {
            warn(`d-transition (${name}): ${phase} hook failed (${err.message || String(err)})`);
        }
    }
}
function syncPortalElement(el) {
    const sync = portalSyncByElement.get(el);
    sync?.();
}
function createTransitionController(el, registry, cleanups) {
    const names = readTransitionNames(el);
    const hasTransition = names.length > 0;
    let token = 0;
    let timeoutId = null;
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
        if (!hasTransition)
            return;
        el.removeAttribute('data-leave');
        el.setAttribute('data-enter', '');
        runTransitionHook('enter', el, names, registry);
    };
    const leave = (onDone) => {
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
            if (current === token)
                onDone();
            return;
        }
        timeoutId = setTimeout(() => {
            timeoutId = null;
            if (current !== token)
                return;
            onDone();
        }, durationMs);
    };
    return { hasTransition, enter, leave };
}
function bindPortal(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-portal]');
    for (const el of elements) {
        const rawExpression = el.getAttribute('d-portal')?.trim();
        if (!rawExpression)
            continue;
        let expressionAst = null;
        let fallbackSelector = null;
        try {
            expressionAst = parseExpression(rawExpression);
        }
        catch {
            // Allow selector shorthand: d-portal="#modal-root"
            fallbackSelector = rawExpression;
        }
        const htmlEl = el;
        const anchor = document.createComment('d-portal');
        htmlEl.parentNode?.insertBefore(anchor, htmlEl);
        const coerceTarget = (value) => {
            const resolved = resolve(value);
            if (resolved == null || resolved === false)
                return null;
            if (typeof resolved === 'string') {
                const selector = resolved.trim();
                if (!selector)
                    return null;
                if (typeof document === 'undefined')
                    return null;
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
            if (!hostParent)
                return;
            if (htmlEl.parentNode === hostParent)
                return;
            const next = anchor.nextSibling;
            if (next)
                hostParent.insertBefore(htmlEl, next);
            else
                hostParent.appendChild(htmlEl);
        };
        const syncPortal = () => {
            let target = null;
            if (expressionAst) {
                const result = evalExpressionAst(expressionAst, ctx);
                if (!result.ok) {
                    if (result.reason === 'missing_identifier') {
                        warn(`d-portal: ${result.message}`);
                    }
                    else {
                        warn(`d-portal: invalid expression "${rawExpression}"`);
                    }
                    target = null;
                }
                else {
                    target = coerceTarget(result.value);
                }
            }
            else {
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
function bindLazy(root, ctx, cleanups, refs, events) {
    const elements = qsaIncludingRoot(root, '[d-lazy]');
    for (const el of elements) {
        const lazyComponentName = normalizeBinding(el.getAttribute('d-lazy'));
        if (!lazyComponentName)
            continue;
        const lazyResult = getLazyComponent(lazyComponentName);
        if (!lazyResult) {
            warn(`d-lazy: component "${lazyComponentName}" not found. Use createLazyComponent() to create it.`);
            continue;
        }
        const { state } = lazyResult;
        const htmlEl = el;
        // Get loading and error templates from attributes
        const loadingTemplate = el.getAttribute('d-lazy-loading') ?? state.loadingTemplate ?? '';
        const errorTemplate = el.getAttribute('d-lazy-error') ?? state.errorTemplate ?? '';
        // Remove the d-lazy attribute to prevent reprocessing
        el.removeAttribute('d-lazy');
        el.removeAttribute('d-lazy-loading');
        el.removeAttribute('d-lazy-error');
        // Track the current rendered node (starts as the original placeholder element)
        let currentNode = htmlEl;
        let componentMounted = false;
        let componentDispose = null;
        let componentEl = null;
        let hasIntersected = false;
        const refName = normalizeBinding(htmlEl.getAttribute('d-ref'));
        const syncRef = (node) => {
            if (!refName)
                return;
            if (node instanceof Element) {
                refs.set(refName, node);
            }
        };
        const replaceCurrentNode = (nextNode) => {
            const parent = currentNode.parentNode;
            if (!parent)
                return;
            parent.replaceChild(nextNode, currentNode);
            currentNode = nextNode;
            syncRef(nextNode);
        };
        const unmountComponent = () => {
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
            if (!comp)
                return;
            // Create component element
            const compDef = comp.definition;
            const compEl = document.createElement(compDef.tag);
            // Copy attributes from placeholder to component
            for (const attr of Array.from(htmlEl.attributes)) {
                if (!attr.name.startsWith('d-')) {
                    compEl.setAttribute(attr.name, attr.value);
                }
            }
            if (componentMounted && componentEl === compEl)
                return;
            replaceCurrentNode(compEl);
            componentEl = compEl;
            // Bind the component
            const parentCtx = Object.create(ctx);
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
        const showError = (err) => {
            if (componentMounted) {
                unmountComponent();
            }
            if (errorTemplate) {
                const errorEl = document.createElement('div');
                errorEl.innerHTML = errorTemplate;
                replaceCurrentNode(errorEl);
            }
            else {
                warn(`d-lazy: failed to load "${lazyComponentName}": ${err.message}`);
            }
        };
        const syncFromState = () => {
            // Always read reactive state so this effect stays subscribed even before visibility.
            const loading = state.loading();
            const error = state.error();
            const comp = state.component();
            if (!hasIntersected)
                return;
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
        const cleanupObserver = observeLazyElement(htmlEl, () => {
            hasIntersected = true;
            syncFromState();
            state.load();
        }, 0 // Trigger when element enters viewport
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
function bindWhen(root, ctx, cleanups, transitionRegistry) {
    const elements = qsaIncludingRoot(root, '[when], [d-when]');
    for (const el of elements) {
        const attrName = el.hasAttribute('when') ? 'when' : 'd-when';
        const bindingName = normalizeBinding(el.getAttribute(attrName));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`when: "${bindingName}" not found in context`);
            continue;
        }
        const htmlEl = el;
        const transitions = createTransitionController(htmlEl, transitionRegistry, cleanups);
        // Apply initial state synchronously to avoid FOUC (flash of unstyled content)
        const initialValue = !!resolve(binding);
        if (initialValue) {
            htmlEl.style.display = '';
            if (transitions.hasTransition) {
                htmlEl.removeAttribute('data-leave');
                htmlEl.setAttribute('data-enter', '');
            }
        }
        else {
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
function bindMatch(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-match]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-match'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-match: "${bindingName}" not found in context`);
            continue;
        }
        // Apply initial state synchronously to avoid FOUC
        const applyMatch = () => {
            const cases = Array.from(el.querySelectorAll('[case]'));
            const v = resolve(binding);
            const value = v == null ? '' : String(v);
            let matchedEl = null;
            let defaultEl = null;
            // First pass: hide all and find match/default
            for (const caseEl of cases) {
                caseEl.style.display = 'none';
                const caseValue = caseEl.getAttribute('case');
                if (caseValue === 'default') {
                    defaultEl = caseEl;
                }
                else if (caseValue === value && !matchedEl) {
                    matchedEl = caseEl;
                }
            }
            // Second pass: show match OR default (not both)
            if (matchedEl) {
                matchedEl.style.display = '';
            }
            else if (defaultEl) {
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
export function getVirtualListController(target) {
    return readVirtualListApi(target);
}
export function scrollToVirtualIndex(target, index, options) {
    const controller = readVirtualListApi(target);
    if (!controller)
        return false;
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
function bindVirtualEach(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-virtual-each]')
        .filter(el => !el.parentElement?.closest('[d-virtual-each], [d-each]'));
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-virtual-each'));
        if (!bindingName)
            continue;
        const itemHeightBinding = normalizeBinding(el.getAttribute('d-virtual-item-height'));
        const itemHeightRaw = itemHeightBinding ?? el.getAttribute('d-virtual-item-height');
        const itemHeightValue = readVirtualNumberOption(itemHeightRaw, ctx, 'd-virtual-item-height', { warn, resolve });
        const fixedItemHeight = Number.isFinite(itemHeightValue) && itemHeightValue > 0
            ? itemHeightValue
            : NaN;
        const dynamicHeight = readVirtualMeasureOption(normalizeBinding(el.getAttribute('d-virtual-measure')) ?? el.getAttribute('d-virtual-measure'), ctx, { resolve });
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
        const estimatedHeightValue = readVirtualNumberOption(estimatedHeightRaw, ctx, 'd-virtual-estimated-height', { warn, resolve });
        const estimatedItemHeight = Number.isFinite(estimatedHeightValue) && estimatedHeightValue > 0
            ? estimatedHeightValue
            : (Number.isFinite(fixedItemHeight) ? fixedItemHeight : 48);
        const overscanBinding = normalizeBinding(el.getAttribute('d-virtual-overscan'));
        const overscanRaw = overscanBinding ?? el.getAttribute('d-virtual-overscan');
        const overscanValue = readVirtualNumberOption(overscanRaw, ctx, 'd-virtual-overscan', { warn, resolve });
        const overscan = Number.isFinite(overscanValue)
            ? Math.max(0, Math.floor(overscanValue))
            : 6;
        const viewportHeight = readVirtualHeightOption(normalizeBinding(el.getAttribute('d-virtual-height')) ?? el.getAttribute('d-virtual-height'), ctx, { resolve });
        const onEndReached = readVirtualCallbackOption(normalizeBinding(el.getAttribute('d-virtual-infinite')) ?? el.getAttribute('d-virtual-infinite'), ctx, 'd-virtual-infinite', { warn, isSignal });
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
        const scrollContainer = comment.parentElement;
        if (scrollContainer) {
            if (viewportHeight)
                scrollContainer.style.height = viewportHeight;
            if (!scrollContainer.style.overflowY)
                scrollContainer.style.overflowY = 'auto';
        }
        const restoreKey = getVirtualRestoreKey(el.ownerDocument, templatePathBeforeDetach, scrollContainer, bindingName, keyBinding);
        const savedScrollTop = getVirtualScrollRestoreValue(restoreKey);
        if (scrollContainer && Number.isFinite(savedScrollTop)) {
            scrollContainer.scrollTop = Math.max(0, savedScrollTop);
        }
        const observedElements = new Set();
        let warnedNonArray = false;
        let warnedViewportFallback = false;
        let heightsIndex = dynamicHeight ? new VirtualHeightsIndex(0, estimatedItemHeight) : null;
        const { keyValueToString, readKeyValue } = createListKeyResolver({
            keyBinding,
            itemAliases: ['item'],
            directiveName: 'd-virtual-each',
            warn,
        });
        let rowResizeObserver = null;
        const registry = createListCloneRegistry({
            onBeforeRemoveClone: (clone) => {
                if (rowResizeObserver && observedElements.has(clone)) {
                    rowResizeObserver.unobserve(clone);
                    observedElements.delete(clone);
                }
            },
        });
        const { clonesByKey, metadataByKey, itemsByKey } = registry;
        const createClone = createListBoundCloneFactory({
            template,
            parentCtx: ctx,
            alias: 'item',
            decorateClone: (clone, index) => {
                clone.setAttribute('data-dalila-virtual-index', String(index));
            },
            bindClone: (clone, itemCtx) => bind(clone, itemCtx, { _skipLifecycle: true }),
            register: registry.register,
        });
        function updateCloneMetadata(key, index, count) {
            const metadata = metadataByKey.get(key);
            updateListItemMetadata(metadata, index, count);
            const clone = clonesByKey.get(key);
            if (clone) {
                clone.setAttribute('data-dalila-virtual-index', String(index));
            }
        }
        const removeKey = (key) => registry.removeKey(key);
        let currentItems = [];
        let lastEndReachedCount = -1;
        let endReachedPending = false;
        const remapDynamicHeights = (prevItems, nextItems) => {
            if (!dynamicHeight || !heightsIndex)
                return;
            const heightsByKey = new Map();
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
        const replaceItems = (nextItems) => {
            remapDynamicHeights(currentItems, nextItems);
            currentItems = nextItems;
        };
        const maybeTriggerEndReached = (visibleEnd, totalCount) => {
            if (!onEndReached || totalCount === 0)
                return;
            if (visibleEnd < totalCount)
                return;
            if (lastEndReachedCount === totalCount || endReachedPending)
                return;
            lastEndReachedCount = totalCount;
            const result = onEndReached();
            if (result && typeof result.then === 'function') {
                endReachedPending = true;
                Promise.resolve(result)
                    .catch(() => { })
                    .finally(() => {
                    endReachedPending = false;
                });
            }
        };
        function renderVirtualList(items) {
            if (virtualListDisposed)
                return;
            const parent = comment.parentNode;
            if (!parent)
                return;
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
                    const visibleEnd = clampVirtual(heightsIndex.lowerBound(scrollTop + effectiveViewportHeight) + 1, visibleStart + 1, items.length);
                    visibleEndForEndReached = visibleEnd;
                    start = clampVirtual(visibleStart - overscan, 0, items.length);
                    end = clampVirtual(visibleEnd + overscan, start, items.length);
                    topOffset = heightsIndex.prefix(start);
                    bottomOffset = Math.max(0, totalHeight - heightsIndex.prefix(end));
                }
            }
            else {
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
                visibleEndForEndReached = clampVirtual(Math.ceil((scrollTop + effectiveViewportHeight) / fixedItemHeight), 0, items.length);
            }
            topSpacer.style.height = `${topOffset}px`;
            bottomSpacer.style.height = `${bottomOffset}px`;
            topSpacer.setAttribute('data-dalila-virtual-total', String(totalHeight));
            const orderedClones = [];
            const orderedKeys = [];
            const nextKeys = new Set();
            const changedKeys = new Set();
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
                }
                else {
                    clone = createClone(key, item, i, items.length);
                }
                orderedClones.push(clone);
                orderedKeys.push(key);
            }
            recreateChangedOrderedClones(orderedClones, orderedKeys, changedKeys, (key, orderedIndex) => {
                removeKey(key);
                return createClone(key, items[start + orderedIndex], start + orderedIndex, items.length);
            });
            removeMissingKeys(clonesByKey.keys(), nextKeys, removeKey);
            insertOrderedClonesBefore(parent, orderedClones, bottomSpacer);
            if (dynamicHeight && rowResizeObserver) {
                const nextObserved = new Set(orderedClones);
                for (const clone of Array.from(observedElements)) {
                    if (nextObserved.has(clone))
                        continue;
                    rowResizeObserver.unobserve(clone);
                    observedElements.delete(clone);
                }
                for (const clone of orderedClones) {
                    if (observedElements.has(clone))
                        continue;
                    rowResizeObserver.observe(clone);
                    observedElements.add(clone);
                }
            }
            maybeTriggerEndReached(visibleEndForEndReached, items.length);
        }
        let framePending = false;
        let virtualListDisposed = false;
        const scheduleRender = createFrameRerender({
            resolvePriority: resolveListRenderPriority,
            isDisposed: () => virtualListDisposed,
            isPending: () => framePending,
            setPending: (pending) => { framePending = pending; },
            render: () => renderVirtualList(currentItems),
        });
        const onScroll = () => scheduleRender();
        const onResize = () => scheduleRender();
        scrollContainer?.addEventListener('scroll', onScroll, { passive: true });
        let containerResizeObserver = null;
        if (typeof ResizeObserver !== 'undefined' && scrollContainer) {
            containerResizeObserver = new ResizeObserver(() => {
                if (virtualListDisposed)
                    return;
                scheduleRender();
            });
            containerResizeObserver.observe(scrollContainer);
        }
        else if (typeof window !== 'undefined') {
            window.addEventListener('resize', onResize);
        }
        if (dynamicHeight && typeof ResizeObserver !== 'undefined' && heightsIndex) {
            rowResizeObserver = new ResizeObserver((entries) => {
                if (virtualListDisposed)
                    return;
                let changed = false;
                for (const entry of entries) {
                    const target = entry.target;
                    const indexRaw = target.getAttribute('data-dalila-virtual-index');
                    if (!indexRaw)
                        continue;
                    const index = Number(indexRaw);
                    if (!Number.isFinite(index))
                        continue;
                    const measured = entry.contentRect?.height;
                    if (!Number.isFinite(measured) || measured <= 0)
                        continue;
                    changed = heightsIndex.set(index, measured) || changed;
                }
                if (changed)
                    scheduleRender();
            });
        }
        const scrollToIndex = (index, options) => {
            if (!scrollContainer || currentItems.length === 0)
                return;
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
            }
            else if (align === 'end') {
                top = top - viewportSize + itemSize;
            }
            top = Math.max(0, top);
            if (options?.behavior && typeof scrollContainer.scrollTo === 'function') {
                scrollContainer.scrollTo({ top, behavior: options.behavior });
            }
            else {
                scrollContainer.scrollTop = top;
            }
            scheduleRender();
        };
        const virtualApi = {
            scrollToIndex,
            refresh: scheduleRender,
        };
        if (scrollContainer) {
            setVirtualListApi(scrollContainer, virtualApi);
        }
        if (isSignal(binding)) {
            let hasRenderedInitialSignalPass = false;
            bindEffect(scrollContainer ?? el, () => {
                const value = binding();
                if (Array.isArray(value)) {
                    warnedNonArray = false;
                    replaceItems(value);
                }
                else {
                    if (!warnedNonArray) {
                        warnedNonArray = true;
                        warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
                    }
                    replaceItems([]);
                }
                if (!hasRenderedInitialSignalPass) {
                    hasRenderedInitialSignalPass = true;
                    runWithResolvedPriority(resolveListRenderPriority, () => renderVirtualList(currentItems));
                    return;
                }
                scheduleRender();
            });
        }
        else if (Array.isArray(binding)) {
            replaceItems(binding);
            runWithResolvedPriority(resolveListRenderPriority, () => renderVirtualList(currentItems));
        }
        else {
            warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
        }
        cleanups.push(() => {
            virtualListDisposed = true;
            framePending = false;
            scrollContainer?.removeEventListener('scroll', onScroll);
            if (containerResizeObserver) {
                containerResizeObserver.disconnect();
            }
            else if (typeof window !== 'undefined') {
                window.removeEventListener('resize', onResize);
            }
            if (rowResizeObserver) {
                rowResizeObserver.disconnect();
            }
            observedElements.clear();
            if (scrollContainer) {
                setVirtualScrollRestoreValue(restoreKey, scrollContainer.scrollTop);
                clearVirtualListApi(scrollContainer, virtualApi);
            }
            for (const key of Array.from(clonesByKey.keys()))
                removeKey(key);
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
function bindEach(root, ctx, cleanups) {
    // Only bind top-level d-each elements. Nested d-each inside d-each or
    // d-virtual-each templates must be left untouched here — they are bound when
    // parent clones are passed to bind() individually.
    const elements = qsaIncludingRoot(root, '[d-each]')
        .filter(el => !el.parentElement?.closest('[d-each], [d-virtual-each]'));
    for (const el of elements) {
        const rawValue = el.getAttribute('d-each')?.trim() ?? '';
        let bindingName;
        let alias = 'item'; // default
        const asMatch = rawValue.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) {
            bindingName = normalizeBinding(asMatch[1]);
            alias = asMatch[2];
        }
        else {
            bindingName = normalizeBinding(rawValue);
        }
        if (!bindingName)
            continue;
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
        const registry = createListCloneRegistry();
        const { clonesByKey, metadataByKey, itemsByKey } = registry;
        const { keyValueToString, readKeyValue } = createListKeyResolver({
            keyBinding,
            itemAliases: [alias, 'item'],
            directiveName: 'd-each',
            warn,
        });
        const createClone = createListBoundCloneFactory({
            template,
            parentCtx: ctx,
            alias,
            bindClone: (clone, itemCtx) => bind(clone, itemCtx, { _skipLifecycle: true }),
            register: registry.register,
        });
        function updateCloneMetadata(key, index, count) {
            const metadata = metadataByKey.get(key);
            updateListItemMetadata(metadata, index, count);
        }
        function renderList(items) {
            const orderedClones = [];
            const orderedKeys = [];
            const nextKeys = new Set();
            const changedKeys = new Set();
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
                }
                else {
                    clone = createClone(key, item, i, items.length);
                }
                orderedClones.push(clone);
                orderedKeys.push(key);
            }
            const removeKey = (key) => registry.removeKey(key);
            recreateChangedOrderedClones(orderedClones, orderedKeys, changedKeys, (key, orderedIndex) => {
                removeKey(key);
                return createClone(key, items[orderedIndex], orderedIndex, items.length);
            });
            removeMissingKeys(clonesByKey.keys(), nextKeys, removeKey);
            const parent = comment.parentNode;
            if (!parent)
                return;
            insertOrderedClonesBefore(parent, orderedClones, comment);
        }
        let lowPriorityRenderQueued = false;
        let listRenderDisposed = false;
        const scheduleLowPriorityListRender = createQueuedListRerender({
            resolvePriority: resolveListRenderPriority,
            isDisposed: () => listRenderDisposed,
            isQueued: () => lowPriorityRenderQueued,
            setQueued: (queued) => { lowPriorityRenderQueued = queued; },
            render: renderList,
        });
        if (isSignal(binding)) {
            let hasRenderedInitialSignalPass = false;
            // Effect owned by templateScope — no manual stop needed
            bindEffect(el, () => {
                const value = binding();
                const items = Array.isArray(value) ? value : [];
                if (!hasRenderedInitialSignalPass) {
                    hasRenderedInitialSignalPass = true;
                    runWithResolvedPriority(resolveListRenderPriority, () => renderList(items));
                    return;
                }
                scheduleLowPriorityListRender(items);
            });
        }
        else if (Array.isArray(binding)) {
            runWithResolvedPriority(resolveListRenderPriority, () => renderList(binding));
        }
        else {
            warn(`d-each: "${bindingName}" is not an array or signal`);
        }
        cleanups.push(() => {
            listRenderDisposed = true;
            lowPriorityRenderQueued = false;
            registry.cleanup();
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
function bindIf(root, ctx, cleanups, transitionRegistry) {
    const elements = qsaIncludingRoot(root, '[d-if]');
    const processedElse = new Set();
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-if'));
        if (!bindingName)
            continue;
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
        const htmlEl = el;
        const transitions = createTransitionController(htmlEl, transitionRegistry, cleanups);
        // Handle d-else branch
        let elseHtmlEl = null;
        let elseComment = null;
        let elseTransitions = null;
        if (elseEl) {
            processedElse.add(elseEl);
            elseComment = document.createComment('d-else');
            elseEl.parentNode?.replaceChild(elseComment, elseEl);
            elseEl.removeAttribute('d-else');
            elseHtmlEl = elseEl;
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
        }
        else if (elseHtmlEl && elseComment) {
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
                }
                else {
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
        }
        else {
            bindEffect(htmlEl, () => {
                const value = !!resolve(binding);
                if (value) {
                    if (!htmlEl.parentNode) {
                        comment.parentNode?.insertBefore(htmlEl, comment);
                        syncPortalElement(htmlEl);
                    }
                    transitions.enter();
                }
                else {
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
function bindHtml(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-html]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-html'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-html: "${bindingName}" not found in context`);
            continue;
        }
        const htmlEl = el;
        if (isSignal(binding)) {
            bindEffect(htmlEl, () => {
                const v = binding();
                const html = v == null ? '' : String(v);
                if (isInDevMode() && /<script[\s>]|javascript:|onerror\s*=/i.test(html)) {
                    warn(`d-html: potentially unsafe HTML in "${bindingName}". Never use with unsanitized user input.`);
                }
                htmlEl.innerHTML = html;
            });
        }
        else {
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
function bindText(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-text]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-text'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-text: "${bindingName}" not found in context`);
            continue;
        }
        const htmlEl = el;
        // Sync initial render
        const initial = resolve(binding);
        htmlEl.textContent = initial == null ? '' : String(initial);
        // Reactive effect only if needed
        if (isSignal(binding) || (typeof binding === 'function' && binding.length === 0)) {
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
function applyAttr(el, attrName, value) {
    // Fast-path: known IDL properties set as properties on the element
    if (BOOLEAN_PROPS.has(attrName) && attrName in el) {
        el[attrName] = !!value;
        return;
    }
    if (STRING_PROPS.has(attrName) && attrName in el) {
        el[attrName] = value == null ? '' : String(value);
        return;
    }
    // Generic attribute path
    if (value === null || value === undefined || value === false) {
        el.removeAttribute(attrName);
    }
    else if (value === true) {
        el.setAttribute(attrName, '');
    }
    else {
        el.setAttribute(attrName, String(value));
    }
}
function bindAttrs(root, ctx, cleanups) {
    const PREFIX = 'd-attr-';
    const allElements = qsaIncludingRoot(root, '*');
    for (const el of allElements) {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
            if (!attr.name.startsWith(PREFIX))
                continue;
            const attrName = attr.name.slice(PREFIX.length);
            const bindingName = normalizeBinding(attr.value);
            if (!bindingName)
                continue;
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
            }
            else {
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
function bindTwoWay(root, ctx, cleanups) {
    const SUPPORTED = [
        { attr: 'd-bind-value', prop: 'value', twoWay: true },
        { attr: 'd-bind-checked', prop: 'checked', twoWay: true },
        { attr: 'd-bind-readonly', prop: 'readOnly', twoWay: false },
        { attr: 'd-bind-disabled', prop: 'disabled', twoWay: false },
        { attr: 'd-bind-maxlength', prop: 'maxLength', twoWay: false },
        { attr: 'd-bind-placeholder', prop: 'placeholder', twoWay: false },
        { attr: 'd-bind-pattern', prop: 'pattern', twoWay: false },
        { attr: 'd-bind-multiple', prop: 'multiple', twoWay: false },
    ];
    const BOOLEAN_PROPS = new Set(['checked', 'readOnly', 'disabled', 'multiple']);
    const STRING_PROPS = new Set(['value', 'placeholder', 'pattern']);
    const applyBoundProp = (el, prop, value) => {
        if (!(prop in el))
            return;
        if (BOOLEAN_PROPS.has(prop)) {
            el[prop] = !!value;
            return;
        }
        if (STRING_PROPS.has(prop)) {
            el[prop] = value == null ? '' : String(value);
            return;
        }
        if (prop === 'maxLength') {
            if (value == null || value === '') {
                el.maxLength = -1;
                return;
            }
            const parsed = Number(value);
            el.maxLength = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : -1;
            return;
        }
        el[prop] = value;
    };
    const resolveFunctionBinding = (el, attrName) => {
        const fnBindingName = normalizeBinding(el.getAttribute(attrName));
        if (!fnBindingName)
            return null;
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
        return resolved;
    };
    for (const directive of SUPPORTED) {
        const attr = directive.attr;
        const elements = qsaIncludingRoot(root, `[${attr}]`);
        for (const el of elements) {
            const bindingName = normalizeBinding(el.getAttribute(attr));
            if (!bindingName)
                continue;
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
                    }
                    catch (err) {
                        warn(`d-bind-transform: "${bindingName}" failed (${err.message || String(err)})`);
                        value = rawValue;
                    }
                }
                applyBoundProp(el, directive.prop, value);
            });
            // Inbound: DOM → signal
            if (directive.twoWay && writable) {
                const eventName = el.tagName === 'SELECT' || directive.prop === 'checked'
                    ? 'change'
                    : 'input';
                const handler = () => {
                    const rawValue = directive.prop === 'checked'
                        ? el.checked
                        : el.value;
                    let nextValue = rawValue;
                    if (parseFn) {
                        try {
                            nextValue = parseFn(rawValue, el);
                        }
                        catch (err) {
                            warn(`d-bind-parse: "${bindingName}" failed (${err.message || String(err)})`);
                            nextValue = rawValue;
                        }
                    }
                    binding.set(nextValue);
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
function bindForm(root, ctx, cleanups) {
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
        if (!bindingName)
            continue;
        const form = ctx[bindingName];
        if (!form || typeof form !== 'object' || !('handleSubmit' in form)) {
            warn(`d-form: "${bindingName}" is not a valid Form instance`);
            continue;
        }
        // Register form element with the Form instance
        if ('_setFormElement' in form && typeof form._setFormElement === 'function') {
            form._setFormElement(el);
        }
        // Auto-wrap d-on-submit handler through form.handleSubmit()
        // Don't mutate shared ctx - add listener directly to this form element
        const submitHandlerName = normalizeBinding(el.getAttribute('d-on-submit'));
        if (submitHandlerName) {
            const originalHandler = ctx[submitHandlerName];
            if (typeof originalHandler === 'function') {
                // Check if handler is already wrapped to avoid double-wrapping
                // If user did: const save = form.handleSubmit(...), don't wrap again
                const isAlreadyWrapped = originalHandler[WRAPPED_HANDLER] === true;
                const finalHandler = isAlreadyWrapped
                    ? originalHandler
                    : form.handleSubmit(originalHandler);
                // Add submit listener directly to form element (not via d-on-submit)
                // This avoids mutating the shared context while preserving high-priority event context.
                const wrappedSubmitHandler = function (event) {
                    return withSchedulerPriority('high', () => finalHandler.call(this, event), { warnOnAsync: false });
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
function bindField(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-field]');
    for (const el of elements) {
        // Prefer data-field-path (set by d-array) over d-field for full path
        const dataFieldPath = el.getAttribute('data-field-path');
        const dFieldPath = normalizeBinding(el.getAttribute('d-field'));
        const fieldPath = dataFieldPath || dFieldPath;
        if (!fieldPath)
            continue;
        // Find the form element - use context first (for detached clones), then closest()
        // When bind() runs on d-array clones, the clone is still detached from DOM,
        // so el.closest('form[d-form]') returns null. We pass form refs through context.
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-field: field "${fieldPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object')
            continue;
        const htmlEl = el;
        // Set name attribute if not already set (use full path)
        if (!htmlEl.getAttribute('name')) {
            htmlEl.setAttribute('name', fieldPath);
        }
        // Register field with form using full path
        if ('_registerField' in form && typeof form._registerField === 'function') {
            const unregister = form._registerField(fieldPath, htmlEl);
            cleanups.push(unregister);
        }
        // Setup reactive aria-invalid based on error state
        if ('error' in form && typeof form.error === 'function') {
            bindEffect(htmlEl, () => {
                // Read current path from DOM attribute inside effect
                // This allows the effect to see updated paths after array reorder
                const currentPath = htmlEl.getAttribute('data-field-path') || htmlEl.getAttribute('name') || fieldPath;
                const errorMsg = form.error(currentPath);
                if (errorMsg) {
                    htmlEl.setAttribute('aria-invalid', 'true');
                    // Use form prefix for unique IDs across multiple forms
                    const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
                    htmlEl.setAttribute('aria-describedby', errorId);
                }
                else {
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
function bindError(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-error]');
    for (const el of elements) {
        // Prefer data-error-path (set by d-array) over d-error for full path
        const dataErrorPath = el.getAttribute('data-error-path');
        const dErrorPath = normalizeBinding(el.getAttribute('d-error'));
        const fieldPath = dataErrorPath || dErrorPath;
        if (!fieldPath)
            continue;
        // Find the form element - use context first (for detached clones), then closest()
        // When bind() runs on d-array clones, the clone is still detached from DOM,
        // so el.closest('form[d-form]') returns null. We pass form refs through context.
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-error: error for "${fieldPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('error' in form))
            continue;
        const htmlEl = el;
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
            const errorMsg = form.error(currentPath);
            if (errorMsg) {
                // Update ID to match current path (with form prefix for uniqueness)
                const errorId = `${formBinding}_${currentPath.replace(/[.\[\]]/g, '_')}_error`;
                htmlEl.id = errorId;
                htmlEl.textContent = errorMsg;
                htmlEl.style.display = '';
            }
            else {
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
function bindFormError(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-form-error]');
    for (const el of elements) {
        // Use the attribute value as explicit form binding name when provided
        const explicitBinding = normalizeBinding(el.getAttribute('d-form-error'));
        // Fall back to finding the form element via context or closest()
        const formEl = ctx._formElement || el.closest('form[d-form]');
        const formBinding = explicitBinding
            || ctx._formBinding
            || (formEl ? normalizeBinding(formEl.getAttribute('d-form')) : null);
        if (!formBinding) {
            warn('d-form-error: must specify a form binding or be inside a [d-form]');
            continue;
        }
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('formError' in form))
            continue;
        const htmlEl = el;
        // Set role for accessibility
        htmlEl.setAttribute('role', 'alert');
        htmlEl.setAttribute('aria-live', 'polite');
        // Reactive form error display
        bindEffect(htmlEl, () => {
            const errorMsg = form.formError();
            if (errorMsg) {
                htmlEl.textContent = errorMsg;
                htmlEl.style.display = '';
            }
            else {
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
function bindArray(root, ctx, cleanups) {
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
        if (!arrayPath)
            continue;
        // Find the form element — use context first (for detached clones), then closest()
        const formEl = ctx._formElement || el.closest('form[d-form]');
        if (!formEl) {
            warn(`d-array: array "${arrayPath}" must be inside a [d-form]`);
            continue;
        }
        const formBinding = ctx._formBinding || normalizeBinding(formEl.getAttribute('d-form'));
        if (!formBinding)
            continue;
        const form = ctx[formBinding];
        if (!form || typeof form !== 'object' || !('fieldArray' in form))
            continue;
        // Get or create the field array
        const fieldArray = form.fieldArray(arrayPath);
        // Find the template element (d-each inside d-array)
        const templateElement = el.querySelector('[d-each]');
        if (!templateElement) {
            warn(`d-array: array "${arrayPath}" must contain a [d-each] template`);
            continue;
        }
        // Store template reference for closure (TypeScript assertion)
        const template = templateElement;
        const comment = document.createComment(`d-array:${arrayPath}`);
        template.parentNode?.replaceChild(comment, template);
        template.removeAttribute('d-each');
        // Track clones by key to preserve DOM state on reorder
        const clonesByKey = new Map();
        const disposesByKey = new Map();
        const metadataByKey = new Map();
        const itemSignalsByKey = new Map();
        function createClone(key, value, index, count) {
            const clone = template.cloneNode(true);
            // Create context for this item
            const itemCtx = Object.create(ctx);
            // Create signal for item so bindings can react to updates
            const itemSignal = signal(value);
            // Create signals for spread properties (if value is an object)
            // This allows {propName} bindings to update when value changes
            const spreadProps = new Map();
            if (typeof value === 'object' && value !== null) {
                for (const [propKey, propValue] of Object.entries(value)) {
                    const propSignal = signal(propValue);
                    spreadProps.set(propKey, propSignal);
                    itemCtx[propKey] = propSignal;
                }
            }
            itemSignalsByKey.set(key, { item: itemSignal, spreadProps });
            // Use signals for metadata so they can be updated on reorder
            const metadata = {
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
                if (currentIndex > 0)
                    fieldArray.move(currentIndex, currentIndex - 1);
            };
            itemCtx.$moveDown = () => {
                const currentIndex = fieldArray._getIndex(key);
                if (currentIndex < fieldArray.length() - 1)
                    fieldArray.move(currentIndex, currentIndex + 1);
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
            ensureButtonTypeForSelector(clone, 'button[d-on-click*="$remove"], button[d-on-click*="$moveUp"], button[d-on-click*="$moveDown"], button[d-on-click*="$swap"]');
            const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
            disposesByKey.set(key, dispose);
            clonesByKey.set(key, clone);
            return clone;
        }
        function updateCloneIndex(clone, key, value, index, count) {
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
                    const newProps = new Set(Object.keys(value));
                    // Update existing props and clear removed ones
                    for (const [propKey, propSignal] of itemSignals.spreadProps) {
                        if (newProps.has(propKey)) {
                            propSignal.set(value[propKey]);
                        }
                        else {
                            // Property was removed - clear to undefined
                            propSignal.set(undefined);
                        }
                    }
                }
                else {
                    // Value is not an object (null, primitive, etc) - clear all spread props
                    for (const [, propSignal] of itemSignals.spreadProps) {
                        propSignal.set(undefined);
                    }
                }
            }
        }
        function renderList() {
            const items = fieldArray.fields();
            const newKeys = new Set(items.map((item) => item.key));
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
            if (!parent)
                return;
            // Collect all clones in new order
            const orderedClones = [];
            for (let i = 0; i < items.length; i++) {
                const { key, value } = items[i];
                let clone = clonesByKey.get(key);
                if (clone) {
                    // Reuse existing clone, update index-based attributes and item value
                    updateCloneIndex(clone, key, value, i, items.length);
                }
                else {
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
function bindArrayOperations(container, fieldArray, cleanups) {
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
        const handler = (e) => {
            e.preventDefault(); // Extra safety
            const defaultValue = btn.getAttribute('d-append');
            try {
                const value = defaultValue ? JSON.parse(defaultValue) : {};
                fieldArray.append(value);
            }
            catch {
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
function bindRef(root, refs) {
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
function getComponentRegistry(ctx) {
    const reg = ctx[COMPONENT_REGISTRY_KEY];
    return reg instanceof Map ? reg : null;
}
function bindComponents(root, ctx, events, cleanups, onMountError) {
    const registry = getComponentRegistry(ctx);
    if (!registry || registry.size === 0)
        return;
    const tagSelector = Array.from(registry.keys()).join(', ');
    const elements = qsaIncludingRoot(root, tagSelector);
    const boundary = root.closest('[data-dalila-internal-bound]');
    for (const el of elements) {
        // Skip stale entries from the initial snapshot.
        // Earlier iterations may replace/move nodes (e.g. slot projection),
        // so this element might no longer belong to the current bind boundary.
        if (!root.contains(el))
            continue;
        if (el.closest('[data-dalila-internal-bound]') !== boundary)
            continue;
        const tag = el.tagName.toLowerCase();
        const component = registry.get(tag);
        if (!component)
            continue;
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
            }
            else if (content.childNodes.length === 0) {
                warn(`Component <${def.tag}>: template produced no DOM nodes`);
            }
        }
        // Single-root optimization: no wrapper needed
        // A d-each on the sole element will clone siblings at runtime, so it needs a container.
        const elementChildren = Array.from(content.children);
        const hasOnlyOneElement = elementChildren.length === 1
            && !elementChildren[0].hasAttribute('d-each')
            && Array.from(content.childNodes).every(n => n === elementChildren[0] || (n.nodeType === 3 && !n.textContent.trim()));
        let componentRoot;
        if (hasOnlyOneElement) {
            componentRoot = elementChildren[0];
            content.removeChild(componentRoot);
        }
        else {
            componentRoot = document.createElement('dalila-c');
            componentRoot.style.display = 'contents';
            componentRoot.appendChild(content);
        }
        // 3. Create component scope (child of current template scope)
        const componentScope = createScope();
        const pendingMountCallbacks = [];
        // 4. Within component scope: resolve props, run setup, bind
        let componentHandle = null;
        // Collect d-on-* event handlers from the component tag for ctx.emit()
        const componentEventHandlers = {};
        for (const attr of Array.from(el.attributes)) {
            if (!attr.name.startsWith('d-on-'))
                continue;
            const eventName = attr.name.slice(5); // "d-on-select" → "select"
            const handlerName = normalizeBinding(attr.value);
            if (!handlerName)
                continue;
            const handler = ctx[handlerName];
            if (typeof handler === 'function') {
                componentEventHandlers[eventName] = handler;
            }
            else if (handler !== undefined) {
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
            const setupCtx = {
                ref: (name) => componentHandle?.getRef(name) ?? null,
                refs: () => componentHandle?.getRefs() ?? Object.freeze({}),
                emit: (event, ...args) => {
                    const handler = componentEventHandlers[event];
                    if (typeof handler === 'function')
                        handler(...args);
                },
                onMount: (fn) => {
                    pendingMountCallbacks.push(fn);
                },
                onCleanup: (fn) => {
                    componentScope.onCleanup(fn);
                },
            };
            // 4c. Run setup
            let setupReturn = {};
            if (def.setup) {
                setupReturn = def.setup(propSignals, setupCtx);
                for (const key of Object.keys(setupReturn)) {
                    if (key in propSignals) {
                        warn(`Component <${def.tag}>: setup() returned "${key}" which overrides a prop binding`);
                    }
                }
            }
            // 4d. Build component bind context (propagate registry for nested components)
            const componentCtx = { ...propSignals, ...setupReturn };
            const parentRegistry = getComponentRegistry(ctx);
            if (parentRegistry) {
                componentCtx[COMPONENT_REGISTRY_KEY] = parentRegistry;
            }
            // 4d'. Store emit function for d-emit-* directives
            componentCtx[COMPONENT_EMIT_KEY] = (event, ...args) => {
                const handler = componentEventHandlers[event];
                if (typeof handler === 'function')
                    handler(...args);
            };
            // 4e. Bind slot content with PARENT context/scope
            const parentScope = componentScope.parent;
            if (parentScope) {
                withScope(parentScope, () => {
                    bindSlotFragments(defaultSlot, namedSlots, ctx, events, cleanups, bind);
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
                    }
                    else {
                        try {
                            cb();
                        }
                        catch (err) {
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
let globalConfig = {};
export function createPortalTarget(id) {
    const targetSignal = signal(null);
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
export function configure(config) {
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
export function bind(root, ctx, options = {}) {
    // ── Merge global config with per-call options ──
    if (Object.keys(globalConfig).length > 0) {
        const { components: globalComponents, transitions: globalTransitions, ...globalRest } = globalConfig;
        const { components: localComponents, transitions: localTransitions, ...localRest } = options;
        const mergedOpts = { ...globalRest, ...localRest };
        // Combine component registries: local takes precedence over global
        if (globalComponents || localComponents) {
            const combined = {};
            const mergeComponents = (src) => {
                if (!src)
                    return;
                if (Array.isArray(src)) {
                    for (const comp of src) {
                        if (isComponent(comp))
                            combined[comp.definition.tag] = comp;
                    }
                }
                else {
                    for (const [key, comp] of Object.entries(src)) {
                        if (isComponent(comp))
                            combined[comp.definition.tag] = comp;
                    }
                }
            };
            mergeComponents(globalComponents);
            mergeComponents(localComponents); // local wins
            mergedOpts.components = combined;
        }
        if (globalTransitions || localTransitions) {
            const byName = new Map();
            for (const item of globalTransitions ?? []) {
                if (!item || typeof item.name !== 'string')
                    continue;
                byName.set(item.name, item);
            }
            for (const item of localTransitions ?? []) {
                if (!item || typeof item.name !== 'string')
                    continue;
                byName.set(item.name, item);
            }
            mergedOpts.transitions = Array.from(byName.values());
        }
        options = mergedOpts;
    }
    // ── Resolve string selector ──
    if (typeof root === 'string') {
        const found = document.querySelector(root);
        if (!found)
            throw new Error(`[Dalila] bind: element not found: ${root}`);
        root = found;
    }
    // ── Component registry propagation via context ──
    if (options.components) {
        const existing = ctx[COMPONENT_REGISTRY_KEY];
        const merged = new Map(existing instanceof Map ? existing : []);
        if (Array.isArray(options.components)) {
            for (const comp of options.components) {
                if (!isComponent(comp)) {
                    warn('bind: components[] contains an invalid component entry');
                    continue;
                }
                merged.set(comp.definition.tag, comp);
            }
        }
        else {
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
        const ctxWithRegistry = Object.create(ctx);
        ctxWithRegistry[COMPONENT_REGISTRY_KEY] = merged;
        ctx = ctxWithRegistry;
    }
    const events = options.events ?? DEFAULT_EVENTS;
    const onMountError = options.onMountError ?? 'log';
    const rawTextSelectors = options.rawTextSelectors ?? DEFAULT_RAW_TEXT_SELECTORS;
    const templatePlanCacheConfig = resolveTemplatePlanCacheConfig(options);
    const transitionRegistry = createTransitionRegistry(options.transitions);
    const htmlRoot = root;
    // HMR support: Register binding context globally in dev mode.
    // Skip for internal (d-each clone) bindings — only the top-level bind owns HMR.
    if (!options._internal && isInDevMode()) {
        globalThis.__dalila_hmr_context = { root, ctx, options };
    }
    // Create a scope for this template binding
    const templateScope = createScope();
    const cleanups = [];
    const refs = new Map();
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
            bindTextInterpolation(root, ctx, rawTextSelectors, templatePlanCacheConfig);
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
    }
    finally {
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
    // Return BindHandle (callable dispose + ref accessors)
    const dispose = () => {
        // Run manual cleanups (event listeners)
        for (const cleanup of cleanups) {
            if (typeof cleanup === 'function') {
                try {
                    cleanup();
                }
                catch (e) {
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
        }
        catch (e) {
            if (isInDevMode()) {
                console.warn('[Dalila] Scope dispose error:', e);
            }
        }
    };
    const handle = Object.assign(dispose, {
        getRef(name) {
            return refs.get(name) ?? null;
        },
        getRefs() {
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
export function autoBind(selector, ctx, options) {
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
        }
        else {
            doBind();
        }
    });
}
export function mount(first, second, third) {
    // Overload 1: mount(selector, vm, options?)
    if (typeof first === 'string' && !isComponent(first)) {
        return bind(first, second, (third ?? {}));
    }
    // Overload 2: mount(component, target, props?)
    const component = first;
    const target = second;
    const props = third;
    const def = component.definition;
    const el = document.createElement(def.tag);
    if (props) {
        for (const key of Object.keys(props)) {
            el.setAttribute(`d-props-${camelToKebab(key)}`, key);
        }
    }
    target.appendChild(el);
    const parentCtx = {};
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
