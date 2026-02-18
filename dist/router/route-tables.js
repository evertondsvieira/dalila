/**
 * Helper to define a single route with full type inference between
 * `loader` return type and the `view` / `layout` / `error` `data` parameter.
 *
 * @example
 * ```ts
 * const route = defineRoute({
 *   path: '/users',
 *   loader: async () => ({ users: await fetchUsers() }),
 *   view: (ctx, data) => {
 *     // data is inferred as { users: User[] }
 *     return fromHtml(tpl, { data });
 *   },
 * });
 * ```
 */
export function defineRoute(route) {
    return route;
}
/** Normalize a path: ensure leading slash, collapse duplicates, strip trailing slash. */
export function normalizePath(path) {
    if (!path)
        return '/';
    let normalized = path.startsWith('/') ? path : `/${path}`;
    normalized = normalized.replace(/\/{2,}/g, '/');
    if (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}
function joinPaths(parent, child) {
    if (!child || child === '.')
        return normalizePath(parent || '/');
    if (child.startsWith('/'))
        return normalizePath(child);
    const base = normalizePath(parent || '/');
    const trimmedBase = base === '/' ? '' : base;
    return normalizePath(`${trimmedBase}/${child}`);
}
/**
 * Rank a path segment for sorting.
 *
 * Higher rank = higher priority: static (2) > missing/parent (1.5) > dynamic (1) > wildcard (0).
 * The "missing" rank ensures parent routes are explored before dynamic siblings
 * so that static children get a chance to match first.
 */
function segmentRank(segment, index) {
    if (!segment) {
        // A missing segment means a shorter (parent) path. Rank it above dynamic
        // segments so the parent's children are explored before dynamic siblings.
        return index === 0 ? 2 : 1.5;
    }
    if (segment.includes('*'))
        return 0;
    if (segment.startsWith(':'))
        return 1;
    return 2;
}
function compareRoutePaths(aPath, bPath) {
    const aSegments = normalizePath(aPath).split('/').filter(Boolean);
    const bSegments = normalizePath(bPath).split('/').filter(Boolean);
    const max = Math.max(aSegments.length, bSegments.length);
    for (let i = 0; i < max; i += 1) {
        const aSeg = aSegments[i] ?? '';
        const bSeg = bSegments[i] ?? '';
        const aRank = segmentRank(aSeg, i);
        const bRank = segmentRank(bSeg, i);
        if (aRank !== bRank) {
            const aIsOptionalCatchAll = aSeg.startsWith(':') && aSeg.endsWith('*?');
            const bIsOptionalCatchAll = bSeg.startsWith(':') && bSeg.endsWith('*?');
            if (!aSeg && bIsOptionalCatchAll)
                return -1;
            if (!bSeg && aIsOptionalCatchAll)
                return 1;
            return bRank - aRank;
        }
        if (aRank === 2 && aSeg !== bSeg) {
            if (aSeg.length !== bSeg.length) {
                return bSeg.length - aSeg.length;
            }
            return aSeg.localeCompare(bSeg);
        }
    }
    if (aSegments.length !== bSegments.length) {
        return bSegments.length - aSegments.length;
    }
    return aPath.localeCompare(bPath);
}
function sortRoutes(routes) {
    return [...routes].sort((a, b) => compareRoutePaths(a.path, b.path));
}
function escapeRegexSegment(segment) {
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const routeLevelIndexCache = new WeakMap();
function resolveFirstStaticSegment(path) {
    const normalized = normalizePath(path);
    const segments = normalized.split('/').filter(Boolean);
    const first = segments[0];
    if (!first)
        return null;
    if (first.startsWith(':') || first.includes('*'))
        return null;
    return first;
}
function isFullyStaticPath(path) {
    const normalized = normalizePath(path);
    const segments = normalized.split('/').filter(Boolean);
    for (const segment of segments) {
        if (segment.startsWith(':') || segment.includes('*'))
            return false;
    }
    return true;
}
function buildRouteLevelIndex(compiled) {
    const staticByFirstSegment = new Map();
    const genericRoutes = [];
    const staticParentRoutesWithChildren = [];
    for (const entry of compiled) {
        if (entry.firstStaticSegment) {
            const bucket = staticByFirstSegment.get(entry.firstStaticSegment);
            if (bucket)
                bucket.push(entry);
            else
                staticByFirstSegment.set(entry.firstStaticSegment, [entry]);
            if (entry.children.length > 0) {
                staticParentRoutesWithChildren.push(entry);
            }
            continue;
        }
        genericRoutes.push(entry);
    }
    return { staticByFirstSegment, genericRoutes, staticParentRoutesWithChildren };
}
function parseDynamicSegment(segment) {
    if (!segment.startsWith(':'))
        return null;
    const raw = segment.slice(1);
    if (!raw)
        return null;
    if (raw.endsWith('*?')) {
        const name = raw.slice(0, -2);
        if (!name)
            return null;
        return { name, isCatchAll: true, isOptionalCatchAll: true };
    }
    if (raw.endsWith('*')) {
        const name = raw.slice(0, -1);
        if (!name)
            return null;
        return { name, isCatchAll: true, isOptionalCatchAll: false };
    }
    return { name: raw, isCatchAll: false, isOptionalCatchAll: false };
}
function buildSegmentsPattern(segments, paramCaptures) {
    let pattern = '^';
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const isLast = index === segments.length - 1;
        if (segment === '*') {
            pattern += '/.*';
            continue;
        }
        const dynamic = parseDynamicSegment(segment);
        if (dynamic) {
            if (dynamic.isCatchAll) {
                if (dynamic.isOptionalCatchAll) {
                    pattern += isLast ? '(?:/(.*))?' : '(?:/(.*?))?';
                }
                else {
                    pattern += '/';
                    pattern += isLast ? '(.+)' : '(.+?)';
                }
            }
            else {
                pattern += '/([^/]+)';
            }
            paramCaptures.push({ name: dynamic.name, isCatchAll: dynamic.isCatchAll });
            continue;
        }
        pattern += `/${escapeRegexSegment(segment)}`;
    }
    return pattern;
}
function parsePath(path) {
    const normalized = normalizePath(path);
    const segments = normalized.split('/').filter(Boolean);
    const paramCaptures = [];
    if (segments.length === 0) {
        return { pattern: /^\/$/, paramCaptures };
    }
    const pattern = buildSegmentsPattern(segments, paramCaptures) + '$';
    return { pattern: new RegExp(pattern), paramCaptures };
}
function parsePathPrefix(path) {
    const normalized = normalizePath(path);
    const segments = normalized.split('/').filter(Boolean);
    const paramCaptures = [];
    if (segments.length === 0) {
        return { pattern: /^\/(?:|$)/, paramCaptures };
    }
    const pattern = buildSegmentsPattern(segments, paramCaptures) + '(?:/|$)';
    return { pattern: new RegExp(pattern), paramCaptures };
}
function decodeRouteParam(raw) {
    try {
        return decodeURIComponent(raw);
    }
    catch {
        return raw;
    }
}
function decodeCatchAllParam(raw) {
    if (!raw)
        return [];
    return raw.split('/').filter(Boolean).map(decodeRouteParam);
}
function extractParams(match, paramCaptures) {
    const params = {};
    for (let i = 0; i < paramCaptures.length; i += 1) {
        const capture = paramCaptures[i];
        const raw = match[i + 1] ?? '';
        params[capture.name] = capture.isCatchAll
            ? decodeCatchAllParam(raw)
            : decodeRouteParam(raw);
    }
    return params;
}
/**
 * Compile the route tree into a pre-sorted, regex-ready structure.
 *
 * Called once at init. Subsequent route matching uses the compiled tree
 * without recompilation or re-sorting.
 */
export function compileRoutes(routes, parentPath = '') {
    return sortRoutes(routes).map(route => {
        const fullPath = joinPaths(parentPath, route.path);
        const normalizedFull = normalizePath(fullPath);
        const staticPath = isFullyStaticPath(fullPath);
        const exact = parsePath(fullPath);
        const prefix = normalizedFull === '/'
            ? null
            : parsePathPrefix(fullPath);
        return {
            route,
            fullPath,
            normalizedFullPath: normalizedFull,
            firstStaticSegment: resolveFirstStaticSegment(fullPath),
            staticExactPath: staticPath ? normalizedFull : null,
            staticPrefixPath: staticPath && normalizedFull !== '/' ? normalizedFull : null,
            exactPattern: exact.pattern,
            prefixPattern: prefix?.pattern ?? null,
            paramCaptures: exact.paramCaptures,
            children: route.children
                ? compileRoutes(route.children, fullPath)
                : []
        };
    });
}
/** Test a pathname against a compiled route's exact pattern. */
function matchCompiled(pathname, compiled) {
    if (compiled.staticExactPath !== null) {
        return pathname === compiled.staticExactPath ? {} : null;
    }
    const match = pathname.match(compiled.exactPattern);
    if (!match)
        return null;
    return extractParams(match, compiled.paramCaptures);
}
/** Test a pathname against a compiled route's prefix pattern (for parent/layout matching). */
function matchCompiledPrefix(pathname, compiled) {
    if (!compiled.prefixPattern)
        return {};
    if (compiled.staticPrefixPath !== null) {
        if (pathname === compiled.staticPrefixPath || pathname.startsWith(`${compiled.staticPrefixPath}/`)) {
            return {};
        }
        return null;
    }
    const match = pathname.match(compiled.prefixPattern);
    if (!match)
        return null;
    return extractParams(match, compiled.paramCaptures);
}
/**
 * Find the deepest matching route stack for a pathname.
 *
 * Returns the full parent-to-leaf match chain and whether the match
 * is exact (has a view/redirect) or partial (layout/prefix only).
 */
export function findCompiledRouteStackResult(pathname, compiled, stack = []) {
    const normalizedPathname = normalizePath(pathname);
    const firstPathSegment = normalizedPathname.split('/').filter(Boolean)[0] ?? '';
    return findCompiledRouteStackResultNormalized(normalizedPathname, firstPathSegment, compiled, stack);
}
function findCompiledRouteStackResultNormalized(pathname, firstPathSegment, compiled, stack) {
    let levelIndex = routeLevelIndexCache.get(compiled);
    if (!levelIndex) {
        levelIndex = buildRouteLevelIndex(compiled);
        routeLevelIndexCache.set(compiled, levelIndex);
    }
    let bestPartial = null;
    const tryCandidate = (entry) => {
        const exactParams = matchCompiled(pathname, entry);
        const prefixParams = !exactParams && (entry.route.children || entry.route.layout)
            ? matchCompiledPrefix(pathname, entry)
            : null;
        const params = exactParams || prefixParams;
        const isExact = Boolean(exactParams);
        if (params) {
            const match = {
                route: entry.route,
                path: entry.fullPath,
                params
            };
            stack.push(match);
            if (entry.children.length > 0) {
                const childResult = findCompiledRouteStackResultNormalized(pathname, firstPathSegment, entry.children, stack);
                if (childResult) {
                    if (childResult.exact) {
                        stack.pop();
                        return childResult;
                    }
                    if (!bestPartial || childResult.stack.length > bestPartial.length) {
                        bestPartial = childResult.stack;
                    }
                }
            }
            if (isExact && (entry.route.view || entry.route.redirect)) {
                const exactStack = stack.slice();
                stack.pop();
                return { stack: exactStack, exact: true };
            }
            if (!isExact && (entry.route.layout || entry.route.children)) {
                if (!bestPartial || stack.length > bestPartial.length) {
                    bestPartial = stack.slice();
                }
            }
            stack.pop();
        }
        else if (entry.children.length > 0) {
            // Parent didn't match but children may have absolute-like paths
            const childResult = findCompiledRouteStackResultNormalized(pathname, firstPathSegment, entry.children, stack);
            if (childResult) {
                if (childResult.exact)
                    return childResult;
                if (!bestPartial || childResult.stack.length > bestPartial.length) {
                    bestPartial = childResult.stack;
                }
            }
        }
        return null;
    };
    const specific = levelIndex.staticByFirstSegment.get(firstPathSegment);
    if (specific) {
        for (const entry of specific) {
            const exact = tryCandidate(entry);
            if (exact)
                return exact;
        }
    }
    for (const entry of levelIndex.genericRoutes) {
        const exact = tryCandidate(entry);
        if (exact)
            return exact;
    }
    // Preserve support for absolute-like child paths under static parents.
    // Example: parent "/admin" with child "/login" must still resolve "/login".
    for (const entry of levelIndex.staticParentRoutesWithChildren) {
        if (entry.firstStaticSegment === firstPathSegment)
            continue;
        const exact = tryCandidate(entry);
        if (exact)
            return exact;
    }
    return bestPartial ? { stack: bestPartial, exact: false } : null;
}
