export function createRouterPrefetchHelpers(options) {
    const { routes, routeManifestEntries, normalizePath, normalizeTags, joinRoutePaths, preloadPath } = options;
    function resolveStaticPrefetchPath(pattern) {
        const segments = normalizePath(pattern).split('/').filter(Boolean);
        const staticSegments = [];
        for (const segment of segments) {
            if (segment === '*')
                return null;
            if (!segment.startsWith(':')) {
                staticSegments.push(segment);
                continue;
            }
            const isOptionalCatchAll = segment.endsWith('*?');
            const isCatchAll = isOptionalCatchAll || segment.endsWith('*');
            if (isOptionalCatchAll)
                continue;
            if (isCatchAll)
                return null;
            return null;
        }
        return staticSegments.length > 0 ? `/${staticSegments.join('/')}` : '/';
    }
    function collectPrefetchCandidatesFromRoutes(routeDefs, parentPath = '') {
        const out = [];
        for (const route of routeDefs) {
            const fullPath = joinRoutePaths(parentPath, route.path);
            if (route.view || route.redirect) {
                out.push({
                    pattern: fullPath,
                    tags: normalizeTags(route.tags),
                    score: route.score
                });
            }
            if (route.children && route.children.length > 0) {
                out.push(...collectPrefetchCandidatesFromRoutes(route.children, fullPath));
            }
        }
        return out;
    }
    function collectPrefetchCandidates() {
        if (routeManifestEntries.length > 0) {
            return routeManifestEntries.map((entry) => ({
                pattern: normalizePath(entry.pattern),
                tags: normalizeTags(entry.tags),
                score: entry.score,
                load: entry.load
            }));
        }
        return collectPrefetchCandidatesFromRoutes(routes);
    }
    async function prefetchCandidates(candidates, priority = 'medium') {
        if (candidates.length === 0)
            return;
        const seenStaticPaths = new Set();
        const seenDynamicPatterns = new Set();
        const tasks = [];
        for (const candidate of candidates) {
            const staticPath = resolveStaticPrefetchPath(candidate.pattern);
            if (staticPath) {
                if (seenStaticPaths.has(staticPath))
                    continue;
                seenStaticPaths.add(staticPath);
                tasks.push(preloadPath(staticPath, priority).catch((error) => {
                    console.warn('[Dalila] Route prefetch failed:', error);
                }));
                continue;
            }
            if (!candidate.load)
                continue;
            if (seenDynamicPatterns.has(candidate.pattern))
                continue;
            seenDynamicPatterns.add(candidate.pattern);
            tasks.push(candidate.load().catch((error) => {
                console.warn('[Dalila] Route module prefetch failed:', error);
            }));
        }
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
    }
    return {
        collectPrefetchCandidates,
        prefetchCandidates,
        resolveStaticPrefetchPath
    };
}
