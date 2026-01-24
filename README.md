# Dalila Framework

**UI driven by the DOM, not re-renders.**

Dalila is a **SPA**, **DOM-first**, **HTML natural** framework based on **signals**, created to eliminate the common pitfalls and workarounds of React.

## ✨ Status

### Core (runtime, stable)
- 🚀 **Signals-based reactivity** - Automatic dependency tracking
- 🎯 **DOM-first rendering** - Direct DOM manipulation, no Virtual DOM
- 🔄 **Scope-based lifecycle** - Automatic cleanup (best effort)
- 🧿 **DOM lifecycle watchers** — `watch()` + helpers (`useEvent`, `useInterval`, `useTimeout`, `useFetch`) with scope-based cleanup
- 🛣️ **SPA router** - Basic routing with loaders and AbortSignal
- 📦 **Context system** - Reactive dependency injection
- 🔧 **Scheduler & batching** - Group updates into a single frame
- 📚 **List rendering** - `createList` with keyed diffing for efficient updates
- 🧱 **Resources** - Async data helpers with AbortSignal and scope cleanup

### Experimental
- 🎨 **Natural HTML bindings** - Only in the example dev-server (not in core)
- 🔍 **DevTools (console)** - Warnings and FPS monitor only
- 🧪 **Low-level list API** - `forEach` (advanced control, use when you need fine-grained behavior like reactive index; `createList` is the default)

### Planned / Roadmap
- 🧰 **DevTools UI** - Visual inspection tooling
- 🧩 **HTML bindings runtime/compiler** - First-class template binding
- 📊 **Virtualization** - Virtual lists/tables for very large datasets (10k+ items)

## 📦 Installation

```bash
npm install dalila
```

## 🚀 Quick Start

Dalila examples use HTML bindings and a controller:

```html
<div>
  <span>{count}</span>
  <button on:click={increment}>+</button>
</div>
```

```ts
import { signal } from 'dalila';

export function createController() {
  const count = signal(0);
  const increment = () => count.update(c => c + 1);

  return { count, increment };
}
```

> Note: HTML bindings in this example are provided by the example dev-server (`npm run serve`),
> not by the core runtime.

## 🧪 Local Demo Server

Run a local server with HMR from the repo root:

```bash
npm run serve
```

Then open `http://localhost:4242/`.

## 📚 Core Concepts

### Signals
```typescript
const count = signal(0);

// Read value
console.log(count()); // 0

// Set value
count.set(5);

// Update with function
count.update(c => c + 1);

// Reactive effects
effect(() => {
  console.log(`Count changed to: ${count()}`);
});

// Async effects with cleanup
effectAsync(async (signal) => {
  const response = await fetch('/api/data', { signal });
  const data = await response.json();
  console.log(data);
});
```

### Lifecycle / Cleanup (Scopes + DOM)

Dalila is DOM-first. That means a lot of your "lifecycle" work is not React-like rendering —
it's **attaching listeners, timers, and async work to real DOM nodes**.

Dalila's rule is simple:

- **Inside a scope** → cleanup is automatic (best-effort) on `scope.dispose()`
- **Outside a scope** → you must call `dispose()` manually unless a primitive explicitly auto-disposes on DOM removal (Dalila warns in dev mode)

#### `watch(node, fn)` — DOM lifecycle primitive

`watch()` runs a reactive function while a DOM node is connected.
When the node disconnects, the effect is disposed. If the node reconnects later, it starts again.
It's the primitive that enables DOM lifecycle without a VDOM.

```ts
import { watch, signal } from "dalila";

const count = signal(0);

const dispose = watch(someNode, () => {
  // Reactive while connected because watch() runs this inside an effect()
  someNode.textContent = String(count());
});

// later (optional if inside a scope)
dispose();
```

#### Lifecycle helpers

Built on the same mental model, Dalila provides small helpers that always return an **idempotent** `dispose()`:
`useEvent`, `useInterval`, `useTimeout`, `useFetch`.

**Inside a scope (recommended)**

```ts
import { createScope, withScope, useEvent, useInterval, useFetch } from "dalila";

const scope = createScope();

withScope(scope, () => {
  useEvent(button, "click", onClick);
  useInterval(tick, 1000);

  const user = useFetch("/api/user");

  // Optional manual cleanup:
  // user.dispose();
});

scope.dispose(); // stops listener, interval, and aborts fetch
```

Disposing the scope stops listeners/timers and aborts in-flight async work created inside the scope.

**Outside a scope (manual cleanup)**

```ts
import { useInterval } from "dalila";

const dispose = useInterval(() => console.log("tick"), 1000);

// later...
dispose(); // required
```

#### Why helpers vs native APIs?

You *can* use `addEventListener` / `setTimeout` / `setInterval` directly, but then cleanup becomes "manual discipline".
In a DOM-first app, listeners/timers are the #1 source of silent leaks when the UI changes.
Scopes make cleanup a **default**, not a convention — so UI changes don't silently leak listeners, timers, or in-flight async work.

### Conditional Rendering

Dalila provides two primitives for branching UI:

- **`when`** — boolean conditions (`if / else`)
- **`match`** — value-based branching (`switch / cases`)

They are intentionally separate to keep UI logic explicit and predictable.

#### `when` — boolean conditions

Use `when` when your UI depends on a true/false condition.

```ts
when(
  () => isVisible(),
  () => VisibleView(),
  () => HiddenView()
);
```

HTML binding example:

```html
<div>
  <button on:click={toggle}>Toggle</button>

  <p when={show}>🐒 Visible branch</p>
  <p when={!show}>🙈 Hidden branch</p>
</div>
```

- Tracks signals used inside the condition
- Optional else branch runs when the condition is false
- Each branch has its own lifecycle (scope cleanup)

#### `match` — value-based branching

Use `match` when your UI depends on a state or key, not just true/false.

```ts
match(
  () => status(),
  {
    loading: Loading,
    error: Error,
    success: Success,
    _: Idle
  }
);
```

HTML binding example:

```html
<div match={status}>
  <p case="idle">🟦 Idle</p>
  <p case="loading">⏳ Loading...</p>
  <p case="success">✅ Success!</p>
  <p case="error">❌ Error</p>
  <p case="_">🤷 Unknown</p>
</div>
```

- Each case maps a value to a render function
- `_` is the default (fallback) case
- Swaps cases only when the selected key changes
- Each case has its own lifecycle (scope cleanup)

#### Rule of thumb

- `when` → booleans → optional else
- `match` → values/keys → `_` as fallback

These primitives are not abstractions over JSX.
They are explicit DOM control tools, designed to make branching visible and predictable.

### Context (Dependency Injection)
```ts
const Theme = createContext<'light' | 'dark'>('theme');
provide(Theme, signal('light'));
const theme = inject(Theme);
```

### SPA Router
```typescript
const router = createRouter({
  routes: [
    {
      path: '/',
      view: HomePage,
      loader: async ({ signal }) => {
        const res = await fetch('/api/home', { signal });
        return res.json();
      }
    },
    { path: '/users/:id', view: UserPage }
  ]
});

router.mount(document.getElementById('app'));
```

### Batching & Scheduling
```typescript
// Batch multiple updates - effects coalesce into a single frame
batch(() => {
  count.set(1);      // ✅ State updates immediately
  theme.set('dark'); // ✅ State updates immediately
  console.log(count()); // Reads new value: 1

  // Effects are deferred and run once at the end of the batch
});

// DOM read/write discipline
const width = measure(() => element.offsetWidth);
mutate(() => {
  element.style.width = `${width + 10}px`;
});
```

**Batching semantics:**
- `signal.set()` updates the value **immediately** (synchronous)
- Effects are **deferred** until the batch completes
- All deferred effects run once in a single animation frame
- This allows reading updated values inside the batch while coalescing UI updates

### List Rendering with Keys

Dalila provides efficient list rendering with keyed diffing, similar to React's `key` prop or Vue's `:key`.

**Basic usage:**
```typescript
import { signal } from 'dalila';
import { createList } from 'dalila/core';

const todos = signal([
  { id: 1, text: 'Learn Dalila', done: true },
  { id: 2, text: 'Build app', done: false }
]);

const listFragment = createList(
  () => todos(),
  (todo) => {
    const li = document.createElement('li');
    li.textContent = todo.text;
    return li;
  },
  (todo) => todo.id.toString() // Key function
);

document.body.append(listFragment);
```

**Key function best practices:**
- ✅ Always provide a keyFn for dynamic lists
- ✅ Use stable, unique identifiers (IDs, not indices)
- ✅ Avoid using object references as keys
- ⚠️ Without keyFn, items use index as key (re-renders on reorder)

**How it works:**
- Only re-renders items whose value changed (not items that only moved)
- Preserves DOM nodes for unchanged items (maintains focus, scroll, etc)
- Efficient for lists up to ~1000 items (informal guideline, not yet benchmarked)
- Each item gets its own scope for automatic cleanup
- Outside a scope, the list auto-disposes when removed from the DOM (or call `fragment.dispose()`)
> **Note:** In `createList`, `index` is a snapshot (not reactive). Reorder moves nodes without re-render. Use `forEach()` if you need a reactive index.

**Performance:**
```typescript
// Bad: re-creates all items on every change
effect(() => {
  container.innerHTML = '';
  todos().forEach(todo => {
    container.append(createTodoItem(todo));
  });
});

// Good: only updates changed items
const list = createList(
  () => todos(),
  (todo) => createTodoItem(todo),
  (todo) => todo.id.toString()
);
```

### Data Fetching & Server State

> **Scope rule (important):**
> - `q.query()` / `createCachedResource()` cache **only within a scope**.
> - Outside scope, **no cache** (safer).
> - For explicit global cache, use `q.queryGlobal()` or `createCachedResource(..., { persist: true })`.

Dalila treats async data as **state**, not as lifecycle effects.

Instead of hooks or lifecycle-driven fetching, Dalila provides resources that:

- Are driven by signals
- Are abortable by default
- Clean themselves up with scopes
- Can be cached, invalidated, and revalidated declaratively

There are three layers, from low-level to DX-focused:

- `createResource` — primitive (no cache)
- `createCachedResource` — shared cache + invalidation
- `QueryClient` — ergonomic DX (queries + mutations)

You can stop at any layer.

#### 🧱 createResource — the primitive

Use `createResource` when you want a single async source tied to reactive dependencies.

```ts
const user = createResource(async (signal) => {
  const res = await fetch(`/api/user/${id()}`, { signal });
  return res.json();
});
```

**Behavior**

- Runs inside effectAsync
- Tracks any signal reads inside the fetch
- Aborts the previous request on re-run
- Aborts automatically on scope disposal
- Exposes reactive state

```ts
user.data();     // T | null
user.loading();  // boolean
user.error();    // Error | null
```

**Manual revalidation:**

```ts
user.refresh();          // deduped
user.refresh({ force }); // abort + refetch
```

**When to use**

- Local data
- One-off fetches
- Non-shared state
- Full control

If you want sharing, cache, or invalidation, go up one level.

#### 🗄️ Cached Resources

> **Scoped cache (recommended):**
```ts
withScope(createScope(), () => {
  const user = createCachedResource("user:42", fetchUser, { tags: ["users"] });
});
```

> **Global cache (explicit):**
```ts
const user = createCachedResource("user:42", fetchUser, { tags: ["users"], persist: true });
```

Dalila can cache resources by key, without introducing a global singleton or context provider.

```ts
const user = createCachedResource(
  "user:42",
  async (signal) => fetchUser(signal, 42),
  { tags: ["users"] }
);
```

**What caching means in Dalila**

- One fetch per key (deduped)
- Shared across scopes (when using `persist: true`)
- Automatically revalidated on invalidation
- Still abortable and scope-safe

**Invalidation by tag**
```ts
invalidateResourceTag("users");
```

All cached resources registered with "users" will:
- Be marked stale
- Revalidate in place (best-effort)

This is the foundation used by the query layer.

#### 🧠 Query Client (DX Layer)

The QueryClient builds a React Query–like experience, but stays signal-driven and scope-safe.

```ts
const q = createQueryClient();

// Scoped query (recommended)
const user = q.query({
  key: () => q.key("user", userId()),
  tags: ["users"],
  fetch: (signal, key) => apiGetUser(signal, key[1]),
  staleTime: 10_000,
});

// Global query (explicit)
const user = q.queryGlobal({
  key: () => q.key("user", userId()),
  tags: ["users"],
  fetch: (signal, key) => apiGetUser(signal, key[1]),
  staleTime: 10_000,
});
```

**What this gives you**

- Reactive key
- Automatic caching by encoded key
- Abort on key change
- Deduped requests
- Tag-based invalidation
- Optional stale revalidation
- No providers, no hooks

```ts
user.data();
user.loading();
user.error();
user.status();   // "loading" | "error" | "success"
user.refresh();
```

#### 🔑 Query Keys

Keys are data identity, not fetch parameters.

```ts
q.key("user", userId());
```

- Typed
- Stable
- Readonly
- Encoded safely (no JSON.stringify)
- If the key changes, the query refetches.

#### 🔁 Stale Revalidation (staleTime)

Dalila’s staleTime is intentionally simpler than React Query.

```ts
staleTime: 10_000
```

**Meaning:**

- After a successful fetch
- Schedule a best-effort revalidate
- Cleared automatically on scope disposal

This avoids background timers leaking or running after unmount.

#### ✍️ Mutations

Mutations represent intentional writes.

They:
- Are abortable
- Deduplicate concurrent runs
- Store last successful result
- Invalidate queries declaratively

```ts
const saveUser = q.mutation({
  mutate: (signal, input) => apiSaveUser(signal, input),
  invalidateTags: ["users"],
});
```

**Running a mutation**
```ts
await saveUser.run({ name: "Everton" });
```

**Reactive state:**
```ts
saveUser.data();    // last success
saveUser.loading();
saveUser.error();
```

**Deduplication & force**
```ts
saveUser.run(input);              // deduped
saveUser.run(input, { force });   // abort + restart
```

**Invalidation**

On success, mutations can invalidate:
- Tags → revalidate all matching queries
- Keys → revalidate a specific query

This keeps writes explicit and reads declarative.

#### 🧭 Mental Model

Think in layers:

| Layer | Purpose |
|-------|---------|
| createResource | Async signal |
| Cached resource | Shared async state |
| Query | Read model |
| Mutation | Write model |

Dalila does not blur these layers.

#### ✅ Rule of Thumb

- Local async state → `createResource`
- Shared server data → `query()`
- Global cache → `queryGlobal()` / `persist: true`
- Writes / side effects → `mutation`
- UI branching → `when` / `match`

Queries and mutations are just signals.
They compose naturally with `when`, `match`, lists, and effects.

#### 🧠 Philosophy

Dalila’s data layer is designed to be:

- Predictable
- Abortable
- Scope-safe
- Explicit
- Boring in the right way

No magic lifecycles.
No hidden background work.
No provider pyramids.

## 🏗️ Architecture

Dalila is built around these core principles:

- **No JSX** - Core runtime doesn't require JSX
- **No Virtual DOM** - Direct DOM manipulation
- **No manual memoization** - Signals reduce manual memoization (goal)
- **Scope-based cleanup** - Automatic resource management (best-effort)
- **Signal-driven reactivity** - Localized updates where possible

## 📊 Performance

- **Localized updates**: Signals update only subscribed DOM nodes (goal)
- **Automatic cleanup**: Scope-based cleanup is best-effort
- **Bundle size**: Not yet measured/verified

## 🤔 Why Dalila vs React?

| Feature | React | Dalila |
|---------|-------|--------|
| Rendering | Virtual DOM diffing | Direct DOM manipulation |
| Performance | Manual optimization | Runtime scheduling (best-effort) |
| State management | Hooks + deps arrays | Signals + automatic tracking |
| Side effects | `useEffect` + deps | `effect()` + automatic cleanup (best-effort) |
| Bundle size | ~40KB | Not yet measured |

## 📁 Project Structure

```
dalila/
├── src/
│   ├── core/          # Signals, effects, scopes
│   ├── context/       # Dependency injection
│   ├── router/        # SPA routing
│   ├── dom/           # DOM utilities
│   └── index.ts       # Main exports
├── examples/          # Example applications
└── dist/              # Compiled output
```

## 🛠️ Development

```bash
# Install dependencies
npm install

# Build the framework
npm run build

# Development mode
npm run dev
```

## 📖 Examples

Check out the `examples/` directory for:
- Counter app

## 🤝 Contributing

Contributions welcome! Focus on:
- Maintaining core principles (no JSX, no VDOM, no manual optimization)
- Adding features that reduce boilerplate
- Improving performance without complexity
- Enhancing developer experience

## 📄 License

MIT

---

**Build UI, not workarounds.**
