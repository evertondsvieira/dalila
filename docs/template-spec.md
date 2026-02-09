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

### Rules

| Condition | Behavior |
|-----------|----------|
| expression reads signal/getter | TextNode reacts with `effect()` and updates automatically |
| expression reads only static values | Renders once |
| `ctx[key]` undefined | Warning in dev, keeps literal token |

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

## 7. `d-if` Directive

### Syntax

```html
<div d-if="hasUsers">...</div>
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx.cond` is signal | Uses `cond()` |
| `ctx.cond` is function | Calls `cond()` |
| Otherwise | Uses value directly |

When truthy, the element is inserted in the DOM. When falsy, the element is
removed from the DOM entirely (a comment placeholder keeps the position).

**Note:** `d-if` removes/reattaches nodes. Use `d-when` if you only need
visibility toggling via `display: none`.

## 8. `d-each` Directive

### Syntax

```html
<li d-each="users">{name}</li>
<li d-each="users" d-key="id">{name}</li>
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
- If the item is not an object, it is exposed as `{item}`.
- Updates use keyed diffing: existing DOM nodes are moved/reused when keys match.
- `d-key` is optional and accepts an item property name (e.g. `id`).
- Without `d-key`, object items fall back to `item.id`/`item.key`; otherwise index is used.

**Note:** For dynamic/reordered lists, set `d-key` to a stable unique field.

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

## 11. Lifecycle and Cleanup

```
bind() creates:
  └── templateScope (root Scope)
       ├── effect() for each {interpolation}
       ├── effect() for each [d-when]
       ├── effect() for each [d-match]
       └── event listeners

dispose() cleans up:
  ├── Removes event listeners
  ├── Stops effects (via scope.dispose())
  └── Disconnects observers (if any)
```

## 12. Dev Mode

In dev mode, the runtime logs warnings:

| Situation | Warning |
|-----------|---------|
| `d-on-click="foo"` but `ctx.foo` undefined | `Event handler "foo" not found in context` |
| `ctx.foo` is not a function | `Event handler "foo" is not a function` |
| `{x}` but `ctx.x` undefined | `Text interpolation: "x" not found in context` |
| `d-when="y"` but `ctx.y` undefined | `d-when: "y" not found in context` |
| `d-if="y"` but `ctx.y` undefined | `d-if: "y" not found in context` |
| `d-each="list"` but `ctx.list` undefined | `d-each: "list" not found in context` |
| `d-each="list"` but not array/signal | `d-each: "list" is not an array or signal` |
| `d-html="x"` but `ctx.x` undefined | `d-html: "x" not found in context` |
| `d-attr-href="x"` but `ctx.x` undefined | `d-attr-href: "x" not found in context` |

## 13. Future Compatibility (Compiler)

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
