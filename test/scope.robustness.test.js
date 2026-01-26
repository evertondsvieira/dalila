import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, withScope } from '../dist/core/scope.js';

test('scope.dispose runs all cleanups even if one throws', () => {
  const scope = createScope();
  const ran = [];

  scope.onCleanup(() => ran.push('a'));
  scope.onCleanup(() => {
    throw new Error('boom');
  });
  scope.onCleanup(() => ran.push('c'));

  assert.doesNotThrow(() => scope.dispose());
  assert.deepEqual(ran, ['a', 'c']);
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
