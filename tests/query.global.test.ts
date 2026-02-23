import { test } from "node:test";
import assert from "node:assert/strict";

import { signal } from "../dist/core/signal.js";
import { createScope, withScope } from "../dist/core/scope.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("non-scoped queries do not cache shared results", async () => {
  clearResourceCache();

  const q = createQueryClient();
  const userId = signal(1);

  let runs = 0;

  const a = q.query({
    key: () => q.key("user", userId()),
    tags: ["users"],
    fetch: async (_sig, [_, id]) => {
      runs++;
      return { id, runs };
    },
  });

  const b = q.query({
    key: () => q.key("user", userId()),
    tags: ["users"],
    fetch: async (_sig, [_, id]) => {
      runs++;
      return { id, runs };
    },
  });

  await flush();
  await sleep(10);

  // Capture once (avoid multiple reads that can create new resources outside scope)
  const da = a.data();
  const db = b.data();

  // No scope => no cache => must have at least 2 fetches overall
  assert.ok(runs >= 2);

  // Most importantly: different instances should not share the same result
  assert.ok(da != null && db != null);
  assert.notEqual(da.runs, db.runs);
});

test("queryGlobal staleTime still revalidates within a scope", async () => {
  clearResourceCache();

  const q = createQueryClient();
  const scope = createScope();
  let runs = 0;

  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  (globalThis as any).setTimeout = (fn, ms, ...args) => {
    const id = originalSetTimeout(() => {
      timers.delete(id);
      fn(...args);
    }, ms);
    timers.add(id);
    return id;
  };

  (globalThis as any).clearTimeout = (id: ReturnType<typeof setTimeout>) => {
    timers.delete(id);
    return originalClearTimeout(id);
  };

  try {
    let user;
    withScope(scope, () => {
      user = q.queryGlobal({
        key: () => q.key("user", "stale"),
        staleTime: 20,
        fetch: async () => {
          runs++;
          return { runs };
        },
      });
    });

    await flush();
    await sleep(5);

    assert.equal(runs, 1);

    await sleep(60);
    await flush();
    await sleep(5);

    assert.ok(runs >= 2);
    assert.equal(user.data()?.runs, runs);
  } finally {
    scope.dispose();
    for (const timer of timers) {
      originalClearTimeout(timer);
    }
    (globalThis as any).setTimeout = originalSetTimeout;
    (globalThis as any).clearTimeout = originalClearTimeout;
  }
});
