import type { RouteCtx, RouteMountCleanup, RouteTable } from './route-tables.js';
interface ScheduleRouteMountLifecycleOptions {
    onRouteMount: RouteTable['onRouteMount'] | null | undefined;
    outletElement: Element;
    leafData: unknown;
    ctx: RouteCtx;
    isCurrent: () => boolean;
    setCleanup: (cleanup: RouteMountCleanup) => void;
}
export declare function scheduleRouteMountLifecycle(options: ScheduleRouteMountLifecycleOptions): void;
export {};
