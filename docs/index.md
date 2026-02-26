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

## Templates in Separate Files

You can keep templates in `.html` files and import them directly:

```ts
// my-component.ts
import { defineComponent } from "dalila/runtime";
import template from "./my-component.html";

export const MyComponent = defineComponent({
  tag: 'my-component',
  template,
});
```

```html
<!-- my-component.html -->
<div class="card">
  <h2>{title}</h2>
  <p>{description}</p>
</div>
```

**How it works:**
- Dev server serves `.html` files as string modules automatically
- In production, use Vite with `?raw` suffix: `import template from './my-component.html?raw'`
- Works with any bundler that supports `?raw` or `?inline`

## Installation

```bash
npm install dalila
```

## Documentation

### Phase 1 — Fundamentals

1. [Signals](./core/signals.md) — Reactive primitives (`signal`, `computed`, `effect`, `batch`, `untrack`)
2. [Effects Guide](./core/effects-guide.md) — Choosing between `effect`, `effectAsync`, `watch`, `onCleanup`
3. [Scopes](./core/scope.md) — Lifecycle management and cleanup
4. [Scopes Guide](./core/scopes-guide.md) — when manual scopes help and when they don't
5. [Template Binding](./runtime/bind.md) — `bind()`, `mount()`, directives and transitions

### Phase 2 — Building UI

6. [Template Spec](./template-spec.md) — Binding syntax and directive model (HTML-first runtime)
7. [when](./core/when.md) — Boolean conditional rendering
8. [match](./core/match.md) — Value-based conditional rendering (switch-style)
9. [for](./core/for.md) — List rendering with keyed diffing
10. [Components](./runtime/component.md) — `defineComponent`, props/emits/refs/slots

### Phase 3 — Data and State

11. [Resources](./core/resource.md) — Async state with loading/error
12. [Forms](./forms.md) — DOM-first form management and validation
13. [Persist](./core/persist.md) — Storage sync for signals

### Phase 4 — Advanced Data

14. [Query](./core/query.md) — Cached queries
15. [Mutations](./core/mutation.md) — Write operations
16. [Keys](./core/key.md) — Cache key encoding

### Phase 5 — Routing

17. [Router](./router.md) — Client-side routing and route generation

### Phase 6 — Advanced Runtime

18. [Lazy Loading](./runtime/lazy.md) — `createLazyComponent`, `d-lazy`, `createSuspense`
19. [Error Boundary](./runtime/boundary.md) — `createErrorBoundary`, `withErrorBoundary`, `d-boundary`
20. [Context](./context.md) — Dependency injection and lookup rules
21. [Virtual Lists](./core/virtual.md) — Windowed rendering for large datasets (`d-virtual-each`)
22. [FOUC Prevention](./runtime/fouc-prevention.md) — Loading token behavior

### Tooling and Ecosystem

23. [Scheduler](./core/scheduler.md) — Batching (`batch()`) and read/write coordination
24. [Dev Mode](./core/dev.md) — Development helpers and warnings
25. [HTTP](./http.md) — Fetch client, interceptors and XSRF helpers
26. [UI Components](./ui.md) — Built-in UI component library
27. [Template Check CLI](./cli/check.md) — `dalila check` static analysis
28. [Devtools Extension](../devtools-extension/README.md) — Inspect signals/effects/scopes

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

const greeting = computed(() => `Hello, ${name()}!`); // Signal<string> (read-only by behavior)

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
