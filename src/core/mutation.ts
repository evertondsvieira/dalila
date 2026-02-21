import { signal } from "./signal.js";
import { getCurrentScope } from "./scope.js";
import { encodeKey, type QueryKey } from "./key.js";
import { invalidateResourceCache, invalidateResourceTags } from "./resource.js";

type MutationRetryFn<TInput> = (failureCount: number, error: Error, input: TInput) => boolean;
type MutationRetryDelayFn<TInput> = (failureCount: number, error: Error, input: TInput) => number;
type MutationQueueMode = "dedupe" | "serial";
type RollbackFn = () => void | Promise<void>;

export type MutationOptimisticApplyResult<TOptimisticContext = unknown> =
  | void
  | TOptimisticContext
  | RollbackFn
  | { rollback?: RollbackFn };

export interface MutationOptimisticConfig<TInput, TOptimisticContext = unknown> {
  /**
   * Applies optimistic changes before the mutationFn runs.
   * Can return a rollback function (directly or in { rollback }).
   */
  apply: (input: TInput) => Promise<MutationOptimisticApplyResult<TOptimisticContext>> | MutationOptimisticApplyResult<TOptimisticContext>;

  /**
   * If true, rollback is attempted on mutation error or abort.
   * A custom rollback function can also be provided.
   */
  rollback?: boolean | ((context: TOptimisticContext | undefined, input: TInput) => void | Promise<void>);
}

/**
 * Configuration for creating a mutation (write operation).
 * 
 * @template TInput - Type of input data passed to the mutation
 * @template TResult - Type of result returned by the mutation
 * @template TContext - Type of optional context kept between callbacks
 */
export interface MutationConfig<TInput, TResult, TContext = unknown> {
  /**
   * Main function that executes the mutation.
   * Receives an AbortSignal for cancellation and the input data.
   * Alias: can also use the 'mutate' property.
   */
  mutationFn?: (signal: AbortSignal, input: TInput) => Promise<TResult>;
  
  /**
   * Alias for mutationFn. Useful for API compatibility.
   */
  mutate?: (signal: AbortSignal, input: TInput) => Promise<TResult>;
  
  /**
   * Cache tags to automatically invalidate after success.
   * Useful for updating related queries after mutation.
   */
  invalidateTags?: readonly string[];
  
  /**
   * Query keys to automatically invalidate after success.
   */
  invalidateKeys?: readonly QueryKey[];
  
  /**
   * Callback executed before the mutation.
   * Useful for optimistically updating UI state.
   * Returns a context that will be passed to subsequent callbacks.
   */
  onMutate?: (input: TInput) => Promise<TContext> | TContext;
  
  /**
   * Callback executed when mutation succeeds.
   * @param result - The result returned by the mutation
   * @param input - The original input data
   * @param context - The context returned by onMutate (or undefined)
   */
  onSuccess?: (result: TResult, input: TInput, context: TContext | undefined) => void;
  
  /**
   * Callback executed when mutation fails.
   * @param error - The error that occurred
   * @param input - The original input data
   * @param context - The context returned by onMutate (or undefined)
   */
  onError?: (error: Error, input: TInput, context: TContext | undefined) => void;
  
  /**
   * Callback executed after mutation completes (success or error).
   * Always executed, regardless of outcome.
   * @param result - The result (or null if error)
   * @param error - The error (or null if success)
   * @param input - The original input data
   * @param context - The context returned by onMutate (or undefined)
   */
  onSettled?: (
    result: TResult | null,
    error: Error | null,
    input: TInput,
    context: TContext | undefined
  ) => void;

  /**
   * Simplified optimistic update API.
   * Useful when you only need apply + automatic rollback behavior.
   */
  optimistic?: MutationOptimisticConfig<TInput>;

  /**
   * Number of retry attempts on mutationFn failures.
   * Can be a number or a function returning whether to retry.
   */
  retry?: number | MutationRetryFn<TInput>;

  /**
   * Delay between retries in ms.
   * Can be a number or a function.
   */
  retryDelay?: number | MutationRetryDelayFn<TInput>;

  /**
   * Queue behavior for run() calls.
   * - dedupe (default): concurrent runs share in-flight result
   * - serial: runs execute one-by-one in call order
   */
  queue?: MutationQueueMode;

  /**
   * Maximum queued items when queue="serial".
   * Extra calls are rejected with null and error state set.
   */
  maxQueue?: number;
}

/**
 * Mutation state, exposing functions to control and access data.
 * 
 * @template TInput - Type of input data
 * @template TResult - Type of result
 */
export interface MutationState<TInput, TResult> {
  /**
   * Signal accessor for data returned by the mutation.
   * Returns null if mutation hasn't run yet or failed.
   */
  data: () => TResult | null;
  
  /**
   * Signal accessor indicating if mutation is in progress.
   */
  loading: () => boolean;
  
  /**
   * Signal accessor for the last mutation error (if any).
   */
  error: () => Error | null;
  
  /**
   * Executes the mutation with the provided input data.
   * @param input - Input data for the mutation
   * @param opts.force - If true, aborts any in-flight mutation and starts a new one
   * @returns Promise that resolves with the result or null on error
   */
  run: (input: TInput, opts?: { force?: boolean }) => Promise<TResult | null>;
  
  /**
   * Resets the mutation state to initial state.
   * Aborts any in-flight mutation and clears data, loading, and error.
   */
  reset: () => void;
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

async function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
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

function shouldRetry<TInput>(
  retry: number | MutationRetryFn<TInput> | undefined,
  failureCount: number,
  error: Error,
  input: TInput
): boolean {
  if (typeof retry === "function") return retry(failureCount, error, input);
  const maxRetries = retry ?? 0;
  return failureCount <= maxRetries;
}

function retryDelayMs<TInput>(
  retryDelay: number | MutationRetryDelayFn<TInput> | undefined,
  failureCount: number,
  error: Error,
  input: TInput
): number {
  if (typeof retryDelay === "function") {
    return Math.max(0, retryDelay(failureCount, error, input));
  }
  return Math.max(0, retryDelay ?? 300);
}

async function runWithRetry<TInput, TResult>(
  signal: AbortSignal,
  input: TInput,
  run: () => Promise<TResult>,
  retry: number | MutationRetryFn<TInput> | undefined,
  retryDelay: number | MutationRetryDelayFn<TInput> | undefined
): Promise<TResult> {
  let failureCount = 0;
  while (true) {
    try {
      return await run();
    } catch (error) {
      if (signal.aborted) throw abortError();
      const err = error instanceof Error ? error : new Error(String(error));
      failureCount++;
      if (!shouldRetry(retry, failureCount, err, input)) throw err;
      await waitForRetry(retryDelayMs(retryDelay, failureCount, err, input), signal);
    }
  }
}

function getRollbackFromApplyResult(result: MutationOptimisticApplyResult<unknown>): RollbackFn | null {
  if (!result) return null;
  if (typeof result === "function") return result as RollbackFn;
  if (typeof result === "object" && "rollback" in result && typeof result.rollback === "function") {
    return result.rollback as RollbackFn;
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
export function createMutation<TInput, TResult, TContext = unknown>(
  cfg: MutationConfig<TInput, TResult, TContext>
): MutationState<TInput, TResult> {
  const data = signal<TResult | null>(null);
  const loading = signal<boolean>(false);
  const error = signal<Error | null>(null);

  let inFlight: Promise<TResult | null> | null = null;
  let controller: AbortController | null = null;
  const idleSerialTail = Promise.resolve();
  let serialTail: Promise<void> = idleSerialTail;
  let queuedCount = 0;
  let queueEpoch = 0;
  const queueMode: MutationQueueMode = cfg.queue ?? "dedupe";

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

  async function executeMutation(input: TInput): Promise<TResult | null> {
    controller?.abort();
    controller = new AbortController();
    const sig = controller.signal;
    const localController = controller;

    loading.set(true);
    error.set(null);

    inFlight = (async () => {
      let context: TContext | undefined = undefined;
      let optimisticContext: unknown = undefined;
      let optimisticRollback: RollbackFn | null = null;

      const rollbackIfNeeded = async (): Promise<void> => {
        if (!cfg.optimistic?.rollback) return;
        try {
          if (typeof cfg.optimistic.rollback === "function") {
            await cfg.optimistic.rollback(optimisticContext, input);
            return;
          }
          await optimisticRollback?.();
        } catch {
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
      } catch (e) {
        if (sig.aborted) {
          await rollbackIfNeeded();
          return null;
        }
        const err = e instanceof Error ? e : new Error(String(e));
        await rollbackIfNeeded();
        error.set(err);
        if (controller === localController) loading.set(false);
        try {
          cfg.onError?.(err, input, context);
          cfg.onSettled?.(null, err, input, context);
        } catch {
        }
        return null;
      }

      if (sig.aborted) {
        await rollbackIfNeeded();
        return null;
      }

      try {
        const result = await runWithRetry(
          sig,
          input,
          () => (mutationFn as (signal: AbortSignal, input: TInput) => Promise<TResult>)(sig, input),
          cfg.retry,
          cfg.retryDelay
        );
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
      } catch (e) {
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
      } finally {
        if (controller === localController) loading.set(false);
      }
    })();

    return await inFlight;
  }

  async function run(input: TInput, opts: { force?: boolean } = {}): Promise<TResult | null> {
    const markSerialIdle = (epoch: number): void => {
      if (epoch !== queueEpoch) return;
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
        if (epoch !== queueEpoch) return null;
        return await executeMutation(input);
      });

      serialTail = runPromise.then(
        () => {
          if (epoch !== queueEpoch) return;
          queuedCount = Math.max(0, queuedCount - 1);
          markSerialIdle(epoch);
        },
        () => {
          if (epoch !== queueEpoch) return;
          queuedCount = Math.max(0, queuedCount - 1);
          markSerialIdle(epoch);
        }
      );
      return await runPromise;
    }

    if (loading() && !opts.force) {
      const pending = inFlight;
      return (await (pending ?? Promise.resolve(null))) as TResult | null;
    }

    return await executeMutation(input);
  }

  function reset(): void {
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
