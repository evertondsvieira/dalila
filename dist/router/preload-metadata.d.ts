import type { RouteManifestEntry, RouteParamValue } from './route-tables.js';
import type { RouteTableMatch } from './route-tables.js';
import type { ParsedLocation } from './location-utils.js';
export interface PreloadMetadata {
    path: string;
    fullPath: string;
    routePath: string;
    routeId?: string;
    params: Record<string, RouteParamValue>;
    queryString: string;
    tags: string[];
    score?: number;
}
interface CreatePreloadMetadataHelpersOptions {
    routeManifestByPattern: Map<string, RouteManifestEntry>;
    normalizePath: (path: string) => string;
}
export declare function createPreloadMetadataHelpers(options: CreatePreloadMetadataHelpersOptions): {
    normalizeTags: (source: readonly string[] | undefined) => string[];
    resolveManifestEntry: (match: RouteTableMatch) => RouteManifestEntry | undefined;
    resolveMatchScore: (match: RouteTableMatch) => number | undefined;
    resolveMatchTags: (match: RouteTableMatch) => string[];
    resolvePreloadKey: (match: RouteTableMatch, location: ParsedLocation) => string;
    createPreloadMetadata: (match: RouteTableMatch, location: ParsedLocation) => PreloadMetadata;
};
export {};
