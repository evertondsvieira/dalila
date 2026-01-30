/**
 * Test: persist() - Automatic storage sync for signals
 *
 * Validates:
 * - Basic persistence (save/load)
 * - Synchronous hydration for sync storage
 * - Versioning and migration
 * - Custom storage
 * - Error handling
 * - Merge strategies
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal } from '../dist/core/signal.js';
import { persist, clearPersisted } from '../dist/core/persist.js';
import { createScope, withScope, withScopeAsync } from '../dist/core/scope.js';

// ============================================
// Mock Storage (synchronous)
// ============================================

class MockStorage {
  constructor() {
    this.store = new Map();
  }

  getItem(key) {
    return this.store.get(key) ?? null;
  }

  setItem(key, value) {
    this.store.set(key, value);
  }

  removeItem(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

// ============================================
// Mock Async Storage
// ============================================

class AsyncMockStorage {
  constructor() {
    this.store = new Map();
  }

  async getItem(key) {
    await new Promise((r) => setTimeout(r, 1));
    return this.store.get(key) ?? null;
  }

  async setItem(key, value) {
    await new Promise((r) => setTimeout(r, 1));
    this.store.set(key, value);
  }

  async removeItem(key) {
    await new Promise((r) => setTimeout(r, 1));
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

// ============================================
// Basic Persistence
// ============================================

test('persist: basic save and load (sync storage)', async () => {
  const storage = new MockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    // Create persisted signal
    const count = persist(signal(0), {
      name: 'test-count',
      storage,
    });

    // Change value
    count.set(5);

    // Wait for effect + queued write
    await new Promise((r) => setTimeout(r, 10));

    // Check storage
    const stored = storage.getItem('test-count');
    assert.equal(stored, '5', 'Should save to storage');

    // Create new signal with same key - should hydrate
    const count2 = persist(signal(0), {
      name: 'test-count',
      storage,
    });

    assert.equal(count2.peek(), 5, 'Should hydrate from storage');
  });

  scope.dispose();
});

test('persist: hydration is synchronous for sync storage', () => {
  const storage = new MockStorage();
  storage.setItem('sync-test', JSON.stringify(42));

  const scope = createScope();

  withScope(scope, () => {
    const num = persist(signal(0), {
      name: 'sync-test',
      storage,
    });

    // Should be hydrated immediately (not async)
    assert.equal(num.peek(), 42, 'Should hydrate synchronously');
  });

  scope.dispose();
});

test('persist: handles async storage', async () => {
  const storage = new AsyncMockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const count = persist(signal(0), {
      name: 'async-count',
      storage,
    });

    // Initial value (not yet hydrated)
    assert.equal(count.peek(), 0);

    // Wait for async hydration to complete first
    await new Promise((r) => setTimeout(r, 10));

    // Change value (after hydration completes)
    count.set(10);

    // Wait for async save
    await new Promise((r) => setTimeout(r, 10));

    // Check storage
    const stored = await storage.getItem('async-count');
    assert.equal(stored, '10');
  });

  scope.dispose();
});

test('persist: no rollback when changing before async hydration completes', async () => {
  const storage = new AsyncMockStorage();

  // Pre-populate storage with value 50
  await storage.setItem('race-test', JSON.stringify(50));

  const scope = createScope();

  await withScopeAsync(scope, async () => {
    // Create signal with initial value 0
    const count = persist(signal(0), {
      name: 'race-test',
      storage,
    });

    // Initial value is 0 (not yet hydrated)
    assert.equal(count.peek(), 0, 'Initial value should be 0');

    // Change BEFORE hydration completes (this is the race condition we're testing)
    count.set(10);

    // Wait for hydration to complete
    await new Promise((r) => setTimeout(r, 10));

    // Signal should be 10 (NOT rolled back to 50 from storage)
    assert.equal(count.peek(), 10, 'Signal should keep value 10, not rollback to 50');

    // Wait for async save
    await new Promise((r) => setTimeout(r, 10));

    // Storage should have 10 (not 50)
    const stored = await storage.getItem('race-test');
    assert.equal(stored, '10', 'Storage should be updated to 10');
  });

  scope.dispose();
});

// ============================================
// Versioning and Migration
// ============================================

test('persist: version and migrate', async () => {
  const storage = new MockStorage();

  // Save old version
  storage.setItem('user', JSON.stringify({ name: 'Alice' }));
  storage.setItem('user:version', '1');

  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const user = persist(signal({ name: '', email: '' }), {
      name: 'user',
      storage,
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          return {
            name: persisted.name,
            email: 'default@example.com',
          };
        }
        return persisted;
      },
    });

    // Should have migrated
    assert.deepEqual(user.peek(), {
      name: 'Alice',
      email: 'default@example.com',
    });

    // Version should be updated
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(storage.getItem('user:version'), '2');
  });

  scope.dispose();
});

test('persist: no migration when versions match', () => {
  const storage = new MockStorage();

  storage.setItem('data', JSON.stringify({ value: 100 }));
  storage.setItem('data:version', '1');

  const scope = createScope();
  let migrateCalled = false;

  withScope(scope, () => {
    const data = persist(signal({ value: 0 }), {
      name: 'data',
      storage,
      version: 1,
      migrate: () => {
        migrateCalled = true;
        return { value: 999 };
      },
    });

    assert.equal(migrateCalled, false, 'Should not call migrate when versions match');
    assert.deepEqual(data.peek(), { value: 100 });
  });

  scope.dispose();
});

test('persist: migrated data is saved to storage', async () => {
  const storage = new MockStorage();

  // Save old version data
  storage.setItem('settings', JSON.stringify({ theme: 'light' }));
  storage.setItem('settings:version', '1');

  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const settings = persist(signal({ theme: 'light', lang: 'en' }), {
      name: 'settings',
      storage,
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          return {
            theme: persisted.theme,
            lang: 'en', // add new field
          };
        }
        return persisted;
      },
    });

    // Should have migrated
    assert.deepEqual(settings.peek(), {
      theme: 'light',
      lang: 'en',
    });

    // Wait for async save of migrated data
    await new Promise((r) => setTimeout(r, 10));

    // Storage should have migrated data (not just version)
    const stored = storage.getItem('settings');
    assert.equal(stored, JSON.stringify({ theme: 'light', lang: 'en' }), 'Migrated data should be saved to storage');

    // Version should also be updated
    assert.equal(storage.getItem('settings:version'), '2');
  });

  scope.dispose();
});

// ============================================
// Merge Strategies
// ============================================

test('persist: merge strategy "replace" (default)', () => {
  const storage = new MockStorage();
  storage.setItem('settings', JSON.stringify({ theme: 'dark' }));

  const scope = createScope();

  withScope(scope, () => {
    const settings = persist(signal({ theme: 'light', lang: 'en' }), {
      name: 'settings',
      storage,
      merge: 'replace',
    });

    // Should replace entirely
    assert.deepEqual(settings.peek(), { theme: 'dark' });
  });

  scope.dispose();
});

test('persist: merge strategy "shallow"', () => {
  const storage = new MockStorage();
  storage.setItem('prefs', JSON.stringify({ theme: 'dark' }));

  const scope = createScope();

  withScope(scope, () => {
    const prefs = persist(signal({ theme: 'light', lang: 'en' }), {
      name: 'prefs',
      storage,
      merge: 'shallow',
    });

    // Should shallow merge (keep lang, override theme)
    assert.deepEqual(prefs.peek(), { theme: 'dark', lang: 'en' });
  });

  scope.dispose();
});

// ============================================
// Custom Serializer
// ============================================

test('persist: custom serializer', async () => {
  const storage = new MockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const date = persist(signal(new Date('2024-01-01')), {
      name: 'date',
      storage,
      serializer: {
        serialize: (value) => value.toISOString(),
        deserialize: (str) => new Date(str),
      },
    });

    date.set(new Date('2025-06-15'));

    await new Promise((r) => setTimeout(r, 10));

    const stored = storage.getItem('date');
    assert.equal(stored, '2025-06-15T00:00:00.000Z');

    // Create new signal - should deserialize
    const date2 = persist(signal(new Date()), {
      name: 'date',
      storage,
      serializer: {
        serialize: (value) => value.toISOString(),
        deserialize: (str) => new Date(str),
      },
    });

    assert.equal(date2.peek().toISOString(), '2025-06-15T00:00:00.000Z');
  });

  scope.dispose();
});

// ============================================
// Callbacks
// ============================================

test('persist: onRehydrate callback', () => {
  const storage = new MockStorage();
  storage.setItem('callback-test', JSON.stringify(123));

  const scope = createScope();
  let rehydrated = null;

  withScope(scope, () => {
    const num = persist(signal(0), {
      name: 'callback-test',
      storage,
      onRehydrate: (state) => {
        rehydrated = state;
      },
    });

    assert.equal(rehydrated, 123, 'onRehydrate should be called');
    assert.equal(num.peek(), 123);
  });

  scope.dispose();
});

test('persist: onError callback', () => {
  const storage = new MockStorage();
  storage.setItem('bad-json', 'not valid json{{{');

  const scope = createScope();
  let error = null;

  withScope(scope, () => {
    const data = persist(signal([]), {
      name: 'bad-json',
      storage,
      onError: (err) => {
        error = err;
      },
    });

    assert.ok(error instanceof Error, 'Should call onError on parse failure');
    assert.deepEqual(data.peek(), [], 'Should keep initial value on error');
  });

  scope.dispose();
});

// ============================================
// Edge Cases
// ============================================

test('persist: empty storage returns initial value', () => {
  const storage = new MockStorage();

  const scope = createScope();

  withScope(scope, () => {
    const count = persist(signal(42), {
      name: 'empty-key',
      storage,
    });

    assert.equal(count.peek(), 42, 'Should use initial value when storage is empty');
  });

  scope.dispose();
});

test('persist: works without scope (fallback to signal.on)', async () => {
  const storage = new MockStorage();

  // No scope
  const count = persist(signal(0), {
    name: 'no-scope',
    storage,
  });

  count.set(99);

  // Wait for subscription to fire
  await new Promise((r) => setTimeout(r, 10));

  const stored = storage.getItem('no-scope');
  assert.equal(stored, '99', 'Should persist even without scope');
});

test('persist: clearPersisted removes data', () => {
  const storage = new MockStorage();
  storage.setItem('clear-test', JSON.stringify(100));
  storage.setItem('clear-test:version', '1');

  clearPersisted('clear-test', storage);

  assert.equal(storage.getItem('clear-test'), null);
  assert.equal(storage.getItem('clear-test:version'), null);
});

test('persist: requires name option', () => {
  assert.throws(() => persist(signal(0), {}), /requires a "name" option/, 'Should throw when name is missing');
});

test('persist: returns original signal when storage unavailable', () => {
  const original = signal(42);
  const persisted = persist(original, {
    name: 'test',
    storage: undefined,
  });

  assert.equal(persisted, original, 'Should return original signal');
  assert.equal(persisted.peek(), 42);
});

// ============================================
// Reactivity
// ============================================

test('persist: persisted signal remains reactive', async () => {
  const storage = new MockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const count = persist(signal(0), {
      name: 'reactive-test',
      storage,
    });

    let effectRuns = 0;
    let lastValue = 0;

    // Track changes with effect
    const { effect } = await import('../dist/core/signal.js');
    effect(() => {
      lastValue = count();
      effectRuns++;
    });

    await new Promise((r) => setTimeout(r, 10));

    // Change value
    count.set(5);

    await new Promise((r) => setTimeout(r, 10));

    assert.equal(effectRuns, 2, 'Effect should run on change');
    assert.equal(lastValue, 5);

    // Check storage updated
    const stored = storage.getItem('reactive-test');
    assert.equal(stored, '5');
  });

  scope.dispose();
});

// ============================================
// Multiple Signals
// ============================================

test('persist: multiple persisted signals with different keys', async () => {
  const storage = new MockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const count = persist(signal(0), { name: 'count', storage });
    const name = persist(signal(''), { name: 'name', storage });

    count.set(10);
    name.set('Alice');

    await new Promise((r) => setTimeout(r, 10));

    assert.equal(storage.getItem('count'), '10');
    assert.equal(storage.getItem('name'), '"Alice"');
  });

  scope.dispose();
});

// ============================================
// Preload Script Generation
// ============================================

test('createThemeScript: generates valid inline script', async () => {
  const { createThemeScript } = await import('../dist/core/persist.js');

  const script = createThemeScript('app-theme', 'dark');

  assert.ok(typeof script === 'string', 'Should return a string');
  assert.ok(script.length < 250, 'Should be minified (under 250 chars)');
  assert.ok(script.includes('localStorage.getItem'), 'Should read from localStorage');
  assert.ok(script.includes('app-theme'), 'Should include storage key');
  assert.ok(script.includes('dark'), 'Should include default value');
  assert.ok(script.includes('data-theme'), 'Should set data-theme attribute');
});

test('createPreloadScript: generates custom script', async () => {
  const { createPreloadScript } = await import('../dist/core/persist.js');

  const script = createPreloadScript({
    storageKey: 'my-setting',
    defaultValue: 'auto',
    target: 'body',
    attribute: 'data-mode',
    storageType: 'sessionStorage',
  });

  assert.ok(script.includes('sessionStorage'), 'Should use sessionStorage');
  assert.ok(script.includes('my-setting'), 'Should include custom key');
  assert.ok(script.includes('auto'), 'Should include custom default');
  assert.ok(script.includes('data-mode'), 'Should use custom attribute');
  assert.ok(script.includes('document.body'), 'Should target body');
});

test('preload script: executes without errors', async () => {
  const { createThemeScript } = await import('../dist/core/persist.js');

  // Mock localStorage
  global.localStorage = new MockStorage();
  global.document = {
    documentElement: {
      setAttribute: (key, value) => {
        assert.equal(key, 'data-theme');
        assert.equal(value, 'dark');
      },
    },
  };

  const script = createThemeScript('test-theme', 'dark');

  // Execute the script (should not throw)
  assert.doesNotThrow(() => {
    eval(script);
  });

  // Cleanup
  delete global.localStorage;
  delete global.document;
});

// ============================================
// Preload Flag
// ============================================

test('persist: preload flag is optional', () => {
  const storage = new MockStorage();
  const scope = createScope();

  withScope(scope, () => {
    // Without preload
    const count1 = persist(signal(0), {
      name: 'no-preload',
      storage,
    });
    assert.equal(count1.peek(), 0);

    // With preload (same behavior at runtime)
    const count2 = persist(signal(0), {
      name: 'with-preload',
      storage,
      preload: true,
    });
    assert.equal(count2.peek(), 0);
  });

  scope.dispose();
});

test('persist: preload flag does not affect runtime behavior', async () => {
  const storage = new MockStorage();
  const scope = createScope();

  await withScopeAsync(scope, async () => {
    const theme = persist(signal('light'), {
      name: 'theme-preload',
      storage,
      preload: true,
    });

    theme.set('dark');
    await new Promise((r) => setTimeout(r, 10));

    // Should persist regardless of preload flag
    assert.equal(storage.getItem('theme-preload'), '"dark"');
  });

  scope.dispose();
});
