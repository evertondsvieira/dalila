import { computed, effect } from "./signal.js";
import { getCurrentScope, createScope, withScope, type Scope } from "./scope.js";
import { key as keyBuilder, encodeKey, type QueryKey } from "./key.js";
import {
  createResource,
  invalidateResourceCache,
  invalidateResourceTag,
  invalidateResourceTags,
  type ResourceState,
} from "./resource.js";
import { createMutation, type MutationConfig, type MutationState } from "./mutation.js";
import { isInDevMode } from "./dev.js";

export interface QueryConfig<TKey extends QueryKey, TResult> {
  /** Reactive key (stable identity + encodable). */
  key: () => TKey;

  /** Optional tags registered on the cached resource (for invalidation). */
  tags?: readonly string[];

  /** Fetch function for the given key (AbortSignal is provided). */
  fetch: (signal: AbortSignal, key: TKey) => Promise<TResult>;

  /**
   * Optional stale revalidation window (ms).
   * After a successful fetch, schedules a refresh after `staleTime`.
   */
  staleTime?: number;

  /** Optional initial value (treated as already-known data). */
  initialValue?: TResult;

  onSuccess?: (data: TResult) => void;
  onError?: (error: Error) => void;
}

export interface QueryState<TResult> {
  data: () => TResult | null;
  loading: () => boolean;
  error: () => Error | null;

  /** Manual refresh of the underlying resource. */
  refresh: (opts?: { force?: boolean }) => Promise<void>;

  /** Derived status for convenience. */
  status: () => "loading" | "error" | "success";

  /** Current encoded cache key. */
  cacheKey: () => string;
}

export interface QueryClient {
  key: typeof keyBuilder;

  /** Safe-by-default: requires scope for caching. Outside scope, does NOT cache. */
  query: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;

  /** Explicit global caching (persist). */
  queryGlobal: <TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>) => QueryState<TResult>;

  mutation: <TInput, TResult>(cfg: MutationConfig<TInput, TResult>) => MutationState<TInput, TResult>;

  invalidateKey: (key: QueryKey, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTag: (tag: string, opts?: { revalidate?: boolean; force?: boolean }) => void;
  invalidateTags: (tags: readonly string[], opts?: { revalidate?: boolean; force?: boolean }) => void;
}

/**
 * Query client (React Query-like API on top of Dalila resources).
 *
 * Design goals:
 * - DOM-first + signals: queries are just resources exposed as reactive getters.
 * - Cache safety: by default, caching requires a scope; global cache is opt-in.
 * - Keyed caching: results are cached by encoded key.
 * - Stale revalidation: optionally schedule a refresh after a successful fetch.
 *
 * Implementation notes:
 * - The underlying cached resource is created inside a computed() so it can react
 *   to key changes.
 * - computed() is lazy, so we "kick" it once and also install an effect() that
 *   re-reads it, ensuring key changes recreate the resource even if nobody reads
 *   data() yet.
 * - staleTime revalidation is guarded by `expectedCk` so a timer from an old key
 *   cannot refresh a new key’s resource.
 * - If created inside a scope, staleTime timers are cleared on scope cleanup.
 */
export function createQueryClient(): QueryClient {
  function makeQuery<TKey extends QueryKey, TResult>(
    cfg: QueryConfig<TKey, TResult>,
    behavior: { persist: boolean }
  ): QueryState<TResult> {
    const scope = getCurrentScope();
    const parentScope = scope;
    const staleTime = cfg.staleTime ?? 0;

    let staleTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupRegistered = false;
    let keyScope: Scope | null = null;
    let keyScopeCk: string | null = null;

    if (isInDevMode() && !parentScope && behavior.persist === false) {
      console.warn(
        `[Dalila] q.query() called outside a scope. ` +
        `It will not cache and may leak. Use within a scope or q.queryGlobal().`
      );
    }

    function ensureKeyScope(ck: string): Scope | null {
      if (!parentScope) return null;

      if (keyScope && keyScopeCk === ck) return keyScope;

      // cancel any pending stale timer from the previous key
      if (staleTimer != null) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }

      keyScope?.dispose();
      keyScopeCk = ck;
      keyScope = createScope(parentScope);
      return keyScope;
    }

    /**
     * Schedules a stale-time revalidation after success.
     *
     * Race safety:
     * - Captures `expectedCk` so a timer created for an old key cannot refresh
     *   after the key changes.
     *
     * Lifetime:
     * - If in a scope, the timer is cleared on scope cleanup.
     */
    const scheduleStaleRevalidate = (r: ResourceState<TResult>, expectedCk: string) => {
      if (staleTime <= 0) return;
      if (!scope) {
        if (isInDevMode()) {
          console.warn(
            `[Dalila] staleTime requires a scope for cleanup. ` +
            `Run the query inside a scope or disable staleTime.`
          );
        }
        return;
      }
      if (encodeKey(cfg.key()) !== expectedCk) return;

      // Register cleanup once (if we have a scope).
      if (!cleanupRegistered) {
        cleanupRegistered = true;
        scope.onCleanup(() => {
          if (staleTimer != null) clearTimeout(staleTimer);
          staleTimer = null;
        });
      }

      // Only one pending stale timer per query instance.
      if (staleTimer != null) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }

      staleTimer = setTimeout(() => {
        // Guard against revalidating stale keys when key changed during staleTime.
        if (encodeKey(cfg.key()) !== expectedCk) return;
        r.refresh({ force: false }).catch(() => { });
      }, staleTime);
    };

    /**
     * Underlying cached resource.
     *
     * Important: we capture `r` via `let r!` so `onSuccess` can schedule the
     * stale revalidation against the correct instance.
     */
    const resource = computed<ResourceState<TResult>>(() => {
      const k = cfg.key();
      const ck = encodeKey(k);

      let r!: ResourceState<TResult>;

      const ks = ensureKeyScope(ck);

      const opts: {
        initialValue?: TResult;
        onError?: (error: Error) => void;
        onSuccess?: (data: TResult) => void;
        cache: {
          key: string;
          tags?: readonly string[];
          persist?: boolean;
        };
      } = {
        onError: cfg.onError,
        onSuccess: (data) => {
          cfg.onSuccess?.(data);
          scheduleStaleRevalidate(r, ck);
        },
        cache: {
          key: ck,
          tags: cfg.tags,
          persist: behavior.persist,
        },
      };

      if (cfg.initialValue !== undefined) opts.initialValue = cfg.initialValue;

      // Keyed cache entry (scope-safe unless persist is enabled).
      const make = () =>
        createResource<TResult>(async (sig) => {
          await Promise.resolve(); // break reactive tracking
          return cfg.fetch(sig, k);
        }, opts);
      r = ks ? withScope(ks, make) : make();

      return r;
    });

    /** Convenience derived status from the underlying resource. */
    const status = computed<"loading" | "error" | "success">(() => {
      const r = resource();
      if (r.loading()) return "loading";
      if (r.error()) return "error";
      return "success";
    });

    /** Expose the current encoded key as a computed signal. */
    const cacheKeySig = computed(() => encodeKey(cfg.key()));

    /**
     * Kick once so the initial query starts immediately.
     * Then keep it reactive so key changes recreate the resource
     * even if nobody reads data() / loading() / error().
     */
    resource();
    effect(() => {
      resource();
    });

    return {
      data: () => resource().data(),
      loading: () => resource().loading(),
      error: () => resource().error(),
      refresh: (opts) => resource().refresh(opts),
      status: () => status(),
      cacheKey: () => cacheKeySig(),
    };
  }

  function query<TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>): QueryState<TResult> {
    return makeQuery(cfg, { persist: false });
  }

  function queryGlobal<TKey extends QueryKey, TResult>(cfg: QueryConfig<TKey, TResult>): QueryState<TResult> {
    return makeQuery(cfg, { persist: true });
  }

  function mutation<TInput, TResult>(cfg: MutationConfig<TInput, TResult>): MutationState<TInput, TResult> {
    return createMutation(cfg);
  }

  function invalidateKey(k: QueryKey, opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceCache(encodeKey(k), opts);
  }

  function invalidateTag(tag: string, opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceTag(tag, opts);
  }

  function invalidateTags(tags: readonly string[], opts: { revalidate?: boolean; force?: boolean } = {}): void {
    invalidateResourceTags(tags, opts);
  }

  return {
    key: keyBuilder,
    query,
    queryGlobal,
    mutation,
    invalidateKey,
    invalidateTag,
    invalidateTags,
  };
}
