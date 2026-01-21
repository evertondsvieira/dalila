import { signal } from "./signal.js";
import { getCurrentScope } from "./scope.js";
import { encodeKey, type QueryKey } from "./key.js";
import { invalidateResourceCache, invalidateResourceTags } from "./resource.js";

export interface MutationConfig<TInput, TResult> {
  mutate: (signal: AbortSignal, input: TInput) => Promise<TResult>;

  /**
   * Optional invalidation (runs on success).
   * - Tags revalidate all cached resources that registered those tags.
   * - Keys revalidate a specific cached resource by key.
   */
  invalidateTags?: readonly string[];
  invalidateKeys?: readonly QueryKey[];

  onSuccess?: (result: TResult, input: TInput) => void;
  onError?: (error: Error, input: TInput) => void;
  onSettled?: (input: TInput) => void;
}

export interface MutationState<TInput, TResult> {
  data: () => TResult | null;
  loading: () => boolean;
  error: () => Error | null;

  /**
   * Runs the mutation.
   * - Dedupe: if already loading and not forced, it awaits the current run.
   * - Force: aborts the current run and starts a new request.
   */
  run: (input: TInput, opts?: { force?: boolean }) => Promise<TResult | null>;

  /**
   * Resets local mutation state.
   * Does not affect the query cache.
   */
  reset: () => void;
}

/**
 * Mutation primitive (scope-safe).
 *
 * Design goals:
 * - DOM-first friendly: mutations are just async actions with reactive state.
 * - Scope-safe: abort on scope disposal (best-effort cleanup).
 * - Dedupe-by-default: concurrent `run()` calls share the same in-flight promise.
 * - Force re-run: abort the current request and start a new one.
 * - React Query-like behavior: keep the last successful `data()` until overwritten or reset.
 *
 * Semantics:
 * - Each run uses its own AbortController.
 * - If a run is aborted:
 *   - it returns null,
 *   - it MUST NOT call onSuccess/onError/onSettled,
 *   - and it MUST NOT overwrite state from a newer run.
 *
 * Invalidation:
 * - Runs only after a successful, non-aborted mutation.
 * - invalidateTags: revalidates all cached resources registered for those tags.
 * - invalidateKeys: revalidates specific cached resources by encoded key.
 */
export function createMutation<TInput, TResult>(
  cfg: MutationConfig<TInput, TResult>
): MutationState<TInput, TResult> {
  const data = signal<TResult | null>(null);
  const loading = signal<boolean>(false);
  const error = signal<Error | null>(null);

  /** In-flight promise for dedupe (represents the latest started run). */
  let inFlight: Promise<TResult | null> | null = null;

  /** AbortController for the latest started run (used for force + scope cleanup). */
  let controller: AbortController | null = null;

  /**
   * If created inside a scope, abort the active run when the scope is disposed.
   * This prevents orphan network work and avoids updating dead UI.
   */
  const scope = getCurrentScope();
  if (scope) {
    scope.onCleanup(() => {
      controller?.abort();
      controller = null;
      inFlight = null;
    });
  }

  async function run(input: TInput, opts: { force?: boolean } = {}): Promise<TResult | null> {
    /**
     * Dedupe:
     * - If a run is already loading and we're not forcing, await the current promise.
     * - Snapshot `inFlight` to avoid races if a forced run starts mid-await.
     */
    if (loading() && !opts.force) {
      const p0 = inFlight;
      return (await (p0 ?? Promise.resolve(null))) as TResult | null;
    }

    /**
     * Start a new run:
     * - Abort previous run (if any).
     * - Create a fresh controller/signal for this run.
     * - Capture controller identity so older runs cannot clobber newer state.
     */
    controller?.abort();
    controller = new AbortController();
    const sig = controller.signal;
    const localController = controller;

    loading.set(true);
    error.set(null);

    inFlight = (async () => {
      try {
        const result = await cfg.mutate(sig, input);

        // Aborted runs never commit state or call callbacks.
        if (sig.aborted) return null;

        data.set(result);
        cfg.onSuccess?.(result, input);

        // Invalidate only after a successful, non-aborted mutation.
        if (cfg.invalidateTags && cfg.invalidateTags.length > 0) {
          invalidateResourceTags(cfg.invalidateTags, { revalidate: true, force: true });
        }

        if (cfg.invalidateKeys && cfg.invalidateKeys.length > 0) {
          for (const k of cfg.invalidateKeys) {
            invalidateResourceCache(encodeKey(k), { revalidate: true, force: true });
          }
        }

        return result;
      } catch (e) {
        // Aborted runs are treated as null (no error state, no callbacks).
        if (sig.aborted) return null;

        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        cfg.onError?.(err, input);
        return null;
      } finally {
        /**
         * Only the latest run is allowed to update `loading`.
         *
         * Why?
         * - If run A is aborted because run B starts, A's finally will still execute.
         * - Without this guard, A could flip loading(false) while B is still running.
         */
        const stillCurrent = controller === localController;
        if (stillCurrent) loading.set(false);

        // Keep onSettled consistent with onSuccess/onError: never run it for aborted runs.
        if (!sig.aborted) cfg.onSettled?.(input);
      }
    })();

    return await inFlight;
  }

  /**
   * Resets local state and aborts any active run.
   * Does not touch the resource/query cache.
   */
  function reset(): void {
    controller?.abort();
    controller = null;
    inFlight = null;

    loading.set(false);
    error.set(null);
    data.set(null);
  }

  return { data, loading, error, run, reset };
}
