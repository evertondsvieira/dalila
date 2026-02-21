# Mutations

Mutations model write operations with reactive state, cancellation, invalidation, and optimistic update lifecycle hooks.

## Core Concepts

```txt
┌─────────────────────────────────────────────────────────────┐
│                       Mutation Flow                         │
│                                                             │
│ run(input)                                                  │
│   ├── onMutate(input) -> context                            │
│   ├── mutationFn(signal, input)                             │
│   ├── onSuccess(result, input, context)                     │
│   ├── invalidateTags/invalidateKeys                         │
│   ├── onError(error, input, context)                        │
│   └── onSettled(result, error, input, context)              │
│                                                             │
│ loading()/error()/data() are reactive signals               │
└─────────────────────────────────────────────────────────────┘
```

**Key behaviors:**
1. **Cancelable** by `AbortSignal` and scope cleanup.
2. **Deduped** by default for concurrent `run()` calls.
3. **Optimistic-ready** through `onMutate` context.
4. **Cache refresh** via `invalidateTags` and `invalidateKeys`.

## API Reference

```ts
function createMutation<TInput, TResult, TContext = unknown>(
  cfg: MutationConfig<TInput, TResult, TContext>
): MutationState<TInput, TResult>

interface MutationConfig<TInput, TResult, TContext> {
  mutationFn?: (signal: AbortSignal, input: TInput) => Promise<TResult>
  mutate?: (signal: AbortSignal, input: TInput) => Promise<TResult>

  onMutate?: (input: TInput) => Promise<TContext> | TContext
  onSuccess?: (result: TResult, input: TInput, context: TContext | undefined) => void
  onError?: (error: Error, input: TInput, context: TContext | undefined) => void
  onSettled?: (
    result: TResult | null,
    error: Error | null,
    input: TInput,
    context: TContext | undefined
  ) => void

  invalidateTags?: readonly string[]
  invalidateKeys?: readonly QueryKey[]

  optimistic?: {
    apply: (input: TInput) => void | (() => void | Promise<void>) | { rollback?: () => void | Promise<void> }
    rollback?: boolean | ((context: unknown, input: TInput) => void | Promise<void>)
  }

  retry?: number | ((failureCount: number, error: Error, input: TInput) => boolean)
  retryDelay?: number | ((failureCount: number, error: Error, input: TInput) => number)
  queue?: "dedupe" | "serial"
  maxQueue?: number
}

interface MutationState<TInput, TResult> {
  data(): TResult | null
  loading(): boolean
  error(): Error | null
  run(input: TInput, opts?: { force?: boolean }): Promise<TResult | null>
  reset(): void
}
```

## Basic Mutation

```ts
const saveUser = createMutation({
  mutationFn: async (signal, input: { name: string }) => {
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal,
    });
    if (!res.ok) throw new Error("failed");
    return res.json();
  },
});

await saveUser.run({ name: "Ana" });
```

## Optimistic Update Pattern (with Query Client)

```ts
const q = createQueryClient();

const addTodo = q.mutation({
  mutationFn: async (signal, newTodo) => {
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newTodo),
      signal,
    });
    return res.json();
  },
  onMutate: async (newTodo) => {
    q.cancelQueries(["todos"]);
    const previous = q.getQueryData<{ id: number; title: string }[]>(["todos"]);
    q.setQueryData(["todos"], (old) => [...(old ?? []), newTodo]);
    return { previous };
  },
  onError: (_err, _input, ctx) => {
    q.setQueryData(["todos"], ctx?.previous ?? []);
  },
  onSettled: () => {
    q.invalidateQueries(["todos"]);
  },
});
```

## Invalidation on Success

```ts
const updateUser = createMutation({
  mutationFn: async (signal, input: { id: string; name: string }) => {
    const res = await fetch(`/api/users/${input.id}`, {
      method: "PUT",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      signal,
    });
    return res.json();
  },
  invalidateTags: ["users"],
  invalidateKeys: [["user", "me"]],
});
```

## Optimistic Shorthand

When using `queryClient.mutation(...)`, `optimistic.apply` receives cache helpers as first argument.

```ts
const saveTodo = q.mutation({
  mutationFn: apiSaveTodo,
  optimistic: {
    apply: (cache, input) => {
      const previous = cache.getQueryData(["todos"]);
      cache.setQueryData(["todos"], (old) => [...(old ?? []), input]);
      return () => cache.setQueryData(["todos"], previous ?? []);
    },
    rollback: true,
  },
  invalidateKeys: [["todos"]],
});
```

## Retry and Serial Queue

```ts
const saveDraft = createMutation({
  mutationFn: apiSaveDraft,
  retry: 3,
  retryDelay: (attempt) => attempt * 300,
  queue: "serial",
});
```

## Best Practices

1. Always forward the provided `AbortSignal` to network calls.
2. Use `onMutate` to snapshot and patch cache atomically.
3. Roll back in `onError` using returned context.
4. Keep invalidation focused (`tags` or specific keys).
5. Use `run(..., { force: true })` only when replacing in-flight writes is intentional.

## Common Pitfalls

1. **No rollback context**

If you optimistic-patch cache, always capture previous state in `onMutate`.

2. **Treating `null` as success**

`run()` returns `null` on abort/error; handle this explicitly.

3. **Using both `mutationFn` and `mutate` inconsistently**

Prefer `mutationFn` as canonical name.

## Performance Notes

- Concurrent runs are deduped by default.
- Optimistic updates avoid extra render delay after user actions.
- Invalidation after success keeps cache coherent with server source of truth.
