import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal, effect } from "../dist/core/signal.js";
import {
  createResource,
  createResourceCache,
  getResourceCacheKeysByTag,
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

      return await new Promise<void>((resolve, reject) => {
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
    r = createResource(
      async (_sig) => {
        fetchRuns++;
        // fast success
        return { ok: true, n: fetchRuns };
      },
      { cache: { key: "users:list", tags: ["users"] } }
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

test("createResource supports deps option with explicit revalidation source", async () => {
  const scope = createScope();
  const dep = signal("A");
  let runs = 0;
  let r;

  withScope(scope, () => {
    r = createResource(async () => {
      runs++;
      return dep();
    }, {
      deps: () => dep(),
    });
  });

  await flush();
  await sleep(10);
  assert.equal(runs, 1);
  assert.equal(r.data(), "A");

  dep.set("B");
  await flush();
  await sleep(10);

  assert.equal(runs, 2);
  assert.equal(r.data(), "B");
  scope.dispose();
});

test("createResource supports composed cache option", async () => {
  clearResourceCache();

  const scope = createScope();
  let runs = 0;
  let first;
  let second;

  withScope(scope, () => {
    first = createResource(async () => {
      runs++;
      return { ok: true, runs };
    }, {
      cache: { key: "resource:composed:test", tags: ["composed"] },
    });

    second = createResource(async () => {
      runs++;
      return { ok: true, runs };
    }, {
      cache: { key: "resource:composed:test", tags: ["composed"] },
    });
  });

  await flush();
  await sleep(10);

  assert.equal(runs, 1);
  assert.deepEqual(first.data(), { ok: true, runs: 1 });
  assert.deepEqual(second.data(), { ok: true, runs: 1 });
  scope.dispose();
});

test("createResourceCache creates isolated cache facade", async () => {
  const cache = createResourceCache({ maxEntries: 10, warnOnEviction: false });

  let runs = 0;
  const a = cache.create("isolated:user:1", async () => {
    runs++;
    return { ok: true, runs };
  }, { persist: true, warnIfNoScope: false });

  const b = cache.create("isolated:user:1", async () => {
    runs++;
    return { ok: true, runs };
  }, { persist: true, warnIfNoScope: false });

  await flush();
  await sleep(10);

  assert.equal(runs, 1);
  assert.equal(cache.keys().includes("isolated:user:1"), true);
  assert.deepEqual(a.data(), { ok: true, runs: 1 });
  assert.deepEqual(b.data(), { ok: true, runs: 1 });

  cache.invalidate("isolated:user:1", { revalidate: true, force: true });
  await flush();
  await sleep(10);
  assert.equal(runs, 2);

  cache.clear();
  assert.equal(cache.keys().length, 0);
});

test("createResource dynamic cache key releases previous key in same long-lived scope", async () => {
  clearResourceCache();

  const scope = createScope();
  const id = signal("1");

  withScope(scope, () => {
    createResource(async () => ({ id: id() }), {
      deps: () => id(),
      cache: {
        key: () => `dynamic:user:${id()}`,
        tags: ["dynamic-users"],
      },
    });
  });

  await flush();
  await sleep(10);
  assert.deepEqual(getResourceCacheKeysByTag("dynamic-users"), ["dynamic:user:1"]);

  id.set("2");
  await flush();
  await sleep(10);

  assert.deepEqual(
    getResourceCacheKeysByTag("dynamic-users"),
    ["dynamic:user:2"],
    "old dynamic key should be released when key changes"
  );

  scope.dispose();
});

test("createResource dynamic cache key does not force duplicate fetch on key change", async () => {
  clearResourceCache();

  const scope = createScope();
  const id = signal("1");
  const runs = new Map();

  withScope(scope, () => {
    createResource(async () => {
      const key = `dynamic:fetch:${id()}`;
      runs.set(key, (runs.get(key) ?? 0) + 1);
      return { key };
    }, {
      deps: () => id(),
      cache: {
        key: () => `dynamic:fetch:${id()}`,
        tags: ["dynamic-fetch"],
      },
    });
  });

  await flush();
  await sleep(10);
  assert.equal(runs.get("dynamic:fetch:1"), 1);

  id.set("2");
  await flush();
  await sleep(10);

  assert.equal(
    runs.get("dynamic:fetch:2"),
    1,
    "key change should create one fetch for the new key"
  );

  scope.dispose();
});

test("createResource with static cache+deps does not enter refresh feedback loop", async () => {
  clearResourceCache();

  const scope = createScope();
  const dep = signal("A");
  let runs = 0;

  withScope(scope, () => {
    createResource(async () => {
      runs++;
      await sleep(2);
      return dep();
    }, {
      deps: () => dep(),
      cache: { key: "loop:static:cache+deps" },
    });
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);

  dep.set("B");
  await flush();
  await sleep(40);

  assert.equal(runs, 2, "deps change should cause one revalidation, not a loop");
  scope.dispose();
});

test("createResource staleWhileRevalidate keeps data while refetching", async () => {
  const scope = createScope();
  let run = 0;
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      run++;
      await sleep(10);
      return { run };
    }, {
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(20);
  assert.equal(resource.data()?.run, 1);

  const refreshing = resource.refresh();
  await flush();
  assert.equal(resource.fetching(), true);
  assert.equal(resource.loading(), false);
  assert.equal(resource.data()?.run, 1);

  await refreshing;
  await sleep(20);
  assert.equal(resource.data()?.run, 2);
  scope.dispose();
});

test("createResource dynamic cache key preserves SWR loading semantics on refresh", async () => {
  clearResourceCache();
  const scope = createScope();
  const id = signal("1");
  let runs = 0;
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      runs++;
      await sleep(10);
      return { id: id(), runs };
    }, {
      deps: () => id(),
      cache: { key: () => `dynamic:swr:${id()}` },
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(20);
  assert.equal(resource.data()?.runs, 1);

  const p = resource.refresh();
  await flush();
  assert.equal(resource.fetching(), true);
  assert.equal(resource.loading(), false);
  assert.equal(resource.data()?.runs, 1);
  await p;
  await sleep(20);
  assert.equal(resource.data()?.runs, 2);
  scope.dispose();
});

test("createResource SWR keeps loading false when settled value is null", async () => {
  const scope = createScope();
  let runs = 0;
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      runs++;
      await sleep(10);
      return null;
    }, {
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);
  assert.equal(resource.data(), null);

  const p = resource.refresh();
  await flush();
  assert.equal(resource.fetching(), true);
  assert.equal(resource.loading(), false);
  await p;
  await sleep(20);
  assert.equal(runs, 2);
  scope.dispose();
});

test("createResource dynamic cache key applies staleTime scheduling", async () => {
  clearResourceCache();

  const scope = createScope();
  const id = signal("1");
  let runs = 0;
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      runs++;
      return { id: id(), runs };
    }, {
      deps: () => id(),
      cache: { key: () => `dynamic:stale:${id()}` },
      staleTime: 20,
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(10);
  assert.equal(runs, 1);

  await sleep(50);
  await flush();
  await sleep(10);

  assert.ok(runs >= 2);
  assert.equal(resource.data()?.id, "1");
  scope.dispose();
});

test("createResource deps+key does not resolve refresh early while fetching in SWR mode", async () => {
  const scope = createScope();
  const id = signal("u1");
  const noisy = signal(0);
  let runs = 0;
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      runs++;
      await sleep(30);
      return { id: id(), runs };
    }, {
      deps: {
        get: () => ({ id: id(), noisy: noisy() }),
        key: () => id(),
      } as any,
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(40);
  assert.equal(resource.data()?.runs, 1);

  let settled = false;
  const refreshPromise = resource.refresh().then(() => {
    settled = true;
  });

  await flush();
  await sleep(5);
  assert.equal(resource.fetching(), true);
  assert.equal(resource.loading(), false);

  noisy.set(1);
  await flush();
  await sleep(5);
  assert.equal(settled, false);
  assert.equal(resource.fetching(), true);

  await refreshPromise;
  await sleep(20);
  assert.equal(resource.data()?.runs >= 1, true);
  assert.equal(resource.fetching(), false);
  assert.equal(resource.loading(), false);
  scope.dispose();
});

test("createResource without scope does not auto-loop staleTime refresh", async () => {
  clearResourceCache();
  let runs = 0;

  createResource(async () => {
    runs++;
    return { runs };
  }, {
    staleTime: 20,
  });

  await flush();
  await sleep(80);
  assert.equal(runs, 1);
});

test("createResource dynamic stale timer does not refresh after key switch", async () => {
  clearResourceCache();
  const scope = createScope();
  const id = signal("1");
  const runsById = new Map();

  withScope(scope, () => {
    createResource(async () => {
      const key = id();
      runsById.set(key, (runsById.get(key) ?? 0) + 1);
      if (key === "2") {
        throw new Error("id2 fails");
      }
      return { key };
    }, {
      deps: () => id(),
      cache: { key: () => `dynamic:timer:${id()}` },
      staleTime: 20,
      staleWhileRevalidate: true,
    });
  });

  await flush();
  await sleep(10);
  assert.equal(runsById.get("1"), 1);

  id.set("2");
  await flush();
  await sleep(10);
  assert.equal(runsById.get("2"), 1);

  await sleep(60);
  await flush();
  await sleep(10);
  assert.equal(runsById.get("2"), 1);
  scope.dispose();
});

test("createResource with static cache+deps does not duplicate fetch when fetchFn reads deps synchronously", async () => {
  clearResourceCache();

  const scope = createScope();
  const dep = signal("A");
  let runs = 0;

  withScope(scope, () => {
    createResource(async () => {
      // Intentionally read dep synchronously inside fetchFn.
      const value = dep();
      runs++;
      return value;
    }, {
      deps: () => dep(),
      cache: { key: "dup-check:static-cache+deps" },
    });
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);

  dep.set("B");
  await flush();
  await sleep(30);

  assert.equal(runs, 2, "one deps change should trigger exactly one additional fetch");
  scope.dispose();
});

test("createResource with dynamic cache+deps (stable key) does not loop revalidation", async () => {
  clearResourceCache();

  const scope = createScope();
  const dep = signal("A");
  let runs = 0;

  withScope(scope, () => {
    createResource(async () => {
      runs++;
      await sleep(2);
      return dep();
    }, {
      deps: () => dep(),
      cache: { key: () => "loop:dynamic:stable-key" },
    });
  });

  await flush();
  await sleep(20);
  assert.equal(runs, 1);

  dep.set("B");
  await flush();
  await sleep(40);

  assert.equal(runs, 2, "stable dynamic key should revalidate once per deps change");
  scope.dispose();
});

test("createResource with dynamic cache key keeps subscribers reactive after key switch", async () => {
  clearResourceCache();

  const scope = createScope();
  const id = signal("1");
  const seen = [];
  let resource;

  withScope(scope, () => {
    resource = createResource(async () => {
      await sleep(2);
      return `user:${id()}`;
    }, {
      deps: () => id(),
      cache: {
        key: () => `dyn:reactive:${id()}`,
      },
    });

    effect(() => {
      seen.push(resource.data());
    });
  });

  await flush();
  await sleep(20);

  id.set("2");
  await flush();
  await sleep(30);

  assert.equal(resource.data(), "user:2");
  assert.equal(
    seen.includes("user:2"),
    true,
    "subscriber should observe data from the new dynamic cache key"
  );

  scope.dispose();
});
