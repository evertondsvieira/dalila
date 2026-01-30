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

A binding can contain:
- `name` (e.g., `"increment"`)
- Optionally simple path `a.b.c` (if supported)

**Not supported:**
- Function calls: `foo()`
- Operators: `a + b`
- Inline JS

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
```

### Rules

| Condition | Behavior |
|-----------|----------|
| `ctx[key]` is signal | TextNode reacts with `effect()`: `text = String(signal())` |
| `ctx[key]` is not signal | Renders `String(value)` once |
| `ctx[key]` undefined | Warning in dev, keeps literal token |

**Exception:** Interpolation does not run inside `<pre>` and `<code>` (raw text).

## 5. `when` Directive

### Syntax

```html
<div when="isLoggedIn">...</div>
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

## 6. `match` and `case` Directive

### Syntax

```html
<div match="status">
  <section case="loading">Loading...</section>
  <section case="success">OK</section>
  <section case="error">Error</section>
  <section case="default">Unknown</section>
</div>
```

### Rules

1. `match="x"` resolves `ctx.x` (same rules as `when`)
2. Value is compared as `String(value)`
3. Behavior:
   - Hide all `[case]` elements
   - Show the **first** `case` where `caseValue === String(value)`
   - If none match, show `case="default"` (if exists)

Reactive via `effect()`, cleaned up on `dispose()`.

## 7. Lifecycle and Cleanup

```
bind() creates:
  └── templateScope (root Scope)
       ├── effect() for each {interpolation}
       ├── effect() for each [when]
       ├── effect() for each [match]
       └── event listeners

dispose() cleans up:
  ├── Removes event listeners
  ├── Stops effects (via scope.dispose())
  └── Disconnects observers (if any)
```

## 8. Dev Mode

In dev mode, the runtime logs warnings:

| Situation | Warning |
|-----------|---------|
| `d-on-click="foo"` but `ctx.foo` undefined | `Event handler "foo" not found in context` |
| `ctx.foo` is not a function | `Event handler "foo" is not a function` |
| `{x}` but `ctx.x` undefined | `Text interpolation: "x" not found in context` |
| `when="y"` but `ctx.y` undefined | `when: "y" not found in context` |

## 9. Future Compatibility (Compiler)

This spec defines **semantics**. A future compiler must generate code that produces the **same result** as the runtime, following these exact rules.

```
┌─────────────────────────────────────────────────────┐
│                    HTML Template                     │
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
   │              Same behavior                       │
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
