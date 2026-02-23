import { test } from "node:test";
import assert from "node:assert/strict";

import { createScope, withScope } from "../dist/core/scope.js";
import { signal, effect, computed, readonly, setEffectErrorHandler } from "../dist/core/signal.js";
import { key, setKeyDevMode } from "../dist/core/key.js";
import { createQueryClient } from "../dist/core/query.js";
import { clearResourceCache, configureResourceCache, createResource } from "../dist/core/resource.js";

const flush = () => Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// COMPUTED SYNC TESTS
test("computed returns correct value immediately after dependency change", async () => {
  const a = signal(1);
  const b = computed(() => a() * 2);

  assert.equal(b(), 2);

  a.set(5);
  // Should be immediately consistent, no need to await
  assert.equal(b(), 10);

  a.set(10);
  assert.equal(b(), 20);
});

test("computed throws when trying to set directly", () => {
  const a = signal(1);
  const b = computed(() => a() * 2);

  assert.throws(
    () => b.set(100),
    /Cannot set a computed signal directly/
  );
});

test("computed throws when trying to update directly", () => {
  const a = signal(1);
  const b = computed(() => a() * 2);

  assert.throws(
    () => b.update((v) => v + 1),
    /Cannot update a computed signal directly/
  );
});

test("computed tracks multiple dependencies correctly", async () => {
  const a = signal(1);
  const b = signal(2);
  const sum = computed(() => a() + b());

  assert.equal(sum(), 3);

  a.set(10);
  assert.equal(sum(), 12);

  b.set(20);
  assert.equal(sum(), 30);
});

test("computed with dynamic dependencies recalculates correctly", async () => {
  const useA = signal(true);
  const a = signal("A");
  const b = signal("B");
  const result = computed(() => (useA() ? a() : b()));

  assert.equal(result(), "A");

  useA.set(false);
  assert.equal(result(), "B");

  // Changing a should not affect result now
  a.set("A2");
  assert.equal(result(), "B");

  // Changing b should affect result
  b.set("B2");
  assert.equal(result(), "B2");
});

test("readonly signal mirrors reads/subscriptions and blocks mutation", async () => {
  const base = signal(1);
  const ro = readonly(base);
  const seen = [];

  const off = ro.on((value) => {
    seen.push(value);
  });

  assert.equal(ro(), 1);
  assert.equal(ro.peek(), 1);

  base.set(2);
  base.update((v) => v + 1);
  await flush();

  assert.deepEqual(seen, [3]);
  assert.equal(ro(), 3);
  assert.equal(ro.peek(), 3);

  off();

  assert.throws(
    () => (ro as any).set(10),
    /Cannot mutate a readonly signal/
  );
  assert.throws(
    () => (ro as any).update((v: number) => v + 1),
    /Cannot mutate a readonly signal/
  );
});

// EFFECT ERROR HANDLING TESTS
test("effect error handler catches errors", async () => {
  let caughtError = null;
  let caughtSource = null;

  setEffectErrorHandler((error, source) => {
    caughtError = error;
    caughtSource = source;
  });

  const s = signal(0);

  effect(() => {
    s();
    throw new Error("test error");
  });

  await flush();
  await sleep(10);

  assert.ok(caughtError instanceof Error);
  assert.equal(caughtError.message, "test error");
  assert.equal(caughtSource, "effect");

  // Reset handler
  setEffectErrorHandler(null);
});

test("effect error does not break other effects", async () => {
  let errorHandlerCalled = false;
  setEffectErrorHandler(() => {
    errorHandlerCalled = true;
  });

  const s = signal(0);
  let secondEffectRan = false;

  effect(() => {
    s();
    throw new Error("boom");
  });

  effect(() => {
    s();
    secondEffectRan = true;
  });

  await flush();
  await sleep(10);

  assert.ok(errorHandlerCalled);
  assert.ok(secondEffectRan);

  // Reset handler
  setEffectErrorHandler(null);
});

// KEY WARNING TESTS
test("key() warns when object is passed (dev mode)", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  setKeyDevMode(true);

  // This should trigger a warning
  key("user", { id: 1 } as any);

  console.warn = originalWarn;

  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes("object at index 1"));
});

test("key() does not warn for primitives", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  setKeyDevMode(true);

  key("user", 123, true, null, undefined);

  console.warn = originalWarn;

  assert.equal(warnings.length, 0);
});

test("key() does not warn when dev mode is disabled", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  setKeyDevMode(false);

  key("user", { id: 1 } as any);

  console.warn = originalWarn;
  setKeyDevMode(true); // Reset

  assert.equal(warnings.length, 0);
});

// MUTATION ABORT TESTS

test("mutation only aborts once per run", async () => {
  clearResourceCache();

  const scope = createScope();
  const q = createQueryClient();
  let abortCount = 0;
  let m;

  withScope(scope, () => {
    m = q.mutation({
      mutate: async (sig, input) => {
        sig.addEventListener("abort", () => {
          abortCount++;
        });
        await sleep(50);
        return { ok: true, input };
      },
    });
  });

  // First run
  const p1 = m.run({ n: 1 });

  // Wait a bit then force a new run
  await sleep(10);
  const p2 = m.run({ n: 2 }, { force: true });

  await p2;

  // Should only abort once (the first run)
  assert.equal(abortCount, 1);

  scope.dispose();
});

// SCOPE CLEANUP ORDER TESTS

test("scope cleanup runs in FIFO order", async () => {
  const order = [];
  const scope = createScope();

  withScope(scope, () => {
    scope.onCleanup(() => order.push("first"));
    scope.onCleanup(() => order.push("second"));
    scope.onCleanup(() => order.push("third"));
  });

  scope.dispose();

  assert.deepEqual(order, ["first", "second", "third"]);
});

test("scope cleanup is idempotent", async () => {
  let cleanupCount = 0;
  const scope = createScope();

  withScope(scope, () => {
    scope.onCleanup(() => cleanupCount++);
  });

  scope.dispose();
  scope.dispose();
  scope.dispose();

  assert.equal(cleanupCount, 1);
});

// LRU CACHE EVICTION TESTS

test("LRU cache evicts oldest entries when limit exceeded", async () => {
  clearResourceCache();

  // Configure a small cache for testing
  configureResourceCache({ maxEntries: 3, warnOnEviction: false });

  const scope = createScope();

  // Create 5 resources - should evict the first 2
  for (let i = 1; i <= 5; i++) {
    withScope(scope, () => {
      createResource(async () => ({ id: i }), { cache: { key: `test:${i}` } });
    });
    await sleep(5); // Ensure different timestamps
  }

  scope.dispose();
  await flush();

  // Reset config
  configureResourceCache({ maxEntries: 500, warnOnEviction: true });
});
