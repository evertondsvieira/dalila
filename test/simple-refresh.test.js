import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { createResource } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("simple refresh test", async () => {
  const scope = createScope();
  let runs = 0;
  let r;

  withScope(scope, () => {
    r = createResource(async () => {
      runs++;
      await sleep(10);
      return `result-${runs}`;
    });
  });

  await flush();
  await sleep(20);

  assert.equal(runs, 1);
  assert.equal(r.data(), "result-1");

  await r.refresh({ force: true });

  assert.equal(runs, 2);
  assert.equal(r.data(), "result-2");

  scope.dispose();
});
