# Effects Guide

Practical guide for choosing between Dalila's effect APIs.

## Decision Table

| Need | API |
|---|---|
| React to signals and run sync/microtask side effects | `effect()` |
| Run async work with automatic cancellation | `effectAsync()` |
| React only while a node is connected to the DOM | `watch(node, fn)` |
| Register teardown in the current scope | `onCleanup()` |
| Read without creating a dependency | `untrack()` |

## `effect()`

Use for synchronous side effects: DOM updates, logs, integration with imperative APIs.

```ts
effect(() => {
  document.title = `Count: ${count()}`;
});
```

## `effectAsync()`

Use when doing `fetch`/async work and you need to cancel stale executions.

```ts
effectAsync(async (signal) => {
  const res = await fetch(`/api/user/${userId()}`, { signal });
  user.set(await res.json());
});
```

## `watch(node, fn)`

Use when the effect should exist only while a node is connected.

```ts
watch(panel, () => {
  panel.textContent = status();
});
```

This avoids leaks and simplifies mount/unmount.

## `onCleanup()`

Registers teardown in the current scope.

```ts
effect(() => {
  const id = setInterval(tick, 1000);
  onCleanup(() => clearInterval(id));
});
```

## `untrack()`

Read a value without subscribing to a reactive dependency.

```ts
effect(() => {
  const term = search();
  const pageSize = untrack(() => settings().pageSize);
  runSearch(term, pageSize);
});
```

## Common Mistakes

- `effect()` with `fetch` and no cancellation (prefer `effectAsync()`)
- accidental reads inside `effect()` creating extra dependencies (use `untrack()`)
- effects created outside a scope in long-lived code
