import { Signal } from '../core/signal.js';
import { RouteDef, RouteState } from './route.js';
export interface Router {
    mount(outlet: Element): void;
    push(path: string): void;
    replace(path: string): void;
    back(): void;
    link(event: MouseEvent): void;
    outlet(): Element;
    route: Signal<RouteState>;
    beforeEnter?: (to: RouteState, from: RouteState) => boolean | Promise<boolean>;
    afterLeave?: (from: RouteState, to: RouteState) => void | Promise<void>;
}
export interface RouteDefWithLoader extends RouteDef {
    loader?: (route: RouteState) => Promise<any>;
    beforeEnter?: (to: RouteState, from: RouteState) => boolean | Promise<boolean>;
    afterLeave?: (from: RouteState, to: RouteState) => void | Promise<void>;
}
export interface RouterConfig {
    routes: RouteDef[];
}
export declare function getCurrentRouter(): Router | null;
export declare function createRouter(config: RouterConfig): Router;
