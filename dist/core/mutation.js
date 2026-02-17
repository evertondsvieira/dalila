import { signal } from "./signal.js";
import { getCurrentScope } from "./scope.js";
import { encodeKey } from "./key.js";
import { invalidateResourceCache, invalidateResourceTags } from "./resource.js";
/**
 * Creates a mutation - a write operation that executes side effects
 * and can invalidate related queries to maintain cache consistency.
 *
 * Follows the Mutation pattern from React Query/TanStack Query:
 * - Provides lifecycle callbacks (onMutate, onSuccess, onError, onSettled)
 * - Supports automatic cache invalidation by tags or keys
 * - Automatically manages cancellation via AbortSignal
 *
 * @template TInput - Type of input data
 * @template TResult - Type of expected result
 * @template TContext - Type of context for communication between callbacks
 * @param cfg - Mutation configuration
 * @returns Mutation state with methods to execute and control
 *
 * @example
 * ```ts
 * const mutation = createMutation({
 *   mutationFn: async (signal, data) => {
 *     const response = await fetch('/api/items', {
 *       method: 'POST',
 *       body: JSON.stringify(data),
 *       signal
 *     });
 *     return response.json();
 *   },
 *   invalidateTags: ['items'],
 *   onSuccess: (result) => {
 *     console.log('Item created:', result);
 *   }
 * });
 *
 * // Execute the mutation
 * mutation.run({ name: 'New Item' });
 * ```
 */
export function createMutation(cfg) {
    const data = signal(null);
    const loading = signal(false);
    const error = signal(null);
    let inFlight = null;
    let controller = null;
    const scope = getCurrentScope();
    if (scope) {
        scope.onCleanup(() => {
            controller?.abort();
            controller = null;
            inFlight = null;
        });
    }
    const mutationFn = cfg.mutationFn ?? cfg.mutate;
    if (!mutationFn) {
        throw new Error("createMutation requires mutationFn or mutate");
    }
    async function run(input, opts = {}) {
        if (loading() && !opts.force) {
            const pending = inFlight;
            return (await (pending ?? Promise.resolve(null)));
        }
        controller?.abort();
        controller = new AbortController();
        const sig = controller.signal;
        const localController = controller;
        loading.set(true);
        error.set(null);
        inFlight = (async () => {
            let context = undefined;
            try {
                if (cfg.onMutate) {
                    context = await cfg.onMutate(input);
                }
            }
            catch (e) {
                if (sig.aborted)
                    return null;
                const err = e instanceof Error ? e : new Error(String(e));
                error.set(err);
                if (controller === localController)
                    loading.set(false);
                try {
                    cfg.onError?.(err, input, context);
                    cfg.onSettled?.(null, err, input, context);
                }
                catch {
                }
                return null;
            }
            if (sig.aborted)
                return null;
            try {
                const result = await mutationFn(sig, input);
                if (sig.aborted)
                    return null;
                data.set(result);
                cfg.onSuccess?.(result, input, context);
                if (cfg.invalidateTags && cfg.invalidateTags.length > 0) {
                    invalidateResourceTags(cfg.invalidateTags, { revalidate: true, force: true });
                }
                if (cfg.invalidateKeys && cfg.invalidateKeys.length > 0) {
                    for (const k of cfg.invalidateKeys) {
                        invalidateResourceCache(encodeKey(k), { revalidate: true, force: true });
                    }
                }
                cfg.onSettled?.(result, null, input, context);
                return result;
            }
            catch (e) {
                if (sig.aborted)
                    return null;
                const err = e instanceof Error ? e : new Error(String(e));
                error.set(err);
                cfg.onError?.(err, input, context);
                cfg.onSettled?.(null, err, input, context);
                return null;
            }
            finally {
                if (controller === localController)
                    loading.set(false);
            }
        })();
        return await inFlight;
    }
    function reset() {
        controller?.abort();
        controller = null;
        inFlight = null;
        loading.set(false);
        error.set(null);
        data.set(null);
    }
    return { data, loading, error, run, reset };
}
