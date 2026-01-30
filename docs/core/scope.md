# Scope

Scopes are lightweight lifecycle containers. They group cleanups and define the
parent-child hierarchy used by Context.

## Core Concepts

```
root scope
  ├─ child scope (inherits context)
  │    └─ grandchild scope
  └─ another child scope (isolated from sibling)
```

- A scope owns cleanup callbacks registered with `onCleanup`.
- Disposing a parent scope automatically disposes all descendants.
- `withScope()` sets the current scope for the duration of a call.

## API Reference

### Core Functions

```ts
function createScope(parent?: Scope | null): Scope
function withScope<T>(scope: Scope, fn: () => T): T
function withScopeAsync<T>(scope: Scope, fn: () => Promise<T>): Promise<T>
function getCurrentScope(): Scope | null
function isScopeDisposed(scope: Scope): boolean
```

### Debug/Inspection Functions

```ts
function getCurrentScopeHierarchy(): Scope[]  // Returns [current, parent, grandparent, ...]
function onScopeCreate(fn: (scope: Scope) => void): () => void
function onScopeDispose(fn: (scope: Scope) => void): () => void
```

### Scope Interface

```ts
interface Scope {
  onCleanup(fn: () => void): void
  dispose(): void
  readonly parent: Scope | null
}
```

## Basic Usage

```ts
import { createScope, withScope } from "dalila";

const scope = createScope();

withScope(scope, () => {
  // Effects/resources/events created here are tied to this scope
});

scope.dispose();
```

## Async Scope

Use `withScopeAsync` when your function contains `await`. The regular `withScope`
restores the previous scope immediately when the Promise is returned, not when it
resolves. This means anything created after an `await` would not be in the scope.

```ts
import { createScope, withScopeAsync } from "dalila";

const scope = createScope();

await withScopeAsync(scope, async () => {
  await fetch('/api/data');

  // This effect IS in scope (withScopeAsync maintains scope during await)
  effect(() => { /* ... */ });
});

scope.dispose();
```

**When to use which:**

| Function | Use when |
|----------|----------|
| `withScope` | Synchronous code |
| `withScopeAsync` | Async functions with `await` |

## Parent/Child Behavior

`createScope()` captures the current scope as its parent (unless you pass an override).

```ts
import { createScope, withScope } from "dalila";

const root = createScope();

withScope(root, () => {
  const child = createScope();

  // Disposing root will dispose child automatically
  root.dispose();
});
```

Notes:
- `createScope()` uses the current scope as parent by default.
- Passing `null` creates an isolated root scope.

## Comparison: Scope vs Manual Cleanup

| Approach | Pros | Cons |
|---------|------|------|
| Scope + onCleanup | Automatic teardown, fewer leaks | Must remember to dispose scope |
| Manual cleanup only | Full control | Easy to forget, harder to audit |

## Best Practices

- Create one scope per component/view and dispose it when the view goes away.
- Register cleanups with `onCleanup` inside `withScope`.
- Keep scopes shallow unless you need explicit hierarchy for Context.

## Common Pitfalls

1) **Forgetting to dispose**

If you create scopes manually, always dispose them to avoid leaks.

2) **Entering disposed scopes**

```ts
withScope(disposedScope, () => {
  // throws: cannot enter a disposed scope
});
```

3) **Unintentionally isolating**

Passing `null` to `createScope(null)` breaks parent inheritance. Use it only when
you want full isolation.

## Debug and Inspection

```ts
import { createScope, withScope, getCurrentScopeHierarchy, onScopeCreate, onScopeDispose } from "dalila";

// Inspect scope hierarchy during debugging
const root = createScope();

withScope(root, () => {
  const child = createScope();

  withScope(child, () => {
    const hierarchy = getCurrentScopeHierarchy();
    // [child, root] — from current scope up to the root
    console.log("Depth:", hierarchy.length);
  });
});

// Monitor scope lifecycle globally (useful for leak detection)
const unsubCreate = onScopeCreate((scope) => {
  console.log("Scope created:", scope);
});

const unsubDispose = onScopeDispose((scope) => {
  console.log("Scope disposed:", scope);
});

// Clean up listeners when done
unsubCreate();
unsubDispose();
```

## Performance Notes

- Scopes are cheap to create.
- Disposing runs cleanups in FIFO order; cost is linear to number of cleanups.
- Avoid creating scopes per item in large loops unless required (use list helpers).
