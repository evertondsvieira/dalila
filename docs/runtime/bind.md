# Runtime — bind()

The `dalila/runtime` module binds declarative HTML templates to a reactive context.
No `eval`, no inline JS — directive attributes resolve identifiers from context, and text interpolation evaluates safe expressions in `{...}`.

## How it works

```
┌──────────────────────────────────────────────────────────────────────┐
│                         bind() pipeline                              │
│                                                                      │
│   HTML template ──► bind(root, ctx) ──► live reactive DOM            │
│                          │                                           │
│                          ├─ 1  d-virtual-each fixed-height window    │
│                          ├─ 2  d-each       remove template,         │
│                          │                  clone + bind per item    │
│                          ├─ 3  components   resolve custom tags      │
│                          ├─ 4  d-ref        collect element refs     │
│                          ├─ 5  d-text       safe textContent binding │
│                          ├─ 6  {...}        reactive text nodes      │
│                          ├─ 7  d-attr-*     attributes / props       │
│                          ├─ 8  d-bind-*     two-way binding          │
│                          ├─ 9  d-html       innerHTML                │
│                          ├─ 10 d-on-*       event listeners          │
│                          ├─ 11 d-emit-*     component → parent emit  │
│                          ├─ 12 d-when       display toggle           │
│                          ├─ 13 d-match/case conditional show         │
│                          └─ 14 d-if/d-else  add / remove from DOM    │
│                                                                      │
│   All reactive effects are owned by a scope.                         │
│   dispose() stops every effect and removes every listener.           │
└──────────────────────────────────────────────────────────────────────┘
```

**Key invariants:**

1. **Root-inclusive** — directives on the element passed as `root` are processed, not only descendants.
2. **No double-bind** — `d-each` and `d-virtual-each` clones are marked and fully bound before the parent's subsequent passes run; the parent skips them entirely.
3. **Safe resolve** — only signals and zero-arity functions are ever called. Functions with parameters (event handlers) are never invoked as getters.

## API Reference

### bind

```ts
function bind(root: Element | string, ctx: BindContext, options?: BindOptions): BindHandle

interface BindContext {
  [key: string]: unknown;   // signals, getters, handlers, plain values
}

interface BindOptions {
  /** Event types to listen for. Default: click, input, change, submit, keydown, keyup */
  events?: string[];

  /** CSS selectors inside which {...} interpolation is skipped. Default: 'pre, code' */
  rawTextSelectors?: string;

  /** Runtime cache policy for text interpolation template plans */
  templatePlanCache?: {
    /** Maximum number of cached template plans (0 disables cache). Default: 250 */
    maxEntries?: number;
    /** Time-to-live (ms) per plan, refreshed on hit (0 disables cache). Default: 600000 */
    ttlMs?: number;
  };

  /** Component registry — map `{ tag: component }` or list `[component]` */
  components?: Record<string, Component> | Component[];

  /** Error policy for component ctx.onMount() callbacks. Default: 'log' */
  onMountError?: 'log' | 'throw';
}

type DisposeFunction = () => void;

interface BindHandle {
  /** Dispose — stops all effects, removes all listeners, clears refs. */
  (): void;
  /** Get a single element ref by name, or null if not found. */
  getRef(name: string): Element | null;
  /** Get a frozen record of all collected refs. */
  getRefs(): Readonly<Record<string, Element>>;
}
```

`BindHandle` is callable as `() => void`, so it is fully backward-compatible with code that expects a `DisposeFunction`.

`onMountError` controls how component `ctx.onMount()` callback failures are handled:
- `'log'` (default): catches and logs the error, preserving the rest of the bind pipeline.
- `'throw'`: rethrows the error.

Note: `ctx.onMount()` runs after the component DOM swap, so thrown errors do not roll back already-rendered DOM.

`root` can be a CSS selector string instead of an `Element`. If the selector matches no element, `bind()` throws.

```ts
// These are equivalent:
bind(document.querySelector('.app')!, ctx);
bind('.app', ctx);
```

### autoBind

```ts
function autoBind(selector: string, ctx: BindContext, options?: BindOptions): Promise<BindHandle>
```

Convenience wrapper — waits for `DOMContentLoaded` if the document is still loading, then calls `bind()`.

### configure

```ts
function configure(config: BindOptions): void
```

Sets global defaults for all `bind()` / `mount()` calls. Options set here are merged with per-call options (per-call wins). For `components`, both registries are combined (local takes precedence). Call with `{}` to reset.

```ts
import { configure } from 'dalila/runtime';

configure({
  components: [FruitPicker, UserCard],
  onMountError: 'log',
});
```

### mount

```ts
// Overload 1 — shorthand for bind()
function mount(selector: string, vm: Record<string, unknown>, options?: BindOptions): BindHandle

// Overload 2 — imperative component mounting
function mount(component: Component, target: Element, props?: Record<string, unknown>): BindHandle
```

**Overload 1** is a convenience alias for `bind(selector, vm, options)`:

```ts
import { configure, mount } from 'dalila/runtime';
import { signal } from 'dalila';

configure({ components: [MyComponent] });

mount('.app', {
  count: signal(0),
  increment: () => count.update(n => n + 1),
});
```

**Overload 2** imperatively mounts a component into a target element. Props can be plain values or signals — plain values are wrapped in a signal automatically.

```ts
import { mount, defineComponent } from 'dalila/runtime';

const UserCard = defineComponent({
  tag: 'user-card',
  template: '<span>{name}</span>',
  props: { name: String },
  setup(props) { return { name: props.name }; },
});

const handle = mount(UserCard, document.getElementById('container')!, {
  name: 'Alice',
});

// Later:
handle(); // dispose
```

`mount()` only binds the created component element — existing content in `target` is not rebound.

## Basic Usage

```html
<div id="app">
  <h1>Hello {name}!</h1>
  <p>Count: {count}</p>
  <button d-on-click="increment">+</button>
  <button d-on-click="decrement">−</button>
  <p d-when="isEven">Even number</p>
</div>
```

```ts
import { bind }              from 'dalila/runtime';
import { signal, computed } from 'dalila';

const count  = signal(0);
const isEven = computed(() => count() % 2 === 0);

const dispose = bind(document.getElementById('app')!, {
  count,
  isEven,
  name: signal('World'),
  increment: () => count.update(n => n + 1),
  decrement: () => count.update(n => n - 1),
});

// Later — all effects and listeners are cleaned up:
dispose();
```

## Directives

### Text interpolation `{...}`

Replaces `{...}` placeholders with expression results from the context.  Multiple expressions per text node are supported.

```html
<p>Hello {name}!</p>
<p>{greeting} {name}, you have {unread} messages</p>
<p>Next count: {count + 1}</p>
<p>Items: {items.length}</p>
<p>Status: {isActive ? 'Yes' : 'No'}</p>
<p>User: {user?.name}</p>
<p>First item: {items?.[0]?.title}</p>
```

**How the value is rendered:**

| Context value | Behaviour |
|---|---|
| `signal` | Reactive — updates automatically when the signal changes |
| zero-arity function (`fn.length === 0`) | Reactive getter — wrapped in an effect, re-renders on dependency change |
| function with parameters | **Never called.** Dev warns. Renders empty string. |
| `null` / `undefined` | Renders as **empty string** |
| anything else | Stringified once (static) |

**Synchronous initial render:** The first render of every expression is synchronous — the text node is populated during `bind()`, before the microtask flush. This prevents a brief empty flash for initial values.

Text inside `<pre>` and `<code>` is skipped by default (configurable via `rawTextSelectors`).

### Safe text binding `d-text`

Sets `textContent` from a context value. Safe from XSS by design — no HTML parsing.

```html
<span d-text="username"></span>
<p d-text="statusMessage"></p>
```

| Value | Result |
|---|---|
| `null` / `undefined` | textContent is set to **empty string** |
| signal / zero-arity function | Reactive — updates automatically |
| anything else | Stringified once (static) |

`d-text` is an alternative to `{...}` interpolation when you want to set the entire text content of an element to a single value. It runs before text interpolation in the pipeline, so elements with `d-text` can also contain `{...}` tokens in child elements.

#### Expression engine

The `{...}` interpolation supports a safe subset of JavaScript expressions. **No `eval` or `new Function` is used** — all expressions are parsed and evaluated by a built-in expression engine.

| Category | Operators |
|---|---|
| Arithmetic | `+`, `-`, `*`, `/`, `%` |
| Comparison | `<`, `>`, `<=`, `>=` |
| Equality | `==`, `!=`, `===`, `!==` |
| Logical | `&&`, `\|\|`, `!` |
| Nullish coalescing | `??` |
| Ternary | `condition ? a : b` |
| Member access | `obj.prop`, `obj[0]` |
| Optional chaining | `obj?.prop`, `arr?.[0]` |
| Unary | `!`, `+`, `-` |
| Grouping | `(expr)` |
| Literals | `true`, `false`, `null`, `undefined`, numbers, strings (`'...'` / `"..."`) |

Nested member access on signals and zero-arity getters is tracked reactively:

```html
<!-- user is { name: signal('Ana') } — updates when the inner signal changes -->
<p>{user.name}</p>
```

**Not supported in expressions:** function calls (`foo()`), assignment, `typeof`, `instanceof`, destructuring, template literals.

---

### Event handlers `d-on-*`

Binds an event listener.  The attribute value must name a **function** in the context.

```html
<button  d-on-click="increment">+</button>
<input   d-on-input="onInput">
<form    d-on-submit="onSubmit">
```

Default event types: `click`, `input`, `change`, `submit`, `keydown`, `keyup`.
Custom events can be added via `options.events`.

Listeners are removed automatically when `dispose()` is called.

---

### Element refs `d-ref`

Captures a reference to a DOM element by name.  Refs are collected once during `bind()` (not reactive) and cleared on `dispose()`.

```html
<div id="app">
  <input d-ref="searchInput" type="text" placeholder="Search..." />
  <button d-ref="submitBtn" d-on-click="focusSearch">Focus</button>
</div>
```

```ts
const handle = bind(document.getElementById('app')!, {
  focusSearch: () => {
    const input = handle.getRef('searchInput') as HTMLInputElement;
    input?.focus();
  },
});
```

| Behaviour | Description |
|---|---|
| Collection time | After `d-each` (cloned templates are excluded), before text interpolation |
| Scope | Each `bind()` call has its own ref map — refs inside `d-each` clones belong to the clone's scope |
| Duplicates | Last-write-wins + dev-mode warning |
| Empty name | Ignored + dev-mode warning |
| After `dispose()` | `getRef()` returns `null`, `getRefs()` returns `{}` |

---

Directive attribute values use plain identifiers only: `d-when="isVisible"` (not `d-when="{isVisible}"`).

### Conditional visibility `d-when`

Toggles `display` style.  The element stays in the DOM at all times.

```html
<div d-when="isVisible">Shown when truthy</div>
```

Reactive: re-evaluates whenever the bound signal changes.

---

### Conditional rendering `d-if` / `d-else`

Adds or removes the element from the DOM entirely.  A comment node is left as a placeholder so the element can be re-inserted when the condition becomes truthy again.

```html
<div d-if="hasData">Content</div>
```

Use `d-if` instead of `d-when` when you want the element's subtree to be removed (saves layout/paint cost) or when you need to prevent its children from being visible at all.

#### `d-else`

If the **immediate next sibling** of a `d-if` element has the `d-else` attribute, the two branches toggle inversely: when the condition is truthy the `d-if` element is shown and the `d-else` element is hidden, and vice versa.

```html
<div d-if="hasItems">
  <p>Items found!</p>
</div>
<div d-else>
  <p>No items.</p>
</div>
```

- Only the immediate next sibling is checked — no deep search.
- `d-if` without `d-else` works exactly as before.
- Both branches are fully bound before the conditional toggle runs (since `d-if` is the last pipeline step).

---

### Pattern matching `d-match` / `case`

Shows exactly one child based on the resolved value of the binding.  All other children are hidden.

```html
<div d-match="status">
  <p case="loading">Loading…</p>
  <p case="error">Something went wrong</p>
  <p case="success">Done!</p>
  <p case="default">Waiting…</p>
</div>
```

`case="default"` is the fallback when no other case matches.

Cases are **re-queried on every signal change**, so `[case]` children can be added or removed dynamically (e.g. via `d-if` inside the d-match container) and will be picked up on the next update.

`null` / `undefined` values normalise to the empty string before matching.

---

### List rendering `d-each`

Repeats an element for every item in an array or signal-of-array.  The element with `d-each` is removed from the DOM and used as a template; one clone is created per item and inserted in its place.

```html
<ul>
  <li d-each="users as user">{user.name} — {user.email}</li>
  <li d-each="users as user" d-key="id">{user.name} — {user.email}</li>
</ul>
```

For compatibility, object-item fields can still be referenced directly (`{name}`), but the recommended style is explicit alias access (`{user.name}`).

#### Alias syntax

Use `as` to give the current item a custom name instead of the default `item`:

```html
<button d-each="fruits as fruit" d-key="fruit" d-text="fruit"></button>
```

The alias is available in all child directives (`d-text`, `d-key`, `d-emit-click`, `{...}`, etc.). The default `item` name is still set for backward compatibility even when an alias is used.

#### Keyed diffing

`d-each` reuses and reorders existing clones by key instead of rebuilding the
entire list on each update.

- Prefer `d-key="id"` (or another stable unique field) for large/dynamic lists.
- If `d-key` is omitted and the item is an object, `item.id` / `item.key` is used.
- If no stable key exists, index fallback is used.

#### Context inside each clone

Each clone's context **inherits from the parent** via the prototype chain.  Handlers and values defined in the outer scope are accessible without repeating them:

```html
<div>
  <div d-each="items">
    <span>{name}</span>
    <button d-on-click="onDelete">✕</button>  <!-- onDelete from parent ctx -->
  </div>
</div>
```

#### Available properties

| Name | Value | Notes |
|---|---|---|
| *(spread)* | own properties of `item` | only when `item` is an object |
| `item` | the raw item | always available — even for objects |
| *alias* | the raw item | when using `d-each="items as fruit"`, exposed as `fruit` |
| `$index` | `0, 1, 2 …` | zero-based position |
| `$count` | length of the array | |
| `$first` | `true` on the first item | |
| `$last` | `true` on the last item | |
| `$odd` | `true` on odd indices (1, 3 …) | |
| `$even` | `true` on even indices (0, 2 …) | |

```html
<li d-each="tags" d-when="$odd" class="alt">
  {$index}: {item}
</li>
```

#### Nested loops

`d-each` inside another `d-each` template works correctly.  The inner loop is bound when its parent clone is created — it is not touched by the outer bind pass.

```html
<div d-each="groups">
  <h3>{name}</h3>
  <ul d-each="children">
    <li>{label}</li>
  </ul>
</div>
```

---

### Virtual list rendering `d-virtual-each`

Renders only a visible window of a large list (plus overscan) using fixed item height.

```html
<div class="viewport">
  <div
    d-virtual-each="items"
    d-virtual-item-height="48"
    d-virtual-overscan="4"
    d-key="id"
  >
    {title}
  </div>
</div>
```

#### Required attributes

- `d-virtual-each`: array or signal-of-array in context
- `d-virtual-item-height`: fixed row height in pixels

#### Optional attributes

- `d-virtual-overscan`: extra rows before and after visible range (default `6`)
- `d-virtual-height`: sets parent scroll container height (`"480px"`, `"60vh"`, or context value)
- `d-key`: stable key field (recommended)

#### Behavior

- Parent element is treated as the scroll container.
- Dalila updates the rendered window on scroll and data changes.
- `item`, `$index`, `$count`, `$first`, `$last`, `$odd`, `$even` are available in each visible clone.
- If `d-virtual-item-height` is invalid, runtime falls back to `d-each`.

---

### Dynamic HTML `d-html`

Sets `innerHTML` from a context value.  HTML tags are rendered, not escaped.

```html
<div d-html="content"></div>
```

| Value | Result |
|---|---|
| `null` / `undefined` | innerHTML is set to **empty string** |
| anything else | stringified and set as innerHTML |

> **Security:** `d-html` renders raw HTML.  In dev mode a warning is logged if the content matches known XSS patterns (`<script>`, `onerror=`, `javascript:`).  **Never use with unsanitised user input.** Use `{token}` for safe, escaped text output.

---

### Dynamic attributes `d-attr-*`

Binds any attribute or IDL property.  The part after `d-attr-` becomes the attribute name.

```html
<a     d-attr-href="url">Link</a>
<input d-attr-value="name">
<input type="checkbox" d-attr-checked="done">
<button d-attr-disabled="loading">Save</button>
```

#### Value semantics

| Value | Result |
|---|---|
| `null` / `undefined` / `false` | attribute is **removed** |
| `true` | set as empty string — standard boolean attribute (`<input disabled>`) |
| anything else | stringified and set |

#### IDL property fast-path

Certain attributes must be set as DOM **properties** (not attributes) to reflect the live state after user interaction.  `d-attr-*` detects these automatically:

| Attribute | Set as | Type |
|---|---|---|
| `value` | `.value` | string |
| `checked` | `.checked` | boolean |
| `disabled` | `.disabled` | boolean |
| `selected` | `.selected` | boolean |
| `indeterminate` | `.indeterminate` | boolean |

This means `d-attr-value` stays in sync even after the user has typed into an input — `setAttribute` alone cannot do that.

---

### Two-way binding `d-bind-*`

Binds a **signal** to a form element property with automatic synchronization in both directions:
- **Outbound:** signal changes update the DOM property.
- **Inbound:** user interaction updates the signal.

```html
<input d-bind-value="name" />
<textarea d-bind-value="bio"></textarea>
<select d-bind-value="choice">
  <option value="a">A</option>
  <option value="b">B</option>
</select>
<input type="checkbox" d-bind-checked="agree" />
```

```ts
import { signal } from 'dalila';
import { bind }   from 'dalila/runtime';

const name  = signal('');
const bio   = signal('');
const choice = signal('a');
const agree = signal(false);

bind(document.getElementById('app')!, { name, bio, choice, agree });
```

#### Supported properties

| Directive | Property | Event | Elements |
|---|---|---|---|
| `d-bind-value` | `.value` (string) | `input` | `<input>`, `<textarea>` |
| `d-bind-value` | `.value` (string) | `change` | `<select>` |
| `d-bind-checked` | `.checked` (boolean) | `change` | `<input type="checkbox">` |

#### Rules

| Rule | Description |
|---|---|
| Signal only | The context value **must** be a signal. Non-signals produce a dev-mode warning and are skipped. |
| No infinite loop | Signals perform equality checks — setting the same value does not re-trigger the effect. |
| Cleanup | `dispose()` removes the inbound event listener and stops the outbound effect. |
| Attribute removal | The `d-bind-*` attribute is removed from the DOM after processing. |

> **Tip:** `d-bind-value` replaces the common `d-attr-value` + `d-on-input` pattern, reducing two directives to one.

---

## Template Plan Cache

Text interpolation compiles a **template plan** (list of text nodes and their expression segments) for each `bind()` call. Plans are cached using a structural hash of the DOM tree, so repeated `bind()` calls on structurally identical templates skip the scanning phase entirely.

**Defaults:** max 250 entries, 10-minute TTL (refreshed on hit).

Configure per `bind()` call:

```ts
bind(root, ctx, {
  templatePlanCache: { maxEntries: 100, ttlMs: 300_000 },
});
```

Or globally:

```ts
globalThis.__dalila_bind_template_cache = { maxEntries: 0, ttlMs: 0 }; // disables cache
```

`bind()` options override the global config when both are set.

### Bench mode (dev only)

Set `globalThis.__dalila_bind_bench = true` to collect per-bind timing stats in `globalThis.__dalila_bind_bench_stats`:

```ts
globalThis.__dalila_bind_bench_stats.last;
// { scanMs, parseMs, totalExpressions, fastPathExpressions, fastPathHitPercent, planCacheHit }
```

---

## resolve() — how values are read

Every directive that reads a context value goes through the same `resolve()` rule:

```
signal            →  call signal(), return result       (reactive)
fn.length === 0   →  call fn(), return result           (reactive getter)
fn.length > 0     →  warn in dev, return undefined      (never executed)
anything else     →  return as-is                       (static)
```

This single rule keeps the entire runtime safe from accidentally executing event handlers as getters.  If you accidentally write `d-when="onClick"` where `onClick` is `(e) => …`, the runtime will warn and treat it as `undefined` (falsy) rather than calling your handler.

## Lifecycle

```
bind(root, ctx)
  │
  ├── templateScope created
  │     └── all effects registered here automatically
  │           └── stopped when dispose() is called
  │
  ├── event listeners tracked separately
  │     └── removed when dispose() is called
  │
  └── queueMicrotask → removes d-loading, sets d-ready
        (top-level bind only — d-each clones skip this)
```

### FOUC prevention

The dev server automatically adds `d-loading` to root elements and injects:

```css
[d-loading] { visibility: hidden }
```

`bind()` removes `d-loading` and sets `d-ready` after the first microtask tick, so `{tokens}` never flash as raw text in the page.

See [FOUC Prevention](./fouc-prevention.md) for details.

## Best Practices

### 1. Use signals for anything reactive

```ts
// GOOD — signal updates the DOM automatically
bind(root, { title: signal('Hello'), count });

// BAD — plain string is static, will never update
bind(root, { title: 'Hello' });
```

### 2. Keep the context flat

```ts
// GOOD
bind(root, { name, email, onSubmit });

// BAD — bind() cannot reach inside nested objects
bind(root, { user: { name, email } });
```

### 3. Use zero-arity getters for computed text

```ts
// GOOD — reactive, tracks any signals read inside
bind(root, { fullName: () => `${first()} ${last()}` });

// ALSO GOOD — explicit computed signal
bind(root, { fullName: computed(() => `${first()} ${last()}`) });
```

### 4. Never put event handlers in text templates

```html
<!-- BAD — resolve() warns and renders empty -->
<p>{onClick}</p>

<!-- GOOD -->
<button d-on-click="onClick">Click</button>
```

### 5. Sanitise before d-html

```ts
// GOOD
bind(root, { content: () => DOMPurify.sanitize(userInput()) });

// BAD — raw user input goes directly into innerHTML
bind(root, { content: userInput });
```

### 6. Always call dispose()

```ts
const dispose = bind(root, ctx);

// On route change, unmount, or component teardown:
dispose();  // stops all effects, removes all listeners
```

## Common Pitfalls

### Pitfall 1: Expecting functions with params to render as text

```ts
const ctx = { onClick: (e) => handleClick(e) };
bind(root, ctx);
// {onClick} in a template renders as empty string — resolve() does not call it

// If you need a label, use a separate value:
bind(root, { ...ctx, label: 'Click me' });
```

### Pitfall 2: Expecting setAttribute to keep form inputs in sync

```html
<!-- d-attr-value uses the .value property automatically — this works -->
<input d-attr-value="name">
```

`d-attr-value` sets `.value` as a property, not via `setAttribute`.  This is the only way to stay in sync after user input.  Do not try to replicate this with `setAttribute` manually.

### Pitfall 3: Expecting `{token}` to show the word "null"

```ts
const val = signal(null);
// {val} renders as empty string, not the literal "null"
// Same for undefined — this is intentional

// Explicit fallback via getter:
bind(root, { val: () => val() ?? 'N/A' });
```

### Pitfall 4: Putting d-each on a root that also needs to stay in the DOM

```html
<!-- d-each replaces this element with clones — it disappears -->
<ul id="app" d-each="items">
  <li>{name}</li>
</ul>

<!-- Wrap in a stable container instead -->
<ul id="app">
  <li d-each="items">{name}</li>
</ul>
```

### Pitfall 5: Assuming match cases are static

```html
<!-- Cases are re-queried on every signal change, so this works: -->
<div d-match="mode">
  <div case="a">A</div>
  <div case="b" d-if="showB">B</div>  <!-- added/removed dynamically -->
</div>
```

No special handling needed — the effect re-queries `[case]` children each time `mode` changes.

## See Also

- [Components](./component.md) — declarative component system
- [Signals](../core/signals.md) — reactive primitives
- [Scope](../core/scope.md) — lifecycle and automatic cleanup
- [Template Spec](../template-spec.md) — full directive syntax reference
- [FOUC Prevention](./fouc-prevention.md) — flash-of-tokens prevention
