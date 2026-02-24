import { test } from "node:test";
import assert from "node:assert/strict";

import { schedule, scheduleMicrotask, withSchedulerPriority } from "../dist/core/scheduler.js";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

(globalThis as any).requestAnimationFrame = globalThis.requestAnimationFrame || ((cb: () => void) => {
  return setTimeout(cb, 0);
});

test("scheduleMicrotask(): executes higher-priority tasks first", async () => {
  const order: string[] = [];

  scheduleMicrotask(() => order.push("low"), { priority: "low" });
  scheduleMicrotask(() => order.push("medium")); // default
  scheduleMicrotask(() => order.push("high"), { priority: "high" });

  await Promise.resolve();

  assert.deepEqual(order, ["high", "medium", "low"]);
});

test("schedule(): low-priority RAF tasks still make progress under repeated high-priority load", async () => {
  const order: string[] = [];
  const totalHighRuns = 20;
  let highRuns = 0;

  const highTask = () => {
    order.push(`h${highRuns}`);
    highRuns++;
    if (highRuns < totalHighRuns) {
      schedule(highTask, { priority: "high" });
    }
  };

  schedule(highTask, { priority: "high" });
  schedule(() => order.push("low"), { priority: "low" });

  await tick(30);

  const lowIndex = order.indexOf("low");
  assert.notEqual(lowIndex, -1, "low-priority task should eventually run");
  assert.ok(lowIndex < totalHighRuns, "low-priority task should run before all high tasks finish");
  assert.equal(highRuns, totalHighRuns, "all high-priority tasks should still complete");
});

test("withSchedulerPriority(): implicit tasks inherit low priority", async () => {
  const order: string[] = [];

  withSchedulerPriority("low", () => {
    scheduleMicrotask(() => order.push("implicit-low"));
  });
  scheduleMicrotask(() => order.push("explicit-medium"), { priority: "medium" });

  await Promise.resolve();

  assert.deepEqual(order, ["explicit-medium", "implicit-low"]);
});
