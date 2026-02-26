import type { RouteCtx, RouteMountCleanup, RouteTable } from './route-tables.js';

interface ScheduleRouteMountLifecycleOptions {
  onRouteMount: RouteTable['onRouteMount'] | null | undefined;
  outletElement: Element;
  leafData: unknown;
  ctx: RouteCtx;
  isCurrent: () => boolean;
  setCleanup: (cleanup: RouteMountCleanup) => void;
}

export function scheduleRouteMountLifecycle(
  options: ScheduleRouteMountLifecycleOptions
): void {
  const { onRouteMount, outletElement, leafData, ctx, isCurrent, setCleanup } = options;
  if (!onRouteMount) return;

  queueMicrotask(() => {
    if (!isCurrent()) return;
    try {
      const result = onRouteMount(outletElement as HTMLElement, leafData as any, ctx);
      if (typeof result === 'function') {
        if (isCurrent()) {
          setCleanup(result as RouteMountCleanup);
        } else {
          try {
            (result as RouteMountCleanup)();
          } catch (cleanupError) {
            console.error('[Dalila] Error in stale onRouteMount cleanup lifecycle hook:', cleanupError);
          }
        }
        return;
      }

      if (result && typeof (result as Promise<void | RouteMountCleanup>).then === 'function') {
        void (result as Promise<void | RouteMountCleanup>)
          .then((resolved) => {
            if (typeof resolved !== 'function') return;
            if (isCurrent()) {
              setCleanup(resolved as RouteMountCleanup);
            } else {
              try {
                (resolved as RouteMountCleanup)();
              } catch (cleanupError) {
                console.error('[Dalila] Error in stale async onRouteMount cleanup lifecycle hook:', cleanupError);
              }
            }
          })
          .catch((error) => {
            console.error('[Dalila] Error in onRouteMount lifecycle hook:', error);
          });
      }
    } catch (error) {
      console.error('[Dalila] Error in onRouteMount lifecycle hook:', error);
    }
  });
}
