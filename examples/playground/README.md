# Dalila Playground

Interactive demos of all Dalila features.

## Theme Persistence (No Flash!)

The theme switcher demonstrates automatic preload with `persist()`:

### How it works

**1. Add `preload: true` flag:**

```ts
// script.ts
const theme = persist(
  signal<Theme>('dark'),
  {
    name: 'app-theme',
    preload: true  // ← dev-server auto-injects preload script
  }
);

// Provide via context
provide(ThemeContext, { theme, toggle: toggleTheme });
```

**2. Dev-server auto-injects the script:**

The dev-server scans `.ts` files, detects `preload: true`, and automatically injects a minimal preload script into the HTML. No manual work needed!

**3. Dev-server auto-injects everything:**

The dev-server automatically:
- Adds `d-loading` to `.container`
- Injects CSS: `[d-loading]{visibility:hidden}`
- Injects theme preload script

```html
<head>
  <style>[d-loading]{visibility:hidden}</style>
  <script>(function(){...theme preload...})()</script>
</head>
<body>
  <div class="container" d-loading>
    <!-- d-loading auto-added -->
  </div>
</body>
```

### Result

- ✅ Theme persists across page reloads
- ✅ No flash of default theme (preload script)
- ✅ No flash of template tokens (d-loading auto-added)
- ✅ ~230 bytes inline script (auto-injected)
- ✅ Shared via Context
- ✅ **Zero configuration** - everything is automatic!

## Run the playground

```bash
npm run serve
```

Open http://localhost:4242/examples/playground/

Check the browser console to see:
```
[Preload] Auto-injecting 1 preload script(s): app-theme
```

You'll notice:
- No flash of default theme (preload script loads before CSS)
- No flash of `{counter}` tokens (d-loading hides them)
- Smooth, professional page load
