# Dalila

A DOM-first reactive framework built on signals. No virtual DOM, no JSX transpilation—just direct DOM manipulation driven by fine-grained reactivity.

## Philosophy

Dalila inverts the typical framework model:

| Traditional Frameworks | Dalila |
|----------------------|--------|
| UI = f(state) → re-render everything | Signals → update specific DOM nodes |
| Virtual DOM diffing | Direct DOM manipulation |
| Component tree re-execution | Effects run only when dependencies change |
| Manual cleanup or GC reliance | Scope-based automatic cleanup |

**Core principles:**

1. **Signals are the source of truth** — All reactive state lives in signals
2. **Effects do the work** — Effects subscribe to signals and update the DOM
3. **Scopes manage lifecycle** — Resources are tied to scopes, not component instances
4. **No magic** — You write JavaScript/TypeScript, not a DSL

## Quick Start

```ts
import { signal, effect, createScope, withScope } from "dalila";

// Create a scope for lifecycle management
const app = createScope();

withScope(app, () => {
  // Create reactive state
  const count = signal(0);

  // Create DOM
  const button = document.createElement("button");
  document.body.append(button);

  // Effect updates DOM when count changes
  effect(() => {
    button.textContent = `Clicked ${count()} times`;
  });

  // Event handler updates state
  button.addEventListener("click", () => {
    count.update(n => n + 1);
  });
});

// Later: cleanup everything
// app.dispose();
```

## Installation

```bash
npm install dalila
```

## Documentation

### Phase 1 — Fundamentals

1. [Signals](./core/signals.md) — Reactive primitives (`signal`, `computed`, `effect`)
2. [Scopes](./core/scope.md) — Lifecycle management and cleanup
3. [Template Binding](./runtime/bind.md) — `bind()`, `mount()`, directives and transitions

### Phase 2 — Building UI

4. [Template Spec](./template-spec.md) — Binding syntax and directive model
5. [when](./core/when.md) — Boolean conditional rendering
6. [match](./core/match.md) — Value-based conditional rendering (switch-style)
7. [for](./core/for.md) — List rendering with keyed diffing
8. [Components](./runtime/component.md) — `defineComponent`, props/emits/refs/slots

### Phase 3 — Data and State

9. [Resources](./core/resource.md) — Async state with loading/error
10. [Forms](./forms.md) — DOM-first form management and validation
11. [Persist](./core/persist.md) — Storage sync for signals

### Phase 4 — Advanced Data

12. [Query](./core/query.md) — Cached queries
13. [Mutations](./core/mutation.md) — Write operations
14. [Keys](./core/key.md) — Cache key encoding

### Phase 5 — Routing

15. [Router](./router.md) — Client-side routing and route generation

### Phase 6 — Advanced Runtime

16. [Lazy Loading](./runtime/lazy.md) — `createLazyComponent`, `d-lazy`, `createSuspense`
17. [Error Boundary](./runtime/boundary.md) — `createErrorBoundary`, `withErrorBoundary`, `d-boundary`
18. [Context](./context.md) — Dependency injection and lookup rules
19. [Virtual Lists](./core/virtual.md) — Windowed rendering for large datasets
20. [FOUC Prevention](./runtime/fouc-prevention.md) — Loading token behavior

### Tooling and Ecosystem

21. [Scheduler](./core/scheduler.md) — Batching and read/write coordination
22. [Dev Mode](./core/dev.md) — Development helpers and warnings
23. [HTTP](./http.md) — Fetch client, interceptors and XSRF helpers
24. [UI Components](./ui.md) — Built-in UI component library
25. [Template Check CLI](./cli/check.md) — `dalila check` static analysis
26. [Devtools Extension](../devtools-extension/README.md) — Inspect signals/effects/scopes

## Comparison with Other Frameworks

### vs React

```jsx
// React: component re-executes on every state change
function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}

// Dalila: effect runs only when count changes
const count = signal(0);
const button = document.createElement("button");
effect(() => {
  button.textContent = String(count());
});
button.onclick = () => count.update(c => c + 1);
```

**Key differences:**
- No virtual DOM diffing overhead
- No component function re-execution
- Explicit dependency tracking (no dependency arrays)

### vs Solid.js

Dalila and Solid share the signals model. Key differences:
- Dalila has no JSX or compiler requirement
- Dalila uses explicit scopes instead of component boundaries
- Dalila integrates with existing DOM directly

### vs Vue/Svelte

- No template language or compiler
- Framework-agnostic (works with any DOM API)
- More explicit, less magic

## When to Use Dalila

**Good fit:**
- You want fine-grained reactivity without framework lock-in
- You're building a library that needs reactive state
- You want explicit control over DOM updates
- You're integrating with existing vanilla JS/TS codebases
- Performance-critical UIs with frequent updates

**Consider alternatives when:**
- You prefer component-based architecture with JSX
- Your team is familiar with React/Vue patterns
- You need a large ecosystem of pre-built components

## TypeScript Support

Dalila is written in TypeScript with full type inference:

```ts
const count = signal(0);        // Signal<number>
const name = signal("Alice");   // Signal<string>

const greeting = computed(() => `Hello, ${name()}!`); // Signal<string>

// Type error: Argument of type 'string' is not assignable
count.set("invalid");
```

## Bundle Size

Dalila is tree-shakeable. Import only what you need:

```ts
// Minimal: ~2KB gzipped
import { signal, effect } from "dalila";

// With queries: ~4KB gzipped
import { signal, effect, createQueryClient } from "dalila";
```
