import { type QueryKey } from "./key.js";
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
    run: (input: TInput, opts?: {
        force?: boolean;
    }) => Promise<TResult | null>;
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
export declare function createMutation<TInput, TResult>(cfg: MutationConfig<TInput, TResult>): MutationState<TInput, TResult>;
