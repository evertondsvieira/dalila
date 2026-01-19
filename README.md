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

Then open `http://localhost:3000/`.

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
```html
<p when={showTips}>This shows when true.</p>
<div match={status}>
  <span case="idle">Idle</span>
  <span case="active">Active</span>
</div>
```

> Note: `when`/`match` bindings are available only in the example dev-server today.
> They are not part of the core runtime yet.

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
// Batch multiple updates into single frame
batch(() => {
  count.set(1);
  theme.set('dark');
  // All updates happen in one frame
});

// DOM read/write discipline
const width = measure(() => element.offsetWidth);
mutate(() => {
  element.style.width = `${width + 10}px`;
});
```

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

### Resource Management
```typescript
// Declarative data fetching
const { data, loading, error, refresh } = createResource(
  async (signal) => {
    const res = await fetch('/api/data', { signal });
    return res.json();
  }
);

// Signals
effect(() => {
  console.log(data(), loading(), error());
});

// Cached resource
const cachedData = createCachedResource(
  'user-data',
  async (signal) => fetchUser(signal)
);

// Auto-refresh
const liveData = createAutoRefreshResource(
  fetchData,
  5000 // Refresh every 5 seconds
);
```

### Virtualization (experimental)
```typescript
// Virtual list
createVirtualList(
  items,
  50, // Item height
  (item) => div(item.name),
  { container: document.getElementById('list') }
);

// Virtual table
createVirtualTable(
  data,
  [
    { key: 'id', header: 'ID', width: '100px' },
    { key: 'name', header: 'Name', width: '200px' }
  ],
  (item, column) => div(item[column.key]),
  document.getElementById('table')
);

// Infinite scroll
const { items, loading, refresh } = createInfiniteScroll(
  (offset, limit) => fetchItems(offset, limit),
  (item) => div(item.name),
  document.getElementById('scroll-container')
);
```

### DevTools & Warnings (console-only)
```typescript
// Enable dev tools
initDevTools();

// Inspect signals
const { value, subscribers } = inspectSignal(count);

// Get active effects
const effects = getActiveEffects();

// Performance monitoring (automatic, console warnings)
monitorPerformance();
```

> There is no DevTools UI yet. The current tooling is lightweight console diagnostics.

### Cleanup Utilities
```typescript
// Event listener with auto-cleanup
useEvent(window, 'resize', handleResize);

// Interval with auto-cleanup
useInterval(() => {
  console.log('Tick');
}, 1000);

// Timeout with auto-cleanup
useTimeout(() => {
  console.log('Delayed');
}, 2000);

// Fetch with auto-cleanup
const { data, loading, error } = useFetch('/api/data');
```

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
