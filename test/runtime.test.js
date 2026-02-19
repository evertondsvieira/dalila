/**
 * Runtime Reactive Core Tests
 *
 * Validates core invariants of the reactive system:
 * - Dynamic dependency tracking
 * - Batching and coalescing
 * - Lazy computed + synchronous invalidation
 * - Scope lifecycle
 * - Scheduling (microtask vs RAF vs batch)
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Mock requestAnimationFrame for deterministic tests
globalThis.requestAnimationFrame =
  globalThis.requestAnimationFrame ||
  ((cb) => {
    return setTimeout(cb, 0);
  });

// Mock DOM APIs
globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback;
  }
  observe() {}
  disconnect() {}
};

globalThis.document = {
  createElement: () => ({
    isConnected: true,
    addEventListener() {},
    removeEventListener() {}
  })
};

// Import compiled modules
import { signal, effect, computed, effectAsync, debounceSignal, throttleSignal } from '../dist/core/signal.js';
import { batch, isBatching } from '../dist/core/scheduler.js';
import { createScope, withScope, getCurrentScope } from '../dist/core/scope.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('Scheduler - state updates are immediate inside batch()', () => {
  const s = signal(0);

  batch(() => {
    s.set(1);
    assert.equal(s(), 1, 'state should update immediately');
    s.set(2);
    assert.equal(s(), 2, 'state should update immediately');
  });

  assert.equal(s(), 2, 'final value should be 2');
});

test('Scheduler - effects coalesce within batch()', async () => {
  const s = signal(0);
  const runs = [];

  effect(() => {
    runs.push(s());
  });

  await tick(10);
  assert.equal(runs.length, 1, 'effect should run once initially');
  runs.length = 0;

  batch(() => {
    s.set(1);
    s.set(2);
    s.set(3);
  });

  await tick(10);

  assert.equal(runs.length, 1, 'effect should run only once after batch');
  assert.equal(runs[0], 3, 'effect should observe the final value (3)');
});

test('Scheduler - nested batches flush only on the outermost batch', async () => {
  const s = signal(0);
  const runs = [];

  effect(() => {
    runs.push(s());
  });

  await tick(10);
  runs.length = 0;

  batch(() => {
    s.set(1);
    assert.equal(isBatching(), true, 'should be batching');

    batch(() => {
      s.set(2);
      assert.equal(isBatching(), true, 'nested batch should also be batching');
    });

    s.set(3);
    assert.equal(isBatching(), true, 'still batching after nested batch');
  });

  assert.equal(isBatching(), false, 'batching should be finished');

  await tick(10);

  assert.equal(runs.length, 1, 'should flush once');
  assert.equal(runs[0], 3, 'final value');
});

test('Signal - tracks dynamic dependencies', async () => {
  const a = signal(true);
  const b = signal(1);
  const c = signal(2);
  const runs = [];

  effect(() => {
    runs.push(a() ? b() : c());
  });

  await tick(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], 1);
  runs.length = 0;

  // Updating `b` should trigger the effect (read when a() === true)
  b.set(10);
  await tick(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], 10);
  runs.length = 0;

  // Updating `c` should NOT trigger the effect (not currently read)
  c.set(20);
  await tick(10);
  assert.equal(runs.length, 0, 'c should not trigger because it is not a dependency');

  // Switch to c
  a.set(false);
  await tick(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], 20);
  runs.length = 0;

  // Now `b` should not trigger
  b.set(100);
  await tick(10);
  assert.equal(runs.length, 0, 'b should not trigger after dependency switch');

  // But `c` should
  c.set(200);
  await tick(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], 200);
});

test('Signal - deduplicates effect runs in the same tick', async () => {
  const a = signal(0);
  const b = signal(0);
  const runs = [];

  effect(() => {
    runs.push([a(), b()]);
  });

  await tick(10);
  runs.length = 0;

  // Multiple writes in the same tick
  a.set(1);
  b.set(1);
  a.set(2);
  b.set(2);

  await tick(10);

  assert.equal(runs.length, 1, 'effect should run only once');
  assert.deepEqual(runs[0], [2, 2], 'should observe final values');
});

test('Signal - Object.is() prevents unnecessary re-runs', async () => {
  const s = signal(5);
  const runs = [];

  effect(() => {
    runs.push(s());
  });

  await tick(10);
  runs.length = 0;

  s.set(5); // Same value
  await tick(10);

  assert.equal(runs.length, 0, 'effect should not run if value is identical');
});

test('Computed - is lazy: computes only when read', () => {
  let computations = 0;
  const s = signal(1);

  const c = computed(() => {
    computations++;
    return s() * 2;
  });

  assert.equal(computations, 0, 'should not compute until first read');

  const val = c();
  assert.equal(computations, 1, 'should compute on first read');
  assert.equal(val, 2);

  c(); // Second read
  assert.equal(computations, 1, 'should not recompute while cached');
});

test('Computed - invalidates synchronously', () => {
  const s = signal(1);
  let computations = 0;

  const c = computed(() => {
    computations++;
    return s() * 2;
  });

  c(); // First read
  assert.equal(computations, 1);

  s.set(2); // Invalidate

  // Immediate read should recompute (invalidation is synchronous)
  const val = c();
  assert.equal(computations, 2, 'should recompute immediately');
  assert.equal(val, 4);
});

test('Computed - caches until invalidated', () => {
  let computations = 0;
  const s = signal(1);

  const c = computed(() => {
    computations++;
    return s() * 2;
  });

  c();
  c();
  c();
  assert.equal(computations, 1, 'multiple reads should compute once');

  s.set(2);
  c();
  assert.equal(computations, 2, 'should invalidate and recompute');

  c();
  c();
  assert.equal(computations, 2, 'should cache again');
});

test('Computed - chain: invalidation propagates synchronously', async () => {
  const s = signal(1);
  const c1 = computed(() => s() * 2);
  const c2 = computed(() => c1() + 1);
  const runs = [];

  effect(() => {
    runs.push(c2());
  });

  await tick(10);
  assert.equal(runs.length, 1);
  assert.equal(runs[0], 3); // (1 * 2) + 1 = 3
  runs.length = 0;

  s.set(2);

  await tick(10);

  assert.equal(runs.length, 1);
  assert.equal(runs[0], 5); // (2 * 2) + 1 = 5
});

test('Scope - cleanups run when a scope is disposed', () => {
  const scope = createScope();
  const cleanups = [];

  scope.onCleanup(() => cleanups.push(1));
  scope.onCleanup(() => cleanups.push(2));
  scope.onCleanup(() => cleanups.push(3));

  assert.equal(cleanups.length, 0);

  scope.dispose();

  assert.deepEqual(cleanups, [1, 2, 3], 'cleanups should run in FIFO order');
});

test('Scope - calling dispose() multiple times is safe', () => {
  const scope = createScope();
  let runs = 0;

  scope.onCleanup(() => runs++);

  scope.dispose();
  assert.equal(runs, 1);

  scope.dispose(); // Second time
  assert.equal(runs, 1, 'cleanup should not run twice');
});

test('Scope - withScope restores the previous scope', () => {
  const scope1 = createScope();
  const scope2 = createScope();

  assert.equal(getCurrentScope(), null);

  withScope(scope1, () => {
    assert.equal(getCurrentScope(), scope1);

    withScope(scope2, () => {
      assert.equal(getCurrentScope(), scope2);
    });

    assert.equal(getCurrentScope(), scope1, 'should restore scope1');
  });

  assert.equal(getCurrentScope(), null, 'should restore null');
});

test('Scope - effects auto-dispose when the scope disposes', async () => {
  const scope = createScope();
  const s = signal(0);
  const runs = [];

  withScope(scope, () => {
    effect(() => {
      runs.push(s());
    });
  });

  await tick(10);
  assert.equal(runs.length, 1);
  runs.length = 0;

  s.set(1);
  await tick(10);
  assert.equal(runs.length, 1, 'effect should be active');
  runs.length = 0;

  scope.dispose();

  s.set(2);
  await tick(10);
  assert.equal(runs.length, 0, 'effect should not run after scope disposal');
});

test('EffectAsync - aborts the previous run when re-executed', async () => {
  const s = signal(0);
  const aborts = [];
  const completions = [];

  effectAsync((signal) => {
    const id = s();

    signal.addEventListener('abort', () => {
      aborts.push(id);
    });

    setTimeout(() => {
      if (!signal.aborted) {
        completions.push(id);
      }
    }, 10);
  });

  await tick(10);

  s.set(1);
  await tick(10);

  s.set(2);
  await tick(10);

  await tick(20);

  assert.deepEqual(aborts, [0, 1], 'first two runs should be aborted');
  assert.deepEqual(completions, [2], 'only the last run should complete');
});

test('EffectAsync - aborts when the scope is disposed', async () => {
  const scope = createScope();
  let aborted = false;

  withScope(scope, () => {
    effectAsync((signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
    });
  });

  await tick(10);

  scope.dispose();

  assert.equal(aborted, true, 'effect should be aborted on dispose');
});

test('Edge case - signal.set inside effect (loop detection)', async () => {
  const s = signal(0);
  const runs = [];
  let iterations = 0;

  effect(() => {
    const val = s();
    runs.push(val);
    iterations++;

    if (val < 5) {
      s.set(val + 1);
    }
  });

  await tick(50);

  // Should stop at 5 (not infinite)
  assert.equal(runs[runs.length - 1], 5, 'should stop at 5');
  assert.ok(iterations < 1000, 'should not loop infinitely');
});

test('Edge case - computed read multiple times after invalidation returns cached', () => {
  let computations = 0;
  const s = signal(1);

  const c = computed(() => {
    computations++;
    return s() * 2;
  });

  c(); // Compute
  s.set(2); // Invalidate

  c(); // Recompute
  const val1 = c(); // Cached
  const val2 = c(); // Cached
  const val3 = c(); // Cached

  assert.equal(computations, 2, 'should compute only twice');
  assert.equal(val1, 4);
  assert.equal(val2, 4);
  assert.equal(val3, 4);
});

test('debounceSignal - trailing mode emits only the latest value after wait', async () => {
  const source = signal(0);
  const debounced = debounceSignal(source, 25);
  const seen = [];

  effect(() => {
    seen.push(debounced());
  });

  await tick(10);
  seen.length = 0;

  source.set(1);
  await tick(15);
  source.set(2);
  source.set(3);

  await tick(10);
  assert.deepEqual(seen, [], 'should not emit before debounce wait');

  await tick(30);
  assert.deepEqual(seen, [3], 'should emit only final value');
});

test('debounceSignal - leading+trailing emits first and last values in burst', async () => {
  const source = signal(0);
  const debounced = debounceSignal(source, 25, { leading: true, trailing: true });
  const seen = [];

  effect(() => {
    seen.push(debounced());
  });

  await tick(10);
  seen.length = 0;

  source.set(1);
  await tick(15);
  source.set(2);

  await tick(5);
  assert.deepEqual(seen, [1], 'should emit leading value immediately');

  await tick(30);
  assert.deepEqual(seen, [1, 2], 'should emit trailing value after wait');
});

test('throttleSignal - default mode emits at most once per window with trailing latest', async () => {
  const source = signal(0);
  const throttled = throttleSignal(source, 25);
  const seen = [];

  effect(() => {
    seen.push(throttled());
  });

  await tick(10);
  seen.length = 0;

  source.set(1);
  await tick(1);
  source.set(2);
  source.set(3);

  await tick(5);
  assert.deepEqual(seen, [1], 'should emit leading value immediately');

  await tick(30);
  assert.deepEqual(seen, [1, 3], 'should emit latest trailing value at end of window');
});

test('debounceSignal/throttleSignal - timers and effects are cleaned up on scope dispose', async () => {
  const scope = createScope();
  const source = signal(0);
  let debounced;
  let throttled;

  withScope(scope, () => {
    debounced = debounceSignal(source, 25);
    throttled = throttleSignal(source, 25);
  });

  source.set(1);
  scope.dispose();

  await tick(35);
  assert.equal(debounced(), 0, 'debounced should not flush pending timer after dispose');
  assert.equal(throttled(), 0, 'throttled should not flush pending timer after dispose');

  source.set(2);
  await tick(35);
  assert.equal(debounced(), 0, 'debounced should stop reacting after dispose');
  assert.equal(throttled(), 0, 'throttled should stop reacting after dispose');
});
