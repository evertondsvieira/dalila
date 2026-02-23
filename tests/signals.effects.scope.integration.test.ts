import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, withScope } from '../dist/core/scope.js';
import { signal, effect, computed, effectAsync } from '../dist/core/signal.js';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('coalescing: multiple updates in one effect', async () => {
  const count = signal(0);
  let runs = 0;

  const dispose = effect(() => {
    count();
    runs++;
  });

  count.set(1);
  count.set(2);
  await tick(30);

  assert.equal(runs, 1);
  dispose();
});

test('manual disposal stops the effect', async () => {
  const count = signal(0);
  let runs = 0;

  const dispose = effect(() => {
    count();
    runs++;
  });

  count.set(1);
  count.set(2);
  await tick(30);
  dispose();
  const before = runs;

  count.set(3);
  count.set(4);
  await tick(30);

  assert.equal(runs, before);
});

test('scope disposal stops nested effects', async () => {
  const scope = createScope();
  let scopedRuns = 0;

  const scopedSignal = withScope(scope, () => {
    const s = signal(100);
    effect(() => {
      s();
      scopedRuns++;
    });
    return s;
  });

  scopedSignal.set(101);
  scopedSignal.set(102);
  await tick(30);
  const beforeDispose = scopedRuns;

  scope.dispose();
  scopedSignal.set(103);
  scopedSignal.set(104);
  await tick(30);

  assert.equal(scopedRuns, beforeDispose);
});

test('computed reruns when dependencies change', async () => {
  const base = signal(10);
  const doubled = computed(() => base() * 2);
  let computedRuns = 0;

  const dispose = effect(() => {
    doubled();
    computedRuns++;
  });

  base.set(20);
  base.set(30);
  await tick(30);

  assert.equal(computedRuns, 1);
  assert.equal(doubled(), 60);
  dispose();
});

test('withScope creates a temporary scope and returns value', async () => {
  const scope = createScope();
  let runs = 0;

  const result = withScope(scope, () => {
    const local = signal('original');
    effect(() => {
      local();
      runs++;
    });
    local.set('changed');
    return 'result from scoped execution';
  });

  await tick(30);
  assert.equal(result, 'result from scoped execution');
  assert.equal(runs, 1);
  scope.dispose();
});

test('dynamic dependencies track active signal', async () => {
  const signalA = signal('A');
  const signalB = signal('B');
  const useA = signal(true);
  const dynamicScope = createScope();
  const values: string[] = [];

  withScope(dynamicScope, () => {
    effect(() => {
      const value = useA() ? signalA() : signalB();
      values.push(value);
    });
  });

  signalA.set('A1');
  signalB.set('B1');
  await tick(30);
  useA.set(false);
  await tick(30);
  signalA.set('A2');
  signalB.set('B2');
  await tick(30);

  assert.deepEqual(values, ['A1', 'B1', 'B2']);
  dynamicScope.dispose();
});

test('effectAsync aborts previous executions', async () => {
  const asyncScope = createScope();
  const trigger = signal(0);
  let completed = 0;
  let aborted = 0;

  withScope(asyncScope, () => {
    effectAsync((abortSignal) => {
      const id = trigger();
      const timer = setTimeout(() => {
        if (id > 0) completed++;
      }, 80);

      abortSignal.addEventListener('abort', () => {
        if (id > 0) aborted++;
        clearTimeout(timer);
      });
    });
  });

  trigger.set(1);
  await tick(10);
  trigger.set(2);
  await tick(10);
  trigger.set(3);
  await tick(250);

  assert.equal(completed, 1);
  assert.ok(aborted >= 2);
  asyncScope.dispose();
});
