/**
 * Dalila Template Runtime - bind()
 *
 * Binds a DOM tree to a reactive context using declarative attributes.
 * No eval, no inline JS execution - only identifier resolution from ctx.
 *
 * @module dalila/runtime
 */
import { effect, createScope, withScope, isInDevMode, signal, computeVirtualRange } from '../core/index.js';
import { WRAPPED_HANDLER } from '../form/form.js';
import { linkScopeToDom, withDevtoolsDomTarget } from '../core/devtools.js';
// ============================================================================
// Utilities
// ============================================================================
/**
 * Check if a value is a Dalila signal
 */
function isSignal(value) {
    return typeof value === 'function' && 'set' in value && 'update' in value;
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
/**
 * querySelectorAll that also tests the root element itself.
 * Necessary because querySelectorAll only searches descendants.
 */
function qsaIncludingRoot(root, selector) {
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
const BENCH_FLAG = '__dalila_bind_bench';
const BENCH_STATS_KEY = '__dalila_bind_bench_stats';
function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
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
function createBindBenchSession() {
    const enabled = isInDevMode() && globalThis[BENCH_FLAG] === true;
    return {
        enabled,
        scanMs: 0,
        parseMs: 0,
        totalExpressions: 0,
        fastPathExpressions: 0,
        planCacheHit: false,
    };
}
function flushBindBenchSession(session) {
    if (!session.enabled)
        return;
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
    const globalObj = globalThis;
    const bucket = globalObj[BENCH_STATS_KEY] ?? {};
    const runs = Array.isArray(bucket.runs) ? bucket.runs : [];
    runs.push(stats);
    if (runs.length > 200)
        runs.shift();
    bucket.runs = runs;
    bucket.last = stats;
    globalObj[BENCH_STATS_KEY] = bucket;
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
function parseInterpolationExpression(expression, benchSession) {
    let ast = expressionCache.get(expression);
    if (ast === undefined) {
        const parseStart = benchSession?.enabled ? nowMs() : 0;
        try {
            ast = parseExpression(expression);
            expressionCache.set(expression, ast);
            if (benchSession?.enabled) {
                benchSession.parseMs += nowMs() - parseStart;
            }
        }
        catch (err) {
            expressionCache.set(expression, null);
            if (benchSession?.enabled) {
                benchSession.parseMs += nowMs() - parseStart;
            }
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
function resolveCompiledExpression(compiled, benchSession) {
    if (compiled.kind === 'fast_path') {
        return { ok: true, ast: compiled.ast };
    }
    return parseInterpolationExpression(compiled.expression, benchSession);
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
function bindTextNodeFromPlan(node, plan, ctx, benchSession) {
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
function bindTextInterpolation(root, ctx, rawTextSelectors, cacheConfig, benchSession) {
    const signature = createInterpolationTemplateSignature(root, rawTextSelectors);
    const now = nowMs();
    let plan = getCachedTemplatePlan(signature, now, cacheConfig);
    const scanStart = benchSession?.enabled ? nowMs() : 0;
    if (!plan) {
        plan = createInterpolationTemplatePlan(root, rawTextSelectors);
        setCachedTemplatePlan(signature, plan, now, cacheConfig);
    }
    else if (benchSession) {
        benchSession.planCacheHit = true;
    }
    if (benchSession?.enabled) {
        benchSession.scanMs += nowMs() - scanStart;
        benchSession.totalExpressions = plan.totalExpressions;
        benchSession.fastPathExpressions = plan.fastPathExpressions;
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
        bindTextNodeFromPlan(item.node, item.binding, ctx, benchSession);
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
            el.addEventListener(eventName, handler);
            cleanups.push(() => el.removeEventListener(eventName, handler));
        }
    }
}
// ============================================================================
// d-when Directive
// ============================================================================
/**
 * Bind all [d-when] directives within root
 */
function bindWhen(root, ctx, cleanups) {
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
        // Apply initial state synchronously to avoid FOUC (flash of unstyled content)
        const initialValue = !!resolve(binding);
        htmlEl.style.display = initialValue ? '' : 'none';
        // Then create reactive effect to keep it updated
        bindEffect(htmlEl, () => {
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
// ============================================================================
// d-virtual-each Directive
// ============================================================================
function readVirtualNumberOption(raw, ctx, label) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber))
        return asNumber;
    const fromCtx = ctx[trimmed];
    if (fromCtx === undefined) {
        warn(`${label}: "${trimmed}" not found in context`);
        return null;
    }
    const resolved = resolve(fromCtx);
    if (typeof resolved === 'number' && Number.isFinite(resolved))
        return resolved;
    const numericFromString = Number(resolved);
    if (Number.isFinite(numericFromString))
        return numericFromString;
    warn(`${label}: "${trimmed}" must resolve to a finite number`);
    return null;
}
function readVirtualHeightOption(raw, ctx) {
    if (!raw)
        return null;
    const trimmed = raw.trim();
    if (!trimmed)
        return null;
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber))
        return `${asNumber}px`;
    const fromCtx = ctx[trimmed];
    if (fromCtx !== undefined) {
        const resolved = resolve(fromCtx);
        if (typeof resolved === 'number' && Number.isFinite(resolved))
            return `${resolved}px`;
        if (typeof resolved === 'string' && resolved.trim())
            return resolved.trim();
    }
    return trimmed;
}
function createVirtualSpacer(template, kind) {
    const spacer = template.cloneNode(false);
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
/**
 * Bind all [d-virtual-each] directives within root.
 *
 * V1 constraints:
 * - Fixed item height (required via d-virtual-item-height)
 * - Vertical virtualization only
 * - Parent element is the scroll container
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
        const itemHeightValue = readVirtualNumberOption(itemHeightRaw, ctx, 'd-virtual-item-height');
        const itemHeight = itemHeightValue == null ? NaN : itemHeightValue;
        if (!Number.isFinite(itemHeight) || itemHeight <= 0) {
            warn(`d-virtual-each: invalid item height on "${bindingName}". Falling back to d-each.`);
            el.setAttribute('d-each', bindingName);
            el.removeAttribute('d-virtual-each');
            el.removeAttribute('d-virtual-item-height');
            el.removeAttribute('d-virtual-overscan');
            el.removeAttribute('d-virtual-height');
            continue;
        }
        const overscanBinding = normalizeBinding(el.getAttribute('d-virtual-overscan'));
        const overscanRaw = overscanBinding ?? el.getAttribute('d-virtual-overscan');
        const overscanValue = readVirtualNumberOption(overscanRaw, ctx, 'd-virtual-overscan');
        const overscan = Number.isFinite(overscanValue)
            ? Math.max(0, Math.floor(overscanValue))
            : 6;
        const viewportHeight = readVirtualHeightOption(normalizeBinding(el.getAttribute('d-virtual-height')) ?? el.getAttribute('d-virtual-height'), ctx);
        let binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-virtual-each: "${bindingName}" not found in context`);
            binding = [];
        }
        const comment = document.createComment('d-virtual-each');
        el.parentNode?.replaceChild(comment, el);
        el.removeAttribute('d-virtual-each');
        el.removeAttribute('d-virtual-item-height');
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
        const clonesByKey = new Map();
        const disposesByKey = new Map();
        const metadataByKey = new Map();
        const itemsByKey = new Map();
        const objectKeyIds = new WeakMap();
        const symbolKeyIds = new Map();
        let nextObjectKeyId = 0;
        let nextSymbolKeyId = 0;
        const missingKeyWarned = new Set();
        let warnedNonArray = false;
        let warnedViewportFallback = false;
        const getObjectKeyId = (value) => {
            const existing = objectKeyIds.get(value);
            if (existing !== undefined)
                return existing;
            const next = ++nextObjectKeyId;
            objectKeyIds.set(value, next);
            return next;
        };
        const keyValueToString = (value, index) => {
            if (value === null || value === undefined)
                return `idx:${index}`;
            const type = typeof value;
            if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
                return `${type}:${String(value)}`;
            }
            if (type === 'symbol') {
                const sym = value;
                let id = symbolKeyIds.get(sym);
                if (id === undefined) {
                    id = ++nextSymbolKeyId;
                    symbolKeyIds.set(sym, id);
                }
                return `sym:${id}`;
            }
            if (type === 'object' || type === 'function') {
                return `obj:${getObjectKeyId(value)}`;
            }
            return `idx:${index}`;
        };
        const readKeyValue = (item, index) => {
            if (keyBinding) {
                if (keyBinding === '$index')
                    return index;
                if (keyBinding === 'item')
                    return item;
                if (typeof item === 'object' && item !== null && keyBinding in item) {
                    return item[keyBinding];
                }
                const warnId = `${keyBinding}:${index}`;
                if (!missingKeyWarned.has(warnId)) {
                    warn(`d-virtual-each: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
                    missingKeyWarned.add(warnId);
                }
                return index;
            }
            if (typeof item === 'object' && item !== null) {
                const obj = item;
                if ('id' in obj)
                    return obj.id;
                if ('key' in obj)
                    return obj.key;
            }
            return index;
        };
        function createClone(key, item, index, count) {
            const clone = template.cloneNode(true);
            const itemCtx = Object.create(ctx);
            if (typeof item === 'object' && item !== null) {
                Object.assign(itemCtx, item);
            }
            const metadata = {
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
            const dispose = bind(clone, itemCtx, { _skipLifecycle: true });
            disposesByKey.set(key, dispose);
            clonesByKey.set(key, clone);
            return clone;
        }
        function updateCloneMetadata(key, index, count) {
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
        function removeKey(key) {
            const clone = clonesByKey.get(key);
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
        let currentItems = [];
        function renderVirtualList(items) {
            const parent = comment.parentNode;
            if (!parent)
                return;
            const viewportHeightValue = scrollContainer?.clientHeight ?? 0;
            const effectiveViewportHeight = viewportHeightValue > 0 ? viewportHeightValue : itemHeight * 10;
            const scrollTop = scrollContainer?.scrollTop ?? 0;
            if (viewportHeightValue <= 0 && !warnedViewportFallback) {
                warnedViewportFallback = true;
                warn('d-virtual-each: scroll container has no measurable height. Using fallback viewport size.');
            }
            const range = computeVirtualRange({
                itemCount: items.length,
                itemHeight,
                scrollTop,
                viewportHeight: effectiveViewportHeight,
                overscan,
            });
            topSpacer.style.height = `${range.topOffset}px`;
            bottomSpacer.style.height = `${range.bottomOffset}px`;
            const orderedClones = [];
            const orderedKeys = [];
            const nextKeys = new Set();
            const changedKeys = new Set();
            for (let i = range.start; i < range.end; i++) {
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
            for (let i = 0; i < orderedClones.length; i++) {
                const key = orderedKeys[i];
                if (!changedKeys.has(key))
                    continue;
                removeKey(key);
                orderedClones[i] = createClone(key, items[range.start + i], range.start + i, items.length);
            }
            for (const key of Array.from(clonesByKey.keys())) {
                if (nextKeys.has(key))
                    continue;
                removeKey(key);
            }
            let referenceNode = bottomSpacer;
            for (let i = orderedClones.length - 1; i >= 0; i--) {
                const clone = orderedClones[i];
                if (clone.nextSibling !== referenceNode) {
                    parent.insertBefore(clone, referenceNode);
                }
                referenceNode = clone;
            }
        }
        let framePending = false;
        let pendingRaf = null;
        let pendingTimeout = null;
        const scheduleRender = () => {
            if (framePending)
                return;
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
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', onResize);
        }
        if (isSignal(binding)) {
            bindEffect(scrollContainer ?? el, () => {
                const value = binding();
                if (Array.isArray(value)) {
                    warnedNonArray = false;
                    currentItems = value;
                }
                else {
                    if (!warnedNonArray) {
                        warnedNonArray = true;
                        warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
                    }
                    currentItems = [];
                }
                renderVirtualList(currentItems);
            });
        }
        else if (Array.isArray(binding)) {
            currentItems = binding;
            renderVirtualList(currentItems);
        }
        else {
            warn(`d-virtual-each: "${bindingName}" is not an array or signal-of-array`);
        }
        cleanups.push(() => {
            scrollContainer?.removeEventListener('scroll', onScroll);
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', onResize);
            }
            if (pendingRaf != null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(pendingRaf);
            }
            pendingRaf = null;
            if (pendingTimeout != null)
                clearTimeout(pendingTimeout);
            pendingTimeout = null;
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
        const bindingName = normalizeBinding(el.getAttribute('d-each'));
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
        const clonesByKey = new Map();
        const disposesByKey = new Map();
        const metadataByKey = new Map();
        const itemsByKey = new Map();
        const objectKeyIds = new WeakMap();
        const symbolKeyIds = new Map();
        let nextObjectKeyId = 0;
        let nextSymbolKeyId = 0;
        const missingKeyWarned = new Set();
        const getObjectKeyId = (value) => {
            const existing = objectKeyIds.get(value);
            if (existing !== undefined)
                return existing;
            const next = ++nextObjectKeyId;
            objectKeyIds.set(value, next);
            return next;
        };
        const keyValueToString = (value, index) => {
            if (value === null || value === undefined)
                return `idx:${index}`;
            const type = typeof value;
            if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
                return `${type}:${String(value)}`;
            }
            if (type === 'symbol') {
                const sym = value;
                let id = symbolKeyIds.get(sym);
                if (id === undefined) {
                    id = ++nextSymbolKeyId;
                    symbolKeyIds.set(sym, id);
                }
                return `sym:${id}`;
            }
            if (type === 'object' || type === 'function') {
                return `obj:${getObjectKeyId(value)}`;
            }
            return `idx:${index}`;
        };
        const readKeyValue = (item, index) => {
            if (keyBinding) {
                if (keyBinding === '$index')
                    return index;
                if (keyBinding === 'item')
                    return item;
                if (typeof item === 'object' && item !== null && keyBinding in item) {
                    return item[keyBinding];
                }
                const warnId = `${keyBinding}:${index}`;
                if (!missingKeyWarned.has(warnId)) {
                    warn(`d-each: key "${keyBinding}" not found on item at index ${index}. Falling back to index key.`);
                    missingKeyWarned.add(warnId);
                }
                return index;
            }
            if (typeof item === 'object' && item !== null) {
                const obj = item;
                if ('id' in obj)
                    return obj.id;
                if ('key' in obj)
                    return obj.key;
            }
            return index;
        };
        function createClone(key, item, index, count) {
            const clone = template.cloneNode(true);
            // Inherit parent ctx via prototype so values and handlers defined
            // outside the loop remain accessible inside each iteration.
            const itemCtx = Object.create(ctx);
            if (typeof item === 'object' && item !== null) {
                Object.assign(itemCtx, item);
            }
            const metadata = {
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
        function updateCloneMetadata(key, index, count) {
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
            for (let i = 0; i < orderedClones.length; i++) {
                const clone = orderedClones[i];
                const item = items[i];
                const key = orderedKeys[i];
                if (!changedKeys.has(key))
                    continue;
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
                if (nextKeys.has(key))
                    continue;
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
            if (!parent)
                return;
            let referenceNode = comment;
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
        }
        else if (Array.isArray(binding)) {
            renderList(binding);
        }
        else {
            warn(`d-each: "${bindingName}" is not an array or signal`);
        }
        cleanups.push(() => {
            for (const clone of clonesByKey.values())
                clone.remove();
            for (const dispose of disposesByKey.values())
                dispose();
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
function bindIf(root, ctx, cleanups) {
    const elements = qsaIncludingRoot(root, '[d-if]');
    for (const el of elements) {
        const bindingName = normalizeBinding(el.getAttribute('d-if'));
        if (!bindingName)
            continue;
        const binding = ctx[bindingName];
        if (binding === undefined) {
            warn(`d-if: "${bindingName}" not found in context`);
            continue;
        }
        const comment = document.createComment('d-if');
        el.parentNode?.replaceChild(comment, el);
        el.removeAttribute('d-if');
        const htmlEl = el;
        // Apply initial state synchronously to avoid FOUC
        const initialValue = !!resolve(binding);
        if (initialValue) {
            comment.parentNode?.insertBefore(htmlEl, comment);
        }
        // Then create reactive effect to keep it updated
        bindEffect(htmlEl, () => {
            const value = !!resolve(binding);
            if (value) {
                if (!htmlEl.parentNode) {
                    comment.parentNode?.insertBefore(htmlEl, comment);
                }
            }
            else {
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
            const fields = [];
            if (clone.hasAttribute('d-field'))
                fields.push(clone);
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
            const errors = [];
            if (clone.hasAttribute('d-error'))
                errors.push(clone);
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
        function updateCloneIndex(clone, key, value, index, count) {
            // Update field names with new index (values stay in DOM)
            // Include clone root itself (for primitive arrays)
            const fields = [];
            if (clone.hasAttribute('d-field'))
                fields.push(clone);
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
            const errors = [];
            if (clone.hasAttribute('d-error'))
                errors.push(clone);
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
    // d-append: append new item
    const appendButtons = container.querySelectorAll('[d-append]');
    for (const btn of appendButtons) {
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
export function bind(root, ctx, options = {}) {
    const events = options.events ?? DEFAULT_EVENTS;
    const rawTextSelectors = options.rawTextSelectors ?? DEFAULT_RAW_TEXT_SELECTORS;
    const templatePlanCacheConfig = resolveTemplatePlanCacheConfig(options);
    const benchSession = createBindBenchSession();
    const htmlRoot = root;
    // HMR support: Register binding context globally in dev mode.
    // Skip for internal (d-each clone) bindings — only the top-level bind owns HMR.
    if (!options._internal && isInDevMode()) {
        globalThis.__dalila_hmr_context = { root, ctx, options };
    }
    // Create a scope for this template binding
    const templateScope = createScope();
    const cleanups = [];
    linkScopeToDom(templateScope, root, describeBindRoot(root));
    // Run all bindings within the template scope
    withScope(templateScope, () => {
        // 1. Form setup — must run very early to register form instances
        bindForm(root, ctx, cleanups);
        // 2. d-array — must run before d-each to setup field arrays
        bindArray(root, ctx, cleanups);
        // 3. d-virtual-each — must run early for virtual template extraction
        bindVirtualEach(root, ctx, cleanups);
        // 4. d-each — must run early: removes templates before TreeWalker visits them
        bindEach(root, ctx, cleanups);
        // 5. Text interpolation (template plan cache + lazy parser fallback)
        bindTextInterpolation(root, ctx, rawTextSelectors, templatePlanCacheConfig, benchSession);
        // 6. d-attr bindings
        bindAttrs(root, ctx, cleanups);
        // 7. d-html bindings
        bindHtml(root, ctx, cleanups);
        // 8. Form fields — register fields with form instances
        bindField(root, ctx, cleanups);
        // 9. Event bindings
        bindEvents(root, ctx, events, cleanups);
        // 10. d-when directive
        bindWhen(root, ctx, cleanups);
        // 11. d-match directive
        bindMatch(root, ctx, cleanups);
        // 12. Form error displays — BEFORE d-if to bind errors in conditionally rendered sections
        bindError(root, ctx, cleanups);
        bindFormError(root, ctx, cleanups);
        // 13. d-if — must run last: elements are fully bound before conditional removal
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
    flushBindBenchSession(benchSession);
    // Return dispose function
    return () => {
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
