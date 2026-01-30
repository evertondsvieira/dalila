# match

`match` is a value-based branching primitive. It selects a case by key and swaps
scopes when the key changes.

## Core Concepts

- Returns a `DocumentFragment` with stable comment markers.
- Initial render is synchronous.
- Tracks only the key function.
- Case swaps are coalesced in a microtask.

## API Reference

```ts
function match<T extends string | number | symbol>(
  key: () => T,
  cases: Record<T | "_", () => Node | Node[]>
): DocumentFragment
```

## Example

```ts
import { match, signal } from "dalila";

const status = signal("idle");

const fragment = match(
  () => status(),
  {
    idle: () => document.createTextNode("Idle"),
    loading: () => document.createTextNode("Loading..."),
    error: () => document.createTextNode("Error"),
    _: () => document.createTextNode("Unknown"),
  }
);

document.body.append(fragment);
```

## Comparison: match vs when

| Use `match` when... | Use `when` when... |
|--------------------|--------------------|
| You have many cases | You only need if/else |
| Keys are discrete values | Condition is boolean |

## Best Practices

- Provide a `_` fallback case when possible.
- Map multiple keys to the same renderer if they share UI.
- Keep case functions small; heavy work should be in effects.

## Common Pitfalls

1) **Missing fallback**

If no case matches and `_` is missing, `match` throws.

2) **Assuming case functions are reactive**

Case functions run once per swap; use signals/effects inside the case if needed.

## Performance Notes

- Case swaps are microtask-coalesced.
- Each case has its own scope; disposal cost scales with case cleanups.
