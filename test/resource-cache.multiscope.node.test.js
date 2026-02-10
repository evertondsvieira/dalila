import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { createResource, clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test("cached resource must survive if creator scope is disposed but another scope still references it", async () => {
  clearResourceCache();

  let runs = 0;

  const scope1 = createScope();
  const scope2 = createScope();

  let r2;

  // IMPORTANT: não usar await dentro de withScope (scope não atravessa await)
  withScope(scope1, () => {
    createResource(async () => {
      runs++;
      return { runs };
    }, { cache: { key: "user:shared" } });
  });

  withScope(scope2, () => {
    r2 = createResource(async () => {
      runs++;
      return { runs };
    }, { cache: { key: "user:shared" } });
  });

  await flush();
  await tick(0);

  assert.equal(runs, 1, "should fetch only once initially");

  // Dispose do scope criador
  scope1.dispose();

  // O scope2 ainda deve conseguir refazer fetch
  await r2.refresh({ force: true });
  await flush();
  await tick(0);

  assert.ok(runs >= 2, "refresh from scope2 should trigger a new fetch after scope1 disposal");

  scope2.dispose();
});
