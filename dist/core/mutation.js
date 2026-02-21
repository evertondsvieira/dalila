import { signal } from "./signal.js";
import { getCurrentScope } from "./scope.js";
import { encodeKey } from "./key.js";
import { invalidateResourceCache, invalidateResourceTags } from "./resource.js";
function abortError() {
    const err = new Error("Aborted");
    err.name = "AbortError";
    return err;
}
async function waitForRetry(ms, signal) {
    if (ms <= 0)
        return;
    await new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        const onAbort = () => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", onAbort);
            reject(abortError());
        };
        const timeout = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
    });
}
function shouldRetry(retry, failureCount, error, input) {
    if (typeof retry === "function")
        return retry(failureCount, error, input);
    const maxRetries = retry ?? 0;
    return failureCount <= maxRetries;
}
function retryDelayMs(retryDelay, failureCount, error, input) {
    if (typeof retryDelay === "function") {
        return Math.max(0, retryDelay(failureCount, error, input));
    }
    return Math.max(0, retryDelay ?? 300);
}
async function runWithRetry(signal, input, run, retry, retryDelay) {
    let failureCount = 0;
    while (true) {
        try {
            return await run();
        }
        catch (error) {
            if (signal.aborted)
                throw abortError();
            const err = error instanceof Error ? error : new Error(String(error));
            failureCount++;
            if (!shouldRetry(retry, failureCount, err, input))
                throw err;
            await waitForRetry(retryDelayMs(retryDelay, failureCount, err, input), signal);
        }
    }
}
function getRollbackFromApplyResult(result) {
    if (!result)
        return null;
    if (typeof result === "function")
        return result;
    if (typeof result === "object" && "rollback" in result && typeof result.rollback === "function") {
        return result.rollback;
    }
    return null;
}
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
    const idleSerialTail = Promise.resolve();
    let serialTail = idleSerialTail;
    let queuedCount = 0;
    let queueEpoch = 0;
    const queueMode = cfg.queue ?? "dedupe";
    const scope = getCurrentScope();
    if (scope) {
        scope.onCleanup(() => {
            controller?.abort();
            controller = null;
            inFlight = null;
            queueEpoch++;
            queuedCount = 0;
            serialTail = idleSerialTail;
        });
    }
    const mutationFn = cfg.mutationFn ?? cfg.mutate;
    if (!mutationFn) {
        throw new Error("createMutation requires mutationFn or mutate");
    }
    async function executeMutation(input) {
        controller?.abort();
        controller = new AbortController();
        const sig = controller.signal;
        const localController = controller;
        loading.set(true);
        error.set(null);
        inFlight = (async () => {
            let context = undefined;
            let optimisticContext = undefined;
            let optimisticRollback = null;
            const rollbackIfNeeded = async () => {
                if (!cfg.optimistic?.rollback)
                    return;
                try {
                    if (typeof cfg.optimistic.rollback === "function") {
                        await cfg.optimistic.rollback(optimisticContext, input);
                        return;
                    }
                    await optimisticRollback?.();
                }
                catch {
                }
            };
            try {
                if (cfg.optimistic) {
                    const optimisticResult = await cfg.optimistic.apply(input);
                    optimisticRollback = getRollbackFromApplyResult(optimisticResult);
                    optimisticContext = optimisticResult;
                }
                if (cfg.onMutate) {
                    context = await cfg.onMutate(input);
                }
            }
            catch (e) {
                if (sig.aborted) {
                    await rollbackIfNeeded();
                    return null;
                }
                const err = e instanceof Error ? e : new Error(String(e));
                await rollbackIfNeeded();
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
            if (sig.aborted) {
                await rollbackIfNeeded();
                return null;
            }
            try {
                const result = await runWithRetry(sig, input, () => mutationFn(sig, input), cfg.retry, cfg.retryDelay);
                if (sig.aborted) {
                    await rollbackIfNeeded();
                    return null;
                }
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
                if (sig.aborted) {
                    await rollbackIfNeeded();
                    return null;
                }
                const err = e instanceof Error ? e : new Error(String(e));
                await rollbackIfNeeded();
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
    async function run(input, opts = {}) {
        const markSerialIdle = (epoch) => {
            if (epoch !== queueEpoch)
                return;
            if (queuedCount === 0) {
                serialTail = idleSerialTail;
            }
        };
        if (queueMode === "serial") {
            if (opts.force) {
                controller?.abort();
                queueEpoch++;
                queuedCount = 0;
                serialTail = idleSerialTail;
            }
            const limit = cfg.maxQueue;
            if (typeof limit === "number" && limit >= 0) {
                const queueIsFull = queuedCount >= limit + 1;
                if (queueIsFull) {
                    const err = new Error(`Mutation queue is full (maxQueue=${limit})`);
                    error.set(err);
                    return null;
                }
            }
            const epoch = queueEpoch;
            queuedCount++;
            const runPromise = serialTail.then(async () => {
                if (epoch !== queueEpoch)
                    return null;
                return await executeMutation(input);
            });
            serialTail = runPromise.then(() => {
                if (epoch !== queueEpoch)
                    return;
                queuedCount = Math.max(0, queuedCount - 1);
                markSerialIdle(epoch);
            }, () => {
                if (epoch !== queueEpoch)
                    return;
                queuedCount = Math.max(0, queuedCount - 1);
                markSerialIdle(epoch);
            });
            return await runPromise;
        }
        if (loading() && !opts.force) {
            const pending = inFlight;
            return (await (pending ?? Promise.resolve(null)));
        }
        return await executeMutation(input);
    }
    function reset() {
        controller?.abort();
        controller = null;
        inFlight = null;
        queueEpoch++;
        queuedCount = 0;
        serialTail = idleSerialTail;
        loading.set(false);
        error.set(null);
        data.set(null);
    }
    return { data, loading, error, run, reset };
}
