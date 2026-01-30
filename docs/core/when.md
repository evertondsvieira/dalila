# when

`when` is a boolean branching primitive. It mounts exactly one branch at a time
and gives each branch its own scope.

## Core Concepts

- Returns a `DocumentFragment` with stable comment markers.
- Initial render is synchronous (no flash).
- Updates track **only** the condition function.
- Branch swaps are coalesced in a microtask.

## API Reference

```ts
function when(
  condition: () => any,
  thenFn: () => Node | Node[],
  elseFn?: () => Node | Node[]
): DocumentFragment
```

## Example

```ts
import { when, signal } from "dalila";

const show = signal(true);

const fragment = when(
  () => show(),
  () => {
    const el = document.createElement("div");
    el.textContent = "Visible";
    return el;
  },
  () => {
    const el = document.createElement("div");
    el.textContent = "Hidden";
    return el;
  }
);

document.body.append(fragment);
```

## Comparison: when vs match

| Use `when` when... | Use `match` when... |
|-------------------|---------------------|
| The condition is boolean | You have multiple discrete cases |
| You need if/else style | You need switch/case style |

## Best Practices

- Keep branch functions focused on rendering (side effects live in effects).
- Return arrays if your branch renders multiple nodes.
- Use `when` for fast toggles; it coalesces swaps automatically.

## Common Pitfalls

1) **Expecting branch reads to affect the condition**

Only the `condition()` is tracked. Reads inside branches do not affect when the
branch is chosen.

2) **Returning nothing unintentionally**

If a branch returns `undefined`/`null`, nothing is mounted for that branch.

## Performance Notes

- Swaps are microtask-coalesced (rapid toggles collapse into one swap).
- Each branch has its own scope; disposal is O(n) in branch cleanups.
