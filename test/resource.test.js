import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import {
  createResource,
  createCachedResource,
  invalidateResourceTag,
  clearResourceCache,
} from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("createResource aborts previous fetch when dependencies change", async () => {
  const scope = createScope();

  let started = 0;
  let aborted = 0;
  let dep;
  let r;

  withScope(scope, () => {
    dep = signal("A");

    r = createResource(async (sig) => {
      const v = dep(); // tracked dependency
      started++;

      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(v), 60);

        sig.addEventListener(
          "abort",
          () => {
            aborted++;
            clearTimeout(t);
            reject(new Error("aborted"));
          },
          { once: true }
        );
      });
    });

  });

  await flush();
  assert.equal(r.loading(), true);
  assert.equal(started, 1);

  dep.set("B"); // triggers rerun -> abort A -> start B
  await flush();
  await sleep(5);

  assert.equal(started, 2);
  assert.equal(aborted, 1);

  await sleep(90);
  assert.equal(r.loading(), false);
  assert.equal(r.error(), null);
  assert.equal(r.data(), "B");

  scope.dispose();
});

test("invalidateResourceTag triggers cached resource revalidation", async () => {
  clearResourceCache();

  const scope = createScope();
  let fetchRuns = 0;
  let r;

  withScope(scope, () => {
    r = createCachedResource(
      "users:list",
      async (_sig) => {
        fetchRuns++;
        // fast success
        return { ok: true, n: fetchRuns };
      },
      { tags: ["users"] }
    );
  });

  await flush();
  await sleep(5);

  assert.equal(fetchRuns, 1);
  assert.equal(r.data()?.n, 1);

  // Invalidate by tag -> should auto-refresh (revalidate=true default)
  invalidateResourceTag("users", { revalidate: true, force: true });

  await flush();
  await sleep(5);

  assert.equal(fetchRuns, 2);
  assert.equal(r.data()?.n, 2);

  scope.dispose();
});
