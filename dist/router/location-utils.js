export function createLocationUtils(options) {
    const { basePrefix, normalizePath } = options;
    function stripBase(pathname) {
        if (!basePrefix)
            return normalizePath(pathname);
        const normalized = normalizePath(pathname);
        if (normalized === basePrefix)
            return '/';
        if (normalized.startsWith(basePrefix + '/')) {
            const stripped = normalized.slice(basePrefix.length);
            return stripped ? normalizePath(stripped) : '/';
        }
        return normalizePath(pathname);
    }
    function parseRelativePath(to) {
        let rest = to;
        let hash = '';
        const hashIdx = rest.indexOf('#');
        if (hashIdx >= 0) {
            hash = rest.slice(hashIdx + 1);
            rest = rest.slice(0, hashIdx);
        }
        let queryString = '';
        const queryIdx = rest.indexOf('?');
        if (queryIdx >= 0) {
            queryString = rest.slice(queryIdx + 1);
            rest = rest.slice(0, queryIdx);
        }
        const pathname = stripBase(rest || '/');
        const fullPath = `${pathname}${queryString ? `?${queryString}` : ''}${hash ? `#${hash}` : ''}`;
        return { pathname, queryString, hash, fullPath };
    }
    function parseLocation(to) {
        if (to.startsWith('/')) {
            return parseRelativePath(to);
        }
        const url = new URL(to, window.location.href);
        return parseRelativePath(`${url.pathname}${url.search}${url.hash}`);
    }
    function applyBase(fullPath) {
        if (!basePrefix)
            return fullPath;
        const location = parseLocation(fullPath);
        const pathname = location.pathname === '/' ? basePrefix : normalizePath(`${basePrefix}${location.pathname}`);
        return `${pathname}${location.queryString ? `?${location.queryString}` : ''}${location.hash ? `#${location.hash}` : ''}`;
    }
    function getLocationQuery(location) {
        if (!location.query) {
            location.query = new URLSearchParams(location.queryString);
        }
        return location.query;
    }
    return {
        stripBase,
        parseRelativePath,
        parseLocation,
        applyBase,
        getLocationQuery,
    };
}
