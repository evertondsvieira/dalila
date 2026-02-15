# Dalila Template Runtime Spec (v0.1)

Dalila uses "natural" HTML with declarative bindings. Attributes **do not execute inline JavaScript** — they reference identifiers resolved from `ctx`.

## 1. Scope and Initialization

```ts
import { bind } from 'dalila/runtime';

const dispose = bind(rootElement, ctx);
```

| Parameter | Description |
|-----------|-------------|
| `rootElement` | Root element where bindings will be applied |
| `ctx` | Object containing handlers, values, and signals |
| `dispose()` | Removes listeners and stops effects/resources |

**Security rule:** No binding uses `eval`, `new Function`, or executes strings.

## 2. Naming Conventions

Directive attribute bindings use:
- `name` (e.g., `"increment"`)

**Not supported:**
- Function calls: `foo()`
- Operators: `a + b`
- Inline JS

Text interpolation supports expressions inside `{...}` in text nodes (for example: `{count + 1}`, `{items.length}`).

If the identifier doesn't exist in `ctx`, the binding is ignored (with warning in dev mode).

## 3. Events

### Syntax

```html
<button d-on-click="increment">+</button>
<form d-on-submit="save"></form>
<input d-on-input="onInput" />
```

### Rules

| Rule | Description |
|------|-------------|
| `d-on-<event>` | Adds `addEventListener("<event>", handler)` |
| Resolution | Handler is resolved by name from `ctx` |
| Validation | If `ctx[handler]` is not a function, ignored (warning in dev) |
| Cleanup | `bind()` removes the listener on `dispose()` |

### Supported Events (default)

`click`, `input`, `change`, `submit`, `keydown`, `keyup`

## 3.1 `d-emit-<event>` Directive (Component Events)

### Syntax

```html
<!-- Emits 'select' with the DOM Event -->
<button d-emit-click="select">Pick</button>

<!-- Emits 'select' with the resolved value expression -->
<button d-emit-click="select" d-emit-value="item">{item}</button>
```

### Rules

| Rule | Description |
|------|-------------|
| `d-emit-<event>="name"` | On `<event>`, calls the parent's `d-on-name` handler with the DOM Event |
| `d-emit-value="expr"` | Optional payload expression for `d-emit-*` (supports identifiers, member access, and `$event`) |
| Scope | Only active inside component templates (where `COMPONENT_EMIT_KEY` exists in context) |
| `d-each` | Works inside `d-each` — each clone resolves its own context value via prototype chain |
| Outside component | Silently ignored (no error) |
| Cleanup | Listeners are removed on `dispose()` |

### Supported Events

`d-emit-*` binds via `addEventListener` directly — it accepts **any valid DOM event name** (`click`, `focus`, `blur`, `mouseenter`, `scroll`, etc.), not just the default `d-on-*` set.

## 4. Text Interpolation

### Syntax

```html
<p>Count: {count}</p>
<p>Hello {name}!</p>
<p>Next: {count + 1}</p>
<p>Total: {items.length}</p>
<p>Status: {isActive ? 'Yes' : 'No'}</p>
<p>User: {user?.name}</p>
<p>First: {items?.[0]?.title}</p>
```

### Supported Expression Syntax

The expression engine parses a safe subset of JavaScript — **no `eval` or `new Function`**.

| Category | Operators / Syntax |
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

**Not supported:** function calls (`foo()`), assignment, `typeof`, `instanceof`, template literals.

### Rules

| Condition | Behavior |
|-----------|----------|
| expression reads signal/getter | TextNode reacts with `effect()` and updates automatically |
| expression reads only static values | Renders once (synchronously during `bind()`) |
| `ctx[key]` undefined | Warning in dev, keeps literal token |
| Nested member access on signal/getter | Tracked reactively (e.g. `{user.name}` where `user.name` is a signal) |

**First render:** All expressions are evaluated synchronously during `bind()`, before the microtask flush. This prevents empty text nodes from flashing briefly.

**Exception:** Interpolation does not run inside `<pre>` and `<code>` (raw text).

## 5. `d-when` Directive

### Syntax

```html
<div d-when="isLoggedIn">...</div>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.cond` is signal | Uses `cond()` |
| `ctx.cond` is function | Calls `cond()` |
| Otherwise | Uses value directly |

The element becomes:
- **Visible** when truthy
- `style.display = 'none'` when falsy

Reactive via `effect()`, cleaned up on `dispose()`.

### 5.1 `d-transition` with `d-when`

If an element has `d-transition="..."`, `d-when` toggles transition state attributes:

- Enter: sets `data-enter`, removes `data-leave`
- Leave: sets `data-leave`, removes `data-enter`

When leaving, `display: none` is applied only after transition duration completes
(derived from CSS transition duration/delay or configured transition duration).

Custom transition hooks can be provided via runtime config:

```ts
configure({
  transitions: [
    { name: 'fade', duration: 300, enter: (el) => {}, leave: (el) => {} }
  ]
});
```

## 6. `d-match` and `case` Directive

### Syntax

```html
<div d-match="status">
  <section case="loading">Loading...</section>
  <section case="success">OK</section>
  <section case="error">Error</section>
  <section case="default">Unknown</section>
</div>
```

### Rules

1. `d-match="x"` resolves `ctx.x` (same rules as `d-when`)
2. Value is compared as `String(value)`
3. Behavior:
   - Hide all `[case]` elements
   - Show the **first** `case` where `caseValue === String(value)`
   - If none match, show `case="default"` (if exists)

Reactive via `effect()`, cleaned up on `dispose()`.

## 7. `d-if` / `d-else` Directive

### Syntax

```html
<div d-if="hasUsers">...</div>

<!-- Optional: inverse branch on the immediate next sibling -->
<div d-if="hasItems">Items here</div>
<div d-else>No items</div>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.cond` is signal | Uses `cond()` |
| `ctx.cond` is function | Calls `cond()` |
| Otherwise | Uses value directly |

When truthy, the element is inserted in the DOM. When falsy, the element is
removed from the DOM entirely (a comment placeholder keeps the position).

If the immediate next sibling element has the `d-else` attribute, the two
branches toggle inversely. `d-if` without `d-else` works exactly as before.

**Note:** `d-if` removes/reattaches nodes. Use `d-when` if you only need
visibility toggling via `display: none`.

### 7.1 `d-transition` with `d-if`

If `d-transition` is present on a `d-if` branch:
- entering applies `data-enter`
- leaving applies `data-leave`
- node removal is delayed until leave duration completes

This applies to both `d-if` and immediate `d-else` branch elements.

## 7.2 `d-portal` Directive

### Syntax

```html
<div d-portal="#modal-root">...</div>
<div d-portal="showModal ? '#modal-root' : null">...</div>
<div d-portal="modalTarget">...</div>
```

### Rules

`d-portal` resolves expression in context and supports:
- selector string (`document.querySelector`)
- `Element`
- `null` / `false` (restores to original anchor position)

If target changes reactively, the element is moved to the new target.

`createPortalTarget(id)` can be used to create/reuse a target element and pass it as signal.

## 8. `d-each` Directive

### Syntax

```html
<li d-each="users as user">{user.name}</li>
<li d-each="users as user" d-key="id">{user.name}</li>

<!-- Alias syntax: name the current item -->
<li d-each="users as user" d-key="user">{user}</li>
<button d-each="fruits as fruit" d-text="fruit" d-emit-click="select" d-emit-value="fruit"></button>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.list` is signal | Uses `list()` |
| `ctx.list` is array | Uses array directly |
| Otherwise | Warning and renders empty |

Behavior:
- The element with `d-each` is treated as a template.
- The template is removed from the DOM and replaced with a comment marker.
- For each item, the template is cloned and bound.
- If the item is an object, its properties become the binding context.
- If the item is not an object, it is exposed as `{item}` (or the alias name if using `as`).
- The `as alias` syntax (`d-each="items as fruit"`) exposes the item under the alias name; `item` is still set for backward compatibility.
- Updates use keyed diffing: existing DOM nodes are moved/reused when keys match.
- `d-key` is optional and accepts an item property name, `$index`, `item`, or the alias name.
- Without `d-key`, object items fall back to `item.id`/`item.key`; otherwise index is used.

**Note:** For dynamic/reordered lists, set `d-key` to a stable unique field.

## 8.1 `d-virtual-each` Directive

### Syntax

```html
<div class="viewport">
  <div
    d-virtual-each="rows"
    d-virtual-item-height="48"
    d-virtual-overscan="4"
    d-key="id"
  >
    {title}
  </div>
</div>
```

### Rules

| Rule | Description |
|------|-------------|
| `d-virtual-item-height` | Required. Fixed row height in pixels (number or numeric context value). |
| `d-virtual-overscan` | Optional. Extra rows before/after viewport (default: `6`). |
| `d-virtual-height` | Optional. Sets parent scroll container height. |
| Windowing | Only visible rows + overscan are mounted in DOM. |
| Context | Exposes same loop helpers as `d-each` (`item`, `$index`, `$count`, `$first`, `$last`, `$odd`, `$even`). |
| Fallback | Invalid `d-virtual-item-height` falls back to `d-each`. |

V1 is fixed-height and vertical-only.

## 9. `d-html` Directive

### Syntax

```html
<div d-html="content"></div>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.html` is signal | Uses `html()` and updates reactively |
| Otherwise | Renders once |

`d-html` sets `innerHTML` directly. Values are **not sanitized** — only use
trusted HTML or sanitize before binding.

## 9.1 `d-text` Directive

### Syntax

```html
<span d-text="username"></span>
<p d-text="statusMessage"></p>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.value` is signal | Uses `value()` and updates reactively |
| `ctx.value` is zero-arity function | Calls `value()` and updates reactively |
| Otherwise | Renders once (static) |

`d-text` sets `textContent` — safe from XSS by design (no HTML parsing). `null` / `undefined` render as empty string.

Use `d-text` when you want to set the entire text content of an element to a single value. Use `{...}` interpolation for mixed text (e.g., `Hello {name}!`).

## 10. `d-attr-*` Directive

### Syntax

```html
<a d-attr-href="url">Profile</a>
<div d-attr-class="className"></div>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.value` is signal | Uses `value()` and updates reactively |
| Otherwise | Renders once |

`d-attr-*` removes the directive attribute and sets the target attribute to
`String(value)` for any attribute name (e.g. `href`, `class`, `style`, `id`).

## 10.1 `d-bind-*` Directive (Two-way Binding)

### Syntax

```html
<input d-bind-value="name" />
<textarea d-bind-value="bio"></textarea>
<select d-bind-value="choice">...</select>
<input type="checkbox" d-bind-checked="done" />
<input d-bind-disabled="locked" d-bind-placeholder="ph" />
```

### Rules

| Rule | Description |
|------|-------------|
| `d-bind-value="key"` | Two-way binding between `ctx[key]` (signal) and `.value` property |
| `d-bind-checked="key"` | Two-way binding between `ctx[key]` (signal) and `.checked` property |
| `d-bind-readonly="key"` | Reactive binding to `.readOnly` |
| `d-bind-disabled="key"` | Reactive binding to `.disabled` |
| `d-bind-maxlength="key"` | Reactive binding to `.maxLength` |
| `d-bind-placeholder="key"` | Reactive binding to `.placeholder` |
| `d-bind-pattern="key"` | Reactive binding to `.pattern` |
| `d-bind-multiple="key"` | Reactive binding to `.multiple` (e.g. `<select>`) |
| `d-bind-transform="fn"` | Outbound transform: signal value -> displayed value |
| `d-bind-parse="fn"` | Inbound parse: displayed/input value -> signal value |
| Signal required | `ctx[key]` **must** be a signal. Non-signals are ignored with a dev-mode warning. |
| Outbound | Signal changes update the DOM property reactively via `effect()` |
| Inbound (input/textarea) | Listens to `input` event, sets `signal.set(el.value)` |
| Inbound (select) | Listens to `change` event, sets `signal.set(el.value)` |
| Inbound (checkbox) | Listens to `change` event, sets `signal.set(el.checked)` |
| Multiple bindings | Multiple `d-bind-*` directives can coexist on the same element |
| Cleanup | `dispose()` removes the event listener and stops the effect |

### Dev-mode warnings

| Situation | Warning |
|-----------|---------|
| `d-bind-value="x"` but `ctx.x` is not a signal | `d-bind-value: "x" must be a signal` |
| `d-bind-checked="x"` but `ctx.x` is not a signal | `d-bind-checked: "x" must be a signal` |

## 11. `d-ref` Directive

### Syntax

```html
<input d-ref="searchInput" type="text" />
<button d-ref="submitBtn">Go</button>
```

### Rules

| Rule | Description |
|------|-------------|
| `d-ref="name"` | Registers the element under `name` in the bind handle's ref map |
| Collection | One-time, during `bind()` — not reactive |
| Scope | Scoped to the `bind()` call — refs inside `d-each` clones belong to the clone |
| Duplicates | Last-write-wins + warning in dev mode |
| Empty name | Ignored + warning in dev mode |
| Access | `handle.getRef("name")` returns `Element \| null` |
| Cleanup | `dispose()` clears all refs |

### Access

```ts
const handle = bind(root, ctx);

handle.getRef('searchInput');  // Element | null
handle.getRefs();              // Readonly<Record<string, Element>>
```

## 12. Component Tags and `d-props-*`

### Component Tags

Custom element tags registered via `bind(root, ctx, { components })` are resolved during the bind pipeline. The original tag is replaced with the component's rendered template.

```html
<user-card d-props-name="userName"></user-card>
```

### `d-props-*` Directive

Binds a parent context value to a component prop. The attribute name after `d-props-` maps to the prop name (kebab-to-camelCase conversion applies).

```html
<!-- Binds ctx.userName to prop "name" -->
<user-card d-props-name="userName"></user-card>

<!-- Kebab converted: binds ctx.isAdmin to prop "isAdmin" -->
<user-card d-props-is-admin="isAdmin"></user-card>
```

### Rules

| Rule | Description |
|------|-------------|
| `d-props-<name>="key"` | Resolves `ctx[key]` and passes it as a signal to the component |
| Static attribute | If no `d-props-*` matches, a plain attribute matching the prop name is coerced by type |
| Reactivity | If the parent value is a signal or zero-arity getter, the prop stays in sync |
| Missing key | Warning in dev mode if `ctx[key]` is undefined |
| Required prop | Warning in dev mode if a required prop has no attribute and no default |

### `d-on-*` on Component Tags

Listens to events emitted by a child component via `ctx.emit()`. The attribute name after `d-on-` maps to the event name, and the value references a function in the parent context.

```html
<!-- Calls ctx.handleSelect(...args) when the child calls ctx.emit('select', ...args) -->
<fruit-picker d-on-select="handleSelect"></fruit-picker>
```

> **Note:** `d-on-*` on component tags is **not** a DOM event listener. It wires the child's `ctx.emit()` to the parent's handler function.

### `d-slot` Directive

Projects content into named slots of a component.

```html
<x-layout>
  <h1 d-slot="header">Title</h1>
  <p>Default slot content</p>
</x-layout>
```

See [Component docs](./runtime/component.md) for full slot documentation.

## 13. Lifecycle and Cleanup

```
bind() creates:
  └── templateScope (root Scope)
       ├── effect() for each [d-text] (reactive values only)
       ├── effect() for each {interpolation} (reactive expressions only)
       ├── effect() for each [d-when]
       ├── transition state updates for [d-transition]
       ├── effect() for each [d-if] / [d-else]
       ├── portal relocation effects for [d-portal]
       ├── effect() for each [d-match]
       ├── effect() for each [d-attr-*] (reactive values only)
       ├── effect() for each [d-bind-*] (outbound sync)
       ├── effect() for each [d-html] (reactive values only)
       ├── effect() for each [d-each] / [d-virtual-each]
       ├── event listeners (d-on-*, d-emit-*, d-bind-* inbound)
       ├── component child scopes (one per resolved component tag)
       └── d-each clone scopes (one per item)

dispose() cleans up:
  ├── Removes event listeners
  ├── Stops effects (via scope.dispose(), cascades into child scopes)
  ├── Clears element refs
  └── Disconnects observers (if any)
```

**Note:** `d-each` and component scopes are children of the root scope — calling `dispose()` on the root cascades through all nested scopes.

## 14. Dev Mode

In dev mode, the runtime logs warnings:

| Situation | Warning |
|-----------|---------|
| `d-on-click="foo"` but `ctx.foo` undefined | `Event handler "foo" not found in context` |
| `ctx.foo` is not a function | `Event handler "foo" is not a function` |
| `{x}` but `ctx.x` undefined | `Text interpolation: "x" not found in context` |
| `d-when="y"` but `ctx.y` undefined | `d-when: "y" not found in context` |
| `d-if="y"` but `ctx.y` undefined | `d-if: "y" not found in context` |
| `d-portal="x"` but `ctx.x` undefined | `d-portal: ... not found in context` |
| `d-each="list"` but `ctx.list` undefined | `d-each: "list" not found in context` |
| `d-each="list"` but not array/signal | `d-each: "list" is not an array or signal` |
| `d-virtual-each="list"` but `ctx.list` undefined | `d-virtual-each: "list" not found in context` |
| `d-virtual-item-height` invalid | `d-virtual-each: invalid item height ... Falling back to d-each.` |
| `d-ref=""` (empty) | `d-ref: empty ref name ignored` |
| `d-ref="x"` duplicated in same scope | `d-ref: duplicate ref name "x" in the same scope` |
| `d-text="x"` but `ctx.x` undefined | `d-text: "x" not found in context` |
| `d-html="x"` but `ctx.x` undefined | `d-html: "x" not found in context` |
| `d-attr-href="x"` but `ctx.x` undefined | `d-attr-href: "x" not found in context` |

## 15. Future Compatibility (Compiler)

This spec defines **semantics**. A future compiler must generate code that produces the **same result** as the runtime, following these exact rules.

```
┌─────────────────────────────────────────────────────┐
│                    HTML Template                    │
│  <button d-on-click="inc">{count}</button>          │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   ┌─────────────┐              ┌─────────────┐
   │   Runtime   │              │  Compiler   │
   │  (bind())   │              │  (future)   │
   └─────────────┘              └─────────────┘
          │                             │
          ▼                             ▼
   ┌─────────────────────────────────────────────────┐
   │              Same behavior                      │
   │  - addEventListener('click', ctx.inc)           │
   │  - effect(() => textNode.data = ctx.count())    │
   └─────────────────────────────────────────────────┘
```

## Usage

### Dev (with HMR)

```bash
npm run serve
```

### Prod (static)

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module">
    import { signal } from 'dalila';
    import { bind } from 'dalila/runtime';

    const count = signal(0);
    const ctx = {
      count,
      increment: () => count.update(n => n + 1),
    };

    bind(document.getElementById('app'), ctx);
  </script>
</head>
<body>
  <div id="app">
    <p>Count: {count}</p>
    <button d-on-click="increment">+</button>
  </div>
</body>
</html>
```
