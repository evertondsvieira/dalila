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

export function createRouterPrefetchHelpers(options: RouterPrefetchHelpersOptions) {
  const {
    routes,
    routeManifestEntries,
    normalizePath,
    normalizeTags,
    joinRoutePaths,
    preloadPath
  } = options;

  function resolveStaticPrefetchPath(pattern: string): string | null {
    const segments = normalizePath(pattern).split('/').filter(Boolean);
    const staticSegments: string[] = [];

    for (const segment of segments) {
      if (segment === '*') return null;
      if (!segment.startsWith(':')) {
        staticSegments.push(segment);
        continue;
      }

      const isOptionalCatchAll = segment.endsWith('*?');
      const isCatchAll = isOptionalCatchAll || segment.endsWith('*');
      if (isOptionalCatchAll) continue;
      if (isCatchAll) return null;
      return null;
    }

    return staticSegments.length > 0 ? `/${staticSegments.join('/')}` : '/';
  }

  function collectPrefetchCandidatesFromRoutes(routeDefs: RouteTable[], parentPath = ''): PrefetchCandidate[] {
    const out: PrefetchCandidate[] = [];

    for (const route of routeDefs) {
      const fullPath = joinRoutePaths(parentPath, route.path);
      if (route.view || route.redirect) {
        out.push({
          pattern: fullPath,
          tags: normalizeTags(route.tags),
          score: route.score
        });
      }

      if (route.children && route.children.length > 0) {
        out.push(...collectPrefetchCandidatesFromRoutes(route.children, fullPath));
      }
    }

    return out;
  }

  function collectPrefetchCandidates(): PrefetchCandidate[] {
    if (routeManifestEntries.length > 0) {
      return routeManifestEntries.map((entry) => ({
        pattern: normalizePath(entry.pattern),
        tags: normalizeTags(entry.tags),
        score: entry.score,
        load: entry.load
      }));
    }

    return collectPrefetchCandidatesFromRoutes(routes);
  }

  async function prefetchCandidates(
    candidates: PrefetchCandidate[],
    priority: SchedulerPriority = 'medium'
  ): Promise<void> {
    if (candidates.length === 0) return;

    const seenStaticPaths = new Set<string>();
    const seenDynamicPatterns = new Set<string>();
    const tasks: Promise<void>[] = [];

    for (const candidate of candidates) {
      const staticPath = resolveStaticPrefetchPath(candidate.pattern);
      if (staticPath) {
        if (seenStaticPaths.has(staticPath)) continue;
        seenStaticPaths.add(staticPath);
        tasks.push(
          preloadPath(staticPath, priority).catch((error) => {
            console.warn('[Dalila] Route prefetch failed:', error);
          })
        );
        continue;
      }

      if (!candidate.load) continue;
      if (seenDynamicPatterns.has(candidate.pattern)) continue;
      seenDynamicPatterns.add(candidate.pattern);
      tasks.push(
        candidate.load().catch((error) => {
          console.warn('[Dalila] Route module prefetch failed:', error);
        })
      );
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }

  return {
    collectPrefetchCandidates,
    prefetchCandidates,
    resolveStaticPrefetchPath
  };
}
