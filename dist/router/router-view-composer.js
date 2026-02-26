export function composeViewStack(options) {
    const { matchStack, ctx, dataStack, withScopeRender, resolveTagLayout } = options;
    let content = null;
    let leafRoute = null;
    let leafData = undefined;
    for (let i = matchStack.length - 1; i >= 0; i -= 1) {
        const match = matchStack[i];
        const data = dataStack[i];
        const route = match.route;
        if (i === matchStack.length - 1) {
            leafRoute = route;
            leafData = data;
            if (!route.view) {
                console.warn(`[Dalila] Leaf route ${match.path} has no view function`);
                return { content: null, leafRoute, leafData };
            }
            content = withScopeRender(() => route.view(ctx, data));
            if (!route.layout && content) {
                const tagLayout = resolveTagLayout(match);
                if (tagLayout) {
                    const childNodes = Array.isArray(content) ? content : [content];
                    content = withScopeRender(() => tagLayout(ctx, childNodes, data));
                }
            }
            continue;
        }
        if (!content)
            continue;
        const childNodes = Array.isArray(content) ? content : [content];
        if (route.layout) {
            content = withScopeRender(() => route.layout(ctx, childNodes, data));
        }
        else {
            const tagLayout = resolveTagLayout(match);
            if (tagLayout) {
                content = withScopeRender(() => tagLayout(ctx, childNodes, data));
            }
        }
    }
    return { content, leafRoute, leafData };
}
