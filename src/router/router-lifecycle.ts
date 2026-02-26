import type { RouteCtx, RouteMountCleanup, RouteTable, RouteTableMatch } from './route-tables.js';

export type RouteBoundaryType = 'pending' | 'error' | 'notFound';

export function findDeepestBoundaryIndex(
  matchStack: RouteTableMatch[],
  type: RouteBoundaryType
): number {
  for (let i = matchStack.length - 1; i >= 0; i -= 1) {
    if (matchStack[i].route[type]) return i;
  }
  return -1;
}

interface RunRouteUnmountLifecycleEffectsOptions {
  cleanup: RouteMountCleanup | null;
  onRouteUnmount: RouteTable['onRouteUnmount'] | null;
  outletElement: Element;
  data: unknown;
  ctx: RouteCtx | null;
}

export function runRouteUnmountLifecycleEffects(
  options: RunRouteUnmountLifecycleEffectsOptions
): void {
  const { cleanup, onRouteUnmount, outletElement, data, ctx } = options;

  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      console.error('[Dalila] Error in onRouteMount cleanup lifecycle hook:', error);
    }
  }

  if (onRouteUnmount && ctx) {
    try {
      const result = onRouteUnmount(outletElement as HTMLElement, data as any, ctx as RouteCtx);
      if (result && typeof (result as Promise<void>).then === 'function') {
        void (result as Promise<void>).catch((error) => {
          console.error('[Dalila] Error in onRouteUnmount lifecycle hook:', error);
        });
      }
    } catch (error) {
      console.error('[Dalila] Error in onRouteUnmount lifecycle hook:', error);
    }
  }
}
