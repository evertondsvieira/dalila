import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("mutation invalidates tags and keeps last success result", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let queryRuns = 0;
  let user;
  let saveUser;

  withScope(scope, () => {
    const userId = signal(1);

    user = q.query({
      key: () => q.key("user", userId()),
      tags: ["users"],
      fetch: async (_sig, [_, id]) => {
        queryRuns++;
        return { id, version: queryRuns };
      },
    });

    saveUser = q.mutation({
      mutate: async (_sig, input) => {
        await sleep(10);
        return { ok: true, saved: input };
      },
      invalidateTags: ["users"],
    });
  });

  await flush();
  await sleep(5);

  assert.equal(queryRuns, 1);
  assert.equal(user.data()?.version, 1);

  const res = await saveUser.run({ id: 1, name: "New Name" });
  assert.deepEqual(res, { ok: true, saved: { id: 1, name: "New Name" } });
  assert.deepEqual(saveUser.data(), { ok: true, saved: { id: 1, name: "New Name" } });

  await flush();
  await sleep(30);

  assert.ok(queryRuns >= 2);
  assert.equal(user.data()?.id, 1);
  assert.ok(user.data()?.version >= 2);

  scope.dispose();
});

test("mutation deduplicates concurrent runs unless force is used", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let started = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutate: async (_sig, input) => {
        started++;
        await sleep(40);
        return { ok: true, input };
      },
    });
  });

  const p1 = m.run({ n: 1 });
  const p2 = m.run({ n: 2 }); // dedupe: should await p1

  const r1 = await p1;
  const r2 = await p2;

  assert.equal(started, 1);
  assert.deepEqual(r1, { ok: true, input: { n: 1 } });
  assert.deepEqual(r2, { ok: true, input: { n: 1 } });

  const p3 = m.run({ n: 3 });
  const p4 = m.run({ n: 4 }, { force: true }); // abort p3, start p4

  const r4 = await p4;

  // total starts:
  // - p1/p2 => 1
  // - p3 => +1
  // - p4 => +1
  assert.equal(started, 3);
  assert.deepEqual(r4, { ok: true, input: { n: 4 } });

  scope.dispose();
});
