function parsePath(path) {
    const paramNames = [];
    const pattern = path
        .replace(/:([^\/]+)/g, (_, paramName) => {
        paramNames.push(paramName);
        return '([^/]+)';
    })
        .replace(/\*/g, '.*');
    return {
        pattern: new RegExp(`^${pattern}$`),
        paramNames
    };
}
export function matchRoute(path, routeDef) {
    const { pattern, paramNames } = parsePath(routeDef.path);
    const match = path.match(pattern);
    if (!match) {
        return null;
    }
    const params = {};
    paramNames.forEach((name, index) => {
        params[name] = match[index + 1];
    });
    const url = new URL(path, 'http://localhost');
    const query = url.searchParams;
    const hash = url.hash.slice(1); // Remove the #
    return {
        route: routeDef,
        params,
        query,
        hash
    };
}
export function findRoute(path, routes) {
    for (const route of routes) {
        const match = matchRoute(path, route);
        if (match) {
            return match;
        }
        if (route.children) {
            const childMatch = findRoute(path, route.children);
            if (childMatch) {
                return childMatch;
            }
        }
    }
    return null;
}
