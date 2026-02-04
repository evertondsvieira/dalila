import { computed, signal } from 'dalila';

export function loader() {
  const count = signal(0);
  const doubled = computed(() => count() * 2);
  const isEven = computed(() => count() % 2 === 0);
  const isOdd = computed(() => count() % 2 !== 0);

  const increment = () => count.update(value => value + 1);
  const decrement = () => count.update(value => value - 1);

  return {
    count,
    doubled,
    isEven,
    isOdd,
    increment,
    decrement
  };
}
