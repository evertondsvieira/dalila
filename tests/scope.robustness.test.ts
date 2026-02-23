import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, withScope } from '../dist/core/scope.js';

test('scope.dispose runs all cleanups even if one throws', () => {
  const scope = createScope();
  const ran = [];
  const originalError = console.error;
  const errorsLogged: string[] = [];

  scope.onCleanup(() => ran.push('a'));
  scope.onCleanup(() => {
    throw new Error('boom');
  });
  scope.onCleanup(() => ran.push('c'));

  console.error = (...args) => {
    errorsLogged.push(args.map(String).join(' '));
  };
  try {
    assert.doesNotThrow(() => scope.dispose());
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(ran, ['a', 'c']);
  assert.ok(errorsLogged.some((w) => w.includes('scope.dispose() had cleanup errors')));
});

test('onCleanup after dispose runs immediately', () => {
  const scope = createScope();
  scope.dispose();

  let ran = false;
  scope.onCleanup(() => {
    ran = true;
  });

  assert.equal(ran, true);
});

test('withScope throws when entering a disposed scope', () => {
  const scope = createScope();
  scope.dispose();

  assert.throws(
    () => withScope(scope, () => {}),
    /withScope\(\) cannot enter a disposed scope/,
    'Should throw when entering a disposed scope'
  );
});

test('parent dispose cascades to child', () => {
  const parent = createScope();
  let childCleaned = false;

  withScope(parent, () => {
    const child = createScope();
    child.onCleanup(() => {
      childCleaned = true;
    });
  });

  parent.dispose();
  assert.equal(childCleaned, true);
});
