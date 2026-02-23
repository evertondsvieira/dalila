import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, withScope } from '../dist/core/scope.js';
import { createContext, provide, inject } from '../dist/context/context.js';

test('context registry clears on scope dispose', () => {
  const Token = createContext('token');
  const scope = createScope();

  withScope(scope, () => {
    provide(Token, 'value');
    assert.equal(inject(Token), 'value');
  });

  scope.dispose();

  assert.throws(
    () => {
      withScope(scope, () => {
        inject(Token);
      });
    },
    /withScope\(\) cannot enter a disposed scope/,
    'Should throw when entering a disposed scope'
  );
});
