import type { RouteParamsValues, RouteQueryValues, RouteTableMatch } from './route-tables.js';
export declare function createRouteValidationHelpers(): {
    resolveRouteValidationError: (match: RouteTableMatch, queryValues: RouteQueryValues, paramsValues: RouteParamsValues) => Promise<Error | null>;
};
