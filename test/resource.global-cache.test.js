import { test } from "node:test";
import assert from "node:assert/strict";

import { createCachedResource, clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("non-scoped createCachedResource does not share cache by default", async () => {
  clearResourceCache();

  let runs = 0;

  const a = createCachedResource(
    "user:1",
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { warnIfNoScope: false } // avoid console noise in tests
  );

  const b = createCachedResource(
    "user:1",
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { warnIfNoScope: false }
  );

  await flush();
  await sleep(5);

  assert.equal(runs, 2);
  assert.deepEqual(a.data(), { ok: true, runs: 1 });
  assert.deepEqual(b.data(), { ok: true, runs: 2 });
});

test("persisted createCachedResource shares cache outside a scope", async () => {
  clearResourceCache();

  let runs = 0;

  const a = createCachedResource(
    "user:1",
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { persist: true, warnIfNoScope: false }
  );

  const b = createCachedResource(
    "user:1",
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { persist: true, warnIfNoScope: false }
  );

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.deepEqual(a.data(), { ok: true, runs: 1 });
  assert.deepEqual(b.data(), { ok: true, runs: 1 });
});
