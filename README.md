# Dalila Framework

**UI driven by the DOM, not re-renders.**

Dalila is a **SPA**, **DOM-first**, **HTML natural** framework based on **signals**, created to eliminate the common pitfalls and workarounds of React.

## ✨ Status

### Core (runtime, stable)
- 🚀 **Signals-based reactivity** - Automatic dependency tracking
- 🎯 **DOM-first rendering** - Direct DOM manipulation, no Virtual DOM
- 🔄 **Scope-based lifecycle** - Automatic cleanup (best effort)
- 🛣️ **SPA router** - Basic routing with loaders and AbortSignal
- 📦 **Context system** - Reactive dependency injection
- 🔧 **Scheduler & batching** - Group updates into a single frame
- 📚 **List rendering** - `createList` for keyed lists
- 🧱 **Resources** - Async data helpers with AbortSignal and scope cleanup

### Experimental
- 🎨 **Natural HTML bindings** - Only in the example dev-server (not in core)
- 📊 **Virtualization** - Virtual lists/tables are experimental
- 🔍 **DevTools (console)** - Warnings and FPS monitor only
- 🧪 **Low-level list API** - `forEach` (experimental, prefer `createList`)

### Planned / Roadmap
- 🧰 **DevTools UI** - Visual inspection tooling
- 🧩 **HTML bindings runtime/compiler** - First-class template binding

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

> Note: HTML bindings in this example are provided by the example dev-server,
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
```typescript
// Primary API (stable)
createList(
  todos,
  (todo) => div(todo.text)
);

// Experimental low-level API
forEach(
  items,
  (item) => div(item.name),
  (item) => item.id // Key function
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
| Side effects | `useEffect` + deps | `effect()` + automatic cleanup |
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
