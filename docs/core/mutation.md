# Mutations

Mutations represent write operations and expose reactive state.

## Core Concepts

- **Stateful**: `data()`, `loading()`, `error()` are signals.
- **Cancelable**: in-flight runs abort on scope disposal.
- **Deduped**: concurrent `run()` calls share the same in-flight promise.

## API Reference

```ts
function createMutation<TInput, TResult>(cfg: MutationConfig<TInput, TResult>): MutationState<TInput, TResult>

interface MutationConfig<TInput, TResult> {
  mutate: (signal: AbortSignal, input: TInput) => Promise<TResult>
  invalidateTags?: readonly string[]
  invalidateKeys?: readonly QueryKey[]
  onSuccess?: (result: TResult, input: TInput) => void
  onError?: (error: Error, input: TInput) => void
  onSettled?: (input: TInput) => void
}

interface MutationState<TInput, TResult> {
  data(): TResult | null
  loading(): boolean
  error(): Error | null
  run(input: TInput, opts?: { force?: boolean }): Promise<TResult | null>
  reset(): void
}
```

## Example

```ts
import { createMutation } from "dalila";

const saveUser = createMutation({
  mutate: async (signal, input: { name: string }) => {
    const res = await fetch("/api/user", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      signal,
    });
    return res.json();
  },
});

saveUser.run({ name: "Ana" });

saveUser.loading();
saveUser.error();
saveUser.data();
```

## Example with invalidation

```ts
import { createMutation } from "dalila";

const updateUser = createMutation({
  mutate: async (signal, input: { id: string; name: string }) => {
    const res = await fetch(`/api/user/${input.id}`, {
      method: "PUT",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      signal,
    });
    return res.json();
  },
  invalidateTags: ["user"],
});
```

## Comparison: Mutation vs Resource

| Use | Best choice |
|-----|-------------|
| Read data (async) | `createResource` or queries |
| Write data | `createMutation` |

## Best Practices

- Pass the AbortSignal to your fetch calls.
- Handle `null` return from `run()` (aborted run).
- Use `invalidateTags`/`invalidateKeys` to refresh dependent queries.

## Common Pitfalls

1) **Ignoring AbortSignal**

If you don't pass the signal to your fetch, aborts won't cancel network work.

2) **Assuming reset clears caches**

`reset()` only clears local mutation state, not cached queries.

3) **Forcing too often**

`run(..., { force: true })` aborts current work; use sparingly.

## Performance Notes

- Dedupe avoids duplicate network calls when many `run()` calls happen quickly.
- Avoid calling `run()` on every keystroke unless you debounce.
