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
const schedulerConfig = {
    maxMicrotaskIterations: 1000,
    maxRafIterations: 100,
};
const PRIORITY_ORDER = ['high', 'medium', 'low'];
const FAIRNESS_QUOTAS = {
    high: 8,
    medium: 4,
    low: 2,
};
const VALID_SCHEDULER_PRIORITIES = new Set(PRIORITY_ORDER);
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
export function configureScheduler(config) {
    Object.assign(schedulerConfig, config);
}
/**
 * Get the current scheduler configuration.
 */
export function getSchedulerConfig() {
    return { ...schedulerConfig };
}
let rafScheduled = false;
let microtaskScheduled = false;
let currentPriorityContext = null;
const warnedInvalidPriorityValues = new Set();
let warnedAsyncPriorityContextUsage = false;
let isFlushingRaf = false;
let isFlushingMicrotasks = false;
/** FIFO queues split by priority. */
const rafQueue = {
    high: [],
    medium: [],
    low: [],
};
const microtaskQueue = {
    high: [],
    medium: [],
    low: [],
};
const rafImpl = typeof globalThis !== 'undefined' && typeof globalThis.requestAnimationFrame === 'function'
    ? (cb) => globalThis.requestAnimationFrame(() => cb())
    : (cb) => setTimeout(cb, 0);
const nowImpl = typeof globalThis !== 'undefined' && typeof globalThis.performance?.now === 'function'
    ? () => globalThis.performance.now()
    : () => Date.now();
function createAbortError() {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    return err;
}
function assertNotAborted(signal) {
    if (signal?.aborted)
        throw createAbortError();
}
function isSchedulerPriority(value) {
    return typeof value === 'string' && VALID_SCHEDULER_PRIORITIES.has(value);
}
function warnInvalidSchedulerPriority(value, source) {
    const key = `${source}:${String(value)}`;
    if (warnedInvalidPriorityValues.has(key))
        return;
    warnedInvalidPriorityValues.add(key);
    console.warn(`[Dalila] Invalid scheduler priority from ${source}: "${String(value)}". Falling back to "medium".`);
}
function isPromiseLike(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.then === 'function');
}
/**
 * Batching state.
 *
 * During `batch()`, producers enqueue "notifications" via `queueInBatch()`.
 * When the outermost batch exits, we flush all queued tasks in a single RAF.
 */
let batchDepth = 0;
/** Batched tasks (FIFO) + identity dedupe set. */
const batchQueue = [];
const batchQueueSet = new Set();
/**
 * Schedule work for the next animation frame.
 *
 * Use this for DOM-affecting work you want grouped per frame.
 * (In Node tests, `requestAnimationFrame` is typically mocked.)
 */
export function schedule(task, options = {}) {
    rafQueue[normalizePriority(options.priority)].push(task);
    if (!rafScheduled) {
        rafScheduled = true;
        rafImpl(flushRaf);
    }
}
/**
 * Schedule work in a microtask.
 *
 * Use this for reactive re-runs and short jobs where you want to:
 * - run after the current call stack,
 * - but before the next frame.
 */
export function scheduleMicrotask(task, options = {}) {
    microtaskQueue[normalizePriority(options.priority)].push(task);
    if (!microtaskScheduled) {
        microtaskScheduled = true;
        Promise.resolve().then(flushMicrotasks);
    }
}
/**
 * Returns true while inside a `batch()` call.
 *
 * Reactive primitives can use this to:
 * - update state immediately,
 * - but defer notification fan-out until the batch finishes.
 */
export function isBatching() {
    return batchDepth > 0;
}
/**
 * Enqueue work to run at the end of the *outermost* batch.
 *
 * Deduplication:
 * - The same Task identity will run at most once per batch flush.
 * - This is critical for effects/notifications: many signals can enqueue the same work.
 */
export function queueInBatch(task) {
    if (batchQueueSet.has(task))
        return;
    batchQueue.push(task);
    batchQueueSet.add(task);
}
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
export function batch(fn) {
    batchDepth++;
    try {
        fn();
    }
    finally {
        batchDepth--;
        if (batchDepth === 0)
            flushBatch();
    }
}
/**
 * Flush batched tasks by scheduling a single RAF job.
 *
 * This keeps "batch outputs" aligned to frames:
 * multiple signal sets -> one notification wave -> one render frame.
 */
function flushBatch() {
    if (batchQueue.length === 0)
        return;
    const tasks = batchQueue.splice(0);
    batchQueueSet.clear();
    schedule(() => {
        for (const t of tasks)
            t();
    }, { priority: 'medium' });
}
/**
 * Drain the microtask queue.
 *
 * Implementation notes:
 * - Uses `splice(0)` to drop references eagerly.
 * - Runs until the queue is empty, but caps the number of drain waves.
 *   (A single task can enqueue more microtasks; that still counts as another iteration.)
 */
function flushMicrotasks() {
    if (isFlushingMicrotasks)
        return;
    isFlushingMicrotasks = true;
    let iterations = 0;
    const maxIterations = schedulerConfig.maxMicrotaskIterations;
    try {
        while (hasQueuedTasks(microtaskQueue) && iterations < maxIterations) {
            iterations++;
            drainPriorityCycle(microtaskQueue);
        }
        if (iterations >= maxIterations && hasQueuedTasks(microtaskQueue)) {
            console.error(`[Dalila] Scheduler exceeded ${maxIterations} microtask iterations. ` +
                `Possible infinite loop detected. Remaining ${countQueuedTasks(microtaskQueue)} tasks discarded.`);
            clearPriorityQueues(microtaskQueue);
        }
    }
    finally {
        isFlushingMicrotasks = false;
        microtaskScheduled = false;
        // If tasks were queued after we stopped flushing, reschedule a new microtask turn.
        if (hasQueuedTasks(microtaskQueue) && !microtaskScheduled) {
            microtaskScheduled = true;
            Promise.resolve().then(flushMicrotasks);
        }
    }
}
/**
 * Drain the RAF queue.
 *
 * Implementation notes:
 * - RAF work is typically heavier (DOM), so we cap iterations more aggressively.
 * - Like microtasks, a task may enqueue more RAF tasks; that triggers another flush cycle.
 */
function flushRaf() {
    if (isFlushingRaf)
        return;
    isFlushingRaf = true;
    let iterations = 0;
    const maxIterations = schedulerConfig.maxRafIterations;
    try {
        while (hasQueuedTasks(rafQueue) && iterations < maxIterations) {
            iterations++;
            drainPriorityCycle(rafQueue);
        }
        if (iterations >= maxIterations && hasQueuedTasks(rafQueue)) {
            console.error(`[Dalila] Scheduler exceeded ${maxIterations} RAF iterations. ` +
                `Possible infinite loop detected. Remaining ${countQueuedTasks(rafQueue)} tasks discarded.`);
            clearPriorityQueues(rafQueue);
        }
    }
    finally {
        isFlushingRaf = false;
        rafScheduled = false;
        // If tasks were queued during the flush, schedule another frame.
        if (hasQueuedTasks(rafQueue) && !rafScheduled) {
            rafScheduled = true;
            rafImpl(flushRaf);
        }
    }
}
function normalizePriority(priority) {
    const candidate = priority ?? currentPriorityContext;
    if (candidate == null)
        return 'medium';
    if (isSchedulerPriority(candidate))
        return candidate;
    warnInvalidSchedulerPriority(candidate, priority != null ? 'schedule-options' : 'priority-context');
    return 'medium';
}
/**
 * Run work under a temporary scheduler priority context.
 *
 * Sync-only helper: tasks scheduled without explicit priority inside the
 * synchronous body of `fn` inherit this priority.
 * Useful for framework internals (e.g. user input event handlers).
 */
export function withSchedulerPriority(priority, fn, options = {}) {
    const nextPriority = isSchedulerPriority(priority) ? priority : (warnInvalidSchedulerPriority(priority, 'withSchedulerPriority'), 'medium');
    const prev = currentPriorityContext;
    currentPriorityContext = nextPriority;
    try {
        const result = fn();
        if ((options.warnOnAsync ?? true) && isPromiseLike(result) && !warnedAsyncPriorityContextUsage) {
            warnedAsyncPriorityContextUsage = true;
            console.warn('[Dalila] withSchedulerPriority() is sync-only and does not preserve priority across async boundaries.');
        }
        return result;
    }
    finally {
        currentPriorityContext = prev;
    }
}
function hasQueuedTasks(queues) {
    return queues.high.length > 0 || queues.medium.length > 0 || queues.low.length > 0;
}
function hasPendingPriorityCounts(counts) {
    return counts.high > 0 || counts.medium > 0 || counts.low > 0;
}
function countQueuedTasks(queues) {
    return queues.high.length + queues.medium.length + queues.low.length;
}
function clearPriorityQueues(queues) {
    queues.high.length = 0;
    queues.medium.length = 0;
    queues.low.length = 0;
}
/**
 * Drain one fairness wave from the current queue snapshot:
 * - prioritize `high`
 * - still guarantee progress for `medium`/`low` if queued
 *
 * Tasks enqueued while draining are deferred to the next outer iteration so
 * loop-protection still counts requeue waves instead of fairness slices.
 */
function drainPriorityCycle(queues) {
    const snapshot = {
        high: queues.high.splice(0),
        medium: queues.medium.splice(0),
        low: queues.low.splice(0)
    };
    const indices = {
        high: 0,
        medium: 0,
        low: 0
    };
    const remaining = {
        high: snapshot.high.length,
        medium: snapshot.medium.length,
        low: snapshot.low.length
    };
    while (hasPendingPriorityCounts(remaining)) {
        for (const priority of PRIORITY_ORDER) {
            if (remaining[priority] === 0)
                continue;
            const start = indices[priority];
            const end = Math.min(start + FAIRNESS_QUOTAS[priority], snapshot[priority].length);
            indices[priority] = end;
            remaining[priority] -= end - start;
            for (let i = start; i < end; i++) {
                snapshot[priority][i]();
            }
        }
    }
}
/**
 * DOM read discipline helper.
 *
 * Currently a no-op wrapper. Its purpose is to make intent explicit:
 * put layout reads inside `measure()` so future tooling/optimizations can hook in.
 */
export function measure(fn) {
    return fn();
}
/**
 * DOM write discipline helper.
 *
 * Writes are scheduled in a microtask so they don't interleave with synchronous reads.
 * If you want stricter "writes only on RAF", you can swap this to `schedule(fn)`.
 */
export function mutate(fn) {
    scheduleMicrotask(fn);
}
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
export async function timeSlice(fn, options = {}) {
    const budgetMs = options.budgetMs ?? 8;
    if (!Number.isFinite(budgetMs) || budgetMs < 0) {
        throw new Error('timeSlice: budgetMs must be a non-negative finite number.');
    }
    const signal = options.signal;
    let deadline = nowImpl() + budgetMs;
    const resetDeadline = () => {
        deadline = nowImpl() + budgetMs;
    };
    const ctx = {
        shouldYield() {
            return Boolean(signal?.aborted) || nowImpl() >= deadline;
        },
        async yield() {
            assertNotAborted(signal);
            await new Promise((resolve) => rafImpl(resolve));
            assertNotAborted(signal);
            resetDeadline();
        },
        signal: signal ?? null,
    };
    assertNotAborted(signal);
    const result = await fn(ctx);
    assertNotAborted(signal);
    return result;
}
