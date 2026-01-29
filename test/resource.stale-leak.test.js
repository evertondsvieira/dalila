import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("staleTime timers are cleared when scope is disposed", async () => {
  clearResourceCache();

  const q = createQueryClient();
  const scope = createScope();

  let runs = 0;
  let id;

  withScope(scope, () => {
    id = signal(1);
    q.query({
      key: () => q.key("user", id()),
      staleTime: 30,
      fetch: async () => {
        runs++;
        return { ok: true, runs };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 1);

  // Dispose the scope before staleTime triggers.
  scope.dispose();

  // Wait longer than staleTime. If the timer leaked, it would refetch.
  await sleep(80);
  await flush();

  assert.equal(runs, 1);
});
