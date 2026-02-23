import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
      mutate: async (_sig, input: any) => {
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
      mutate: async (_sig, input: any) => {
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
      onMutate: async (newTodo: any) => {
        const previous = q.getQueryData(["todos"]);
        q.setQueryData(["todos"], (old: any) => [...(old ?? []), newTodo]);
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

test("mutation treats non-signal AbortError as regular error", async () => {
  const scope = createScope();
  const q = createQueryClient();
  const calls = [];
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async () => {
        const err = new Error("request timed out");
        err.name = "AbortError";
        throw err;
      },
      onError: (err) => {
        calls.push(`error:${err.name}`);
      },
      onSettled: (_result, err) => {
        calls.push(`settled:${err?.name ?? "none"}`);
      },
    });
  });

  const result = await m.run({ id: 1 });
  assert.equal(result, null);
  assert.equal(m.error()?.name, "AbortError");
  assert.deepEqual(calls, ["error:AbortError", "settled:AbortError"]);
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

test("mutation supports optimistic shorthand with automatic rollback", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();

  let todos;
  let save;
  withScope(scope, () => {
    todos = q.query({
      key: () => q.key("todos-shorthand"),
      fetch: async () => [{ id: 1, title: "A" }],
    });

    save = q.mutation({
      mutationFn: async () => {
        await sleep(10);
        throw new Error("boom");
      },
      optimistic: {
        apply: (cache: any, newTodo: any) => {
          const previous = cache.getQueryData(["todos-shorthand"]);
          cache.setQueryData(["todos-shorthand"], (old: any) => [...(old ?? []), newTodo]);
          return () => {
            cache.setQueryData(["todos-shorthand"], previous ?? []);
          };
        },
        rollback: true,
      },
    });
  });

  await flush();
  await sleep(10);

  const runPromise = save.run({ id: 2, title: "B" });
  await flush();
  assert.equal(todos.data().length, 2);

  await runPromise;
  await sleep(10);
  assert.equal(todos.data().length, 1);
  scope.dispose();
});

test("mutation retries transient failures", async () => {
  const scope = createScope();
  const q = createQueryClient();
  let attempts = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async (_sig, input: any) => {
        attempts++;
        if (attempts < 3) throw new Error("temporary");
        return { ok: true, input, attempts };
      },
      retry: 2,
      retryDelay: () => 1,
    });
  });

  const result = await m.run({ id: 1 });
  assert.deepEqual(result, { ok: true, input: { id: 1 }, attempts: 3 });
  assert.equal(attempts, 3);
  assert.equal(m.error(), null);
  scope.dispose();
});

test("mutation queue serial runs calls in order", async () => {
  const scope = createScope();
  const q = createQueryClient();
  const starts = [];
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async (_sig, input: any) => {
        starts.push(input.id);
        await sleep(10);
        return { id: input.id };
      },
      queue: "serial",
    });
  });

  const [r1, r2, r3] = await Promise.all([
    m.run({ id: 1 }),
    m.run({ id: 2 }),
    m.run({ id: 3 }),
  ]);

  assert.deepEqual(starts, [1, 2, 3]);
  assert.deepEqual(r1, { id: 1 });
  assert.deepEqual(r2, { id: 2 });
  assert.deepEqual(r3, { id: 3 });
  scope.dispose();
});

test("mutation queue serial maxQueue counts only waiting jobs", async () => {
  const scope = createScope();
  const q = createQueryClient();
  const starts = [];
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async (_sig, input: any) => {
        starts.push(input.id);
        await sleep(10);
        return { id: input.id };
      },
      queue: "serial",
      maxQueue: 1,
    });
  });

  const p1 = m.run({ id: 1 });
  const p2 = m.run({ id: 2 });
  const [r1, r2] = await Promise.all([p1, p2]);

  assert.deepEqual(starts, [1, 2]);
  assert.deepEqual(r1, { id: 1 });
  assert.deepEqual(r2, { id: 2 });
  assert.equal(m.error(), null);
  scope.dispose();
});

test("mutation queue serial allows first run when maxQueue is 0", async () => {
  const scope = createScope();
  const q = createQueryClient();
  const starts = [];
  let releaseFirst;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async (_sig, input: any) => {
        starts.push(input.id);
        if (input.id === 1) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
        }
        return { id: input.id };
      },
      queue: "serial",
      maxQueue: 0,
    });
  });

  const p1 = m.run({ id: 1 });
  await flush();
  assert.deepEqual(starts, [1]);

  const r2 = await m.run({ id: 2 });
  assert.equal(r2, null);
  assert.equal(m.error()?.message, "Mutation queue is full (maxQueue=0)");

  releaseFirst();
  const r1 = await p1;
  assert.deepEqual(r1, { id: 1 });
  scope.dispose();
});

test("mutation queue serial force reset ignores stale epoch completion bookkeeping", async () => {
  const scope = createScope();
  const q = createQueryClient();
  const starts = [];
  const releases = new Map();
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutationFn: async (_sig, input: any) => {
        starts.push(input.id);
        await new Promise<void>((resolve) => {
          releases.set(input.id, resolve);
        });
        return { id: input.id };
      },
      queue: "serial",
    });
  });

  const p1 = m.run({ id: 1 });
  const p2 = m.run({ id: 2 });
  await flush();
  assert.deepEqual(starts, [1]);

  const p3 = m.run({ id: 3 }, { force: true });
  await flush();
  assert.deepEqual(starts, [1, 3]);

  releases.get(1)?.();
  await p1;

  const p4 = m.run({ id: 4 });
  await flush();
  assert.deepEqual(starts, [1, 3]);

  releases.get(3)?.();
  const r3 = await p3;
  await flush();
  assert.deepEqual(r3, { id: 3 });
  assert.deepEqual(starts, [1, 3, 4]);

  releases.get(4)?.();
  const [r2, r4] = await Promise.all([p2, p4]);
  assert.equal(r2, null);
  assert.deepEqual(r4, { id: 4 });
  scope.dispose();
});
