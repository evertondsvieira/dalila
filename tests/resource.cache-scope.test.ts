import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope, getCurrentScope } from "../dist/core/scope.js";
import { createResource, clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("cached resource evicts when no scopes reference it", async () => {
  clearResourceCache();

  let started = 0;

  // 1) Create inside a scope -> should fetch once
  const scope1 = createScope();
  withScope(scope1, () => {
    createResource(
      async () => {
        started++;
        return "A";
      },
      { cache: { key: "user:1" } }
    );
  });
  await flush();
  scope1.dispose();

  // Give cleanup a tick (best-effort)
  await sleep(0);

  // 2) Create again (new scope) -> should fetch again if it was evicted
  const scope2 = createScope();
  withScope(scope2, () => {
    createResource(
      async () => {
        started++;
        return "B";
      },
      { cache: { key: "user:1" } }
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
    createResource(
      async () => {
        runs++;
        return { ok: true, runs };
      },
      { cache: { key: "user:ttl", ttlMs: 0 } }
    );
  });

  await flush();
  await sleep(5);
  assert.equal(runs, 1);

  withScope(scope, () => {
    createResource(
      async () => {
        runs++;
        return { ok: true, runs };
      },
      { cache: { key: "user:ttl", ttlMs: 0 } }
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

    createResource(
      async () => {
        return "ok";
      },
      { cache: { key: "user:scope-guard" } }
    );

    const after = getCurrentScope();
    assert.equal(after, before);
  });

  scope.dispose();
});
