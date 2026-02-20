import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal } from "../dist/core/signal.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache, createResource } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("query caches results by encoded key within a scope", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let runs = 0;
  let userId;
  let userA;
  let userB;

  withScope(scope, () => {
    userId = signal(1);

    userA = q.query({
      key: () => q.key("user", userId()),
      tags: ["users"],
      fetch: async (_sig, [_, id]) => {
        runs++;
        return { id, runs };
      },
    });

    userB = q.query({
      key: () => q.key("user", userId()),
      tags: ["users"],
      fetch: async (_sig, [_, id]) => {
        runs++;
        return { id, runs };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.equal(userA.cacheKey(), userB.cacheKey());
  assert.deepEqual(userA.data(), { id: 1, runs: 1 });
  assert.deepEqual(userB.data(), { id: 1, runs: 1 });

  userId.set(2);
  await flush();
  await sleep(5);

  assert.equal(runs, 2);
  assert.deepEqual(userA.data(), { id: 2, runs: 2 });

  scope.dispose();
});

test("staleTime schedules a scope-safe revalidation after success", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let runs = 0;
  let id;
  let user;

  withScope(scope, () => {
    id = signal(1);

    user = q.query({
      key: () => q.key("user", id()),
      tags: ["users"],
      staleTime: 30,
      fetch: async (_sig, [_, userId]) => {
        runs++;
        return { userId, runs };
      },
    });
  });

  await flush();
  await sleep(5);

  assert.equal(runs, 1);
  assert.equal(user.status(), "success");

  await sleep(60);
  await flush();
  await sleep(5);

  assert.ok(runs >= 2);
  assert.equal(user.data()?.userId, 1);

  scope.dispose();
});

test("query client supports getQueryData/setQueryData for optimistic cache updates", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();

  let todos;
  withScope(scope, () => {
    todos = q.query({
      key: () => q.key("todos"),
      fetch: async () => [{ id: 1, title: "A" }],
    });
  });

  await flush();
  await sleep(10);

  const before = q.getQueryData(["todos"]);
  assert.equal(Array.isArray(before), true);
  assert.equal(before.length, 1);

  q.setQueryData(["todos"], (current) => [...(current ?? []), { id: 2, title: "B" }]);

  const after = q.getQueryData(["todos"]);
  assert.equal(after.length, 2);
  assert.equal(todos.data().length, 2);
  scope.dispose();
});

test("setQueryData clears previous query error state", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();
  let state;

  withScope(scope, () => {
    state = q.query({
      key: () => q.key("user", "error-clear"),
      fetch: async () => {
        throw new Error("boom");
      },
    });
  });

  await flush();
  await sleep(15);
  assert.equal(state.status(), "error");

  q.setQueryData(["user", "error-clear"], { id: 1, ok: true });
  await flush();
  await sleep(5);
  assert.equal(state.status(), "success");
  assert.equal(state.error(), null);
  scope.dispose();
});

test("query.select recomputes on explicit cache writes for the same key", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let selectorRuns = 0;
  await q.prefetchQuery({
    key: ["user", 1],
    fetch: async () => ({ name: "Initial" }),
  });

  const selectName = q.select(["user", 1], (data) => {
    selectorRuns++;
    return data?.name ?? null;
  });

  assert.equal(selectName(), "Initial");
  assert.equal(selectName(), "Initial");
  assert.equal(selectorRuns, 1);

  q.setQueryData(["user", 1], { name: "Ana" });
  assert.equal(selectName(), "Ana");
  assert.equal(selectName(), "Ana");
  assert.equal(selectorRuns, 2);

  const sameRef = { name: "Bea" };
  q.setQueryData(["user", 1], sameRef);
  assert.equal(selectName(), "Bea");
  assert.equal(selectorRuns, 3);

  q.setQueryData(["user", 1], sameRef);
  assert.equal(selectName(), "Bea");
  assert.equal(selectorRuns, 4);
});

test("query.select tracks reactive key changes", async () => {
  clearResourceCache();
  const q = createQueryClient();
  const userId = signal(1);
  await q.prefetchQuery({
    key: ["user", 1],
    fetch: async () => ({ id: 1, name: "Ana" }),
  });
  await q.prefetchQuery({
    key: ["user", 2],
    fetch: async () => ({ id: 2, name: "Bia" }),
  });

  const selectedName = q.select(() => q.key("user", userId()), (data) => data?.name ?? null);

  assert.equal(selectedName(), "Ana");
  userId.set(2);
  await flush();
  assert.equal(selectedName(), "Bia");
});

test("query.select preserves external reactive dependencies", async () => {
  clearResourceCache();
  const q = createQueryClient();
  const multiplier = signal(2);
  await q.prefetchQuery({
    key: ["price", 1],
    fetch: async () => ({ total: 10 }),
  });

  const selectedTotal = q.select(["price", 1], (data) => (data?.total ?? 0) * multiplier());
  assert.equal(selectedTotal(), 20);

  multiplier.set(3);
  await flush();
  assert.equal(selectedTotal(), 30);
});

test("query.select shares memoization by key and selector identity", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let selectorRuns = 0;

  await q.prefetchQuery({
    key: ["shared", 1],
    fetch: async () => ({ name: "Shared" }),
  });

  const selector = (data) => {
    selectorRuns++;
    return data?.name ?? null;
  };

  const selectedA = q.select(["shared", 1], selector);
  const selectedB = q.select(["shared", 1], selector);

  assert.equal(selectedA(), "Shared");
  assert.equal(selectedB(), "Shared");
  assert.equal(selectorRuns, 1);

  q.setQueryData(["shared", 1], { name: "Updated" });
  assert.equal(selectedA(), "Updated");
  assert.equal(selectedB(), "Updated");
  assert.equal(selectorRuns, 2);
});

test("invalidateTag only bumps versions for matching tagged keys", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let userRuns = 0;
  let todoRuns = 0;

  await q.prefetchQuery({
    key: ["user", 1],
    tags: ["users"],
    fetch: async () => ({ id: 1 }),
  });
  await q.prefetchQuery({
    key: ["todo", 1],
    tags: ["todos"],
    fetch: async () => ({ id: 1 }),
  });

  const userSel = q.select(["user", 1], (data) => {
    userRuns++;
    return data?.id ?? null;
  });
  const todoSel = q.select(["todo", 1], (data) => {
    todoRuns++;
    return data?.id ?? null;
  });

  assert.equal(userSel(), 1);
  assert.equal(todoSel(), 1);
  assert.equal(userRuns, 1);
  assert.equal(todoRuns, 1);

  q.invalidateTag("users", { revalidate: false });

  assert.equal(userSel(), 1);
  assert.equal(todoSel(), 1);
  assert.equal(userRuns, 2);
  assert.equal(todoRuns, 1);
});

test("query.select updates when unscoped queryGlobal populates a previously missing key", async () => {
  clearResourceCache();
  const q = createQueryClient();

  const selected = q.select(["late", 1], (data) => data?.value ?? null);
  assert.equal(selected(), null);

  const state = q.queryGlobal({
    key: () => q.key("late", 1),
    fetch: async () => ({ value: 42 }),
  });

  await flush();
  await sleep(20);
  assert.equal(state.data()?.value, 42);
  assert.equal(selected(), 42);
});

test("query.select does not recompute on unrelated registry lifecycle changes", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let selectorRuns = 0;

  const scopeA = createScope();
  withScope(scopeA, () => {
    q.query({
      key: () => q.key("stable", 1),
      fetch: async () => ({ value: 10 }),
    });
  });

  await flush();
  await sleep(10);

  const selected = q.select(["stable", 1], (data) => {
    selectorRuns++;
    return data?.value ?? null;
  });
  assert.equal(selected(), 10);
  assert.equal(selected(), 10);
  assert.equal(selectorRuns, 1);

  const scopeB = createScope();
  withScope(scopeB, () => {
    q.query({
      key: () => q.key("other", 1),
      fetch: async () => ({ value: 99 }),
    });
  });
  await flush();
  await sleep(10);
  scopeB.dispose();
  await flush();
  await sleep(5);

  assert.equal(selected(), 10);
  assert.equal(selectorRuns, 1);
  scopeA.dispose();
});

test("prefetchQuery stores data in cache before query mount", async () => {
  clearResourceCache();

  const q = createQueryClient();
  let runs = 0;
  await q.prefetchQuery({
    key: ["todo", 1],
    fetch: async () => {
      runs++;
      return { id: 1, title: "prefetched" };
    },
  });

  const scope = createScope();
  let todo;
  withScope(scope, () => {
    todo = q.query({
      key: () => q.key("todo", 1),
      fetch: async () => {
        runs++;
        return { id: 1, title: "network" };
      },
    });
  });

  await flush();
  await sleep(10);
  assert.equal(runs, 1);
  assert.equal(todo.data()?.title, "prefetched");
  scope.dispose();
});

test("infiniteQuery loads pages and fetchNextPage appends", async () => {
  clearResourceCache();
  const q = createQueryClient();
  const scope = createScope();

  let state;
  withScope(scope, () => {
    state = q.infiniteQuery({
      queryKey: ["todos"],
      initialPageParam: 1,
      queryFn: async ({ pageParam }) => ({
        items: [`item-${pageParam}`],
        nextPage: pageParam < 3 ? pageParam + 1 : null,
      }),
      getNextPageParam: (lastPage) => lastPage.nextPage,
    });
  });

  await flush();
  await sleep(20);
  assert.equal(state.pages().length, 1);
  assert.equal(state.pages()[0].items[0], "item-1");
  assert.equal(state.hasNextPage(), true);

  await state.fetchNextPage();
  await sleep(10);
  assert.equal(state.pages().length, 2);
  assert.equal(state.pages()[1].items[0], "item-2");

  await state.fetchNextPage();
  await sleep(10);
  assert.equal(state.pages().length, 3);
  assert.equal(state.hasNextPage(), false);
  scope.dispose();
});

test("infiniteQuery resets pages when queryKey changes", async () => {
  clearResourceCache();
  const q = createQueryClient();
  const scope = createScope();
  const filter = signal("a");
  let state;

  withScope(scope, () => {
    state = q.infiniteQuery({
      queryKey: () => q.key("todos", filter()),
      initialPageParam: 1,
      queryFn: async ({ queryKey, pageParam }) => ({
        items: [`${queryKey[1]}-${pageParam}`],
        nextPage: pageParam < 2 ? pageParam + 1 : null,
      }),
      getNextPageParam: (lastPage) => lastPage.nextPage,
    });
  });

  await flush();
  await sleep(20);
  assert.equal(state.pages().length, 1);
  assert.equal(state.pages()[0].items[0], "a-1");

  await state.fetchNextPage();
  await sleep(10);
  assert.equal(state.pages().length, 2);
  assert.equal(state.pages()[1].items[0], "a-2");

  filter.set("b");
  await flush();
  await state.fetchNextPage();
  await sleep(10);

  assert.equal(state.pages().length, 1);
  assert.equal(state.pages()[0].items[0], "b-1");
  scope.dispose();
});

test("query retry retries fetch until success", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();
  let attempts = 0;
  let state;

  withScope(scope, () => {
    state = q.query({
      key: () => q.key("retry", 1),
      retry: 2,
      retryDelay: 1,
      fetch: async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary");
        return { ok: true, attempts };
      },
    });
  });

  await flush();
  await sleep(30);
  assert.equal(attempts, 3);
  assert.equal(state.data()?.ok, true);
  assert.equal(state.error(), null);
  scope.dispose();
});

test("query filters find and refetch matching queries", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();
  let todoRuns = 0;
  let userRuns = 0;

  withScope(scope, () => {
    q.query({
      key: () => q.key("todos", 1),
      fetch: async () => {
        todoRuns++;
        return { kind: "todo", n: todoRuns };
      },
    });
    q.query({
      key: () => q.key("users", 1),
      fetch: async () => {
        userRuns++;
        return { kind: "user", n: userRuns };
      },
    });
  });

  await flush();
  await sleep(10);
  const todosOnly = q.findQueries(["todos"]);
  assert.equal(todosOnly.length, 1);
  assert.equal(Array.isArray(todosOnly[0].key), true);

  q.refetchQueries({ predicate: (entry) => Array.isArray(entry.key) && entry.key[0] === "todos" });
  await flush();
  await sleep(10);
  assert.equal(todoRuns, 2);
  assert.equal(userRuns, 1);
  scope.dispose();
});

test("observeQuery notifies snapshots and can unsubscribe", async () => {
  clearResourceCache();
  const scope = createScope();
  const q = createQueryClient();
  let state;

  withScope(scope, () => {
    state = q.query({
      key: () => q.key("observe", 1),
      fetch: async () => ({ value: 1 }),
    });
  });

  const snapshots = [];
  const stop = q.observeQuery(state, (snapshot) => {
    snapshots.push(snapshot);
  });

  await flush();
  await sleep(20);
  assert.equal(snapshots.length > 0, true);
  const beforeStop = snapshots.length;

  q.setQueryData(["observe", 1], { value: 2 });
  await flush();
  await sleep(5);
  assert.equal(snapshots[snapshots.length - 1].data?.value, 2);

  stop();
  q.setQueryData(["observe", 1], { value: 3 });
  await flush();
  await sleep(5);
  assert.equal(snapshots.length, beforeStop + 1);
  scope.dispose();
});

test("unscoped queryGlobal is not retained in query registry", async () => {
  clearResourceCache();
  const q = createQueryClient();

  q.queryGlobal({
    key: () => q.key("orphan", 1),
    fetch: async () => ({ ok: true }),
  });

  await flush();
  await sleep(10);
  const found = q.findQueries(["orphan"]);
  assert.equal(found.length, 0);
});

test("cancelQueries with string keyPrefix cancels unscoped string-key query", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let aborted = 0;

  q.queryGlobal({
    key: () => "todos",
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          aborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(10);
  q.cancelQueries({ keyPrefix: "todos" });
  await sleep(10);
  assert.equal(aborted, 1);
});

test("cancelQueries without filters cancels unscoped in-flight queries", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let aborted = 0;

  q.queryGlobal({
    key: () => q.key("cancel-all", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          aborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(10);
  q.cancelQueries();
  await sleep(10);
  assert.equal(aborted, 1);
});

test("cancelQueries with array keyPrefix cancels unscoped array-key query", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let aborted = 0;

  q.queryGlobal({
    key: () => q.key("todos", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          aborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(10);
  q.cancelQueries({ keyPrefix: ["todos"] });
  await sleep(10);
  assert.equal(aborted, 1);
});

test("cancelQueries with empty array keyPrefix cancels unscoped array-key query", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let aborted = 0;

  q.queryGlobal({
    key: () => q.key("todos", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          aborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(10);
  q.cancelQueries([]);
  await sleep(10);
  assert.equal(aborted, 1);
});

test("cancelQueries respects predicate with keyPrefix filters", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let aborted = 0;

  q.queryGlobal({
    key: () => q.key("todos", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          aborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(10);
  q.cancelQueries({ keyPrefix: ["todos"], predicate: () => false });
  await sleep(20);
  assert.equal(aborted, 0);
});

test("invalidateQueries invalidates unscoped global cache by keyPrefix", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let runs = 0;

  q.queryGlobal({
    key: () => q.key("todos", 1),
    fetch: async () => {
      runs++;
      return { runs };
    },
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);

  q.invalidateQueries(["todos"]);
  await flush();
  await sleep(20);
  assert.equal(runs >= 2, true);
});

test("invalidateQueries with empty array keyPrefix invalidates unscoped array-key cache", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let runs = 0;

  q.queryGlobal({
    key: () => q.key("todos", 2),
    fetch: async () => {
      runs++;
      return { runs };
    },
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);

  q.invalidateQueries([]);
  await flush();
  await sleep(20);
  assert.equal(runs >= 2, true);
});

test("cancelQueries without filters does not cancel non-query cached resources", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let queryAborted = 0;
  let resourceAborted = 0;

  q.queryGlobal({
    key: () => q.key("query", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve({ ok: true }), 80);
        sig.addEventListener("abort", () => {
          queryAborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  createResource(async (sig) => {
    return await new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true }), 80);
      sig.addEventListener("abort", () => {
        resourceAborted++;
        clearTimeout(t);
        reject(new Error("aborted"));
      }, { once: true });
    });
  }, {
    cache: { key: "plain:resource", persist: true },
  });

  await flush();
  await sleep(10);
  q.cancelQueries();
  await sleep(15);
  assert.equal(queryAborted, 1);
  assert.equal(resourceAborted, 0);
});

test("invalidateQueries with empty filters does not revalidate non-query cached resources", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let queryRuns = 0;
  let resourceRuns = 0;

  q.queryGlobal({
    key: () => q.key("query", 2),
    fetch: async () => {
      queryRuns++;
      return { queryRuns };
    },
  });

  createResource(async () => {
    resourceRuns++;
    return { resourceRuns };
  }, {
    cache: { key: "plain:revalidate", persist: true },
  });

  await flush();
  await sleep(20);
  assert.equal(queryRuns, 1);
  assert.equal(resourceRuns, 1);

  q.invalidateQueries({});
  await flush();
  await sleep(20);
  assert.equal(queryRuns >= 2, true);
  assert.equal(resourceRuns, 1);
});

test("invalidateQueries exact empty-string key does not broaden filter", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let runsEmpty = 0;
  let runsOther = 0;

  q.queryGlobal({
    key: () => "",
    fetch: async () => {
      runsEmpty++;
      return { runsEmpty };
    },
  });

  q.queryGlobal({
    key: () => "other",
    fetch: async () => {
      runsOther++;
      return { runsOther };
    },
  });

  await flush();
  await sleep(20);
  assert.equal(runsEmpty, 1);
  assert.equal(runsOther, 1);

  q.invalidateQueries({ key: "" });
  await flush();
  await sleep(20);
  assert.equal(runsEmpty >= 2, true);
  assert.equal(runsOther, 1);
});

test("invalidateQueries reaches persisted queryGlobal cache after scope disposal", async () => {
  clearResourceCache();
  const q = createQueryClient();
  const scope = createScope();
  let runs = 0;

  withScope(scope, () => {
    q.queryGlobal({
      key: () => q.key("persisted", 1),
      fetch: async () => {
        runs++;
        return { runs };
      },
    });
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);
  scope.dispose();

  q.invalidateQueries(["persisted"]);
  await flush();
  await sleep(20);
  assert.equal(runs >= 2, true);
});

test("invalidateQueries reaches prefetched persisted cache", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let runs = 0;

  await q.prefetchQuery({
    key: ["pref", 1],
    fetch: async () => {
      runs++;
      return { runs };
    },
  });

  assert.equal(runs, 1);
  q.invalidateQueries(["pref"]);
  await flush();
  await sleep(20);
  assert.equal(runs >= 2, true);
});

test("empty-string key filters do not broaden to global operations", async () => {
  clearResourceCache();
  const q = createQueryClient();
  let emptyRuns = 0;
  let arrayRuns = 0;
  let arrayAborted = 0;

  q.queryGlobal({
    key: () => "",
    fetch: async () => {
      emptyRuns++;
      return { emptyRuns };
    },
  });

  q.queryGlobal({
    key: () => q.key("array", 1),
    fetch: async (sig) => {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          arrayRuns++;
          resolve({ arrayRuns });
        }, 120);
        sig.addEventListener("abort", () => {
          arrayAborted++;
          clearTimeout(t);
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  });

  await flush();
  await sleep(20);
  assert.equal(emptyRuns >= 1, true);
  assert.equal(arrayRuns, 0);

  q.invalidateQueries("");
  await flush();
  await sleep(20);
  assert.equal(emptyRuns >= 2, true);
  assert.equal(arrayAborted, 0);

  q.cancelQueries("");
  await sleep(20);
  assert.equal(arrayAborted, 0);
});
