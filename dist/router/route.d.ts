export interface RouteDef {
    path: string;
    view: () => Node | Node[];
    children?: RouteDef[];
    loader?: (route: RouteState) => Promise<any>;
    beforeEnter?: (to: RouteState, from: RouteState) => boolean | Promise<boolean>;
    afterLeave?: (from: RouteState, to: RouteState) => void | Promise<void>;
}
export interface RouteState {
    path: string;
    params: Record<string, string>;
    query: URLSearchParams;
    hash: string;
    signal?: AbortSignal;
}
export interface RouteMatch {
    route: RouteDef;
    params: Record<string, string>;
    query: URLSearchParams;
    hash: string;
}
export declare function matchRoute(path: string, routeDef: RouteDef): RouteMatch | null;
export declare function findRoute(path: string, routes: RouteDef[]): RouteMatch | null;
