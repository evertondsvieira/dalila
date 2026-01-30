# Runtime - Template Binding

The `dalila/runtime` module provides the `bind()` function for declarative HTML templates.

## Quick Start

```html
<div id="app">
  <p>Count: {count}</p>
  <button d-on-click="increment">+</button>
</div>
```

```ts
import { bind } from 'dalila/runtime';
import { signal } from 'dalila';

const count = signal(0);
const ctx = {
  count,
  increment: () => count.update(n => n + 1)
};

bind(document.getElementById('app')!, ctx);
```

## Features

### Text Interpolation

Use `{tokenName}` to insert reactive values:

```html
<p>Hello {name}!</p>
<p>Count: {count}</p>
<p>{greeting} {name}, you have {unread} messages</p>
```

### Event Handlers

Use `d-on-*` attributes:

```html
<button d-on-click="increment">+</button>
<input d-on-input="handleInput">
<form d-on-submit="handleSubmit">
```

Supported events:
- `d-on-click`
- `d-on-input`
- `d-on-change`
- `d-on-submit`
- `d-on-keydown`
- `d-on-keyup`

### Conditional Rendering

Use `when` attribute:

```html
<p when={isVisible}>This shows when isVisible is truthy</p>
<p when={isHidden}>This shows when isHidden is truthy</p>
```

### Pattern Matching

Use `match` and `case` attributes:

```html
<div match={status}>
  <p case="loading">Loading...</p>
  <p case="error">Error occurred</p>
  <p case="success">Success!</p>
  <p case="default">Unknown status</p>
</div>
```

## FOUC Prevention

The dev-server automatically prevents Flash of Unstyled Content:

- Detects root elements (`.container`, `#app`)
- Adds `d-loading` attribute automatically
- Injects CSS: `[d-loading]{visibility:hidden}`
- `bind()` removes `d-loading` when ready

**You don't need to do anything - it's automatic in development!**

See [FOUC Prevention](./fouc-prevention.md) for details.

## API

### `bind(root, ctx, options?)`

Binds a DOM tree to a reactive context.

**Parameters:**
- `root: Element` - The root element to bind
- `ctx: BindContext` - Context object with reactive values and handlers
- `options?: BindOptions` - Optional configuration

**Returns:** `() => void` - Dispose function to cleanup bindings

**Example:**

```ts
const dispose = bind(rootElement, ctx);

// Later, cleanup:
dispose();
```

### `autoBind(selector, ctx, options?)`

Automatically binds when DOM is ready.

**Parameters:**
- `selector: string` - CSS selector for root element
- `ctx: BindContext` - Context object
- `options?: BindOptions` - Optional configuration

**Returns:** `Promise<() => void>` - Promise that resolves to dispose function

**Example:**

```ts
import { autoBind } from 'dalila/runtime';

autoBind('#app', ctx).then(dispose => {
  console.log('Bound!');
});
```

## Options

```ts
interface BindOptions {
  // Event types to bind (default: click, input, change, submit, keydown, keyup)
  events?: string[];

  // Selectors for elements where text interpolation should be skipped
  rawTextSelectors?: string; // default: 'pre, code'
}
```

## Best Practices

1. **Keep templates in HTML** - avoid string templates in JS
2. **Use signals for reactive state** - not plain values
3. **Keep context flat** - avoid deep nesting
4. **Clean up** - call dispose when done
5. **Use semantic HTML** - bind() enhances, doesn't replace good HTML

## Examples

### Counter

```html
<div id="app">
  <p>Count: {count}</p>
  <button d-on-click="decrement">-</button>
  <button d-on-click="increment">+</button>
  <p when={isEven}>Even number</p>
  <p when={isOdd}>Odd number</p>
</div>
```

```ts
import { bind } from 'dalila/runtime';
import { signal, computed } from 'dalila';

const count = signal(0);
const isEven = computed(() => count() % 2 === 0);
const isOdd = computed(() => count() % 2 !== 0);

bind(document.getElementById('app')!, {
  count,
  isEven,
  isOdd,
  increment: () => count.update(n => n + 1),
  decrement: () => count.update(n => n - 1)
});
```

### Form Handling

```html
<form d-on-submit="handleSubmit">
  <input d-on-input="updateName" placeholder="Name">
  <p>Hello {name}!</p>
  <button type="submit">Submit</button>
</form>
```

```ts
import { bind } from 'dalila/runtime';
import { signal } from 'dalila';

const name = signal('');

bind(document.querySelector('form')!, {
  name,
  updateName: (e: Event) => {
    name.set((e.target as HTMLInputElement).value);
  },
  handleSubmit: (e: Event) => {
    e.preventDefault();
    console.log('Submitted:', name());
  }
});
```

## See Also

- [FOUC Prevention](./fouc-prevention.md) - Prevent flash of tokens
- [Signals](../core/signals.md) - Reactive state
- [Template Spec](../template-spec.md) - Full syntax reference
