# Dalila

**DOM-first reactivity without the re-renders.**

Dalila is a reactive framework built on signals. No virtual DOM, no JSX required — just HTML with declarative bindings.

## Quick Start

```bash
npm create dalila my-app
cd my-app
npm install
npm run dev
```

Open http://localhost:4242 to see your app.

## Manual Installation

```bash
npm install dalila
```

```html
<div id="app">
  <p>Count: {count}</p>
  <button d-on-click="increment">+</button>
</div>
```

```ts
import { signal } from 'dalila';
import { bind } from 'dalila/runtime';

const count = signal(0);

const ctx = {
  count,
  increment: () => count.update(n => n + 1),
};

bind(document.getElementById('app')!, ctx);
```

## Docs

### Getting Started

- [Overview](./docs/index.md) — Philosophy and quick start
- [Template Spec](./docs/template-spec.md) — Binding syntax reference

### Core

- [Signals](./docs/core/signals.md) — `signal`, `computed`, `effect`
- [Scopes](./docs/core/scope.md) — Lifecycle management and cleanup
- [Persist](./docs/core/persist.md) — Automatic storage sync for signals
- [Context](./docs/context.md) — Dependency injection

### Runtime

- [Template Binding](./docs/runtime/bind.md) — `bind()`, text interpolation, events
- [FOUC Prevention](./docs/runtime/fouc-prevention.md) — Automatic token hiding

### Routing

- [Router](./docs/router.md) — Client-side routing with nested layouts, preloading, and file-based route generation

### UI Components

- [UI Components](./docs/ui.md) — Interactive components (Dialog, Drawer, Toast, Tabs, Calendar, etc.) with native HTML and full ARIA support

### Rendering

- [when](./docs/core/when.md) — Conditional visibility
- [match](./docs/core/match.md) — Switch-style rendering
- [for](./docs/core/for.md) — List rendering with keyed diffing

### Data

- [Resources](./docs/core/resource.md) — Async data with loading/error states
- [Query](./docs/core/query.md) — Cached queries
- [Mutations](./docs/core/mutation.md) — Write operations

### Forms

- [Forms](./docs/forms.md) — DOM-first form management with validation, field arrays, and accessibility

### Utilities

- [Scheduler](./docs/core/scheduler.md) — Batching and coordination
- [Keys](./docs/core/key.md) — Cache key encoding
- [Dev Mode](./docs/core/dev.md) — Warnings and helpers

## Features

```
dalila           → signal, computed, effect, batch, ...
dalila/runtime   → bind() for HTML templates
dalila/context   → createContext, provide, inject
```

### Signals

```ts
import { signal, computed, effect } from 'dalila';

const count = signal(0);
const doubled = computed(() => count() * 2);

effect(() => {
  console.log('Count is', count());
});

count.set(5); // logs: Count is 5
```

### Template Binding

```ts
import { bind } from 'dalila/runtime';

// Binds {tokens}, d-on-*, d-when, d-match to the DOM
const dispose = bind(rootElement, ctx);

// Cleanup when done
dispose();
```

### Scopes

```ts
import { createScope, withScope, effect } from 'dalila';

const scope = createScope();

withScope(scope, () => {
  effect(() => { /* auto-cleaned when scope disposes */ });
});

scope.dispose(); // stops all effects
```

### Context

```ts
import { createContext, provide, inject } from 'dalila';

const ThemeContext = createContext<'light' | 'dark'>('theme');

// In parent scope
provide(ThemeContext, 'dark');

// In child scope
const theme = inject(ThemeContext); // 'dark'
```

### Persist

```ts
import { signal, persist } from 'dalila';

// Auto-saves to localStorage
const theme = persist(signal('dark'), { name: 'app-theme' });

theme.set('light'); // Saved automatically
// On reload: theme starts as 'light'
```

### File-Based Routing

```txt
src/app/
├── layout.html
├── page.html
├── about/
│   └── page.html
└── users/
    └── [id]/
        └── page.html
```

```bash
dalila routes generate
```

```ts
import { createRouter } from 'dalila/router';
import { routes } from './routes.generated.js';
import { routeManifest } from './routes.generated.manifest.js';

const router = createRouter({
  outlet: document.getElementById('app')!,
  routes,
  routeManifest
});

router.start();
```

### Forms

```ts
import { createForm } from 'dalila';

const userForm = createForm({
  defaultValues: { name: '', email: '' },
  validate: (data) => {
    const errors: Record<string, string> = {};
    if (!data.name) errors.name = 'Name is required';
    if (!data.email?.includes('@')) errors.email = 'Invalid email';
    return errors;
  }
});

async function handleSubmit(data, { signal }) {
  await fetch('/api/users', {
    method: 'POST',
    body: JSON.stringify(data),
    signal
  });
}
```

```html
<form d-form="userForm" d-on-submit="handleSubmit">
  <label>
    Name
    <input d-field="name" />
  </label>
  <span d-error="name"></span>

  <label>
    Email
    <input d-field="email" type="email" />
  </label>
  <span d-error="email"></span>

  <button type="submit">Save</button>
  <span d-form-error="userForm"></span>
</form>
```

### UI Components with Router

```ts
// page.ts
import { signal } from 'dalila';
import { createDialog, mountUI } from 'dalila/components/ui';

const dialog = createDialog();

export function loader() {
  const count = signal(0);

  return {
    count,
    increment: () => count.update(n => n + 1),
    openDialog: () => dialog.show(),
  };
}

// Called after view is mounted
export function onMount(root: HTMLElement) {
  mountUI(root, {
    dialogs: { dialog }
  });
}
```

```html
<!-- page.html -->
<d-button d-on-click="openDialog">Open Dialog</d-button>

<d-dialog d-ui="dialog">
  <d-dialog-header>
    <d-dialog-title>Count: {count}</d-dialog-title>
  </d-dialog-header>
  <d-dialog-body>
    <d-button d-on-click="increment">Increment</d-button>
  </d-dialog-body>
</d-dialog>
```

## Development

```bash
npm install
npm run build
npm run serve   # Dev server with HMR
npm test
```

## License

MIT
