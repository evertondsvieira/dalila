import type { SchedulerPriority } from '../core/scheduler.js';
import type { RouteManifestEntry, RouteTable } from './route-tables.js';
export interface PrefetchCandidate {
    pattern: string;
    tags: string[];
    score?: number;
    load?: () => Promise<void>;
}
interface RouterPrefetchHelpersOptions {
    routes: RouteTable[];
    routeManifestEntries: RouteManifestEntry[];
    normalizePath: (path: string) => string;
    normalizeTags: (source: readonly string[] | undefined) => string[];
    joinRoutePaths: (parent: string, child: string) => string;
    preloadPath: (path: string, priority?: SchedulerPriority) => Promise<void>;
}
export declare function createRouterPrefetchHelpers(options: RouterPrefetchHelpersOptions): {
    collectPrefetchCandidates: () => PrefetchCandidate[];
    prefetchCandidates: (candidates: PrefetchCandidate[], priority?: SchedulerPriority) => Promise<void>;
    resolveStaticPrefetchPath: (pattern: string) => string | null;
};
export {};
