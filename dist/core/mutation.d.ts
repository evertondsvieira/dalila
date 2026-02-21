import { type QueryKey } from "./key.js";
type MutationRetryFn<TInput> = (failureCount: number, error: Error, input: TInput) => boolean;
type MutationRetryDelayFn<TInput> = (failureCount: number, error: Error, input: TInput) => number;
type MutationQueueMode = "dedupe" | "serial";
type RollbackFn = () => void | Promise<void>;
export type MutationOptimisticApplyResult<TOptimisticContext = unknown> = void | TOptimisticContext | RollbackFn | {
    rollback?: RollbackFn;
};
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
    onSettled?: (result: TResult | null, error: Error | null, input: TInput, context: TContext | undefined) => void;
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
    run: (input: TInput, opts?: {
        force?: boolean;
    }) => Promise<TResult | null>;
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
export declare function createMutation<TInput, TResult, TContext = unknown>(cfg: MutationConfig<TInput, TResult, TContext>): MutationState<TInput, TResult>;
export {};
