import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope, getCurrentScope } from "../dist/core/scope.js";
import { createCachedResource, clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("cached resource evicts when no scopes reference it", async () => {
  clearResourceCache();

  let started = 0;

  // 1) Create inside a scope -> should fetch once
  const scope1 = createScope();
  withScope(scope1, () => {
    createCachedResource(
      "user:1",
      async () => {
        started++;
        return "A";
      },
      {}
    );
  });
  await flush();
  scope1.dispose();

  // Give cleanup a tick (best-effort)
  await sleep(0);

  // 2) Create again (new scope) -> should fetch again if it was evicted
  const scope2 = createScope();
  withScope(scope2, () => {
    createCachedResource(
      "user:1",
      async () => {
        started++;
        return "B";
      },
      {}
    );
  });
  await flush();
  scope2.dispose();

  assert.equal(started, 2);
});

test("cached resource refetches when ttl expires inside the same scope", async () => {
  clearResourceCache();

  const scope = createScope();
  let runs = 0;

  withScope(scope, () => {
    createCachedResource(
      "user:ttl",
      async () => {
        runs++;
        return { ok: true, runs };
      },
      { ttlMs: 0 }
    );
  });

  await flush();
  await sleep(5);
  assert.equal(runs, 1);

  withScope(scope, () => {
    createCachedResource(
      "user:ttl",
      async () => {
        runs++;
        return { ok: true, runs };
      },
      { ttlMs: 0 }
    );
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 2);

  scope.dispose();
});

test("cached resource creation does not mutate the current scope", async () => {
  clearResourceCache();

  const scope = createScope();

  withScope(scope, () => {
    const before = getCurrentScope();

    createCachedResource(
      "user:scope-guard",
      async () => {
        return "ok";
      },
      {}
    );

    const after = getCurrentScope();
    assert.equal(after, before);
  });

  scope.dispose();
});
