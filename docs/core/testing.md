# Testing

Testing Dalila components and reactive state.

## Quick Start

```ts
import { signal, effect } from 'dalila';

// Test signals directly
const count = signal(0);
expect(count()).toBe(0);

count.set(5);
expect(count()).toBe(5);
```

## Testing Signals

```ts
import { signal, computed, effect } from 'dalila';

describe('signals', () => {
  it('should update on set', () => {
    const count = signal(0);
    count.set(10);
    expect(count()).toBe(10);
  });

  it('should update on update', () => {
    const count = signal(0);
    count.update(n => n + 1);
    expect(count()).toBe(1);
  });

  it('should compute derived values', () => {
    const count = signal(5);
    const doubled = computed(() => count() * 2);
    
    expect(doubled()).toBe(10);
    
    count.set(3);
    expect(doubled()).toBe(6);
  });
});
```

## Testing Effects

```ts
import { signal, effect } from 'dalila';

it('should run effect on dependency change', () => {
  const count = signal(0);
  let runs = 0;
  
  const dispose = effect(() => {
    runs++;
    count(); // track count
  });
  
  expect(runs).toBe(1); // effect ran once on creation
  
  count.set(1);
  expect(runs).toBe(2); // effect ran again
  
  dispose();
  count.set(2);
  expect(runs).toBe(2); // no more runs after dispose
});
```

## Testing Components

```ts
import { signal, effect } from 'dalila';
import { bind } from 'dalila/runtime';

it('should render template', () => {
  const container = document.createElement('div');
  const name = signal('Alice');
  
  bind(container, { name });
  
  expect(container.textContent).toBe('Alice');
  
  name.set('Bob');
  expect(container.textContent).toBe('Bob');
});

it('should handle events', () => {
  const container = document.createElement('div');
  const count = signal(0);
  
  bind(container, { 
    count,
    increment: () => count.update(n => n + 1)
  });
  
  const button = container.querySelector('button')!;
  button.click();
  
  expect(count()).toBe(1);
});
```

## Using waitFor (for async)

```ts
import { signal, effect } from 'dalila';

// Simple approach: use setTimeout with done callback
it('should handle async effects', (done) => {
  const data = signal<string | null>(null);
  
  effect(async () => {
    data.set('loaded');
  });
  
  // Wait for microtask queue
  queueMicrotask(() => {
    expect(data()).toBe('loaded');
    done();
  });
});
```

## Test Utilities Pattern

Create your own test utilities:

```ts
// test-utils.ts
import { signal, type Signal } from 'dalila';

export function createSignal<T>(initial: T): { 
  signal: Signal<T>; 
  get: () => T; 
  set: (value: T) => void;
} {
  const s = signal(initial);
  return {
    signal: s,
    get: () => s(),
    set: (value: T) => s.set(value),
  };
}

export async function nextTick(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}
```

```ts
// example.test.ts
import { createSignal, nextTick } from './test-utils';

it('should work with test utils', async () => {
  const { get, set } = createSignal(0);
  
  set(5);
  await nextTick();
  
  expect(get()).toBe(5);
});
```

## Mocking Signals

```ts
import { signal } from 'dalila';

it('should mock signal behavior', () => {
  // Create a mock that tracks calls
  let value = 0;
  const mockSignal = () => value;
  mockSignal.set = (v: number) => { value = v; };
  mockSignal.update = (fn: (n: number) => number) => { value = fn(value); };
  
  // Use in tests
  mockSignal.set(10);
  expect(mockSignal()).toBe(10);
});
```

## Best Practices

1. **Test signals directly** - They're just functions, easy to test
2. **Test effects with a counter** - Track how many times they run
3. **Use `queueMicrotask`** - For async effects, wait for microtask queue
4. **Clean up in `afterEach`** - Dispose effects to avoid memory leaks

```ts
afterEach(() => {
  // Clean up any created effects/scopes
  dispose?.();
});
```

## Common Patterns

```ts
// Test computed is lazy
it('should not compute until read', () => {
  const trigger = signal(0);
  let computeCount = 0;
  
  const computed = computed(() => {
    computeCount++;
    return trigger() * 2;
  });
  
  expect(computeCount).toBe(0); // not computed yet!
  
  computed(); // read it
  expect(computeCount).toBe(1); // now computed
});

// Test effect cleanup
it('should cleanup on dispose', () => {
  const count = signal(0);
  let runs = 0;
  
  const dispose = effect(() => {
    runs++;
    count();
  });
  
  dispose();
  count.set(1);
  expect(runs).toBe(1); // no new run after dispose
});
```
