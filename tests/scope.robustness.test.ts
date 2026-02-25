import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScope, onScopeDispose, withScope } from '../dist/core/scope.js';

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

test('parent disposes child before parent local cleanup', () => {
  const parent = createScope();
  const order: string[] = [];

  withScope(parent, () => {
    parent.onCleanup(() => order.push('parent'));
    const child = createScope();
    child.onCleanup(() => order.push('child'));
  });

  parent.dispose();
  assert.deepEqual(order, ['child', 'parent']);
});

test('local cleanups remain FIFO within the same scope', () => {
  const scope = createScope();
  const order: string[] = [];

  scope.onCleanup(() => order.push('a'));
  scope.onCleanup(() => order.push('b'));
  scope.onCleanup(() => order.push('c'));

  scope.dispose();
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('multiple children dispose before parent locals (sibling FIFO)', () => {
  const parent = createScope();
  const order: string[] = [];

  withScope(parent, () => {
    const childA = createScope();
    childA.onCleanup(() => order.push('child-a'));

    parent.onCleanup(() => order.push('parent-1'));

    const childB = createScope();
    childB.onCleanup(() => order.push('child-b'));

    parent.onCleanup(() => order.push('parent-2'));
  });

  parent.dispose();
  assert.deepEqual(order, ['child-a', 'child-b', 'parent-1', 'parent-2']);
});

test('child already disposed does not run cleanup twice when parent disposes', () => {
  const parent = createScope();
  let childRuns = 0;
  let childRef: ReturnType<typeof createScope> | null = null;

  withScope(parent, () => {
    const child = createScope();
    childRef = child;
    child.onCleanup(() => childRuns++);
  });

  childRef!.dispose();
  parent.dispose();

  assert.equal(childRuns, 1);
});

test('grandchild disposes before child local and parent local cleanups', () => {
  const root = createScope();
  const order: string[] = [];

  withScope(root, () => {
    root.onCleanup(() => order.push('root-local'));

    const child = createScope();
    child.onCleanup(() => order.push('child-local'));

    withScope(child, () => {
      const grandchild = createScope();
      grandchild.onCleanup(() => order.push('grandchild-local'));
    });
  });

  root.dispose();

  assert.deepEqual(order, ['grandchild-local', 'child-local', 'root-local']);
});

test('errors in child disposal do not block parent local cleanup and are aggregated', () => {
  const parent = createScope();
  const order: string[] = [];
  const originalError = console.error;
  const logs: string[] = [];

  withScope(parent, () => {
    const child = createScope();
    child.onCleanup(() => {
      order.push('child-start');
      throw new Error('child boom');
    });
    parent.onCleanup(() => order.push('parent-local'));
  });

  console.error = (...args) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    assert.doesNotThrow(() => parent.dispose());
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(order, ['child-start', 'parent-local']);
  assert.ok(logs.some((line) => line.includes('scope.dispose() had cleanup errors')));
});

test('onCleanup called during dispose runs immediately (preserved behavior)', () => {
  const scope = createScope();
  const order: string[] = [];

  scope.onCleanup(() => {
    order.push('a');
    scope.onCleanup(() => order.push('late'));
  });
  scope.onCleanup(() => order.push('b'));

  scope.dispose();

  assert.deepEqual(order, ['a', 'late', 'b']);
});

test('onScopeDispose listener fires once for parent dispose with child cascade', () => {
  const parent = createScope();
  let childDisposeEvents = 0;
  let parentDisposeEvents = 0;
  let childRef: ReturnType<typeof createScope> | null = null;

  const off = onScopeDispose((scope) => {
    if (scope === parent) parentDisposeEvents++;
    if (scope === childRef) childDisposeEvents++;
  });

  try {
    withScope(parent, () => {
      childRef = createScope();
    });

    parent.dispose();
    parent.dispose();
  } finally {
    off();
  }

  assert.equal(childDisposeEvents, 1);
  assert.equal(parentDisposeEvents, 1);
});

test('createScope supports external parent Scope implementations via public interface', () => {
  const parentCleanups: Array<() => void> = [];
  let disposed = false;

  const externalParent = {
    parent: null,
    onCleanup(fn: () => void) {
      parentCleanups.push(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of parentCleanups.splice(0)) fn();
    },
  };

  const child = createScope(externalParent);
  let childRan = false;
  child.onCleanup(() => {
    childRan = true;
  });

  assert.doesNotThrow(() => externalParent.dispose());
  assert.equal(childRan, true);
});

test('external parent already disposed can trigger immediate child cleanup via late onCleanup', () => {
  let disposed = false;
  const parentCleanups: Array<() => void> = [];

  const externalParent = {
    parent: null,
    onCleanup(fn: () => void) {
      if (disposed) {
        fn();
        return;
      }
      parentCleanups.push(fn);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const fn of parentCleanups.splice(0)) fn();
    },
  };

  externalParent.dispose();

  const child = createScope(externalParent);
  let childRan = false;
  child.onCleanup(() => {
    childRan = true;
  });

  assert.equal(childRan, true);
});
