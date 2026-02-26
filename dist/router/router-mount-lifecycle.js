export function scheduleRouteMountLifecycle(options) {
    const { onRouteMount, outletElement, leafData, ctx, isCurrent, setCleanup } = options;
    if (!onRouteMount)
        return;
    queueMicrotask(() => {
        if (!isCurrent())
            return;
        try {
            const result = onRouteMount(outletElement, leafData, ctx);
            if (typeof result === 'function') {
                if (isCurrent()) {
                    setCleanup(result);
                }
                else {
                    try {
                        result();
                    }
                    catch (cleanupError) {
                        console.error('[Dalila] Error in stale onRouteMount cleanup lifecycle hook:', cleanupError);
                    }
                }
                return;
            }
            if (result && typeof result.then === 'function') {
                void result
                    .then((resolved) => {
                    if (typeof resolved !== 'function')
                        return;
                    if (isCurrent()) {
                        setCleanup(resolved);
                    }
                    else {
                        try {
                            resolved();
                        }
                        catch (cleanupError) {
                            console.error('[Dalila] Error in stale async onRouteMount cleanup lifecycle hook:', cleanupError);
                        }
                    }
                })
                    .catch((error) => {
                    console.error('[Dalila] Error in onRouteMount lifecycle hook:', error);
                });
            }
        }
        catch (error) {
            console.error('[Dalila] Error in onRouteMount lifecycle hook:', error);
        }
    });
}
