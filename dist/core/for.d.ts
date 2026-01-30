interface DisposableFragment extends DocumentFragment {
    dispose(): void;
}
/**
 * Low-level keyed list rendering with fine-grained reactivity.
 *
 * Uses keyed diffing to efficiently update only changed items.
 * Each item gets its own scope for automatic cleanup.
 *
 * @param items - Signal or function returning array of items
 * @param template - Function that renders each item (receives item and reactive index)
 * @param keyFn - Optional function to extract unique key from item (defaults to index)
 *
 * @example
 * ```ts
 * const todos = signal([
 *   { id: 1, text: 'Learn Dalila' },
 *   { id: 2, text: 'Build app' }
 * ]);
 *
 * forEach(
 *   () => todos(),
 *   (todo, index) => {
 *     const li = document.createElement('li');
 *     li.textContent = `${index()}: ${todo.text}`;
 *     return li;
 *   },
 *   (todo) => todo.id.toString()
 * );
 * ```
 *
 * @internal Prefer createList() for most use cases
 */
export declare function forEach<T>(items: () => T[], template: (item: T, index: () => number) => Node | Node[], keyFn?: (item: T, index: number) => string): DisposableFragment;
/**
 * Stable API for rendering keyed lists.
 *
 * Renders a reactive list with automatic updates when items change.
 * Only re-renders items that actually changed (keyed diffing).
 */
export declare function createList<T>(items: () => T[], template: (item: T, index: number) => Node | Node[], keyFn?: (item: T, index: number) => string): DisposableFragment;
export {};
