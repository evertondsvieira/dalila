# Watch and DOM Helpers

These utilities connect Dalila's reactivity to the DOM lifecycle. The key insight: **effects should only run while their DOM is connected**.

## Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                        watch(node, fn)                          │
│                                                                 │
│   Node connected to DOM  ─────►  Effect is ACTIVE               │
│                                  - Tracks signal dependencies   │
│                                  - Re-runs when deps change     │
│                                                                 │
│   Node disconnected      ─────►  Effect is PAUSED               │
│                                  - Unsubscribes from signals    │
│                                  - Saves memory                 │
│                                                                 │
│   Node reconnected       ─────►  Effect RESUMES                 │
│                                  - Re-subscribes and runs       │
│                                                                 │
│   Scope disposed         ─────►  Effect is DISPOSED             │
│                                  - Cleanup runs                 │
│                                  - Cannot be resumed            │
└─────────────────────────────────────────────────────────────────┘
```

## API Reference

### watch

```ts
function watch(node: Node, fn: () => void): () => void
```

Runs `fn` as an effect while `node` is connected to the document. Returns a dispose function.

### Lifecycle hooks

```ts
function onCleanup(fn: () => void): void    // Run when scope disposes
```

### Event helpers

```ts
function useEvent<T extends EventTarget>(
  target: T,
  type: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions
): () => void

function useInterval(fn: () => void, ms: number): () => void
function useTimeout(fn: () => void, ms: number): () => void
```

### Data fetching

```ts
function useFetch<T>(
  url: string | (() => string),
  options?: RequestInit
): {
  data: () => T | null;
  loading: () => boolean;
  error: () => Error | null;
  dispose: () => void;
}
```

## watch: DOM-Bound Reactivity

`watch` is the bridge between signals and DOM elements:

```ts
import { watch, signal } from "dalila";

const count = signal(0);

// Create element
const counter = document.createElement("div");

// Effect runs while counter is in the DOM
watch(counter, () => {
  counter.textContent = `Count: ${count()}`;
});

// Add to DOM - effect activates and runs
document.body.append(counter);

// Signal change - effect re-runs
count.set(5);  // counter shows "Count: 5"

// Remove from DOM - effect pauses (saves resources)
counter.remove();

// Signal change while disconnected - no effect run
count.set(10);  // Nothing happens (counter not in DOM)

// Re-add to DOM - effect resumes
document.body.append(counter);  // counter shows "Count: 10"
```

### watch vs effect: When to Use Which?

| Use `watch` when... | Use `effect` when... |
|---------------------|----------------------|
| Updating a specific DOM element | Side effects not tied to DOM |
| Effect should pause when element is removed | Effect should always run |
| Building UI components | Application-level logic |

```ts
// GOOD: watch for element-specific updates
watch(priceLabel, () => {
  priceLabel.textContent = `$${price()}`;
});

// GOOD: effect for document-level updates
effect(() => {
  document.title = `${count()} items`;
});

// BAD: effect for element that might be removed
effect(() => {
  maybeRemovedElement.textContent = count();  // Might update detached element!
});
```

## Lifecycle Hooks

### onCleanup

Runs when the scope is disposed:

```ts
import { createScope, withScope, onCleanup } from "dalila";

const scope = createScope();

withScope(scope, () => {
  const subscription = externalService.subscribe();

  onCleanup(() => {
    subscription.unsubscribe();
    console.log("Cleaned up");
  });
});

scope.dispose();  // Logs: "Cleaned up"
```

### Combined Example

```ts
import { createScope, withScope, onCleanup, signal, watch } from "dalila";

function createTimer() {
  const scope = createScope();
  const seconds = signal(0);

  withScope(scope, () => {
    let intervalId: number;
    console.log("Timer started");
    intervalId = setInterval(() => {
      seconds.update(s => s + 1);
    }, 1000);

    onCleanup(() => {
      console.log("Timer stopped");
      clearInterval(intervalId);
    });
  });

  return { seconds, dispose: () => scope.dispose() };
}

const timer = createTimer();
// Logs: "Timer started"

timer.dispose();
// Logs: "Timer stopped"
```

## Event Helpers

### useEvent

Adds an event listener that auto-removes on cleanup:

```ts
import { createScope, withScope, useEvent } from "dalila";

const scope = createScope();

withScope(scope, () => {
  // Listener is added immediately
  useEvent(button, "click", (e) => {
    console.log("Button clicked");
  });

  // With options
  useEvent(document, "scroll", handleScroll, { passive: true });

  // Returns manual dispose if needed
  const dispose = useEvent(input, "input", handleInput);
  // dispose();  // Remove early if needed
});

// Scope dispose removes all listeners
scope.dispose();
```

### Comparison: useEvent vs addEventListener

```ts
// WITHOUT useEvent (manual cleanup required)
const handler = (e) => console.log(e);
button.addEventListener("click", handler);
// Must remember to remove:
button.removeEventListener("click", handler);

// WITH useEvent (automatic cleanup)
useEvent(button, "click", (e) => console.log(e));
// Automatically removed when scope disposes
```

### useInterval and useTimeout

```ts
import { createScope, withScope, useInterval, useTimeout } from "dalila";

const scope = createScope();

withScope(scope, () => {
  // Interval that auto-clears
  useInterval(() => {
    console.log("Tick");
  }, 1000);

  // Timeout that auto-clears
  useTimeout(() => {
    console.log("Delayed action");
  }, 5000);
});

// Both are cleared automatically
scope.dispose();
```

### When to Use Built-in vs Manual

```ts
// PREFER useInterval/useTimeout when:
// - You want automatic cleanup on scope dispose
// - The timer is tied to a component lifecycle

// PREFER setInterval/setTimeout when:
// - You need manual control over clearing
// - The timer is application-global
```

## useFetch: Simple Data Fetching

For simple fetch operations without caching:

```ts
import { useFetch, signal, effect } from "dalila";

const userId = signal("1");

// URL can be reactive
const { data, loading, error } = useFetch(() => `/api/users/${userId()}`);

// Use in effects
effect(() => {
  if (loading()) {
    showSpinner();
  } else if (error()) {
    showError(error().message);
  } else if (data()) {
    renderUser(data());
  }
});

// Changing userId triggers new fetch
userId.set("2");
```

### useFetch vs Resource APIs vs Query Client

| Feature | useFetch | createResource/resourceFromUrl | Query Client |
|---------|----------|--------------------------------|--------------|
| Caching | No | Optional | Yes |
| Manual refresh | No | Yes | Yes |
| Invalidation | No | No | Yes |
| Stale time | No | No | Yes |
| Complexity | Low | Medium | High |

**Guidelines:**
- `useFetch`: one-off fetches and prototypes
- `createResource` / `resourceFromUrl`: app flows with manual refresh and optional cache
- `createQueryClient`: production flows with cache invalidation and query orchestration

## Best Practices

### 1. Always use watch for element updates

```ts
// GOOD: Updates pause when element is removed
watch(element, () => {
  element.style.transform = `translateX(${position()}px)`;
});

// BAD: Effect runs even when element is detached
effect(() => {
  element.style.transform = `translateX(${position()}px)`;
});
```

### 2. Scope your cleanup

```ts
// GOOD: Cleanup is scoped
withScope(scope, () => {
  const ws = new WebSocket(url);

  onCleanup(() => {
    ws.close();
  });
});

// BAD: Cleanup might be forgotten
const ws = new WebSocket(url);
// Where do we close this?
```

### 3. Use useEvent for all event listeners

```ts
// GOOD: Auto-cleanup
withScope(scope, () => {
  useEvent(window, "resize", handleResize);
  useEvent(document, "keydown", handleKeydown);
});

// BAD: Manual tracking required
window.addEventListener("resize", handleResize);
document.addEventListener("keydown", handleKeydown);
// Must manually remove both listeners
```

### 4. Prefer reactive URLs in useFetch

```ts
// GOOD: Reactive URL - fetches when userId changes
const userId = signal("1");
const { data } = useFetch(() => `/api/users/${userId()}`);

// LESS GOOD: Static URL - only fetches once
const { data } = useFetch("/api/users/1");
```

## Common Pitfalls

### Pitfall 1: watch outside a scope

```ts
// WARNING: No scope to manage cleanup
watch(element, () => {
  element.textContent = count();
});

// Dalila warns in dev mode
// The effect works but may leak if not manually disposed

// GOOD: Always use inside a scope
withScope(scope, () => {
  watch(element, () => {
    element.textContent = count();
  });
});
```

### Pitfall 2: Expecting watch to run for detached elements

```ts
const element = document.createElement("div");

watch(element, () => {
  console.log("This runs");  // Never runs!
});

// Element is not in DOM, so watch doesn't activate
// Must add to DOM first:
document.body.append(element);  // Now watch runs
```

### Pitfall 3: Creating multiple watches for the same element

```ts
// INEFFICIENT: Multiple watches for same element
watch(element, () => { element.textContent = text(); });
watch(element, () => { element.className = className(); });
watch(element, () => { element.style.color = color(); });

// BETTER: One watch with multiple updates
watch(element, () => {
  element.textContent = text();
  element.className = className();
  element.style.color = color();
});

// Or separate only if dependencies are truly independent:
// (text changes frequently, color rarely)
watch(element, () => { element.textContent = text(); });
// color updates separately
effect(() => { element.style.color = color(); });
```

## How watch Works Internally

```ts
// Simplified implementation concept:
function watch(node, fn) {
  const scope = getCurrentScope();
  let activeEffect = null;

  const observer = new MutationObserver(() => {
    if (document.contains(node)) {
      // Node is connected - start/resume effect
      if (!activeEffect) {
        activeEffect = effect(fn);
      }
    } else {
      // Node disconnected - pause effect
      if (activeEffect) {
        activeEffect();  // Dispose
        activeEffect = null;
      }
    }
  });

  observer.observe(document, { childList: true, subtree: true });

  // Initial check
  if (document.contains(node)) {
    activeEffect = effect(fn);
  }

  // Cleanup on scope dispose
  scope?.onCleanup(() => {
    observer.disconnect();
    activeEffect?.();
  });
}
```

## Performance Notes

- `watch` uses a shared `MutationObserver` per document (efficient)
- Paused effects don't consume memory for subscriptions
- Prefer fewer `watch` calls with more work inside
- For lists, use `forEach`/`createList` instead of watch per item
