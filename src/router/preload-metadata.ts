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

export function createPreloadMetadataHelpers(
  options: CreatePreloadMetadataHelpersOptions
) {
  const { routeManifestByPattern, normalizePath } = options;
  const preloadRouteIds = new WeakMap<any, string>();
  let nextPreloadRouteId = 0;

  function normalizeTags(source: readonly string[] | undefined): string[] {
    if (!source || source.length === 0) return [];

    const tags = new Set<string>();
    for (const tag of source) {
      const normalized = String(tag).trim();
      if (normalized) tags.add(normalized);
    }
    return [...tags];
  }

  function resolveManifestEntry(match: RouteTableMatch): RouteManifestEntry | undefined {
    return routeManifestByPattern.get(normalizePath(match.path));
  }

  function resolveMatchScore(match: RouteTableMatch): number | undefined {
    const manifest = resolveManifestEntry(match);
    if (typeof manifest?.score === 'number') return manifest.score;
    return typeof match.route.score === 'number' ? match.route.score : undefined;
  }

  function resolveMatchTags(match: RouteTableMatch): string[] {
    const manifest = resolveManifestEntry(match);
    const source = manifest?.tags ?? match.route.tags ?? [];
    return normalizeTags(source);
  }

  function resolvePreloadRouteId(match: RouteTableMatch): string {
    const existing = preloadRouteIds.get(match.route);
    if (existing) return existing;

    const generated = `r${++nextPreloadRouteId}`;
    preloadRouteIds.set(match.route, generated);
    return generated;
  }

  function resolvePreloadKey(match: RouteTableMatch, location: ParsedLocation): string {
    const routeId = resolvePreloadRouteId(match);
    const search = location.queryString;
    const urlKey = search ? `${location.pathname}?${search}` : location.pathname;
    return `${routeId}::${match.path}::${urlKey}`;
  }

  function createPreloadMetadata(match: RouteTableMatch, location: ParsedLocation): PreloadMetadata {
    const manifest = resolveManifestEntry(match);
    return {
      path: location.pathname,
      fullPath: location.fullPath,
      routePath: match.path,
      routeId: manifest?.id,
      params: { ...match.params },
      queryString: location.queryString,
      tags: resolveMatchTags(match),
      score: resolveMatchScore(match),
    };
  }

  return {
    normalizeTags,
    resolveManifestEntry,
    resolveMatchScore,
    resolveMatchTags,
    resolvePreloadKey,
    createPreloadMetadata,
  };
}

