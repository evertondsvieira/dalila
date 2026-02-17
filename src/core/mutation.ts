import { signal } from "./signal.js";
import { getCurrentScope } from "./scope.js";
import { encodeKey, type QueryKey } from "./key.js";
import { invalidateResourceCache, invalidateResourceTags } from "./resource.js";

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

  async function run(input: TInput, opts: { force?: boolean } = {}): Promise<TResult | null> {
    if (loading() && !opts.force) {
      const pending = inFlight;
      return (await (pending ?? Promise.resolve(null))) as TResult | null;
    }

    controller?.abort();
    controller = new AbortController();
    const sig = controller.signal;
    const localController = controller;

    loading.set(true);
    error.set(null);

    inFlight = (async () => {
      let context: TContext | undefined = undefined;

      try {
        if (cfg.onMutate) {
          context = await cfg.onMutate(input);
        }
      } catch (e) {
        if (sig.aborted) return null;
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        if (controller === localController) loading.set(false);
        try {
          cfg.onError?.(err, input, context);
          cfg.onSettled?.(null, err, input, context);
        } catch {
        }
        return null;
      }

      if (sig.aborted) return null;

      try {
        const result = await (mutationFn as (signal: AbortSignal, input: TInput) => Promise<TResult>)(sig, input);
        if (sig.aborted) return null;

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
        if (sig.aborted) return null;

        const err = e instanceof Error ? e : new Error(String(e));
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
