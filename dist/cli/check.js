import * as fs from 'fs';
import * as path from 'path';
import { buildRouteTree, injectHtmlPathTemplates, findFile, findProjectRoot, extractParamKeys, } from './routes-generator.js';
// ============================================================================
// TypeScript Compiler API (dynamic import)
// ============================================================================
async function loadTypeScript() {
    try {
        return await import('typescript');
    }
    catch {
        console.error('❌ TypeScript is required for `dalila check`.\n' +
            '   Install it with: npm install -D typescript');
        process.exit(1);
    }
}
// ============================================================================
// Loader return type extraction via TS Compiler API
// ============================================================================
function extractLoaderReturnKeys(ts, checker, loaderSymbol, sourceFile) {
    function isPlainObjectLikeType(type) {
        if (type.isUnion()) {
            return type.types.length > 0 && type.types.every(isPlainObjectLikeType);
        }
        if (type.isIntersection()) {
            return type.types.length > 0 && type.types.every(isPlainObjectLikeType);
        }
        if ((type.flags & ts.TypeFlags.Object) === 0)
            return false;
        const objectType = type;
        if (objectType.getCallSignatures().length > 0)
            return false;
        if (checker.isArrayType(type) || checker.isTupleType(type))
            return false;
        const objectFlags = objectType.objectFlags ?? 0;
        if ((objectFlags & ts.ObjectFlags.Reference) !== 0) {
            const target = objectType.target;
            const targetName = target?.symbol?.getName();
            if (targetName === 'Array' || targetName === 'ReadonlyArray')
                return false;
        }
        return true;
    }
    const resolvedLoaderSymbol = loaderSymbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(loaderSymbol)
        : loaderSymbol;
    const loaderLocation = resolvedLoaderSymbol.valueDeclaration ??
        resolvedLoaderSymbol.declarations?.[0] ??
        sourceFile;
    const loaderType = checker.getTypeOfSymbolAtLocation(resolvedLoaderSymbol, loaderLocation);
    const callSignatures = loaderType.getCallSignatures();
    if (callSignatures.length === 0)
        return null;
    let returnType = checker.getReturnTypeOfSignature(callSignatures[0]);
    // Unwrap Promise<T>
    const typeSymbol = returnType.getSymbol();
    const targetSymbol = returnType.target?.symbol;
    if (typeSymbol?.getName() === 'Promise' ||
        targetSymbol?.getName() === 'Promise') {
        const typeArgs = checker.getTypeArguments(returnType);
        if (typeArgs && typeArgs.length > 0) {
            returnType = typeArgs[0];
        }
    }
    if (!isPlainObjectLikeType(returnType))
        return null;
    return returnType.getProperties().map(p => p.getName());
}
function getLoaderExportSymbol(ts, checker, sourceFile) {
    const symbol = checker.getSymbolAtLocation(sourceFile);
    if (!symbol)
        return null;
    const moduleExports = checker.getExportsOfModule(symbol);
    const loaderSymbol = moduleExports.find(s => s.getName() === 'loader');
    if (!loaderSymbol)
        return null;
    const runtimeFlags = ts.SymbolFlags.Function |
        ts.SymbolFlags.Variable |
        ts.SymbolFlags.Property |
        ts.SymbolFlags.Method |
        ts.SymbolFlags.GetAccessor |
        ts.SymbolFlags.Alias;
    return (loaderSymbol.flags & runtimeFlags) !== 0 ? loaderSymbol : null;
}
// ============================================================================
// Template identifier extraction (regex-based)
// ============================================================================
const JS_KEYWORDS = new Set([
    'true', 'false', 'null', 'undefined', 'NaN', 'Infinity',
    'typeof', 'instanceof', 'void', 'delete', 'in', 'of',
    'new', 'this', 'if', 'else', 'return', 'switch', 'case',
    'break', 'continue', 'for', 'while', 'do', 'try', 'catch',
    'finally', 'throw', 'const', 'let', 'var', 'function', 'class',
]);
function extractParamNames(segment) {
    const result = [];
    const seen = new Set();
    const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
    function splitTopLevel(input) {
        const parts = [];
        let start = 0;
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = null;
        let escaped = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                }
                else if (ch === '\\') {
                    escaped = true;
                }
                else if (ch === inString) {
                    inString = null;
                }
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = ch;
                continue;
            }
            if (ch === '(')
                depthParen++;
            else if (ch === ')')
                depthParen = Math.max(0, depthParen - 1);
            else if (ch === '[')
                depthBracket++;
            else if (ch === ']')
                depthBracket = Math.max(0, depthBracket - 1);
            else if (ch === '{')
                depthBrace++;
            else if (ch === '}')
                depthBrace = Math.max(0, depthBrace - 1);
            else if (ch === ',' &&
                depthParen === 0 &&
                depthBracket === 0 &&
                depthBrace === 0) {
                parts.push(input.slice(start, i));
                start = i + 1;
            }
        }
        parts.push(input.slice(start));
        return parts;
    }
    function topLevelIndexOf(input, target) {
        let depthParen = 0;
        let depthBracket = 0;
        let depthBrace = 0;
        let inString = null;
        let escaped = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (inString) {
                if (escaped) {
                    escaped = false;
                }
                else if (ch === '\\') {
                    escaped = true;
                }
                else if (ch === inString) {
                    inString = null;
                }
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                inString = ch;
                continue;
            }
            if (ch === '(')
                depthParen++;
            else if (ch === ')')
                depthParen = Math.max(0, depthParen - 1);
            else if (ch === '[')
                depthBracket++;
            else if (ch === ']')
                depthBracket = Math.max(0, depthBracket - 1);
            else if (ch === '{')
                depthBrace++;
            else if (ch === '}')
                depthBrace = Math.max(0, depthBrace - 1);
            else if (ch === target &&
                depthParen === 0 &&
                depthBracket === 0 &&
                depthBrace === 0) {
                return i;
            }
        }
        return -1;
    }
    function stripDefaultValue(input) {
        const eqIdx = topLevelIndexOf(input, '=');
        if (eqIdx >= 0)
            return input.slice(0, eqIdx).trim();
        return input.trim();
    }
    function collectFromPattern(pattern) {
        let param = pattern.trim();
        if (!param)
            return;
        param = param.replace(/^\.\.\./, '').trim();
        param = stripDefaultValue(param);
        if (!param)
            return;
        if (IDENT_RE.test(param)) {
            if (!JS_KEYWORDS.has(param) && !seen.has(param)) {
                seen.add(param);
                result.push(param);
            }
            return;
        }
        if (param.startsWith('{') && param.endsWith('}')) {
            const inner = param.slice(1, -1);
            for (const rawEntry of splitTopLevel(inner)) {
                const entry = rawEntry.trim();
                if (!entry)
                    continue;
                if (entry.startsWith('...')) {
                    collectFromPattern(entry.slice(3));
                    continue;
                }
                const colonIdx = topLevelIndexOf(entry, ':');
                if (colonIdx >= 0) {
                    collectFromPattern(entry.slice(colonIdx + 1));
                }
                else {
                    collectFromPattern(entry);
                }
            }
            return;
        }
        if (param.startsWith('[') && param.endsWith(']')) {
            const inner = param.slice(1, -1);
            for (const rawEntry of splitTopLevel(inner)) {
                collectFromPattern(rawEntry);
            }
        }
    }
    for (const chunk of splitTopLevel(segment)) {
        collectFromPattern(chunk);
    }
    return result;
}
function collectLocalIdentifiers(expr) {
    const locals = new Set();
    const ARROW_SINGLE_PARAM_RE = /(?<![\w$.])([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=>/g;
    let match;
    while ((match = ARROW_SINGLE_PARAM_RE.exec(expr))) {
        locals.add(match[1]);
    }
    const ARROW_PARAMS_RE = /\(([^)]*)\)\s*=>/g;
    while ((match = ARROW_PARAMS_RE.exec(expr))) {
        for (const name of extractParamNames(match[1])) {
            locals.add(name);
        }
    }
    const FUNCTION_PARAMS_RE = /function(?:\s+[a-zA-Z_$][a-zA-Z0-9_$]*)?\s*\(([^)]*)\)/g;
    while ((match = FUNCTION_PARAMS_RE.exec(expr))) {
        for (const name of extractParamNames(match[1])) {
            locals.add(name);
        }
    }
    const CATCH_PARAM_RE = /catch\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\)/g;
    while ((match = CATCH_PARAM_RE.exec(expr))) {
        locals.add(match[1]);
    }
    return locals;
}
/**
 * Extract root identifiers from a template expression.
 * Given `items.length`, returns `['items']`.
 * Given `count`, returns `['count']`.
 * Ignores string literals, numbers, and JS keywords.
 */
function extractRootIdentifiers(expr) {
    // Remove plain string literal contents while preserving template
    // expression bodies inside `${...}` so identifiers are still validated.
    const stripStringsPreserveTemplateExpressions = (input) => {
        let i = 0;
        let out = '';
        const consumeQuoted = (quote) => {
            out += ' ';
            i++;
            let escaped = false;
            while (i < input.length) {
                const ch = input[i];
                out += ' ';
                i++;
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (ch === '\\') {
                    escaped = true;
                    continue;
                }
                if (ch === quote)
                    break;
            }
        };
        const consumeTemplate = () => {
            out += ' ';
            i++;
            let escaped = false;
            while (i < input.length) {
                const ch = input[i];
                if (escaped) {
                    out += ' ';
                    escaped = false;
                    i++;
                    continue;
                }
                if (ch === '\\') {
                    out += ' ';
                    escaped = true;
                    i++;
                    continue;
                }
                if (ch === '`') {
                    out += ' ';
                    i++;
                    break;
                }
                if (ch === '$' && input[i + 1] === '{') {
                    out += '${';
                    i += 2;
                    let depth = 1;
                    while (i < input.length && depth > 0) {
                        const inner = input[i];
                        if (inner === '"' || inner === "'") {
                            consumeQuoted(inner);
                            continue;
                        }
                        if (inner === '`') {
                            consumeTemplate();
                            continue;
                        }
                        if (inner === '{') {
                            depth++;
                            out += inner;
                            i++;
                            continue;
                        }
                        if (inner === '}') {
                            depth--;
                            out += inner;
                            i++;
                            continue;
                        }
                        out += inner;
                        i++;
                    }
                    continue;
                }
                out += ' ';
                i++;
            }
        };
        while (i < input.length) {
            const ch = input[i];
            if (ch === '"' || ch === "'") {
                consumeQuoted(ch);
                continue;
            }
            if (ch === '`') {
                consumeTemplate();
                continue;
            }
            out += ch;
            i++;
        }
        return out;
    };
    const cleaned = stripStringsPreserveTemplateExpressions(expr);
    const localIdentifiers = collectLocalIdentifiers(cleaned);
    // Match identifiers NOT preceded by a dot (member access)
    const regex = /(?<![.\w$])([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    const seen = new Set();
    const result = [];
    const prevNonWs = (index) => {
        for (let i = index; i >= 0; i--) {
            if (!/\s/.test(cleaned[i]))
                return cleaned[i];
        }
        return null;
    };
    const nextNonWs = (index) => {
        for (let i = index; i < cleaned.length; i++) {
            if (!/\s/.test(cleaned[i]))
                return cleaned[i];
        }
        return null;
    };
    let match;
    while ((match = regex.exec(cleaned))) {
        const name = match[1];
        const nextToken = nextNonWs(regex.lastIndex);
        const prevToken = prevNonWs(match.index - 1);
        const isObjectLiteralKey = nextToken === ':' && (prevToken === '{' || prevToken === ',');
        if (!isObjectLiteralKey && !JS_KEYWORDS.has(name) && !seen.has(name) && !localIdentifiers.has(name)) {
            seen.add(name);
            result.push(name);
        }
    }
    return result;
}
/**
 * Extract all template identifiers from HTML content.
 *
 * Scans for:
 * 1. Text interpolation `{expr}` — only outside HTML tags
 * 2. Context-binding directives `d-*="value"` — specific set
 */
function extractTemplateIdentifiers(html) {
    const identifiers = [];
    const lines = html.split('\n');
    const lineOffsets = [];
    let runningOffset = 0;
    for (const line of lines) {
        lineOffsets.push(runningOffset);
        runningOffset += line.length + 1;
    }
    function offsetToLineCol(offset) {
        let lineIdx = 0;
        for (let i = 0; i < lineOffsets.length; i++) {
            if (lineOffsets[i] <= offset) {
                lineIdx = i;
            }
            else {
                break;
            }
        }
        return { line: lineIdx + 1, col: offset - lineOffsets[lineIdx] + 1 };
    }
    // --- 1. Text interpolation {expr} with state machine (supports multiline) ---
    let inTag = false;
    let tagQuote = null;
    let i = 0;
    while (i < html.length) {
        const ch = html[i];
        if (!inTag && ch === '<') {
            inTag = true;
            tagQuote = null;
            i++;
            continue;
        }
        if (inTag) {
            if (tagQuote) {
                if (ch === tagQuote) {
                    tagQuote = null;
                }
                i++;
                continue;
            }
            if (ch === '"' || ch === "'") {
                tagQuote = ch;
                i++;
                continue;
            }
            if (ch === '>') {
                inTag = false;
                tagQuote = null;
                i++;
                continue;
            }
            i++;
            continue;
        }
        if (ch === '{') {
            const start = i;
            let depth = 1;
            let j = i + 1;
            let inString = null;
            let escaped = false;
            while (j < html.length && depth > 0) {
                const ch = html[j];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    }
                    else if (ch === '\\') {
                        escaped = true;
                    }
                    else if (ch === inString) {
                        inString = null;
                    }
                    j++;
                    continue;
                }
                if (ch === '"' || ch === "'" || ch === '`') {
                    inString = ch;
                    j++;
                    continue;
                }
                if (ch === '{')
                    depth++;
                if (ch === '}')
                    depth--;
                j++;
            }
            if (depth === 0) {
                const expr = html.slice(start + 1, j - 1);
                const roots = extractRootIdentifiers(expr);
                const loc = offsetToLineCol(start);
                for (const name of roots) {
                    identifiers.push({
                        name,
                        line: loc.line,
                        col: loc.col,
                        offset: start,
                        source: 'interpolation',
                    });
                }
                i = j;
                continue;
            }
        }
        i++;
    }
    // --- 2. Directive scanning (supports single and double quotes) ---
    const DIRECTIVE_RE = /\b(d-each|d-virtual-each|d-virtual-height|d-virtual-item-height|d-virtual-overscan|d-if|d-when|d-match|d-html|d-attr-[a-zA-Z][\w-]*|d-on-[a-zA-Z][\w-]*|d-form-error|d-form|d-array)\s*=\s*(['"])([\s\S]*?)\2/g;
    DIRECTIVE_RE.lastIndex = 0;
    let match;
    while ((match = DIRECTIVE_RE.exec(html))) {
        const directive = match[1];
        const value = match[3].trim();
        if (!value)
            continue;
        const roots = extractRootIdentifiers(value);
        const loc = offsetToLineCol(match.index);
        for (const name of roots) {
            identifiers.push({
                name,
                line: loc.line,
                col: loc.col,
                offset: match.index,
                source: directive,
            });
        }
    }
    return identifiers;
}
function extractLoopRanges(html) {
    const ranges = [];
    const stack = [];
    let i = 0;
    while (i < html.length) {
        if (html[i] !== '<') {
            i++;
            continue;
        }
        let j = i + 1;
        let inString = null;
        let escaped = false;
        while (j < html.length) {
            const ch = html[j];
            if (inString) {
                if (escaped) {
                    escaped = false;
                }
                else if (ch === '\\') {
                    escaped = true;
                }
                else if (ch === inString) {
                    inString = null;
                }
                j++;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inString = ch;
                j++;
                continue;
            }
            if (ch === '>')
                break;
            j++;
        }
        if (j >= html.length)
            break;
        const fullTag = html.slice(i, j + 1);
        const inner = html.slice(i + 1, j).trim();
        const isClosingTag = inner.startsWith('/');
        const normalized = isClosingTag ? inner.slice(1).trim() : inner;
        const nameMatch = /^([a-zA-Z][\w:-]*)/.exec(normalized);
        if (!nameMatch) {
            i = j + 1;
            continue;
        }
        const tagName = nameMatch[1];
        const attrs = normalized.slice(tagName.length);
        const isSelfClosingTag = !isClosingTag && /\/\s*$/.test(normalized);
        if (isClosingTag) {
            for (let stackIdx = stack.length - 1; stackIdx >= 0; stackIdx--) {
                if (stack[stackIdx].tagName !== tagName)
                    continue;
                const entry = stack.splice(stackIdx, 1)[0];
                if (entry.isLoop) {
                    ranges.push({ start: entry.start, end: i + fullTag.length });
                }
                break;
            }
            i = j + 1;
            continue;
        }
        const isLoopTag = /\bd-(?:virtual-)?each\s*=\s*(['"])([\s\S]*?)\1/.test(attrs);
        if (isSelfClosingTag) {
            if (isLoopTag) {
                ranges.push({ start: i, end: i + fullTag.length });
            }
            i = j + 1;
            continue;
        }
        stack.push({ tagName, isLoop: isLoopTag, start: i });
        i = j + 1;
    }
    for (const entry of stack) {
        if (entry.isLoop) {
            ranges.push({ start: entry.start, end: html.length });
        }
    }
    return ranges;
}
function isInsideLoopRange(offset, ranges) {
    for (const range of ranges) {
        if (offset >= range.start && offset < range.end)
            return true;
    }
    return false;
}
// ============================================================================
// Levenshtein did-you-mean
// ============================================================================
function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++)
        dp[i][0] = i;
    for (let j = 0; j <= n; j++)
        dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (a[i - 1] === b[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            }
            else {
                dp[i][j] =
                    1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}
function findSuggestion(identifier, validNames) {
    let best;
    let bestDist = Infinity;
    const maxDist = Math.max(2, Math.floor(identifier.length * 0.4));
    for (const name of validNames) {
        const dist = levenshtein(identifier, name);
        if (dist < bestDist && dist <= maxDist) {
            bestDist = dist;
            best = name;
        }
    }
    return best;
}
// ============================================================================
// Diagnostic check
// ============================================================================
const BUILTIN_IDENTIFIERS = new Set([
    'params',
    'query',
    'path',
    'fullPath',
]);
const LOOP_VARS = new Set([
    '$index',
    '$count',
    '$first',
    '$last',
    '$odd',
    '$even',
    'item',
    'key',
]);
const LOOP_FORCED_CHECK_SOURCES = new Set([
    'd-each',
    'd-virtual-each',
    'd-virtual-height',
    'd-virtual-item-height',
    'd-virtual-overscan',
]);
function checkHtmlContent(html, filePath, validIdentifiers, diagnostics) {
    const ids = extractTemplateIdentifiers(html);
    const loopRanges = extractLoopRanges(html);
    for (const id of ids) {
        if (validIdentifiers.has(id.name))
            continue;
        const insideLoop = isInsideLoopRange(id.offset, loopRanges);
        if (insideLoop) {
            if (LOOP_VARS.has(id.name))
                continue;
            // Loop runtime injects item fields into local scope, so unknown
            // identifiers may be valid inside loop bodies.
            if (!LOOP_FORCED_CHECK_SOURCES.has(id.source))
                continue;
        }
        const suggestion = findSuggestion(id.name, [...validIdentifiers]);
        diagnostics.push({
            filePath,
            line: id.line,
            col: id.col,
            identifier: id.name,
            source: id.source,
            suggestion,
        });
    }
}
// ============================================================================
// Route tree helpers
// ============================================================================
function collectRouteTsPaths(node, routesDir, out) {
    for (const file of node.files) {
        if (file.isHtml)
            continue;
        out.push(path.join(routesDir, file.path));
    }
    for (const child of node.children) {
        collectRouteTsPaths(child, routesDir, out);
    }
}
function computeFullPattern(node, parentPattern) {
    if (!node.segment)
        return parentPattern || '/';
    const base = parentPattern === '/' ? '' : parentPattern;
    return `${base}/${node.routePath}`;
}
function traverseAndCheck(node, routesDir, parentPattern, loaderKeysMap, uninferableLoaderPaths, diagnostics) {
    const currentPattern = computeFullPattern(node, parentPattern);
    const paramKeys = extractParamKeys(currentPattern);
    // --- Check page.html ---
    const pageHtml = findFile(node, 'page', true);
    const pageTs = findFile(node, 'page', false);
    if (pageHtml && pageHtml.htmlContent) {
        const pageTsPath = pageTs ? path.join(routesDir, pageTs.path) : null;
        const skipPageCheck = pageTsPath && uninferableLoaderPaths.has(pageTsPath);
        if (!skipPageCheck) {
            const validIds = new Set(BUILTIN_IDENTIFIERS);
            for (const k of paramKeys)
                validIds.add(k);
            if (pageTs) {
                const keys = loaderKeysMap.get(path.join(routesDir, pageTs.path));
                if (keys)
                    for (const k of keys)
                        validIds.add(k);
            }
            checkHtmlContent(pageHtml.htmlContent, pageHtml.path, validIds, diagnostics);
        }
    }
    // --- Check layout.html ---
    const layoutHtml = findFile(node, 'layout', true);
    const layoutTs = findFile(node, 'layout', false);
    if (layoutHtml && layoutHtml.htmlContent) {
        const layoutTsPath = layoutTs ? path.join(routesDir, layoutTs.path) : null;
        const skipLayoutCheck = layoutTsPath && uninferableLoaderPaths.has(layoutTsPath);
        if (!skipLayoutCheck) {
            const validIds = new Set(BUILTIN_IDENTIFIERS);
            for (const k of paramKeys)
                validIds.add(k);
            if (layoutTs) {
                const keys = loaderKeysMap.get(path.join(routesDir, layoutTs.path));
                if (keys)
                    for (const k of keys)
                        validIds.add(k);
            }
            checkHtmlContent(layoutHtml.htmlContent, layoutHtml.path, validIds, diagnostics);
        }
    }
    // --- Check error.html, loading.html, not-found.html ---
    const stateTypes = ['error', 'pending', 'notFound'];
    for (const type of stateTypes) {
        const html = findFile(node, type, true);
        if (!html || !html.htmlContent)
            continue;
        const validIds = new Set(BUILTIN_IDENTIFIERS);
        for (const k of paramKeys)
            validIds.add(k);
        if (type === 'error')
            validIds.add('errorMessage');
        checkHtmlContent(html.htmlContent, html.path, validIds, diagnostics);
    }
    // Recurse into children
    for (const child of node.children) {
        traverseAndCheck(child, routesDir, currentPattern, loaderKeysMap, uninferableLoaderPaths, diagnostics);
    }
}
// ============================================================================
// Main entry point
// ============================================================================
export async function runCheck(appDir, options = {}) {
    const ts = await loadTypeScript();
    const strictMode = Boolean(options.strict);
    console.log('');
    console.log('🔍 Dalila Check');
    console.log('');
    const routesDir = path.resolve(appDir);
    if (!fs.existsSync(routesDir)) {
        console.error(`❌ App directory not found: ${routesDir}`);
        return 1;
    }
    // 1. Build route tree (reuses routes-generator internals)
    const tree = await buildRouteTree(routesDir, '', '');
    const projectRoot = (await findProjectRoot(routesDir)) ?? process.cwd();
    await injectHtmlPathTemplates(tree, routesDir, projectRoot);
    // 2. Collect route .ts files, create shared TS Program, infer loader keys by symbols
    const routeTsPaths = [];
    collectRouteTsPaths(tree, routesDir, routeTsPaths);
    const loaderKeysMap = new Map();
    const uninferableLoaderPaths = new Set();
    const strictIssues = [];
    if (routeTsPaths.length > 0) {
        const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
        let compilerOptions = {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.NodeJs,
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
        };
        if (fs.existsSync(tsconfigPath)) {
            const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
            if (configFile.config) {
                const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);
                compilerOptions = parsed.options;
            }
        }
        const program = ts.createProgram(routeTsPaths, compilerOptions);
        const checker = program.getTypeChecker();
        for (const filePath of routeTsPaths) {
            const sourceFile = program.getSourceFile(filePath);
            if (!sourceFile)
                continue;
            const loaderSymbol = getLoaderExportSymbol(ts, checker, sourceFile);
            if (!loaderSymbol)
                continue;
            const keys = extractLoaderReturnKeys(ts, checker, loaderSymbol, sourceFile);
            if (keys) {
                loaderKeysMap.set(filePath, keys);
            }
            else {
                uninferableLoaderPaths.add(filePath);
                if (strictMode) {
                    strictIssues.push(`${path.relative(process.cwd(), filePath)} exports "loader", but its return type could not be inferred`);
                }
            }
        }
    }
    // 3. Traverse tree and check all HTML templates
    const diagnostics = [];
    traverseAndCheck(tree, routesDir, '/', loaderKeysMap, uninferableLoaderPaths, diagnostics);
    // 4. Report results
    if (strictIssues.length === 0 && diagnostics.length === 0) {
        console.log('✅ No errors found');
        console.log('');
        return 0;
    }
    if (strictIssues.length > 0) {
        console.log('  Strict mode');
        for (const issue of strictIssues) {
            console.log(`    ❌ ${issue}`);
        }
        console.log('');
    }
    // Group by file
    const grouped = new Map();
    for (const d of diagnostics) {
        const list = grouped.get(d.filePath) ?? [];
        list.push(d);
        grouped.set(d.filePath, list);
    }
    for (const [file, diags] of grouped) {
        console.log(`  ${file}`);
        for (const d of diags) {
            const loc = `${d.line}:${d.col}`;
            let msg = `"${d.identifier}" is not defined in template context (${d.source})`;
            if (d.suggestion) {
                msg += `. Did you mean "${d.suggestion}"?`;
            }
            console.log(`    ${loc.padEnd(8)} ❌ ${msg}`);
        }
        console.log('');
    }
    const totalErrors = diagnostics.length + strictIssues.length;
    const fileCount = grouped.size + strictIssues.length;
    console.log(`❌ Found ${totalErrors} error${totalErrors === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`);
    console.log('');
    return 1;
}
