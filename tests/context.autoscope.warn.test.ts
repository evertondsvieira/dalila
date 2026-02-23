import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setDevMode } from '../dist/core/dev.js';
import { createScope, withScope } from '../dist/core/scope.js';
import {
  createContext,
  provide,
  inject,
  provideGlobal,
  setAutoScopePolicy,
  getGlobalScope,
  resetGlobalScope,
} from '../dist/context/auto-scope.js';

test('auto-scope provide outside scope warns only once in dev mode', () => {
  setDevMode(true);
  resetGlobalScope();
  setAutoScopePolicy("warn"); // Enable warn mode for this test

  const Token = createContext('warn-token');
  const warns = [];
  const originalWarn = console.warn;

  console.warn = (message) => {
    warns.push(String(message));
  };

  try {
    provide(Token, 1);
    provide(Token, 2);
    provide(Token, 3);
  } finally {
    console.warn = originalWarn;
    setAutoScopePolicy("throw"); // Reset to default
  }

  assert.equal(warns.length, 1);
  assert.match(warns[0], /provide\(\) called outside a scope/i);
});

test('inject outside scope does not create global scope (safe-by-default)', () => {
  resetGlobalScope();
  const Token = createContext('t');

  assert.throws(() => inject(Token), /no global scope exists yet/i);
});

test('provide outside scope creates global scope for later inject', () => {
  resetGlobalScope();
  setAutoScopePolicy("warn"); // Enable warn mode for this test

  const Token = createContext('t');
  const originalWarn = console.warn;
  console.warn = () => {}; // Suppress warning

  try {
    provide(Token, 123);
    assert.equal(inject(Token), 123);
  } finally {
    console.warn = originalWarn;
    setAutoScopePolicy("throw"); // Reset to default
  }
});

test('resetGlobalScope removes beforeunload listener when registered', () => {
  const originalWindow = globalThis.window;
  const calls = { add: 0, remove: 0 };
  let registeredHandler;
  const originalWarn = console.warn;

  (globalThis as any).window = {
    addEventListener(event, handler) {
      if (event === 'beforeunload') {
        calls.add++;
        registeredHandler = handler;
      }
    },
    removeEventListener(event, handler) {
      if (event === 'beforeunload' && handler === registeredHandler) {
        calls.remove++;
      }
    },
  };

  console.warn = () => {};

  try {
    resetGlobalScope();
    setAutoScopePolicy("warn"); // Enable warn mode for this test
    const Token = createContext('listener');
    provide(Token, 1);
    assert.equal(calls.add, 1);

    resetGlobalScope();
    assert.equal(calls.remove, 1);
  } finally {
    console.warn = originalWarn;
    (globalThis as any).window = originalWindow;
    setAutoScopePolicy("throw"); // Reset to default
  }
});

test('auto-scope policy "throw" prevents accidental globals', () => {
  resetGlobalScope();
  // "throw" is now the default, so no need to set it explicitly

  const Token = createContext('throw-token');

  assert.throws(
    () => provide(Token, 1),
    /provide\(\) called outside a scope/i,
    'Should throw when policy is set to throw (default)'
  );
});

test('global scope is detached from current scope', () => {
  resetGlobalScope();

  const Token = createContext('global-detached');
  const parent = createScope();

  withScope(parent, () => {
    provideGlobal(Token, 123);
  });

  const globalScope = getGlobalScope();
  assert.ok(globalScope, 'Global scope should exist');
  assert.equal(globalScope.parent, null);
});
