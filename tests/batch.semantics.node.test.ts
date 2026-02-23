import { test } from "node:test";
import assert from "node:assert/strict";

import { signal, effect } from "../dist/core/signal.js";
import { batch, timeSlice } from "../dist/core/scheduler.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const flush = () => Promise.resolve();

// Mock requestAnimationFrame for Node.js environment
(globalThis as any).requestAnimationFrame = globalThis.requestAnimationFrame || ((cb) => {
  return setTimeout(cb, 0);
});

test("batch(): state updates immediately, effects are deferred", async () => {
  const a = signal(1);
  const b = signal(2);

  batch(() => {
    a.set(10);
    // State must be updated immediately, even inside batch
    assert.equal(a(), 10, "a() should return new value immediately inside batch");

    b.set(20);
    assert.equal(b(), 20, "b() should return new value immediately inside batch");
  });

  // Verify state is still updated after batch completes
  assert.equal(a(), 10, "a() should return new value after batch");
  assert.equal(b(), 20, "b() should return new value after batch");
});

test("batch(): effects coalesce (run once after batch)", async () => {
  const a = signal(1);
  let effectRuns = 0;
  let lastValue = 0;

  effect(() => {
    lastValue = a();
    effectRuns++;
  });

  // Wait for initial effect run
  await tick(10);
  await flush();

  const runsBeforeBatch = effectRuns;
  assert.ok(runsBeforeBatch >= 1, "effect should run at least once initially");

  batch(() => {
    a.set(10);
    a.set(20);
    a.set(30);
  });

  // Effects should not have run yet (still batched)
  assert.equal(effectRuns, runsBeforeBatch, "effect should not run during batch");

  // Wait for batched notifications to flush (RAF + microtask)
  await tick(20);
  await flush();

  // Effect should run exactly once more (coalesced)
  assert.equal(effectRuns, runsBeforeBatch + 1, "effect should run exactly once after batch");
  assert.equal(lastValue, 30, "effect should see final value");
});

test("batch(): nested batches behave correctly", async () => {
  const a = signal(1);
  let effectRuns = 0;

  effect(() => {
    a();
    effectRuns++;
  });

  await tick(10);
  await flush();

  const runsBeforeBatch = effectRuns;

  batch(() => {
    a.set(10);
    assert.equal(a(), 10, "outer batch: state updated");

    batch(() => {
      a.set(20);
      assert.equal(a(), 20, "inner batch: state updated");
    });

    assert.equal(a(), 20, "outer batch: state still 20 after inner batch");
    a.set(30);
    assert.equal(a(), 30, "outer batch: state updated to 30");
  });

  // Effects should not run until outermost batch completes
  assert.equal(effectRuns, runsBeforeBatch, "effect should not run during nested batch");

  await tick(20);
  await flush();

  assert.equal(effectRuns, runsBeforeBatch + 1, "effect should run once after nested batch");
  assert.equal(a(), 30, "final value should be 30");
});

test("batch(): multiple signals coalesce correctly", async () => {
  const a = signal(1);
  const b = signal(2);
  let effectRuns = 0;
  let sum = 0;

  effect(() => {
    sum = a() + b();
    effectRuns++;
  });

  await tick(10);
  await flush();

  const runsBeforeBatch = effectRuns;

  batch(() => {
    a.set(10);
    b.set(20);
    a.set(100);
    b.set(200);
  });

  // State should be updated immediately
  assert.equal(a(), 100, "a should be 100 immediately");
  assert.equal(b(), 200, "b should be 200 immediately");

  // Effect should not run during batch
  assert.equal(effectRuns, runsBeforeBatch, "effect should not run during batch");

  await tick(20);
  await flush();

  // Effect should run once with final values
  assert.equal(effectRuns, runsBeforeBatch + 1, "effect should run once after batch");
  assert.equal(sum, 300, "effect should see final sum 100 + 200");
});

test("timeSlice(): processes heavy work cooperatively across slices", async () => {
  let processed = 0;
  let timerFired = false;
  const target = 300;

  setTimeout(() => {
    timerFired = true;
  }, 0);

  await timeSlice(async (ctx) => {
    while (processed < target) {
      processed++;
      if (ctx.shouldYield()) await ctx.yield();
    }
  }, { budgetMs: 0 });

  assert.equal(processed, target, "should complete all work");
  assert.equal(timerFired, true, "should yield enough for queued timers to run");
});

test("timeSlice(): aborts cooperative execution via AbortSignal", async () => {
  const controller = new AbortController();
  let processed = 0;

  const run = timeSlice(async (ctx) => {
    while (true) {
      processed++;
      if (processed === 10) controller.abort();
      if (ctx.shouldYield()) await ctx.yield();
    }
  }, { budgetMs: 0, signal: controller.signal });

  await assert.rejects(run, (error: any) => {
    assert.equal(error?.name, "AbortError");
    return true;
  });
});

test("timeSlice(): rejects invalid budget values", async () => {
  await assert.rejects(
    () => timeSlice(async () => {}, { budgetMs: -1 }),
    /budgetMs must be a non-negative finite number/
  );
});
