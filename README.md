# 🐰✂️ Dalila

**DOM-first reactivity without the re-renders.**

Dalila is a reactive framework built on signals. No virtual DOM, no JSX required — just HTML with declarative bindings.

## Quick Start

```bash
npm create dalila@latest my-app
cd my-app
npm install
npm run dev
```

Open http://localhost:4242 to see your app.

## Install

```bash
npm install dalila
```

## Minimal Example

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

### Start here

- [Overview](./docs/index.md)
- [Template Spec](./docs/template-spec.md)
- [Router](./docs/router.md)
- [Forms](./docs/forms.md)
- [UI Components](./docs/ui.md)
- [HTTP Client](./docs/http.md)

### Core

- [Signals](./docs/core/signals.md)
- [Scopes](./docs/core/scope.md)
- [Persist](./docs/core/persist.md)
- [Context](./docs/context.md)
- [Scheduler](./docs/core/scheduler.md)
- [Keys](./docs/core/key.md)
- [Dev Mode](./docs/core/dev.md)

### Runtime

- [Template Binding](./docs/runtime/bind.md)
- [Components](./docs/runtime/component.md)
- [Lazy Loading](./docs/runtime/lazy.md)
- [Error Boundary](./docs/runtime/boundary.md)
- [FOUC Prevention](./docs/runtime/fouc-prevention.md)

### Rendering & Data

- [when](./docs/core/when.md)
- [match](./docs/core/match.md)
- [for](./docs/core/for.md)
- [Virtual Lists](./docs/core/virtual.md)
- [Resources](./docs/core/resource.md)
- [Query](./docs/core/query.md)
- [Mutations](./docs/core/mutation.md)

### Tooling

- [Template Check CLI](./docs/cli/check.md)
- [Devtools Extension](./devtools-extension/README.md)

Firefox extension workflows:

- `npm run devtools:firefox:run` — launch Firefox with extension loaded for dev
- `npm run devtools:firefox:build` — package extension artifact for submission/signing

## Packages

```txt
dalila           → signals, scope, persist, forms, resources, query, mutations
dalila/runtime   → bind(), mount(), configure(), components, lazy, transitions
dalila/context   → createContext(), provide(), inject()
dalila/router    → createRouter(), file-based routes, preloading
dalila/http      → createHttpClient()
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
