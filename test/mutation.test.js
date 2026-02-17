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

test("mutation supports optimistic update with rollback context", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();

  let todos;
  let save;
  withScope(scope, () => {
    todos = q.query({
      key: () => q.key("todos"),
      fetch: async () => [{ id: 1, title: "A" }],
    });

    save = q.mutation({
      mutationFn: async () => {
        await sleep(10);
        throw new Error("boom");
      },
      onMutate: async (newTodo) => {
        const previous = q.getQueryData(["todos"]);
        q.setQueryData(["todos"], (old) => [...(old ?? []), newTodo]);
        return { previous };
      },
      onError: (_err, _input, ctx) => {
        q.setQueryData(["todos"], ctx?.previous ?? []);
      },
    });
  });

  await flush();
  await sleep(10);

  const runPromise = save.run({ id: 2, title: "B" });
  await flush();
  const optimistic = todos.data();
  assert.equal(optimistic.length, 2);

  await runPromise;
  await sleep(10);
  assert.equal(todos.data().length, 1);
  scope.dispose();
});

test("mutation clears loading when onMutate throws", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let starts = 0;
  let mutateCalls = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async () => {
        starts++;
        return { ok: true };
      },
      onMutate: () => {
        mutateCalls++;
        if (mutateCalls === 1) {
          throw new Error("optimistic failed");
        }
      },
    });
  });

  const first = await m.run({ id: 1 });
  assert.equal(first, null);
  assert.equal(m.loading(), false);

  const second = await m.run({ id: 2 });
  assert.deepEqual(second, { ok: true });
  assert.equal(starts, 1);
  scope.dispose();
});

test("mutation does not run mutationFn for aborted run after onMutate resolves", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let starts = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async () => {
        starts++;
        return { ok: true };
      },
      onMutate: async () => {
        await sleep(20);
      },
    });
  });

  const first = m.run({ id: 1 });
  await sleep(5);
  const second = m.run({ id: 2 }, { force: true });

  await first;
  await second;
  assert.equal(starts, 1);
  scope.dispose();
});

test("mutation clears loading when onMutate error hooks throw", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let starts = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async () => {
        starts++;
        return { ok: true };
      },
      onMutate: () => {
        throw new Error("onMutate failed");
      },
      onError: () => {
        throw new Error("onError failed");
      },
    });
  });

  const first = await m.run({ id: 1 });
  assert.equal(first, null);
  assert.equal(m.loading(), false);

  const second = await m.run({ id: 2 });
  assert.equal(second, null);
  assert.equal(m.loading(), false);
  assert.equal(starts, 0);
  scope.dispose();
});
