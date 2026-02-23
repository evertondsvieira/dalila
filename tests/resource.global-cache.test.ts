import { test } from "node:test";
import assert from "node:assert/strict";

import { createResource, clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("non-scoped createResource cache does not share by default", async () => {
  clearResourceCache();

  let runs = 0;

  const a = createResource(
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { cache: { key: "user:1" } }
  );

  const b = createResource(
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { cache: { key: "user:1" } }
  );

  await flush();
  await sleep(5);

  assert.equal(runs, 2);
  assert.deepEqual(a.data(), { ok: true, runs: 1 });
  assert.deepEqual(b.data(), { ok: true, runs: 2 });
});

test("persisted createResource cache shares outside a scope", async () => {
  clearResourceCache();

  let runs = 0;

  const a = createResource(
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { cache: { key: "user:1", persist: true } }
  );

  const b = createResource(
    async () => {
      runs++;
      return { ok: true, runs };
    },
    { cache: { key: "user:1", persist: true } }
  );

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.deepEqual(a.data(), { ok: true, runs: 1 });
  assert.deepEqual(b.data(), { ok: true, runs: 1 });
});
