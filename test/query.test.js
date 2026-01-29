import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("query caches results by encoded key within a scope", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let runs = 0;
  let userId;
  let userA;
  let userB;

  withScope(scope, () => {
    userId = signal(1);

    userA = q.query({
      key: () => q.key("user", userId()),
      tags: ["users"],
      fetch: async (_sig, [_, id]) => {
        runs++;
        return { id, runs };
      },
    });

    userB = q.query({
      key: () => q.key("user", userId()),
      tags: ["users"],
      fetch: async (_sig, [_, id]) => {
        runs++;
        return { id, runs };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.equal(userA.cacheKey(), userB.cacheKey());
  assert.deepEqual(userA.data(), { id: 1, runs: 1 });
  assert.deepEqual(userB.data(), { id: 1, runs: 1 });

  userId.set(2);
  await flush();
  await sleep(5);

  assert.equal(runs, 2);
  assert.deepEqual(userA.data(), { id: 2, runs: 2 });

  scope.dispose();
});

test("staleTime schedules a scope-safe revalidation after success", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let runs = 0;
  let id;
  let user;

  withScope(scope, () => {
    id = signal(1);

    user = q.query({
      key: () => q.key("user", id()),
      tags: ["users"],
      staleTime: 30,
      fetch: async (_sig, [_, userId]) => {
        runs++;
        return { userId, runs };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.equal(user.status(), "success");

  await sleep(60);
  await flush();
  await sleep(5);

  assert.ok(runs >= 2);
  assert.equal(user.data()?.userId, 1);

  scope.dispose();
});
