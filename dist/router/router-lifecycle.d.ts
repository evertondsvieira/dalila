import type { RouteCtx, RouteMountCleanup, RouteTable, RouteTableMatch } from './route-tables.js';
export type RouteBoundaryType = 'pending' | 'error' | 'notFound';
export declare function findDeepestBoundaryIndex(matchStack: RouteTableMatch[], type: RouteBoundaryType): number;
interface RunRouteUnmountLifecycleEffectsOptions {
    cleanup: RouteMountCleanup | null;
    onRouteUnmount: RouteTable['onRouteUnmount'] | null;
    outletElement: Element;
    data: unknown;
    ctx: RouteCtx | null;
}
export declare function runRouteUnmountLifecycleEffects(options: RunRouteUnmountLifecycleEffectsOptions): void;
export {};
