# Scheduler and Batching

The scheduler groups work into microtasks and frames. It powers signal updates,
coalesces effects, and provides optional DOM read/write helpers.

## Core Concepts

- **Microtasks** are used for short reactive follow-ups.
- **RAF tasks** are used for frame-aligned work (DOM updates).
- **batch()** defers notifications until the outermost batch finishes.

## API Reference

```ts
function schedule(task: () => void): void
function scheduleMicrotask(task: () => void): void
function batch(fn: () => void): void
function queueInBatch(task: () => void): void
function isBatching(): boolean
function timeSlice<T>(
  fn: (ctx: { shouldYield(): boolean; yield(): Promise<void>; signal: AbortSignal | null }) => T | Promise<T>,
  options?: { budgetMs?: number; signal?: AbortSignal }
): Promise<T>
function configureScheduler(config: Partial<{ maxMicrotaskIterations: number; maxRafIterations: number }>): void
function getSchedulerConfig(): Readonly<{ maxMicrotaskIterations: number; maxRafIterations: number }>
function measure<T>(fn: () => T): T
function mutate(fn: () => void): void
```

Notes:
- `schedule()` groups work into the next animation frame.
- `scheduleMicrotask()` runs before the next frame.
- `queueInBatch()` is mainly for internal coalescing; most apps only need `batch()`.
- `timeSlice()` lets long loops cooperatively yield to keep UI/event loop responsive.

## batch

```ts
import { batch, signal } from "dalila";

const count = signal(0);
const theme = signal("light");

batch(() => {
  count.set(1);
  theme.set("dark");
  // Effects are deferred until the batch ends.
});
```

## measure / mutate

```ts
import { measure, mutate } from "dalila";

const width = measure(() => element.offsetWidth);
mutate(() => {
  element.style.width = `${width + 10}px`;
});
```

Behavior:
- `measure()` is currently a no-op wrapper (documents intent for reads).
- `mutate()` schedules the write in a microtask to avoid interleaving with sync reads.

## timeSlice

Use `timeSlice` for heavy loops that should periodically yield.

```ts
import { timeSlice } from "dalila";

await timeSlice(async (ctx) => {
  while (hasMoreItems()) {
    processNextItem();
    if (ctx.shouldYield()) await ctx.yield();
  }
}, { budgetMs: 8 });
```

Options:
- `budgetMs` (default `8`): max time budget per cooperative slice.
- `signal`: optional `AbortSignal` to cancel in-progress work.

Cancellation:

```ts
const controller = new AbortController();

const job = timeSlice(async (ctx) => {
  while (hasMoreItems()) {
    processNextItem();
    if (ctx.shouldYield()) await ctx.yield();
  }
}, { signal: controller.signal });

controller.abort();
await job; // rejects with AbortError
```

Validation:
- `budgetMs` must be a finite non-negative number.

## Comparison: Direct vs Batched Updates

| Approach | Pros | Cons |
|---------|------|------|
| Direct `set()` | Immediate updates | More effect churn |
| `batch()` | One effect wave per frame | Slightly delayed effects |

## Best Practices

- Use `batch()` for multiple related updates.
- Group DOM reads in `measure()` and writes in `mutate()` to avoid layout thrash.
- Avoid heavy work inside `scheduleMicrotask()` loops.

## Common Pitfalls

1) **Infinite microtask loops**

Scheduling work that always enqueues more work can hit iteration caps and drop tasks.

2) **Using `mutate()` for reads**

`mutate()` is intended for writes; mixing reads inside can cause layout thrashing.

## Performance Notes

- Microtasks drain up to `maxMicrotaskIterations` (default 1000).
- RAF tasks drain up to `maxRafIterations` (default 100).
- `batch()` flushes once per frame even if many signals update.
