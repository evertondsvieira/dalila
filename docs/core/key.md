# Query Keys

Keys uniquely identify cached resources and queries.

## Core Concepts

- Keys are either a string or an array of primitive parts.
- The cache uses an encoded string form internally.
- Objects are discouraged as key parts (dev warnings).

## API Reference

```ts
type QueryKeyPart = string | number | boolean | null | undefined | symbol
type QueryKey = readonly QueryKeyPart[] | string

function key<const T extends readonly QueryKeyPart[]>(...parts: T): T
function encodeKey(k: QueryKey): string
function isQueryKey(v: unknown): v is QueryKey
function setKeyDevMode(enabled: boolean): void
```

## Example

```ts
import { key, encodeKey } from "dalila";

const k = key("user", 42);
const encoded = encodeKey(k); // stable string
```

## Comparison: key() vs raw arrays

| Approach | Pros | Cons |
|---------|------|------|
| `key()` helper | Type inference, warnings | Slightly more verbose |
| Raw array | Shorter | Easy to pass invalid parts |

## Best Practices

- Use primitives (id, slug) instead of objects.
- Keep keys short and stable.
- Use `key()` for type safety when building arrays.

## Common Pitfalls

1) **Objects in keys**

Objects are unstable and can cause cache misses. Use primitive identifiers.

2) **Symbols across runtimes**

Symbols are encoded by description; they are stable only within a single runtime.

## Performance Notes

- Encoding is O(n) by number of key parts.
- Very large keys increase cache overhead; keep them small.
