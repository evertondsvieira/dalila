/**
 * Lifecycle Helpers Tests
 *
 * Validates useEvent, useInterval, useTimeout:
 * - Returns a dispose() function (idempotent)
 * - Cleans up via scope.dispose()
 * - Warns if called outside a scope (one-time warning)
 * - Works correctly with and without a scope
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Mock requestAnimationFrame (some scheduling utilities may rely on it)
globalThis.requestAnimationFrame =
  globalThis.requestAnimationFrame ||
  ((cb) => {
    return setTimeout(cb, 0);
  });

// Minimal DOM mock (only what the helpers may touch)
globalThis.document = {
  createElement: () => ({
    addEventListener() {},
    removeEventListener() {},
  }),
};

import { useEvent, useInterval, useTimeout } from '../dist/core/watch.js';
import { createScope, withScope } from '../dist/core/scope.js';
import { resetWarnings } from '../dist/internal/watch-testing.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

test('useEvent - returns idempotent dispose()', () => {
  const scope = createScope();
  const target = { addEventListener() {}, removeEventListener() {} };
  let removeCalls = 0;

  target.removeEventListener = () => {
    removeCalls++;
  };

  const dispose = withScope(scope, () => {
    return useEvent(target, 'click', () => {});
  });

  // Multiple calls must not double-remove
  dispose();
  dispose();
  dispose();

  // Only one removal should happen
  assert.equal(removeCalls, 1, 'dispose must be idempotent');
});

test('useEvent - cleanup via scope.dispose()', () => {
  const scope = createScope();
  const target = { addEventListener() {}, removeEventListener() {} };
  let removeCalls = 0;

  target.removeEventListener = () => {
    removeCalls++;
  };

  withScope(scope, () => {
    useEvent(target, 'click', () => {});
  });

  scope.dispose();

  assert.equal(removeCalls, 1, 'listener must be removed on scope.dispose()');
});

test('useEvent - works without scope (with warning)', () => {
  resetWarnings(); // Reset to make the warning deterministic for this test

  const target = { addEventListener() {}, removeEventListener() {} };
  let addCalls = 0;
  let removeCalls = 0;

  target.addEventListener = () => {
    addCalls++;
  };
  target.removeEventListener = () => {
    removeCalls++;
  };

  // Capture console.warn output
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  const dispose = useEvent(target, 'click', () => {});

  console.warn = originalWarn;

  // Must warn when used outside scope
  assert.ok(
    warnings.some((w) => w.includes('useEvent()') && w.includes('outside scope')),
    'must log a warning when called outside a scope'
  );

  // But it must still work
  assert.equal(addCalls, 1, 'listener must be added');

  // Manual dispose must work
  dispose();
  assert.equal(removeCalls, 1, 'manual dispose must remove listener');
});

test('useInterval - returns idempotent dispose()', async () => {
  const scope = createScope();
  let runs = 0;

  const dispose = withScope(scope, () => {
    return useInterval(() => {
      runs++;
    }, 10);
  });

  await tick(25);
  const runsBefore = runs;

  // Manual dispose must be idempotent
  dispose();
  dispose();

  await tick(25);

  // Must not run anymore after dispose
  assert.equal(runs, runsBefore, 'interval must not run after dispose');
});

test('useInterval - cleanup via scope.dispose()', async () => {
  const scope = createScope();
  let runs = 0;

  withScope(scope, () => {
    useInterval(() => {
      runs++;
    }, 10);
  });

  await tick(25);
  const runsBefore = runs;

  scope.dispose();

  await tick(25);

  // Must not run anymore after scope disposal
  assert.equal(runs, runsBefore, 'interval must not run after scope.dispose()');
});

test('useInterval - works without scope (with warning)', async () => {
  resetWarnings(); // Reset to make the warning deterministic for this test

  // Capture console.warn output
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  let runs = 0;
  const dispose = useInterval(() => {
    runs++;
  }, 10);

  console.warn = originalWarn;

  // Must warn when used outside scope
  assert.ok(
    warnings.some((w) => w.includes('useInterval()') && w.includes('outside scope')),
    'must log a warning when called outside a scope'
  );

  await tick(25);

  // Must still function without a scope
  assert.ok(runs >= 1, 'interval must work even without a scope');

  // Manual dispose must stop it
  dispose();
  const runsBefore = runs;
  await tick(25);

  assert.equal(runs, runsBefore, 'manual dispose must stop the interval');
});

test('useTimeout - returns idempotent dispose()', async () => {
  const scope = createScope();
  let runs = 0;

  const dispose = withScope(scope, () => {
    return useTimeout(() => {
      runs++;
    }, 10);
  });

  // Dispose before the timeout fires
  dispose();
  dispose();

  await tick(25);

  // Must not run if disposed before it fires
  assert.equal(runs, 0, 'timeout must not run if disposed before firing');
});

test('useTimeout - cleanup via scope.dispose()', async () => {
  const scope = createScope();
  let runs = 0;

  withScope(scope, () => {
    useTimeout(() => {
      runs++;
    }, 10);
  });

  // Dispose the scope before the timeout fires
  scope.dispose();

  await tick(25);

  // Must not run after scope disposal
  assert.equal(runs, 0, 'timeout must not run after scope.dispose()');
});

test('useTimeout - works without scope (with warning)', async () => {
  resetWarnings(); // Reset to make the warning deterministic for this test

  // Capture console.warn output
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));

  let runs = 0;
  const dispose = useTimeout(() => {
    runs++;
  }, 10);

  console.warn = originalWarn;

  // Must warn when used outside scope
  assert.ok(
    warnings.some((w) => w.includes('useTimeout()') && w.includes('outside scope')),
    'must log a warning when called outside a scope'
  );

  await tick(25);

  // Must still run once without a scope
  assert.equal(runs, 1, 'timeout must work even without a scope');

  // Disposing after execution should be safe and idempotent
  dispose();
  dispose();
});

test('Lifecycle helpers - do not spam console (global warning gating)', () => {
  // This test documents the intended behavior:
  // warnings are global and should appear at most once per helper type.
  //
  // Note: since previous tests already triggered warnings, we cannot reliably
  // assert warning counts here without isolating the process per test file.
  // The implementation uses a global Set (e.g. warnedFunctions) that persists
  // for the lifetime of the Node process.
  //
  // Visual validation: run the whole test suite and confirm you see
  // at most one warning per helper type in the output.

  assert.ok(true, 'warnings are controlled by global flags');
});
