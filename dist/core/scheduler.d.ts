/**
 * Low-level scheduler (runtime core).
 *
 * This module is intentionally independent from signals/effects to avoid circular
 * dependencies and to keep the runtime easy to reason about.
 *
 * What it provides:
 * - A RAF queue (`schedule`) for work that should be grouped per frame (DOM writes, batching flush)
 * - A microtask queue (`scheduleMicrotask`) for reactive follow-ups and short jobs
 * - A batching mechanism (`batch` + `queueInBatch`) to coalesce many notifications into one frame
 * - Optional DOM discipline helpers (`measure`/`mutate`) to document read/write intent
 *
 * Invariants:
 * - Tasks are executed in FIFO order within each queue.
 * - Microtasks are drained fully (up to a hard iteration limit) before returning control.
 * - RAF tasks are drained fully (up to a hard iteration limit) per frame.
 *
 * Safety:
 * - Iteration caps prevent infinite loops from growing queues unbounded.
 * - Flushes always drain with `splice(0)` to release references eagerly.
 */
type Task = () => void;
export interface TimeSliceOptions {
    /** Time budget per slice in milliseconds. Default: 8 */
    budgetMs?: number;
    /** Optional abort signal to cancel a running cooperative task. */
    signal?: AbortSignal;
}
export interface TimeSliceContext {
    /** Returns true when the current slice exceeded its budget or was aborted. */
    shouldYield(): boolean;
    /** Yields to the event loop and starts a fresh slice budget. */
    yield(): Promise<void>;
    /** Abort signal passed through from options for convenience. */
    signal: AbortSignal | null;
}
/**
 * Scheduler configuration.
 */
interface SchedulerConfig {
    /**
     * Maximum microtask iterations before stopping (prevents infinite loops).
     * A high value is intentional: reactive systems may legitimately schedule
     * multiple microtask waves. Default: 1000.
     */
    maxMicrotaskIterations: number;
    /**
     * Maximum RAF iterations before stopping (prevents infinite loops).
     * RAF work is typically heavier (DOM), so keep it lower. Default: 100.
     */
    maxRafIterations: number;
}
/**
 * Configure scheduler limits.
 *
 * Call this early in your app initialization if you need different limits.
 *
 * Example:
 * ```ts
 * configureScheduler({ maxMicrotaskIterations: 2000 });
 * ```
 */
export declare function configureScheduler(config: Partial<SchedulerConfig>): void;
/**
 * Get the current scheduler configuration.
 */
export declare function getSchedulerConfig(): Readonly<SchedulerConfig>;
/**
 * Schedule work for the next animation frame.
 *
 * Use this for DOM-affecting work you want grouped per frame.
 * (In Node tests, `requestAnimationFrame` is typically mocked.)
 */
export declare function schedule(task: Task): void;
/**
 * Schedule work in a microtask.
 *
 * Use this for reactive re-runs and short jobs where you want to:
 * - run after the current call stack,
 * - but before the next frame.
 */
export declare function scheduleMicrotask(task: Task): void;
/**
 * Returns true while inside a `batch()` call.
 *
 * Reactive primitives can use this to:
 * - update state immediately,
 * - but defer notification fan-out until the batch finishes.
 */
export declare function isBatching(): boolean;
/**
 * Enqueue work to run at the end of the *outermost* batch.
 *
 * Deduplication:
 * - The same Task identity will run at most once per batch flush.
 * - This is critical for effects/notifications: many signals can enqueue the same work.
 */
export declare function queueInBatch(task: Task): void;
/**
 * Batch multiple updates so their resulting notifications are grouped.
 *
 * Contract:
 * - State updates inside the batch happen immediately.
 * - Notifications/effects are deferred until the batch completes.
 * - Nested batches are supported: only the outermost batch triggers a flush.
 *
 * Flush strategy:
 * - We flush batched tasks in *one RAF* to group visible DOM work per frame.
 */
export declare function batch(fn: () => void): void;
/**
 * DOM read discipline helper.
 *
 * Currently a no-op wrapper. Its purpose is to make intent explicit:
 * put layout reads inside `measure()` so future tooling/optimizations can hook in.
 */
export declare function measure<T>(fn: () => T): T;
/**
 * DOM write discipline helper.
 *
 * Writes are scheduled in a microtask so they don't interleave with synchronous reads.
 * If you want stricter "writes only on RAF", you can swap this to `schedule(fn)`.
 */
export declare function mutate(fn: () => void): void;
/**
 * Run cooperative work in slices to keep the event loop responsive.
 *
 * Usage pattern:
 * - loop your heavy work
 * - call `ctx.shouldYield()` inside the loop
 * - `await ctx.yield()` when it returns true
 *
 * Example:
 * ```ts
 * await timeSlice(async (ctx) => {
 *   while (hasMore()) {
 *     processNext();
 *     if (ctx.shouldYield()) await ctx.yield();
 *   }
 * }, { budgetMs: 8, signal });
 * ```
 */
export declare function timeSlice<T>(fn: (ctx: TimeSliceContext) => T | Promise<T>, options?: TimeSliceOptions): Promise<T>;
export {};
