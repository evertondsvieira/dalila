# FOUC Prevention - Automatic Token Hiding

Dalila automatically prevents Flash of Unstyled Content (FOUC) by hiding template tokens like `{counter}` until bindings are ready.

## The Problem

Without protection, users see raw template tokens on page load:

```html
<!-- User sees this briefly: -->
<p>{counter}</p>
<button>{buttonLabel}</button>

<!-- Then it becomes: -->
<p>0</p>
<button>Click me</button>
```

This happens because:
1. HTML loads and renders immediately
2. JavaScript loads asynchronously
3. `bind()` runs after JavaScript loads
4. There's a gap between HTML render and `bind()` execution

## The Solution (Automatic!)

The dev-server **automatically** adds `d-loading` to root elements and injects CSS.

**You write normal HTML:**

```html
<div class="container">
  <p>{counter}</p>
  <button d-on-click="increment">+</button>
</div>
```

**Dev-server transforms it to:**

```html
<head>
  <style>[d-loading]{visibility:hidden}</style>
</head>
<body>
  <div class="container" d-loading>
    <p>{counter}</p>
    <button d-on-click="increment">+</button>
  </div>
</body>
```

**When `bind()` completes:**

```html
<div class="container" d-ready>
  <p>0</p>
  <button d-on-click="increment">+</button>
</div>
```

**Result**: No flash, smooth transition, zero configuration.

## How It Works

### 1. You write normal HTML

```html
<div class="container">
  <p>Count: {count}</p>
  <button d-on-click="increment">+</button>
</div>
```

### 2. Dev-server auto-injects everything

The dev-server detects root elements (with `class="container"` or `id="app"`) and:

1. Adds `d-loading` attribute to the element
2. Injects CSS: `[d-loading]{visibility:hidden}`

```html
<head>
  <style>[d-loading]{visibility:hidden}</style>
</head>
<body>
  <div class="container" d-loading>
    <!-- Auto-added by dev-server -->
  </div>
</body>
```

### 3. bind() removes `d-loading` when ready

```ts
import { bind } from 'dalila/runtime';
import { signal } from 'dalila';

const ctx = {
  count: signal(0),
  increment: () => ctx.count.update(n => n + 1)
};

bind(document.querySelector('.container')!, ctx);

// Timeline:
// - HTML loads with d-loading (auto-added by dev-server)
// - CSS hides element
// - JS loads and bind() executes
// - Bindings run: text interpolation, events, directives
// - Microtask: remove d-loading, add d-ready
// - Element becomes visible with correct values
```

## Attributes

### `d-loading`

- **Added**: Automatically by dev-server
- **Removed**: After bindings complete (via microtask)
- **Purpose**: Hide raw tokens during binding
- **Targets**: Elements with `class="container"` or `id="app"`

```html
<!-- You write: -->
<div class="container">...</div>

<!-- Dev-server serves: -->
<div class="container" d-loading>...</div>
```

### `d-ready`

- **Added**: Automatically by `bind()` after bindings complete
- **Purpose**: Indicate the element is fully bound and reactive

```html
<!-- After bind() completes: -->
<div class="container" d-ready>
  <!-- Bindings complete, element is reactive -->
</div>
```

## CSS Styling

You can style based on these attributes:

```css
/* Hide while loading (handled automatically by dev-server) */
[d-loading] {
  visibility: hidden;
}

/* Optional: fade in when ready */
[d-ready] {
  animation: fadeIn 0.2s ease-in;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

## Production Setup

For production builds, you need to manually add:

1. The CSS in your main stylesheet:

```css
/* Prevent FOUC in production */
[d-loading] {
  visibility: hidden;
}
```

2. The `d-loading` attribute to your root element:

```html
<!DOCTYPE html>
<html>
<head>
  <style>[d-loading]{visibility:hidden}</style>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div id="app" d-loading>
    <!-- Your app -->
  </div>
</body>
</html>
```

**Note**: In development, the dev-server adds `d-loading` automatically. In production, you must add it manually to your HTML template.

## Why `visibility: hidden` (not `display: none`)?

- `visibility: hidden` preserves layout (no layout shift)
- `display: none` removes from layout (causes shift when shown)

Using `visibility` prevents Cumulative Layout Shift (CLS).

## Comparison with Other Solutions

### Manual approach

```css
.app { visibility: hidden; }
.app.ready { visibility: visible; }
```

```ts
const app = document.getElementById('app');
bind(app, ctx);
app.classList.add('ready'); // Manual!
```

### Dalila approach (automatic!)

```html
<!-- You write: -->
<div id="app">
  <p>{count}</p>
</div>
```

```ts
bind(document.getElementById('app'), ctx);
// Everything automatic - dev-server adds d-loading, bind() removes it
```

## Summary

### Development (Automatic)
- Dev-server detects `.container` or `#app` elements
- Automatically adds `d-loading` attribute
- Automatically injects `[d-loading]{visibility:hidden}` CSS
- `bind()` removes `d-loading` and adds `d-ready` when ready
- **Zero configuration required**

### Production (Manual)
- Add `d-loading` to your root element in HTML
- Include `[d-loading]{visibility:hidden}` in your CSS
- `bind()` removes `d-loading` and adds `d-ready` when ready

## Notes

- Uses `visibility: hidden` to prevent layout shift (better than `display: none`)
- Works with any element that has `class="container"` or `id="app"`
- Attributes are managed by `bind()` - no manual cleanup needed
- Compatible with all browsers
