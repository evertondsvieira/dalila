import type { RouteManifestEntry } from 'dalila/router';
export declare const routeManifest: RouteManifestEntry[];
export declare function getRouteManifestEntry(id: string): RouteManifestEntry | undefined;
export declare function prefetchRouteById(id: string): Promise<void>;
