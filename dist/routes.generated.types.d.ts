export type RoutePattern = '/' | '/about';
export type RouteParamsByPattern = {
    '/': {};
    '/about': {};
};
export type RouteSearchByPattern = {
    [P in RoutePattern]: Record<string, string | string[]>;
};
export type RouteParams<P extends RoutePattern> = RouteParamsByPattern[P];
export type RouteSearch<P extends RoutePattern> = RouteSearchByPattern[P];
export declare function buildRoutePath<P extends RoutePattern>(pattern: P, params: RouteParams<P>): string;
