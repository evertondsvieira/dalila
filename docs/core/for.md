# Lists: forEach and createList

Dalila provides two keyed list primitives. Both update only what changed and
create a scope per item for automatic cleanup.

## Core Concepts

- **Keyed diffing:** stable keys preserve DOM nodes on reorder.
- **Per-item scope:** effects/listeners inside items are disposed when items leave.
- **Stable anchors:** list content is mounted between comment markers.

## API Reference

```ts
function forEach<T>(
  items: () => T[],
  template: (item: T, index: () => number) => Node | Node[],
  keyFn?: (item: T, index: number) => string
): DocumentFragment & { dispose(): void }

function createList<T>(
  items: () => T[],
  template: (item: T, index: number) => Node | Node[],
  keyFn?: (item: T, index: number) => string
): DocumentFragment & { dispose(): void }
```

## createList (recommended)

```ts
import { createList, signal } from "dalila";

const todos = signal([
  { id: 1, text: "Learn" },
  { id: 2, text: "Build" },
]);

const fragment = createList(
  () => todos(),
  (todo) => {
    const li = document.createElement("li");
    li.textContent = todo.text;
    return li;
  },
  (todo) => String(todo.id)
);

document.body.append(fragment);
```

## forEach (low-level)

`forEach` provides a **reactive** `index()` signal per item.

```ts
import { forEach, signal } from "dalila";

const items = signal(["a", "b", "c"]);

const fragment = forEach(
  () => items(),
  (item, index) => {
    const li = document.createElement("li");
    li.textContent = `${index()}: ${item}`;
    return li;
  }
);

document.body.append(fragment);
```

## Comparison: createList vs forEach

| Feature | createList | forEach |
|--------|------------|---------|
| Index | Snapshot number | Reactive signal |
| Complexity | Lower | Higher |
| Recommended | Yes | Only when you need reactive index |

## Behavior Details

- `createList` uses a snapshot index (number), not reactive.
- `forEach` uses a reactive `index()` that updates on reorder.
- Duplicate keys throw in dev mode (to prevent unstable list state).
- If used outside a scope, Dalila warns and auto-disposes when removed from DOM.

## Best Practices

- Always provide a stable `keyFn` for dynamic lists.
- Avoid using array index as key when items can reorder.
- Keep item render functions small; move heavy logic to effects.

## Common Pitfalls

1) **Duplicate keys**

Duplicate keys can cause incorrect reordering and are treated as errors in dev.

2) **Expecting createList index to be reactive**

If you need reactive index updates, use `forEach`.

3) **Leaking lists outside scopes**

If created without a scope, call `fragment.dispose()` when removing from DOM.

## Performance Notes

- Keyed diffing minimizes DOM changes.
- Item scopes are disposed on removal, preventing effect leaks.
- Removed-item detection now reuses keyed maps and removes stale entries directly, avoiding extra set materialization per update.
- Index signals are only updated when an item's index actually changes.
- Prefer one list per container instead of many small lists.
- For very large datasets, prefer [Virtual Lists](./virtual.md).
