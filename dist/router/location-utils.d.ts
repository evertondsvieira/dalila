export interface ParsedLocation {
    pathname: string;
    queryString: string;
    query?: URLSearchParams;
    hash: string;
    fullPath: string;
}
interface CreateLocationUtilsOptions {
    basePrefix: string;
    normalizePath: (path: string) => string;
}
export declare function createLocationUtils(options: CreateLocationUtilsOptions): {
    stripBase: (pathname: string) => string;
    parseRelativePath: (to: string) => ParsedLocation;
    parseLocation: (to: string) => ParsedLocation;
    applyBase: (fullPath: string) => string;
    getLocationQuery: (location: ParsedLocation) => URLSearchParams;
};
export {};
