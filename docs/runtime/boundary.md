# Error Boundary

Dalila provides boundary utilities to render fallback UI from an error signal.

## createErrorBoundary

Creates a boundary component that wires `d-boundary` + internal error/reset signals.

Important:
- it does not automatically catch every runtime error in descendants
- you should set boundary error explicitly (for example with `withErrorBoundary()` or `createErrorBoundaryState()`)

```ts
import { createErrorBoundary } from 'dalila/runtime';

const ErrorBoundary = createErrorBoundary({
  fallback: '<div class="error">Something went wrong</div>',
  onError: (err) => console.error(err),
});
```

### Options

| Option | Type | Description |
|--------|------|-------------|
| `fallback` | `string` | Template to show when error occurs |
| `onError` | `(error: Error) => void` | Callback when error is caught |
| `onReset` | `() => void` | Callback when error is reset |

## createErrorBoundaryState

Creates `error/reset/hasError` state for component setup.

```ts
import { createErrorBoundaryState } from 'dalila/runtime';

const MyComponent = defineComponent({
  tag: 'my-component',
  setup(props, ctx) {
    const { error, reset, hasError } = createErrorBoundaryState({
      onError: (err) => logError(err),
    });

    const handleClick = () => {
      withErrorBoundary(() => {
        // risky operation
      }, error);
    };

    return { error, handleClick };
  }
});
```

## withErrorBoundary

Wraps a function and writes thrown errors into an error signal.

```ts
import { withErrorBoundary } from 'dalila/runtime';

const result = withErrorBoundary(
  () => riskyOperation(),
  errorSignal
);
```

Returns `undefined` if error occurs.

## bindBoundary

Directive-level boundary for a subtree.

Behavior:
- preserves the host element in DOM
- swaps internal content between children and fallback
- fallback subtree is bind-processed (so directives like `d-on-click="reset"` work)

```html
<div d-boundary="fallback template" d-boundary-error="errorSignal" d-boundary-reset="resetFn">
  <!-- children -->
</div>
```

## Usage Example

```ts
import { defineComponent } from 'dalila/runtime';
import { signal } from 'dalila';

const MyComponent = defineComponent({
  tag: 'my-component',
  setup() {
    const { error, reset, hasError } = createErrorBoundaryState({
      onError: (err) => console.error('Caught:', err),
    });

    const doSomething = () => {
      withErrorBoundary(() => {
        throw new Error('Oops!');
      }, error);
    };

    return { error, reset, hasError, doSomething };
  }
});
```

```html
<my-component>
  <button d-on-click="doSomething">Try</button>
  <p d-if="hasError">Error: {error.message}</p>
  <button d-if="hasError" d-on-click="reset">Retry</button>
</my-component>
```

## Best Practices

1. **Wrap risky operations** with `withErrorBoundary`
2. **Expose reset action** in fallback UI
3. **Log with onError** for monitoring/telemetry
4. **Use small boundaries** around risky areas
