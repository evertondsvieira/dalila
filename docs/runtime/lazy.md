# Lazy Loading & Suspense

Dalila provides lazy loading for components and a lightweight suspense wrapper.

## createLazyComponent

Creates a component definition that loads on demand (code splitting).

```ts
import { createLazyComponent } from 'dalila/runtime';

const LazyModal = createLazyComponent(() => import('./Modal'));
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `loading` | `string` | Template to show while loading |
| `error` | `string` | Template to show on failure |
| `loadingDelay` | `number` | Delay before showing loading (ms) |

`loading` and `error` are default templates used by `d-lazy` when `d-lazy-loading` / `d-lazy-error` are not provided on the element.

### State Access

```ts
const { loading, error, component, load, retry, loaded } = getLazyComponentState(tag);

// Or observe changes
observeLazyElement(el, () => load());
```

### Example

```ts
const LazyModal = createLazyComponent(
  () => import('./Modal'),
  {
    loading: '<div class="spinner">Loading...</div>',
    error: '<div class="error">Failed to load</div>',
    loadingDelay: 300
  }
);
```

## createSuspense

Creates a wrapper component that preserves/render children via slot projection.

Current behavior:
- it wraps children in a suspense host (`<div data-suspense>...</div>`)
- it does not currently orchestrate loading/error UI by itself

```ts
import { createSuspense } from 'dalila/runtime';

const Suspense = createSuspense({
  loading: '<div>Loading...</div>',
  error: '<div>Error occurred</div>',
  loadingDelay: 200
});
```

## Utility Functions

### preloadLazyComponent

Preload a lazy component by tag.

```ts
import { preloadLazyComponent } from 'dalila/runtime';

preloadLazyComponent('lazy-modal-123');
```

### isLazyComponentLoaded

Check if a component has already loaded.

```ts
import { isLazyComponentLoaded } from 'dalila/runtime';

if (isLazyComponentLoaded('lazy-modal-123')) {
  // Component is ready
}
```

### getLazyComponentState

Access the loading state of a lazy component.

```ts
import { getLazyComponentState } from 'dalila/runtime';

const state = getLazyComponentState('lazy-modal-123');
console.log(state.loading());   // boolean
console.log(state.error());    // Error | null
console.log(state.loaded());   // boolean
```

### observeLazyElement

Observe an element and run callback when it enters viewport.

Notes:
- uses `IntersectionObserver` when available
- fallback without `IntersectionObserver`: schedules callback in microtask if element is still connected
- returned cleanup cancels pending fallback callback

```ts
import { observeLazyElement } from 'dalila/runtime';

const cleanup = observeLazyElement(el, () => {
  // Load when element becomes visible
}, 0.1); // threshold

// Cleanup when done
cleanup();
```

## Usage in Templates

```html
<!-- Lazy component -->
<lazy-modal-123></lazy-modal-123>

<!-- d-lazy expects a registered lazy component tag -->
<div d-lazy="lazy-modal-123">Scroll to load</div>

<!-- Optional per-element templates -->
<div
  d-lazy="lazy-modal-123"
  d-lazy-loading="<span>Loading...</span>"
  d-lazy-error="<span>Failed</span>">
</div>
```

## Best Practices

1. **Use loadingDelay** - prevent flash on very fast loads
2. **Use preloadLazyComponent** - warm critical lazy chunks
3. **Use d-lazy for viewport loading** - each instance renders only after its own trigger
