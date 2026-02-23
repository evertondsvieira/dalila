import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createResource } from "../dist/core/resource.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Async lifecycle: refresh() waiter system
 *
 * Ensures that `await refresh()` only resolves when the requested fetch completes,
 * not when a stale in-flight promise finishes.
 *
 * Bug scenario:
 * - refresh() captured inFlight before effectAsync created the new fetch
 * - await would resolve with the old (already resolved) promise
 *
 * Fix:
 * - Waiter system per runId ensures refresh() waits for the specific run it triggered
 */
test("resource refresh() waits for the new fetch to complete", async () => {
  const scope = createScope();
  let runs = 0;
  let r;

  withScope(scope, () => {
    r = createResource(async () => {
      runs++;
      await sleep(20);
      return `result-${runs}`;
    });
  });

  await flush();
  await sleep(30);

  assert.equal(runs, 1, "initial fetch should have completed");
  assert.equal(r.data(), "result-1");

  const refreshPromise = r.refresh({ force: true });

  // Wait less than the fetch duration
  await sleep(5);

  // refresh() should not have resolved yet
  let refreshResolved = false;
  refreshPromise.then(() => {
    refreshResolved = true;
  });

  await flush();
  await sleep(5);

  assert.equal(refreshResolved, false, "refresh() should NOT resolve before fetch completes");

  // Now wait for fetch to complete
  await sleep(30);

  assert.equal(refreshResolved, true, "refresh() should resolve after fetch completes");
  assert.equal(runs, 2);
  assert.equal(r.data(), "result-2");

  scope.dispose();
});

/**
 * Async lifecycle: queryGlobal staleTimer race condition
 *
 * Prevents staleTimer from revalidating a stale key after the key changes.
 *
 * Bug scenario:
 * - queryGlobal schedules staleTimer for key1
 * - key changes to key2 before staleTimer fires
 * - staleTimer fires and revalidates key1 (wrong!)
 *
 * Fix:
 * - scheduleStaleRevalidate captures expectedCk and validates before refresh
 */
test("queryGlobal staleTimer does not revalidate old key after key change", async () => {
  clearResourceCache();

  const q = createQueryClient();
  const scope = createScope();
  let fetchCounts = { key1: 0, key2: 0 };

  const userId = signal(1);
  let user;

  withScope(scope, () => {
    user = q.queryGlobal({
      key: () => q.key("user", userId()),
      staleTime: 30,
      fetch: async (_sig, [_, id]) => {
        const key = `key${id}`;
        fetchCounts[key]++;
        return { id, fetchCount: fetchCounts[key] };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(fetchCounts.key1, 1, "initial fetch for key1");
  assert.equal(user.data()?.id, 1);

  // Change key BEFORE staleTime fires
  userId.set(2);
  await flush();
  await sleep(5);

  assert.equal(fetchCounts.key1, 1, "key1 should not refetch yet");
  assert.equal(fetchCounts.key2, 1, "key2 should have fetched once");
  assert.equal(user.data()?.id, 2);

  // Wait beyond staleTime
  await sleep(60);
  await flush();
  await sleep(5);

  // Only key2 should have been revalidated (not key1)
  assert.equal(fetchCounts.key1, 1, "key1 should NOT have been revalidated");
  assert.ok(fetchCounts.key2 >= 2, "key2 should have been revalidated");

  scope.dispose();
  // Cleanup: clear cache to stop any pending timers
  clearResourceCache();
});

/**
 * Async lifecycle: mutation onSettled in abort
 *
 * Ensures onSettled only runs for successful/error runs, not aborted ones.
 *
 * Bug scenario:
 * - onSettled ran in finally block even when sig.aborted
 * - inconsistent with onSuccess/onError behavior
 *
 * Fix:
 * - Guard onSettled with if (!sig.aborted)
 */
test("mutation onSettled does not run when aborted", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let settledCalls = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutate: async (sig, input) => {
        await new Promise<any>((resolve, reject) => {
          const t = setTimeout(() => resolve({ ok: true, input }), 50);

          sig.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          }, { once: true });
        });

        return { ok: true, input };
      },
      onSettled: () => {
        settledCalls++;
      },
    });
  });

  // Start run1
  const p1 = m.run({ n: 1 });
  await flush();
  await sleep(5);

  // Start run2 with force (aborts run1)
  const p2 = m.run({ n: 2 }, { force: true });

  // Wait for both to settle
  await Promise.allSettled([p1, p2]);
  await flush();
  await sleep(60);

  // onSettled should only be called for the non-aborted run (run2)
  assert.equal(settledCalls, 1, "onSettled should only be called for non-aborted runs");

  scope.dispose();
});

/**
 * Async lifecycle: refresh() with rerun during fetch
 *
 * Ensures refresh() waits for the final fetch even when effectAsync reruns mid-flight.
 *
 * Bug scenario:
 * - fetchFn reads a reactive signal
 * - refresh() triggers run2
 * - signal changes during run2 → run2 aborted, run3 starts
 * - run2's waiter resolves early → refresh() returns before run3 finishes
 *
 * Fix:
 * - Only resolve waiter if lastRunController === controller
 */
test("resource refresh() waits for final fetch even with rerun during refresh", async () => {
  const scope = createScope();
  const dep = signal(1);
  let runs = 0;
  let r;

  withScope(scope, () => {
    r = createResource(async (sig) => {
      const val = dep(); // Read reactive signal
      runs++;
      const currentRun = runs;

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => resolve(), 30);

        sig.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });

      return `result-${val}-run${currentRun}`;
    });
  });

  await flush();
  await sleep(40);

  assert.equal(runs, 1);
  assert.equal(r.data(), "result-1-run1");

  // Start refresh
  const refreshPromise = r.refresh({ force: true });

  // Wait for fetch to start
  await flush();
  await sleep(5);

  assert.equal(runs, 2, "refresh should have started run 2");

  // Change dep DURING refresh (triggers rerun, aborting run 2)
  dep.set(2);
  await flush();
  await sleep(5);

  // Run 2 was aborted, run 3 started
  assert.equal(runs, 3, "dep change should have triggered run 3");

  // refreshPromise should NOT resolve until run 3 finishes
  let refreshResolved = false;
  refreshPromise.then(() => {
    refreshResolved = true;
  });

  await flush();
  await sleep(5);

  assert.equal(refreshResolved, false, "refresh() should NOT resolve when run 2 was aborted");

  // Wait for run 3 to complete
  await sleep(40);

  assert.equal(refreshResolved, true, "refresh() should resolve after run 3 completes");
  assert.equal(r.data(), "result-2-run3");

  scope.dispose();
});
