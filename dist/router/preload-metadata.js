export function createPreloadMetadataHelpers(options) {
    const { routeManifestByPattern, normalizePath } = options;
    const preloadRouteIds = new WeakMap();
    let nextPreloadRouteId = 0;
    function normalizeTags(source) {
        if (!source || source.length === 0)
            return [];
        const tags = new Set();
        for (const tag of source) {
            const normalized = String(tag).trim();
            if (normalized)
                tags.add(normalized);
        }
        return [...tags];
    }
    function resolveManifestEntry(match) {
        return routeManifestByPattern.get(normalizePath(match.path));
    }
    function resolveMatchScore(match) {
        const manifest = resolveManifestEntry(match);
        if (typeof manifest?.score === 'number')
            return manifest.score;
        return typeof match.route.score === 'number' ? match.route.score : undefined;
    }
    function resolveMatchTags(match) {
        const manifest = resolveManifestEntry(match);
        const source = manifest?.tags ?? match.route.tags ?? [];
        return normalizeTags(source);
    }
    function resolvePreloadRouteId(match) {
        const existing = preloadRouteIds.get(match.route);
        if (existing)
            return existing;
        const generated = `r${++nextPreloadRouteId}`;
        preloadRouteIds.set(match.route, generated);
        return generated;
    }
    function resolvePreloadKey(match, location) {
        const routeId = resolvePreloadRouteId(match);
        const search = location.queryString;
        const urlKey = search ? `${location.pathname}?${search}` : location.pathname;
        return `${routeId}::${match.path}::${urlKey}`;
    }
    function createPreloadMetadata(match, location) {
        const manifest = resolveManifestEntry(match);
        return {
            path: location.pathname,
            fullPath: location.fullPath,
            routePath: match.path,
            routeId: manifest?.id,
            params: { ...match.params },
            queryString: location.queryString,
            tags: resolveMatchTags(match),
            score: resolveMatchScore(match),
        };
    }
    return {
        normalizeTags,
        resolveManifestEntry,
        resolveMatchScore,
        resolveMatchTags,
        resolvePreloadKey,
        createPreloadMetadata,
    };
}
