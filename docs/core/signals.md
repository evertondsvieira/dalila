# Signals

Signals are the foundation of Dalila's reactivity system. They hold values that automatically notify subscribers when changed.

## Quick Reference: signal() vs signal

```ts
const count = signal(0);  // Create a signal

count();      // READ the value - call like a function!
count.set(5); // WRITE - use .set() method
```

**Why call `count()` instead of just `count`?**
- Calling `count()` tells Dalila "I'm reading this value, track me as a dependency"
- This is how Dalila knows which effects to re-run when the value changes

## Understanding Lazy Computed

One of the most powerful (and confusing) features: **computed is lazy**.

```ts
const count = signal(0);
const doubled = computed(() => {
  console.log("Computing doubled...");
  return count() * 2;
});

console.log("Before reading doubled");
// ❌ "Computing doubled..." is NOT logged yet!

console.log(doubled());  
// ✅ NOW it computes - "Computing doubled..." is logged

console.log(doubled());  
// ✅ Cached! No computation, returns 2 immediately

count.set(5);
// ✅ Computed is dirty, next read recomputes
console.log(doubled());  
// Logs: "Computing doubled..." → returns 10
```

**Why is lazy good?**
- If you create 10 computed values but only read 3, only 3 compute
- Computations are deferred until actually needed
- Results are cached until dependencies change

## signal vs computed vs effect

| What | When it runs | Returns |
|------|--------------|---------|
| `signal` | Stores a value | The value |
| `computed` | Only when read (lazy) | Derived value |
| `effect` | On every dependency change | Nothing (side effects) |

```ts
// signal - just stores and returns a value
const age = signal(25);
age();        // → 25

// computed - derives from other signals, lazy
const birthYear = computed(() => 2024 - age());
birthYear();  // → 1999 (computes NOW, caches)

// effect - runs automatically when dependencies change
effect(() => {
  console.log("Age changed to:", age());
});
age.set(30);  // → logs "Age changed to: 30"
```

## Core Concepts

```
┌─────────────────────────────────────────────────────────────┐
│                     Reactive Graph                          │
│                                                             │
│   signal(A) ───┐                                            │
│                ├──► computed(C) ───► effect(render)         │
│   signal(B) ───┘                                            │
│                                                             │
│   When A or B changes → C recomputes → effect re-runs       │
└─────────────────────────────────────────────────────────────┘
```

**Three primitives:**
1. **`signal`** — Writable reactive value
2. **`computed`** — Derived value (read-only, lazy)
3. **`effect`** — Side effect that re-runs on dependency changes
4. **`readonly`** — Read-only contract for an existing signal
5. **`debounceSignal` / `throttleSignal`** — Time-based derived signals
6. **`batch` / `untrack`** — Performance and dependency-control fundamentals

## API Reference

### signal

```ts
function signal<T>(initialValue: T): Signal<T>

interface Signal<T> {
  (): T;                              // Read (tracks dependency)
  set(value: T): void;                // Write
  update(fn: (prev: T) => T): void;   // Update from previous
  peek(): T;                          // Read without tracking
  on(cb: (value: T) => void): () => void;  // Manual subscription
}
```

### effect

```ts
function effect(fn: () => void): () => void  // Returns dispose function
```

### computed

```ts
function computed<T>(fn: () => T): ComputedSignal<T>
```

### readonly

```ts
function readonly<T>(source: Signal<T>): ReadonlySignal<T>
```

### effectAsync

```ts
function effectAsync(fn: (signal: AbortSignal) => void | Promise<void>): () => void
```

### debounceSignal

```ts
function debounceSignal<T>(
  source: ReadonlySignal<T>,
  waitMs: number,
  options?: { leading?: boolean; trailing?: boolean }
): ReadonlySignal<T>
```

Defaults: `leading = false`, `trailing = true`.

### throttleSignal

```ts
function throttleSignal<T>(
  source: ReadonlySignal<T>,
  waitMs: number,
  options?: { leading?: boolean; trailing?: boolean }
): ReadonlySignal<T>
```

Defaults: `leading = true`, `trailing = true`.

### Convenience aliases

```ts
debounce(s, ms)  // alias of debounceSignal(s, ms)
throttle(s, ms)  // alias of throttleSignal(s, ms)
```

### untrack

```ts
function untrack<T>(fn: () => T): T  // Read without creating dependency
```

### batch (scheduler)

```ts
function batch<T>(fn: () => T): T
```

Use `batch()` when applying multiple signal writes that should notify dependents once.

```ts
batch(() => {
  firstName.set('Ada');
  lastName.set('Lovelace');
});
```

### Error handling

```ts
function setEffectErrorHandler(handler: (error: Error, source: string) => void): void
```

## Basic Usage

```ts
import { signal, effect } from "dalila";

// Create a signal
const count = signal(0);

// Read the value
console.log(count());  // 0

// Write a new value
count.set(1);

// Update based on previous value
count.update(n => n + 1);  // Now 2

// Create an effect that tracks dependencies
const dispose = effect(() => {
  console.log("Count is:", count());
});
// Logs: "Count is: 2"

count.set(5);
// Logs: "Count is: 5" (effect re-runs automatically)

// Cleanup
dispose();
count.set(10);  // No log (effect disposed)
```

## Computed Values

Computed signals derive values from other signals. They are:
- **Lazy**: Only compute when read
- **Cached**: Recompute only when dependencies change
- **Read-only**: Cannot call `.set()` on them

```ts
import { signal, computed, effect } from "dalila";

const firstName = signal("John");
const lastName = signal("Doe");

// Computed derives from both signals
const fullName = computed(() => `${firstName()} ${lastName()}`);

// Reading is lazy - computation happens here
console.log(fullName());  // "John Doe"

// Effect subscribes to computed (and transitively to its deps)
effect(() => {
  document.title = fullName();
});

firstName.set("Jane");
// fullName recomputes → "Jane Doe"
// Effect re-runs → document.title updated
```

## Read-only Signal Contracts

Use `readonly` when you need to expose a signal to consumers without allowing writes.

```ts
import { signal, readonly } from "dalila";

const count = signal(0);
const countRO = readonly(count);

countRO();       // read
countRO.peek();  // untracked read

// countRO.set(1) and countRO.update(...) are not part of the public type
// Runtime also throws if mutation is attempted via casts.
```

When to use `readonly`:
- Expose store state publicly but keep mutation private.
- Avoid accidental writes from components/consumers.
- Enforce updates through explicit actions (`increment`, `reset`, etc.).

Practical pattern:

```ts
function createCounterStore() {
  const count = signal(0);
  return {
    count: readonly(count),
    increment: () => count.update((v) => v + 1),
    reset: () => count.set(0)
  };
}
```

## Time-based Signal Utilities

Use these helpers to reduce update frequency in noisy streams (search input, scroll, resize).

```ts
import { signal, debounceSignal, throttleSignal, effect } from "dalila";

const query = signal("");
const scrollY = signal(0);

const debouncedQuery = debounceSignal(query, 250);   // trailing by default
const throttledScroll = throttleSignal(scrollY, 16); // leading + trailing by default

effect(() => {
  console.log("Search after pause:", debouncedQuery());
});

effect(() => {
  console.log("Scroll sample:", throttledScroll());
});
```

Option examples:

```ts
// Emit immediately, and also emit the latest value after the burst.
const debouncedLeading = debounceSignal(query, 250, { leading: true, trailing: true });

// Trailing-only throttle (no immediate value at the start of the window).
const trailingThrottle = throttleSignal(scrollY, 50, { leading: false, trailing: true });
```

When to use `debounceSignal`:
- Text search/filter inputs.
- Autosave after user pause.
- Expensive validation while typing.

When to use `throttleSignal`:
- Scroll position tracking.
- Resize/mousemove listeners.
- Animation-like updates that should be capped per frame/window.

### Computed vs Effect: When to Use Which?

| Use `computed` when... | Use `effect` when... |
|------------------------|----------------------|
| Deriving a value from other signals | Performing side effects (DOM, logs, API) |
| Value will be read multiple times | Running imperative code on changes |
| You need a cacheable, lazy result | You don't need a return value |

```ts
// GOOD: computed for derived values
const total = computed(() => items().reduce((sum, i) => sum + i.price, 0));

// GOOD: effect for DOM updates
effect(() => {
  priceElement.textContent = `$${total()}`;
});

// BAD: effect returning a value (use computed instead)
let total;
effect(() => {
  total = items().reduce((sum, i) => sum + i.price, 0);
});
```

## Async Effects

`effectAsync` is for effects that need to perform async work. It provides an `AbortSignal` that aborts when:
- The effect re-runs (dependencies changed)
- The effect is disposed

```ts
import { signal, effectAsync } from "dalila";

const userId = signal("1");

effectAsync(async (signal) => {
  // Pass signal to fetch for automatic cancellation
  const res = await fetch(`/api/user/${userId()}`, { signal });
  const data = await res.json();

  // Only runs if not aborted
  console.log("User:", data);
});

// Changing userId aborts the previous fetch
userId.set("2");  // Previous request cancelled, new request starts
```

### effectAsync vs effect: When to Use Which?

```ts
// Use effect for sync work
effect(() => {
  element.textContent = count();
});

// Use effectAsync for async work
effectAsync(async (signal) => {
  const data = await fetchData(signal);
  element.textContent = data.name;
});

// AVOID: async in regular effect (no abort handling)
effect(async () => {  // BAD
  const data = await fetchData();
  element.textContent = data.name;  // May update after disposal!
});
```

## Reading Without Tracking: untrack and peek

Sometimes you need to read a signal without creating a dependency.

### Using `untrack`

```ts
import { signal, effect, untrack } from "dalila";

const count = signal(0);
const multiplier = signal(2);

effect(() => {
  // count() is tracked - effect re-runs when count changes
  // multiplier via untrack is NOT tracked
  const result = count() * untrack(() => multiplier());
  console.log(result);
});

count.set(5);       // Effect runs (count is dependency)
multiplier.set(3);  // Effect does NOT run (multiplier not tracked)
```

### Using `peek`

```ts
const count = signal(0);

effect(() => {
  // Same as untrack(() => count())
  console.log(count.peek());
});
```

### When to Use untrack/peek

```ts
// GOOD: Reading config that shouldn't trigger re-runs
effect(() => {
  const items = data();  // Track data changes
  const limit = untrack(() => config().pageSize);  // Don't track config
  renderItems(items.slice(0, limit));
});

// GOOD: Logging without creating dependency
effect(() => {
  console.log("Debug:", count.peek());  // Log doesn't cause re-run
  doSomethingWith(count());  // This is the real dependency
});

// GOOD: Comparing old and new values
let prev = count.peek();
effect(() => {
  const curr = count();
  if (curr !== prev) {
    console.log(`Changed from ${prev} to ${curr}`);
    prev = curr;
  }
});
```

## Manual Subscriptions with `on`

For cases where you need imperative subscription (outside effects):

```ts
const count = signal(0);

const unsubscribe = count.on((value) => {
  console.log("Count changed to:", value);
});

count.set(1);  // Logs: "Count changed to: 1"

unsubscribe();
count.set(2);  // No log
```

**Prefer `effect` over `on`** — Effects integrate with scopes for automatic cleanup.

## Best Practices

### 1. Keep signals granular

```ts
// GOOD: Separate signals for separate concerns
const firstName = signal("John");
const lastName = signal("Doe");
const age = signal(30);

// BAD: One big object signal
const user = signal({ firstName: "John", lastName: "Doe", age: 30 });
// Any change replaces the whole object, triggering ALL subscribers
```

### 2. Use computed for derived state

```ts
// GOOD: Derived state as computed
const items = signal([...]);
const total = computed(() => items().reduce((s, i) => s + i.price, 0));
const count = computed(() => items().length);

// BAD: Duplicating derived state in separate signals
const items = signal([...]);
const total = signal(0);
const count = signal(0);

effect(() => {
  total.set(items().reduce((s, i) => s + i.price, 0));
  count.set(items().length);
});
```

### 3. Avoid setting signals inside effects that read them

```ts
// BAD: Infinite loop risk
effect(() => {
  count.set(count() + 1);  // Reads and writes same signal!
});

// GOOD: Use update for self-referential changes (outside effects)
button.onclick = () => count.update(n => n + 1);

// GOOD: If you must derive, use computed
const doubled = computed(() => count() * 2);
```

### 4. Dispose effects when done

```ts
// Always capture the dispose function
const dispose = effect(() => { /* ... */ });

// Clean up when appropriate
dispose();

// Or better: use scopes (see scope.md)
```

## Common Pitfalls

### Pitfall 1: Stale closures in async code

```ts
// WRONG: count() captured at effect creation time
effect(() => {
  setTimeout(() => {
    console.log(count());  // May be stale!
  }, 1000);
});

// RIGHT: Read inside the timeout OR use effectAsync
effectAsync(async (signal) => {
  await delay(1000);
  if (!signal.aborted) {
    console.log(count());  // Fresh read
  }
});
```

### Pitfall 2: Conditional dependencies

```ts
// Dependencies are dynamic - this is fine but be aware
effect(() => {
  if (showDetails()) {
    console.log(details());  // Only tracked when showDetails is true
  }
});

showDetails.set(false);
details.set("new");  // Effect does NOT run (details not tracked currently)
showDetails.set(true);  // Effect runs, now sees "new"
```

### Pitfall 3: Object/array identity

```ts
const items = signal([1, 2, 3]);

// This creates a NEW array, so signal notifies subscribers
items.set([...items(), 4]);

// For efficiency, modify in place with update
items.update(arr => {
  arr.push(4);
  return arr;  // Same reference, but signal still notifies
});

// Note: Dalila uses Object.is() for comparison
// Two different arrays with same contents are NOT equal
```

### Pitfall 4: Forgetting that computed is lazy

```ts
const expensive = computed(() => {
  console.log("Computing...");
  return heavyCalculation();
});

// "Computing..." is NOT logged yet

effect(() => {
  // Now it computes (and logs)
  console.log(expensive());
});

// If nothing reads expensive(), it never computes
```

## Error Handling

Effects can throw errors. Use `setEffectErrorHandler` to catch them:

```ts
import { setEffectErrorHandler, signal, effect } from "dalila";

setEffectErrorHandler((error, source) => {
  // source is "effect" or "computed"
  reportError({ error, source });
});

const data = signal<Data | null>(null);

effect(() => {
  // If data is null, this throws
  console.log(data()!.name);
});

data.set(null);  // Error caught by handler instead of crashing
```

## Performance Notes

1. **Signal reads are O(1)** — Just reading a value, no overhead
2. **Effect subscription is O(1)** — Adding to a Set
3. **Signal writes are O(n)** — n = number of subscribers (batched in microtask)
4. **Computed reads are O(1) when cached** — Only recomputes when dirty
5. **Effect scheduling is flag-based per effect** — avoids global pending sets in the hot path
6. **Dependency subscription logic is centralized** — shared by signal and computed reads for lower runtime overhead and consistent behavior

```ts
// For many rapid updates, use batch (see scheduler.md)
import { batch } from "dalila";

batch(() => {
  a.set(1);
  b.set(2);
  c.set(3);
  // Effects run once after batch, not three times
});
```

## Debugging Tips

```ts
// Name your signals for debugging
const count = signal(0);
// In DevTools, signals show their current value

// Add logging effects during development
effect(() => {
  console.log("State:", { count: count(), name: name() });
});

// Use peek to inspect without affecting behavior
console.log("Current count:", count.peek());
```
