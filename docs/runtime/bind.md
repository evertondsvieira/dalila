# Runtime — bind()

The `dalila/runtime` module binds declarative HTML templates to a reactive context.
No `eval`, no inline JS — every directive resolves identifiers from the context object you pass in.

## How it works

```
┌────────────────────────────────────────────────────────────────────┐
│                        bind() pipeline                             │
│                                                                    │
│   HTML template ──► bind(root, ctx) ──► live reactive DOM          │
│                          │                                         │
│                          ├─ 1  d-each      remove template,        │
│                          │                 clone + bind per item   │
│                          ├─ 2  {tokens}    reactive text nodes     │
│                          ├─ 3  d-attr-*    attributes / props      │
│                          ├─ 4  d-html      innerHTML               │
│                          ├─ 5  d-on-*      event listeners         │
│                          ├─ 6  d-when      display toggle          │
│                          ├─ 7  d-match/case conditional show       │
│                          └─ 8  d-if        add / remove from DOM   │
│                                                                    │
│   All reactive effects are owned by a scope.                       │
│   dispose() stops every effect and removes every listener.         │
└────────────────────────────────────────────────────────────────────┘
```

**Key invariants:**

1. **Root-inclusive** — directives on the element passed as `root` are processed, not only descendants.
2. **No double-bind** — `d-each` clones are marked and fully bound before the parent's subsequent passes run; the parent skips them entirely.
3. **Safe resolve** — only signals and zero-arity functions are ever called. Functions with parameters (event handlers) are never invoked as getters.

## API Reference

### bind

```ts
function bind(root: Element, ctx: BindContext, options?: BindOptions): DisposeFunction

interface BindContext {
  [key: string]: unknown;   // signals, getters, handlers, plain values
}

interface BindOptions {
  /** Event types to listen for. Default: click, input, change, submit, keydown, keyup */
  events?: string[];

  /** CSS selectors inside which {token} interpolation is skipped. Default: 'pre, code' */
  rawTextSelectors?: string;
}

type DisposeFunction = () => void;
```

### autoBind

```ts
function autoBind(selector: string, ctx: BindContext, options?: BindOptions): Promise<DisposeFunction>
```

Convenience wrapper — waits for `DOMContentLoaded` if the document is still loading, then calls `bind()`.

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

### Text interpolation `{token}`

Replaces `{name}` placeholders with values from the context.  Multiple tokens per text node are supported.

```html
<p>Hello {name}!</p>
<p>{greeting} {name}, you have {unread} messages</p>
```

**How the value is rendered:**

| Context value | Behaviour |
|---|---|
| `signal` | Reactive — updates automatically when the signal changes |
| zero-arity function (`fn.length === 0`) | Reactive getter — wrapped in an effect, re-renders on dependency change |
| function with parameters | **Never called.** Dev warns. Renders empty string. |
| `null` / `undefined` | Renders as **empty string** |
| anything else | Stringified once (static) |

Text inside `<pre>` and `<code>` is skipped by default (configurable via `rawTextSelectors`).

---

### Event handlers `d-on-*`

Binds an event listener.  The attribute value must name a **function** in the context.

```html
<button d-on-click="increment">+</button>
<input   d-on-input="onInput">
<form    d-on-submit="onSubmit">
```

Default event types: `click`, `input`, `change`, `submit`, `keydown`, `keyup`.
Custom events can be added via `options.events`.

Listeners are removed automatically when `dispose()` is called.

---

Directive attribute values use plain identifiers only: `d-when="isVisible"` (not `d-when="{isVisible}"`).

### Conditional visibility `d-when`

Toggles `display` style.  The element stays in the DOM at all times.

```html
<div d-when="isVisible">Shown when truthy</div>
```

Reactive: re-evaluates whenever the bound signal changes.

---

### Conditional rendering `d-if`

Adds or removes the element from the DOM entirely.  A comment node is left as a placeholder so the element can be re-inserted when the condition becomes truthy again.

```html
<div d-if="hasData">Content</div>
```

Use `d-if` instead of `d-when` when you want the element's subtree to be removed (saves layout/paint cost) or when you need to prevent its children from being visible at all.

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
  <li d-each="users">{name} — {email}</li>
</ul>
```

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

- [Signals](../core/signals.md) — reactive primitives
- [Scope](../core/scope.md) — lifecycle and automatic cleanup
- [Template Spec](../template-spec.md) — full directive syntax reference
- [FOUC Prevention](./fouc-prevention.md) — flash-of-tokens prevention
