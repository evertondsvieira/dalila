export function findDeepestBoundaryIndex(matchStack, type) {
    for (let i = matchStack.length - 1; i >= 0; i -= 1) {
        if (matchStack[i].route[type])
            return i;
    }
    return -1;
}
export function runRouteUnmountLifecycleEffects(options) {
    const { cleanup, onRouteUnmount, outletElement, data, ctx } = options;
    if (cleanup) {
        try {
            cleanup();
        }
        catch (error) {
            console.error('[Dalila] Error in onRouteMount cleanup lifecycle hook:', error);
        }
    }
    if (onRouteUnmount && ctx) {
        try {
            const result = onRouteUnmount(outletElement, data, ctx);
            if (result && typeof result.then === 'function') {
                void result.catch((error) => {
                    console.error('[Dalila] Error in onRouteUnmount lifecycle hook:', error);
                });
            }
        }
        catch (error) {
            console.error('[Dalila] Error in onRouteUnmount lifecycle hook:', error);
        }
    }
}
