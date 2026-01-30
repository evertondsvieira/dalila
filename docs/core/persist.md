# Persist - Automatic Storage Sync for Signals

The `persist()` function enables signals to automatically synchronize with storage (localStorage, sessionStorage, etc.), eliminating boilerplate for data persistence.

## Quick Start

```ts
import { signal, persist } from 'dalila';

// Basic usage
const count = persist(
  signal(0),
  { name: 'counter' }
);

// Changes save automatically
count.set(5); // → localStorage['counter'] = "5"
```

For UI state like themes, add `preload: true` to prevent visual flash:

```ts
const theme = persist(
  signal('dark'),
  {
    name: 'app-theme',
    preload: true  // ← dev-server auto-injects preload script
  }
);
```

## Options

### `name` (required)

Storage key name. Must be unique.

```ts
const user = persist(signal<User | null>(null), { name: 'current-user' });
```

### `preload` (optional)

Enable automatic preload script injection to prevent FOUC (Flash of Unstyled Content). The dev-server detects `preload: true` and automatically injects a synchronous script that loads the value before CSS.

```ts
const theme = persist(signal('dark'), {
  name: 'app-theme',
  preload: true  // ← Auto-injected by dev-server
});
```

**When to use:**
- ✅ Theme, locale, layout mode, font size
- ❌ User data, session state, large data

See [Preventing FOUC](#preventing-fouc-flash-of-unstyled-content) for details.

### `storage` (optional)

Custom storage implementation. Default: `localStorage`

```ts
// Use sessionStorage
const temp = persist(signal('data'), {
  name: 'temp-data',
  storage: sessionStorage
});

// Custom storage
const customStorage = {
  getItem: (key: string) => { /* ... */ },
  setItem: (key: string, value: string) => { /* ... */ },
  removeItem: (key: string) => { /* ... */ }
};
```

### `serializer` (optional)

Custom serializer. Default: `JSON`

```ts
import superjson from 'superjson';

const data = persist(signal(new Date()), {
  name: 'date',
  serializer: {
    serialize: (value) => superjson.stringify(value),
    deserialize: (str) => superjson.parse(str)
  }
});
```

### `version` and `migrate` (optional)

Versioning and data migration when schema changes.

```ts
const todos = persist(signal<TodoV2[]>([]), {
  name: 'todos',
  version: 2,
  migrate: (persisted, version) => {
    if (version < 2) {
      return (persisted as TodoV1[]).map(todo => ({
        ...todo,
        done: false,
        createdAt: new Date()
      }));
    }
    return persisted as TodoV2[];
  }
});
```

### `merge` (optional)

Merge strategy when hydrating. Default: `'replace'`

```ts
const settings = persist(signal({ theme: 'dark', lang: 'en' }), {
  name: 'settings',
  merge: 'shallow'  // Shallow merge with initial state
});
```

### `onRehydrate` and `onError` (optional)

Callbacks for hydration and error handling.

```ts
const data = persist(signal([]), {
  name: 'data',
  onRehydrate: (state) => console.log('Restored:', state),
  onError: (error) => console.error('Failed:', error)
});
```

## Preventing FOUC (Flash of Unstyled Content)

When persisting UI state like themes, you may see a flash before the persisted value loads. Use `preload: true` to prevent this.

### Automatic (Dev Server)

The dev-server automatically detects `preload: true` and injects the script.

**1. Add the flag:**

```ts
const theme = persist(signal('dark'), {
  name: 'app-theme',
  preload: true
});
```

**2. HTML stays clean:**

```html
<head>
  <!-- Preload scripts auto-injected by dev-server -->
  <link rel="stylesheet" href="styles.css">
</head>
```

**3. See it working:**

```bash
[Preload] Auto-injecting 1 preload script(s): app-theme
Dalila dev server on http://localhost:4242
```

**How it works:**
1. Dev-server scans `.ts` files for `preload: true`
2. Generates minimal inline script (~230 bytes)
3. Injects before CSS to prevent flash

### Manual (Production)

For production builds, use generator functions.

**`createThemeScript`** - Quick helper for themes:

```ts
import { createThemeScript } from 'dalila';

const script = createThemeScript('app-theme', 'dark');

// Inject into HTML template
const html = `<head><script>${script}</script>...`;
```

**`createPreloadScript`** - Full control:

```ts
import { createPreloadScript } from 'dalila';

const script = createPreloadScript({
  storageKey: 'user-locale',
  defaultValue: 'en',
  target: 'documentElement',
  attribute: 'lang',
  storageType: 'localStorage'
});
```

## Examples

### Basic: Counter

```ts
const count = persist(signal(0), { name: 'counter' });

count.set(5);  // Saves automatically
```

### Todo App

**Before (manual):**

```ts
const items = signal<Todo[]>([]);

const saved = localStorage.getItem('todos');
if (saved) {
  try {
    items.set(JSON.parse(saved));
  } catch { /* Handle error */ }
}

effect(() => {
  localStorage.setItem('todos', JSON.stringify(items()));
});
```

**After (automatic):**

```ts
const items = persist(signal<Todo[]>([]), { name: 'todos' });
```

### Theme with Context

```ts
import { signal, persist, createContext, provide, inject } from 'dalila';

type Theme = 'light' | 'dark';

// Create persisted signal with preload
const theme = persist(signal<Theme>('dark'), {
  name: 'app-theme',
  preload: true
});

// Provide via context
const ThemeContext = createContext<Signal<Theme>>('theme');
provide(ThemeContext, theme);

// Use in child components
const currentTheme = inject(ThemeContext);
const toggleTheme = () => {
  currentTheme.update(t => t === 'light' ? 'dark' : 'light');
};
```

## Utilities

### `createJSONStorage`

Helper to create storage wrapper.

```ts
import { persist, createJSONStorage } from 'dalila';

const data = persist(signal({}), {
  name: 'data',
  storage: createJSONStorage(() => sessionStorage)
});
```

### `clearPersisted`

Clear persisted data.

```ts
import { clearPersisted } from 'dalila';

clearPersisted('todos');
clearPersisted('temp-data', sessionStorage);
```

## How It Works

1. **Hydration**: Restores value from storage on initialization
2. **Reactivity**: Creates `effect()` to watch signal changes
3. **Persistence**: Saves automatically when signal changes
4. **Serialization**: Uses JSON by default, accepts custom serializers
5. **Versioning**: Optionally checks version and migrates old data

## Notes

- Works best inside a scope (to use `effect`)
- Falls back to `signal.on()` when no scope available
- Supports async storage (React Native's AsyncStorage, etc.)
- Errors are handled gracefully
- Returned signal has same API as original signal
