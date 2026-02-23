# Dev Server & HMR

Dalila's development server with hot module replacement.

## Quick Start

```bash
npx dalila dev
```

The dev server starts on http://localhost:4242 with automatic HMR.

## HMR Behavior

When you edit a file, the dev server updates modules without full page reload. What happens depends on the file type:

| File Type | What Happens | State Preserved |
|-----------|--------------|-----------------|
| `.ts` (logic) | Reloads module | ❌ Lost (fresh execution) |
| `.html` (template) | Re-renders component | ✅ Preserved |
| `.css` | Injects styles | ✅ Preserved |
| `.ts` (route) | Reloads route | ⚠️ Depends |

### Editing Logic (`.ts`)

When you edit TypeScript files with signal/state:

```ts
// counter.ts
export const count = signal(0);
```

**Behavior:**
- Module is re-executed fresh
- **State is lost** — count resets to 0
- Component re-renders with new code

**Tip:** Use `persist()` for state that should survive HMR.

### Editing Templates (`.html`)

When you edit component templates:

```html
<!-- my-component.html -->
<div>Hello {name}!</div>
```

**Behavior:**
- Template is hot-replaced
- Component re-renders
- **State is preserved** — signals keep their values

### Editing Styles (`.css`)

```css
/* style.css */
button { color: red; }
```

**Behavior:**
- CSS is injected without reload
- **No state change**

## Preserving State Across HMR

Use `persist()` to keep important state:

```ts
import { signal, persist } from 'dalila';

// This survives HMR
const userPrefs = persist(signal({ theme: 'dark' }), { name: 'prefs' });

// This resets on HMR
const tempState = signal(0);
```

## Dev Server Features

### Auto-injection

The dev server automatically:

1. **Injects HMR runtime** — handles module replacement
2. **Preload scripts** — for `persist()` with `preload: true`
3. **Source maps** — for better debugging

### Console Output

```
[Dalila] HMR: Updated component.ts
[Dalila] HMR: Full reload required for router.ts
[Preload] Auto-injecting 1 preload script(s): app-theme
Dalila dev server on http://localhost:4242
```

## Troubleshooting

### "Full reload required"

Some changes can't be hot-replaced:

```ts
// Route files need full reload
export const routes = [...];  // Edit here → full reload
```

**Why:** Route tables are built at compile time.

**Solution:** Just refresh the page manually.

### State disappears

If your state resets on every edit:

**Cause:** You're not using `persist()` for state that matters.

**Solution:**
```ts
// Before: loses state on HMR
const count = signal(0);

// After: survives HMR
const count = persist(signal(0), { name: 'count' });
```

### HMR not working

1. Make sure you're using `npx dalila dev`
2. Check browser console for errors
3. Try manual refresh

## Production

HMR is disabled in production. Use a bundler like Vite:

```bash
npm run build
```

Build output goes to `dist/`.
