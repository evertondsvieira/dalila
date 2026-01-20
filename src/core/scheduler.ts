/**
 * Low-level scheduler.
 * Independent from reactive primitives to avoid circular dependencies.
 *
 * Responsibilities:
 * - Schedule tasks in the next animation frame (RAF queue)
 * - Schedule microtasks for reactive work and short jobs
 * - Batch updates into a single frame
 * - Provide basic DOM read/write discipline helpers
 */

type Task = () => void;

let rafScheduled = false;
let microtaskScheduled = false;

let isFlushingRaf = false;
let isFlushingMicrotasks = false;

const rafQueue: Task[] = [];
const microtaskQueue: Task[] = [];

/** Batching state */
let batchDepth = 0;
const batchQueue: Task[] = [];

/**
 * Schedule a task to run in the next animation frame.
 * This is good for DOM writes that should be grouped per-frame.
 */
export function schedule(task: Task): void {
  rafQueue.push(task);

  if (!rafScheduled) {
    rafScheduled = true;
    requestAnimationFrame(flushRaf);
  }
}

/**
 * Schedule a task to run in a microtask.
 * This is good for reactive re-runs and small follow-up work.
 */
export function scheduleMicrotask(task: Task): void {
  microtaskQueue.push(task);

  if (!microtaskScheduled) {
    microtaskScheduled = true;
    Promise.resolve().then(flushMicrotasks);
  }
}

/**
 * Returns true if we are currently inside a `batch()` call.
 * Reactive primitives can use this to delay notifications.
 */
export function isBatching(): boolean {
  return batchDepth > 0;
}

/**
 * Enqueue work to run at the end of the current batch.
 * When the outermost batch completes, these tasks will be scheduled together
 * in a single animation frame.
 */
export function queueInBatch(task: Task): void {
  batchQueue.push(task);
}

/**
 * Batch multiple updates so their resulting notifications are grouped.
 *
 * Implementation:
 * - While batching, producers can push work into `batchQueue`
 * - When the outermost batch ends, we schedule a single RAF task
 *   that runs all queued batch work.
 */
export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flushBatch();
  }
}

function flushBatch(): void {
  if (batchQueue.length === 0) return;

  const tasks = batchQueue.splice(0);

  // Run all batched tasks together in a single frame.
  schedule(() => {
    for (const t of tasks) t();
  });
}

/** Flush microtask queue. */
function flushMicrotasks(): void {
  if (isFlushingMicrotasks) return;
  isFlushingMicrotasks = true;

  try {
    // Keep flushing until queue is empty.
    while (microtaskQueue.length > 0) {
      const tasks = microtaskQueue.splice(0);
      for (const t of tasks) t();
    }
  } finally {
    isFlushingMicrotasks = false;
    microtaskScheduled = false;

    // If tasks were queued during flushing, reschedule.
    if (microtaskQueue.length > 0 && !microtaskScheduled) {
      microtaskScheduled = true;
      Promise.resolve().then(flushMicrotasks);
    }
  }
}

/** Flush RAF queue. */
function flushRaf(): void {
  if (isFlushingRaf) return;
  isFlushingRaf = true;

  try {
    const tasks = rafQueue.splice(0);
    for (const t of tasks) t();
  } finally {
    isFlushingRaf = false;
    rafScheduled = false;

    // If tasks were queued during flushing, schedule another frame.
    if (rafQueue.length > 0 && !rafScheduled) {
      rafScheduled = true;
      requestAnimationFrame(flushRaf);
    }
  }
}

/**
 * DOM read discipline helper.
 * Intentionally a no-op wrapper for now; it documents intent and can be enhanced later.
 */
export function measure<T>(fn: () => T): T {
  return fn();
}

/**
 * DOM write discipline helper.
 * Writes are scheduled as microtasks so they don't interleave with reads synchronously.
 * (You can change this to RAF later if you want stricter per-frame writes.)
 */
export function mutate(fn: () => void): void {
  scheduleMicrotask(fn);
}
