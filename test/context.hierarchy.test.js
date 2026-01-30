/**
 * Test: Context hierarchical lookup (parent scope tracking)
 *
 * Validates that inject() can find context values provided in parent scopes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, withScope } from '../dist/core/scope.js';
import { createContext, provide, inject, tryInject, injectMeta } from '../dist/context/context.js';

test('inject finds context in parent scope', () => {
  const Theme = createContext('theme');

  const appScope = createScope();
  let result;

  withScope(appScope, () => {
    provide(Theme, 'dark');

    const pageScope = createScope();
    withScope(pageScope, () => {
      // Should find 'dark' from appScope
      result = inject(Theme);
    });
  });

  assert.equal(result, 'dark', 'Should find context value from parent scope');
});

test('inject finds context in grandparent scope', () => {
  const User = createContext('user');

  const appScope = createScope();
  let result;

  withScope(appScope, () => {
    provide(User, { name: 'Alice', id: 42 });

    const pageScope = createScope();
    withScope(pageScope, () => {
      const componentScope = createScope();
      withScope(componentScope, () => {
        // Should find user from appScope (2 levels up)
        result = inject(User);
      });
    });
  });

  assert.deepEqual(result, { name: 'Alice', id: 42 });
});

test('child context shadows parent context', () => {
  const Theme = createContext('theme');

  const appScope = createScope();
  let parentResult, childResult;

  withScope(appScope, () => {
    provide(Theme, 'light');
    parentResult = inject(Theme);

    const pageScope = createScope();
    withScope(pageScope, () => {
      // Override in child scope
      provide(Theme, 'dark');
      childResult = inject(Theme);
    });
  });

  assert.equal(parentResult, 'light', 'Parent should see light theme');
  assert.equal(childResult, 'dark', 'Child should see overridden dark theme');
});

test('inject throws if context not found in any ancestor', () => {
  const Missing = createContext('missing');

  const appScope = createScope();

  withScope(appScope, () => {
    const pageScope = createScope();
    withScope(pageScope, () => {
      assert.throws(
        () => inject(Missing),
        /Context "missing" not found in scope hierarchy/,
        'Should throw when context is not provided'
      );
    });
  });
});

test('tryInject returns { found: false } when context is missing', () => {
  const Missing = createContext('missing-optional');
  const rootScope = createScope();

  let result;
  withScope(rootScope, () => {
    result = tryInject(Missing);
  });

  assert.deepEqual(result, { found: false, value: undefined });
});

test('injectMeta returns owner scope and depth', () => {
  const Theme = createContext('theme');

  const appScope = createScope();
  let meta;

  withScope(appScope, () => {
    provide(Theme, 'dark');

    const pageScope = createScope();
    withScope(pageScope, () => {
      meta = injectMeta(Theme);
    });
  });

  assert.equal(meta.value, 'dark');
  assert.equal(meta.ownerScope, appScope);
  assert.equal(meta.depth, 1);
});

test('multiple contexts work independently', () => {
  const Theme = createContext('theme');
  const Locale = createContext('locale');
  const User = createContext('user');

  const appScope = createScope();
  let results;

  withScope(appScope, () => {
    provide(Theme, 'dark');
    provide(Locale, 'pt-BR');

    const pageScope = createScope();
    withScope(pageScope, () => {
      provide(User, { name: 'Bob' });

      // All three should be accessible
      results = {
        theme: inject(Theme),
        locale: inject(Locale),
        user: inject(User),
      };
    });
  });

  assert.deepEqual(results, {
    theme: 'dark',
    locale: 'pt-BR',
    user: { name: 'Bob' },
  });
});

test('scopes are isolated - sibling scopes do not share context', () => {
  const Data = createContext('data');

  const appScope = createScope();

  withScope(appScope, () => {
    provide(Data, 'root');

    const child1Scope = createScope();
    const child2Scope = createScope();

    let child1Value, child2Value;

    withScope(child1Scope, () => {
      provide(Data, 'child1');
      child1Value = inject(Data);
    });

    withScope(child2Scope, () => {
      provide(Data, 'child2');
      child2Value = inject(Data);
    });

    assert.equal(child1Value, 'child1', 'Child 1 sees its own value');
    assert.equal(child2Value, 'child2', 'Child 2 sees its own value');
  });
});

test('context survives across multiple withScope calls', () => {
  const Config = createContext('config');

  const rootScope = createScope();

  withScope(rootScope, () => {
    provide(Config, { apiUrl: 'https://api.example.com' });
  });

  let result;
  withScope(rootScope, () => {
    // Re-enter the same scope - context should still be there
    result = inject(Config);
  });

  assert.deepEqual(result, { apiUrl: 'https://api.example.com' });
});

console.log('✅ All context hierarchy tests passed!');
