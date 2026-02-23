# Runtime — Components

The component system enables declarative, reusable UI building blocks. Define a component with `defineComponent()`, then use it as a custom tag in any `bind()` scope.

## onMount Naming Note

Dalila has two different `onMount` APIs with different scopes:

| API | Scope | Purpose |
|-----|-------|---------|
| `ctx.onMount(() => {})` | Component `setup()` context | Run after component host swap in DOM |
| `onRouteMount(root)` (router) | Route module lifecycle | Run after route view mount |

This page documents **`ctx.onMount()`** (component lifecycle).

## Quick Start — Simple Components

For simple components without complex setup logic, use the shorthand:

```ts
import { component } from 'dalila/runtime';
import template from './my-card.html';

export const MyCard = component('my-card', template);
```

Or with props:

```ts
import { component } from 'dalila/runtime';
import template from './user-card.html';

export const UserCard = component('user-card', template, {
  props: {
    name: String,
    avatar: String,
  }
});
```

This is equivalent to:

```ts
import { defineComponent } from 'dalila/runtime';
import template from './user-card.html';

export const UserCard = defineComponent({
  tag: 'user-card',
  template,
  props: { name: String, avatar: String },
});
```

### When to use each form

| Form | Best for |
|------|----------|
| `component()` | Simple components with just props, no setup |
| `defineComponent()` | Complex components with setup, emits, refs, lifecycle |

---

## Quick Start — Full Components

**fruit-picker.html**
```html
<div class="picker">
  <h3><slot name="title">Escolha uma fruta:</slot></h3>
  <div class="picker-buttons" d-if="hasItems">
    <button d-each="items as fruit" d-key="fruit" d-text="fruit" d-emit-click="select" d-emit-value="fruit"></button>
  </div>
  <p class="picker-empty" d-else>Nenhuma fruta encontrada.</p>
  <slot></slot>
</div>
```

**fruit-picker.ts**
```ts
import { computed, signal } from 'dalila';
import { defineComponent } from 'dalila/runtime';
import type { EmitsSchema, RefsSchema } from 'dalila/runtime';
import template from './fruit-picker.html';

type FruitPickerProps = {
  items: { type: ArrayConstructor; default: () => string[] };
};

type FruitPickerEmits = EmitsSchema & {
  select: string;
};

export const FruitPicker = defineComponent<FruitPickerProps, FruitPickerEmits>({
  tag: 'fruit-picker',
  template,
  props: {
    items: { type: Array, default: () => [] },
  },
  setup(props, ctx) {
    const hasItems = computed(() => (props.items() as string[]).length > 0);
    return { items: props.items, hasItems };
  },
});
```

**script.ts**
```ts
import { signal, computed } from 'dalila';
import { configure, mount } from 'dalila/runtime';
import { FruitPicker } from './fruit-picker';

const selected = signal('nenhuma');
const busca = signal('');
const frutas = signal(['Maçã', 'Banana', 'Manga', 'Uva']);

const frutasFiltradas = computed(() => {
  const termo = busca().toLowerCase();
  return termo ? frutas().filter(f => f.toLowerCase().includes(termo)) : frutas();
});

configure({
  components: [FruitPicker],
  onMountError: 'log',
});

mount('.app', {
  selected,
  busca,
  frutasFiltradas,
  handleSelect: (fruta: string) => selected.set(fruta),
});
```

**index.html**
```html
<div class="app">
  <p>Selecionada: <strong d-text="selected"></strong></p>
  <input d-bind-value="busca" placeholder="Filtrar frutas..." />

  <fruit-picker
    d-props-items="frutasFiltradas"
    d-on-select="handleSelect"
  >
    <span d-slot="title">Escolha uma fruta filtrada:</span>
    <p>Clique em uma fruta para selecionar.</p>
  </fruit-picker>
</div>
```

> **Tip:** Import `.html` files directly to keep templates in separate files instead of template strings. The dev-server serves them as string modules automatically. Bundlers like Vite also support this via `?raw` suffix.
> **Tip:** `mount(selector, vm)` is a shorthand for `bind(selector, vm)` — use `configure()` to set global options like component registries.

## API Reference

### defineComponent

```ts
function defineComponent<
  P extends PropsSchema = PropsSchema,
  E extends EmitsSchema = EmitsSchema,
  R extends RefsSchema = RefsSchema
>(def: ComponentDefinition<P, E, R>): Component
```

Creates a component definition. The `tag` must contain a hyphen (custom element convention).

The generic parameters provide type safety for props, emits, and refs inside `setup()`:

```ts
type MyProps = {
  items: { type: ArrayConstructor; default: () => string[] };
};

type MyEmits = EmitsSchema & {
  select: string;
};

type MyRefs = RefsSchema & {
  input: HTMLInputElement;
};

const MyComp = defineComponent<MyProps, MyEmits, MyRefs>({
  tag: 'my-comp',
  template: '...',
  props: { items: { type: Array, default: () => [] } },
  setup(props, ctx) {
    // props.items() is typed as string[]
    // ctx.emit('select', value) — 'select' autocompletes, value is string
    // ctx.ref('input') — 'input' autocompletes, returns HTMLInputElement | null
    return {};
  },
});
```

> **Note:** Use `type` (not `interface`) for props/emits/refs types — TypeScript `interface` declarations don't satisfy `Record<string, ...>` index signatures.

#### ComponentDefinition

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tag` | `string` | Yes | Custom element tag name (must contain a hyphen) |
| `template` | `string` | Yes | HTML template string |
| `props` | `PropsSchema` | No | Props schema for type coercion and defaults |
| `setup` | `(props, ctx) => Record<string, unknown>` | No | Setup function returning template bindings |

#### PropsSchema

Each prop can be defined as a constructor or a full definition:

```ts
props: {
  // Short form — just the type
  name: String,
  count: Number,
  active: Boolean,

  // Full form — with required/default
  title: { type: String, required: true },
  page: { type: Number, default: 1 },

  // Factory default — function is called per instance
  items: { type: Array, default: () => [] },
}
```

When `default` is a function, it is called for each component instance. This prevents shared mutable state between instances (e.g., arrays or objects).

#### SetupContext

The second argument of `setup()` provides ref access and event emission:

```ts
setup(props, ctx) {
  // Emit events to the parent
  ctx.emit('select', value);

  // Access a named ref after bind
  const input = ctx.ref('myInput');

  // Access all refs
  const allRefs = ctx.refs();

  // Lifecycle helpers in component scope
  ctx.onMount(() => console.log('mounted'));
  ctx.onCleanup(() => console.log('cleanup'));

  return { /* template bindings */ };
}
```

| Method | Description |
|--------|-------------|
| `emit(event, ...args)` | Emits an event to the parent. The parent listens via `d-on-<event>` on the component tag. |
| `ref(name)` | Returns a named ref element (from `d-ref` in the component template). |
| `refs()` | Returns all named refs as a read-only record. |
| `onMount(fn)` | Queues `fn` to run after the component replaces its host tag in the DOM. |
| `onCleanup(fn)` | Registers `fn` to run when the component scope is disposed. |

`onMount()` callbacks run inside the component scope, so reactive effects and cleanup registration are active.
If an `onMount()` callback throws, the component has already been rendered/swapped into the DOM.

### configure

```ts
function configure(config: BindOptions): void
```

Sets global defaults for all `bind()` / `mount()` calls. Useful for registering component registries, error policies, and cache settings in one place.

```ts
import { configure } from 'dalila/runtime';

configure({
  components: [FruitPicker, UserCard],
  onMountError: 'log',
});
```

### mount

```ts
// Overload 1 — shorthand for bind(selector, vm, options)
function mount(selector: string, vm: Record<string, unknown>, options?: BindOptions): BindHandle

// Overload 2 — imperative component mounting
function mount(component: Component, target: Element, props?: Record<string, unknown>): BindHandle
```

**Overload 1** — bind a selector to a view-model (shorthand for `bind()`):

```ts
mount('.app', { count: signal(0) });
```

**Overload 2** — mount a component imperatively. Plain prop values are automatically wrapped in signals; existing signals are passed through as-is.

```ts
const handle = mount(UserCard, document.getElementById('container')!, {
  name: 'Bob',           // wrapped in signal() automatically
});

// With reactive props:
const name = signal('Bob');
const handle = mount(UserCard, document.getElementById('container')!, {
  name,                   // signal passed through directly
});

// Later:
handle(); // dispose
```

`mount()` only binds the created component element — existing content inside `target` is not rebound. CamelCase prop names are converted to kebab-case attributes automatically.

## Props

### Static props (attributes)

Pass string values directly via HTML attributes matching the prop name:

```html
<user-card name="Alice"></user-card>
```

For camelCase prop names, use kebab-case in HTML:

```html
<user-card is-admin="true"></user-card>
```

Values are coerced based on the prop type:

| Type | Coercion |
|------|----------|
| `String` | Raw string (no coercion) |
| `Number` | `Number(raw)` |
| `Boolean` | `raw !== 'false' && raw !== '0'` |

### Dynamic props (`d-props-*`)

Bind props reactively to values from the parent context:

```html
<user-card d-props-name="userName" d-props-is-admin="isAdmin"></user-card>
```

- Kebab-case attribute names are converted to camelCase (`d-props-is-admin` -> `isAdmin` prop)
- If the parent value is a signal or zero-arity function, the prop stays reactive

## Events

Components emit events to the parent. The parent listens using `d-on-<event>` on the component tag.

### `d-emit-<event>` (setup-less)

The `d-emit-*` directive lets a component emit events **without `setup()`**:

```html
<!-- d-emit-click="select" → emits 'select' with the DOM Event -->
<button d-emit-click="select">Pick</button>

<!-- d-emit-click + d-emit-value → emits 'select' with a resolved payload -->
<button d-each="items" d-emit-click="select" d-emit-value="item">{item}</button>
```

`d-emit-value` accepts template expressions (e.g. `item`, `item.id`, `$event.target.value`).
Works inside `d-each` — each clone resolves its own `item` value.

`d-emit-*` uses `addEventListener` directly and accepts **any valid DOM event name** (`click`, `focus`, `blur`, `mouseenter`, `scroll`, etc.) — it is not limited to the default `d-on-*` event list.

### `ctx.emit()` (inside setup)

For more complex logic, use `setup()` and call `ctx.emit()` directly:

```ts
const FruitPicker = defineComponent({
  tag: 'fruit-picker',
  template: '<button d-each="items" d-on-click="select">{item}</button>',
  props: { items: Array },
  setup(props, ctx) {
    return {
      items: props.items,
      select: (e: Event) => ctx.emit('select', (e.target as HTMLElement).textContent),
    };
  },
});
```

### Parent template

```html
<fruit-picker
  d-props-items="frutas"
  d-on-select="handleSelect"
></fruit-picker>
```

### Parent script

```ts
const selected = signal('nenhuma');

bind('.app', {
  frutas: signal(['Maçã', 'Banana']),
  handleSelect: (fruta: string) => selected.set(fruta),
}, {
  components: { 'fruit-picker': FruitPicker },
});
```

The `d-on-select="handleSelect"` attribute maps the component's `'select'` event to the `handleSelect` function in the parent context. Arguments passed to `ctx.emit('select', value)` or via `d-emit-click="select" d-emit-value="value"` are forwarded to the handler.

## Slots

Components support content projection via slots.

### Default slot

```ts
const Card = defineComponent({
  tag: 'x-card',
  template: '<div class="card"><slot></slot></div>',
});
```

```html
<x-card>
  <p>This goes into the default slot</p>
</x-card>
```

If no content is provided, the `<slot>` fallback content is preserved:

```ts
template: '<div><slot>Default content here</slot></div>'
```

### Named slots

Use `slot[name]` in the template and `slot="name"` (or `d-slot="name"`) on projected content:

```ts
const Layout = defineComponent({
  tag: 'x-layout',
  template: `
    <header><slot name="header"></slot></header>
    <main><slot></slot></main>
    <footer><slot name="footer"></slot></footer>
  `,
});
```

```html
<x-layout>
  <h1 slot="header">Page Title</h1>
  <p>Main content (default slot)</p>
  <span slot="footer">Copyright 2024</span>
</x-layout>
```

Named slots also work with `<template slot="name">` (or `<template d-slot="name">`) for multi-element content:

```html
<x-layout>
  <template slot="header">
    <h1>Title</h1>
    <nav>Navigation</nav>
  </template>
  <p>Main content</p>
</x-layout>
```

### Slot scope

Slot content is bound with the **parent** context, not the component's context. This follows the principle that the data owner controls the rendering.

## Using with bind

Register components via `configure()` (global) or the `components` option (per-call):

```ts
// Global — available to all bind() / mount() calls
configure({ components: [UserCard, NavBar] });

// Per-call — local takes precedence over global
bind(root, ctx, {
  components: {
    'user-card': UserCard,
    'nav-bar': NavBar,
  },
});
```

Components are available to the entire subtree, including:
- Inside `d-each` loops
- Inside other components (nested components)
- Inside slot content

## DX Guardrails (Dev Warnings)

In dev mode, Dalila emits warnings for common component mistakes:

- `d-props-*` references a missing key in parent context.
- `d-props-*` prop name is not declared in the component `props` schema.
- Required prop is missing.
- `d-emit-*` is empty or `d-emit-value` is invalid/empty.
- `setup()` returns a key that overrides a prop binding.
- `bind({ components })` receives an invalid component entry.
- `bind({ components })` key differs from the component `tag` (the `tag` is used).

## Imperative mount isolation

When using `mount()`, only the component itself is bound — any pre-existing content in the target element is left untouched. You can safely combine `bind()` on a target element with `mount()` calls that add components into it:

```ts
const counter = signal(0);
bind(target, { counter });             // binds existing <p>{counter}</p>
mount(StatusBadge, target, { ok: true }); // appends <status-badge> — does not rebind <p>
```

## Context (provide/inject)

Components participate in the scope hierarchy, so `provide`/`inject` works across component boundaries:

```ts
// Parent scope
const ThemeCtx = createContext('theme');

withScope(scope, () => {
  provide(ThemeCtx, 'dark');
  bind(root, ctx, { components: { 'x-child': ChildComp } });
});

// Inside ChildComp's setup
const ChildComp = defineComponent({
  tag: 'x-child',
  template: '<span>{theme}</span>',
  setup() {
    const theme = inject(ThemeCtx);
    return { theme: signal(theme) };
  },
});
```

## Types

```ts
type PropConstructor =
  | StringConstructor | NumberConstructor | BooleanConstructor
  | ArrayConstructor | ObjectConstructor | FunctionConstructor;

interface PropDefinition {
  type: PropConstructor;
  required?: boolean;
  default?: unknown;        // function values are called per instance (factory)
}

type PropOption = PropConstructor | PropDefinition;
type PropsSchema = Record<string, PropOption>;

// ── Typed prop inference ──

type TypedPropSignals<P extends PropsSchema> = {
  [K in keyof P]: Signal<InferPropOptionType<P[K]>>;
};

// ── Emits and Refs schemas ──

type EmitsSchema = Record<string, unknown>;
type RefsSchema = Record<string, Element>;

type TypedEmit<E extends EmitsSchema> = <K extends keyof E & string>(
  event: K, payload: E[K]
) => void;

type TypedRef<R extends RefsSchema> = <K extends keyof R & string>(
  name: K
) => R[K] | null;

// ── SetupContext ──

interface TypedSetupContext<
  E extends EmitsSchema = EmitsSchema,
  R extends RefsSchema = RefsSchema
> {
  ref: TypedRef<R>;
  refs(): Readonly<Partial<R>>;
  emit: TypedEmit<E>;
  onMount(fn: () => void): void;
  onCleanup(fn: () => void): void;
}

// ── ComponentDefinition ──

interface ComponentDefinition<
  P extends PropsSchema = PropsSchema,
  E extends EmitsSchema = EmitsSchema,
  R extends RefsSchema = RefsSchema
> {
  tag: string;
  template: string;
  props?: P;
  setup?: (props: TypedPropSignals<P>, ctx: TypedSetupContext<E, R>) => Record<string, unknown>;
}

interface Component {
  readonly __dalila_component: true;
  readonly definition: ComponentDefinition<any, any, any>;
}
```

The legacy unparameterized types `PropSignals<P>` and `SetupContext` are still exported for backward compatibility.
