import { effect, signal } from './signal.js';
import type { Signal } from './signal.js';
import { isInDevMode } from './dev.js';
import { createScope, withScope, getCurrentScope } from './scope.js';

interface KeyedItem<T> {
  key: string;
  value: T;
  start: Comment;
  end: Comment;
  scope: ReturnType<typeof createScope> | null;
  indexSignal: Signal<number>;
}

interface DisposableFragment extends DocumentFragment {
  dispose(): void;
}

interface AutoDisposeEntry {
  start: Comment;
  end: Comment;
  cleanup: () => void;
  attached: boolean;
}

const autoDisposeByDocument = new WeakMap<
  Document,
  { observer: MutationObserver; entries: Set<AutoDisposeEntry> }
>();

const getMutationObserverCtor = (doc: Document): typeof MutationObserver | null => {
  if (doc.defaultView?.MutationObserver) return doc.defaultView.MutationObserver;
  if (typeof MutationObserver !== 'undefined') return MutationObserver;
  return null;
};

const registerAutoDispose = (
  start: Comment,
  end: Comment,
  cleanup: () => void
): (() => void) => {
  const doc = start.ownerDocument;
  const MutationObserverCtor = getMutationObserverCtor(doc);
  if (!MutationObserverCtor) return () => {};

  let ctx = autoDisposeByDocument.get(doc);
  if (!ctx) {
    const entries = new Set<AutoDisposeEntry>();
    const observer = new MutationObserverCtor(() => {
      entries.forEach(entry => {
        const connected = entry.start.isConnected && entry.end.isConnected;
        if (!entry.attached && connected) {
          entry.attached = true;
          return;
        }
        if (entry.attached && !connected) entry.cleanup();
      });

      if (entries.size === 0) {
        observer.disconnect();
        autoDisposeByDocument.delete(doc);
      }
    });
    observer.observe(doc, { childList: true, subtree: true });
    ctx = { observer, entries };
    autoDisposeByDocument.set(doc, ctx);
  }

  const entry: AutoDisposeEntry = {
    start,
    end,
    cleanup,
    attached: start.isConnected && end.isConnected
  };
  ctx.entries.add(entry);

  return () => {
    ctx?.entries.delete(entry);
    if (ctx && ctx.entries.size === 0) {
      ctx.observer.disconnect();
      autoDisposeByDocument.delete(doc);
    }
  };
};

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
export function forEach<T>(
  items: () => T[],
  template: (item: T, index: () => number) => Node | Node[],
  keyFn?: (item: T, index: number) => string
): DisposableFragment {
  const start = document.createComment('for:start');
  const end = document.createComment('for:end');
  let currentItems: KeyedItem<T>[] = [];
  let disposeEffect: (() => void) | null = null;
  const parentScope = getCurrentScope();
  let disposed = false;
  let stopAutoDispose: (() => void) | null = null;

  const getKey = (item: T, index: number): string => {
    if (keyFn) return keyFn(item, index);
    // Using index as key is an anti-pattern for dynamic lists
    // but we allow it as a fallback. Items will be re-rendered on reorder.
    return `__idx_${index}`;
  };

  const removeNode = (node: Node) => {
    if (node.parentNode) node.parentNode.removeChild(node);
  };

  const removeRange = (keyedItem: KeyedItem<T>) => {
    // Dispose scope first to cleanup effects/listeners
    if (keyedItem.scope) {
      keyedItem.scope.dispose();
      keyedItem.scope = null;
    }

    // Remove DOM nodes (including markers)
    let node: ChildNode | null = keyedItem.start;
    while (node) {
      const next: ChildNode | null = node.nextSibling;
      removeNode(node);
      if (node === keyedItem.end) break;
      node = next;
    }
  };

  const clearBetween = (startNode: Comment, endNode: Comment) => {
    let node: ChildNode | null = startNode.nextSibling;
    while (node && node !== endNode) {
      const next: ChildNode | null = node.nextSibling;
      removeNode(node);
      node = next;
    }
  };

  const moveRangeBefore = (startNode: Comment, endNode: Comment, referenceNode: Node) => {
    const parent = referenceNode.parentNode;
    if (!parent) return;

    let node: ChildNode | null = startNode;

    while (node) {
      const next: ChildNode | null = node.nextSibling;
      parent.insertBefore(node, referenceNode);
      if (node === endNode) break;
      node = next;
    }
  };

  let hasValidatedOnce = false;

  const throwDuplicateKey = (key: string, scheduleFatal: boolean) => {
    const error = new Error(
      `[Dalila] Duplicate key "${key}" detected in forEach. ` +
        `Keys must be unique within the same list. Check your keyFn implementation.`
    );

    if (scheduleFatal) {
      queueMicrotask(() => {
        throw error;
      });
    }

    throw error;
  };

  const validateNoDuplicateKeys = (arr: T[]) => {
    if (!isInDevMode()) return;

    const scheduleFatal = hasValidatedOnce;
    hasValidatedOnce = true;

    const seenKeys = new Set<string>();
    arr.forEach((item, index) => {
      const key = getKey(item, index);
      if (seenKeys.has(key)) {
        throwDuplicateKey(key, scheduleFatal);
      }
      seenKeys.add(key);
    });
  };

  const disposeItemScope = (item: KeyedItem<T>) => {
    if (!item.scope) return;
    item.scope.dispose();
    item.scope = null;
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;

    stopAutoDispose?.();
    stopAutoDispose = null;

    disposeEffect?.();
    disposeEffect = null;

    currentItems.forEach(item => {
      removeRange(item);
    });
    currentItems = [];

    removeNode(start);
    removeNode(end);
  };

  // Validate first render synchronously (let throw escape in dev)
  validateNoDuplicateKeys(items());

  const update = () => {
    if (disposed) return;
    const newItems = items();

    // Validate again on updates (will be caught by effect error handler)
    validateNoDuplicateKeys(newItems);

    const oldMap = new Map<string, KeyedItem<T>>();
    currentItems.forEach(item => oldMap.set(item.key, item));

    const nextItems: KeyedItem<T>[] = [];
    const itemsToUpdate = new Set<string>();
    const seenNextKeys = new Set<string>();

    // Phase 1: Build next list + detect updates/new
    newItems.forEach((item, index) => {
      const key = getKey(item, index);

      if (seenNextKeys.has(key)) return; // prod-mode: ignore dup keys silently
      seenNextKeys.add(key);

      const existing = oldMap.get(key);
      if (existing) {
        if (existing.value !== item) {
          itemsToUpdate.add(key);
          existing.value = item;
        }
        nextItems.push(existing);
      } else {
        itemsToUpdate.add(key);
        nextItems.push({
          key,
          value: item,
          start: document.createComment(`for:${key}:start`),
          end: document.createComment(`for:${key}:end`),
          scope: null,
          indexSignal: signal(index)
        });
      }
    });

    // Phase 2: Remove items no longer present
    const nextKeys = new Set(nextItems.map(i => i.key));
    currentItems.forEach(item => {
      if (!nextKeys.has(item.key)) removeRange(item);
    });

    // Phase 3: Move/insert items to correct positions
    const parent = end.parentNode;
    if (parent) {
      let cursor: Node = start;

      nextItems.forEach(item => {
        const nextSibling = cursor.nextSibling;
        const inDom = item.start.parentNode === parent;

        if (!inDom) {
          const referenceNode = nextSibling || end;
          referenceNode.before(item.start, item.end);
        } else if (nextSibling !== item.start) {
          const referenceNode = nextSibling || end;
          moveRangeBefore(item.start, item.end, referenceNode);
        }

        cursor = item.end;
      });
    }

    // Phase 4: Dispose scopes and clear content for changed items
    nextItems.forEach(item => {
      if (!itemsToUpdate.has(item.key)) return;
      disposeItemScope(item);
      clearBetween(item.start, item.end);
    });

    // Phase 5: Update reactive indices for ALL items
    nextItems.forEach((item, index) => {
      item.indexSignal.set(index);
    });

    // Phase 6: Render changed items
    nextItems.forEach(item => {
      if (!itemsToUpdate.has(item.key)) return;

      item.scope = createScope();

      withScope(item.scope, () => {
        const indexGetter = () => item.indexSignal();
        const templateResult = template(item.value, indexGetter);
        const nodes = Array.isArray(templateResult) ? templateResult : [templateResult];
        item.end.before(...nodes);
      });
    });

    currentItems = nextItems;
  };

  // IMPORTANT: append markers BEFORE creating the effect,
  // so a synchronous effect run can still render into the fragment safely.
  const frag = document.createDocumentFragment() as DisposableFragment;
  frag.append(start, end);
  (frag as any).dispose = cleanup;

  // Run update reactively and capture dispose
  disposeEffect = effect(() => {
    if (disposed) return;
    update();
  });

  // Cleanup on parent scope disposal
  if (parentScope) {
    parentScope.onCleanup(cleanup);
  } else {
    stopAutoDispose = registerAutoDispose(start, end, cleanup);
    if (isInDevMode()) {
      console.warn(
        '[Dalila] forEach() called outside of a scope. ' +
          'The effect will not be tied to a scope. ' +
          'It will auto-dispose when removed from the DOM, ' +
          'or call fragment.dispose() for manual cleanup if needed.'
      );
    }
  }

  return frag;
}

/**
 * Stable API for rendering keyed lists.
 *
 * Renders a reactive list with automatic updates when items change.
 * Only re-renders items that actually changed (keyed diffing).
 */
export function createList<T>(
  items: () => T[],
  template: (item: T, index: number) => Node | Node[],
  keyFn?: (item: T, index: number) => string
): DisposableFragment {
  return forEach(
    items,
    (item, index) => {
      const idx = index();
      return template(item, idx);
    },
    keyFn
  );
}
