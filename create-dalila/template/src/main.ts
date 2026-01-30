import { signal, computed, createScope, withScope } from 'dalila';
import { bind } from 'dalila/runtime';

// Create app scope
const app = createScope();

withScope(app, () => {
  // Reactive state
  const count = signal(0);
  const doubled = computed(() => count() * 2);
  const isEven = computed(() => count() % 2 === 0);
  const isOdd = computed(() => count() % 2 !== 0);

  // Actions
  const increment = () => count.update(n => n + 1);
  const decrement = () => count.update(n => n - 1);

  // Bind to DOM
  const root = document.getElementById('app');
  if (root) {
    bind(root, {
      count,
      doubled,
      isEven,
      isOdd,
      increment,
      decrement,
    });
  }
});
