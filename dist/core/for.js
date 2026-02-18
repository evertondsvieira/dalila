import { effect, signal } from './signal.js';
import { isInDevMode } from './dev.js';
import { createScope, withScope, getCurrentScope } from './scope.js';
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
/**
 * Compute the visible range for a fixed-height virtualized list.
 *
 * `start`/`end` use the [start, end) convention.
 */
export function computeVirtualRange(input) {
    const itemCount = Number.isFinite(input.itemCount) ? Math.max(0, Math.floor(input.itemCount)) : 0;
    const itemHeight = Number.isFinite(input.itemHeight) ? Math.max(1, input.itemHeight) : 1;
    const scrollTop = Number.isFinite(input.scrollTop) ? Math.max(0, input.scrollTop) : 0;
    const viewportHeight = Number.isFinite(input.viewportHeight)
        ? Math.max(0, input.viewportHeight)
        : 0;
    const overscan = Number.isFinite(input.overscan) ? Math.max(0, Math.floor(input.overscan ?? 0)) : 0;
    const totalHeight = itemCount * itemHeight;
    if (itemCount === 0) {
        return {
            start: 0,
            end: 0,
            topOffset: 0,
            bottomOffset: 0,
            totalHeight,
        };
    }
    const visibleStart = Math.floor(scrollTop / itemHeight);
    const visibleEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight);
    const start = clamp(visibleStart - overscan, 0, itemCount);
    const end = clamp(visibleEnd + overscan, start, itemCount);
    const topOffset = start * itemHeight;
    const bottomOffset = Math.max(0, totalHeight - (end * itemHeight));
    return {
        start,
        end,
        topOffset,
        bottomOffset,
        totalHeight,
    };
}
const autoDisposeByDocument = new WeakMap();
const getMutationObserverCtor = (doc) => {
    if (doc.defaultView?.MutationObserver)
        return doc.defaultView.MutationObserver;
    if (typeof MutationObserver !== 'undefined')
        return MutationObserver;
    return null;
};
const registerAutoDispose = (start, end, cleanup) => {
    const doc = start.ownerDocument;
    const MutationObserverCtor = getMutationObserverCtor(doc);
    if (!MutationObserverCtor)
        return () => { };
    let ctx = autoDisposeByDocument.get(doc);
    if (!ctx) {
        const entries = new Set();
        const observer = new MutationObserverCtor(() => {
            entries.forEach(entry => {
                const connected = entry.start.isConnected && entry.end.isConnected;
                if (!entry.attached && connected) {
                    entry.attached = true;
                    return;
                }
                if (entry.attached && !connected)
                    entry.cleanup();
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
    const entry = {
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
export function forEach(items, template, keyFn) {
    const start = document.createComment('for:start');
    const end = document.createComment('for:end');
    let currentItems = [];
    let disposeEffect = null;
    const parentScope = getCurrentScope();
    let disposed = false;
    let stopAutoDispose = null;
    const getKey = (item, index) => {
        if (keyFn)
            return keyFn(item, index);
        // Using index as key is an anti-pattern for dynamic lists
        // but we allow it as a fallback. Items will be re-rendered on reorder.
        return `__idx_${index}`;
    };
    const removeNode = (node) => {
        if (node.parentNode)
            node.parentNode.removeChild(node);
    };
    const removeRange = (keyedItem) => {
        // Dispose scope first to cleanup effects/listeners
        if (keyedItem.scope) {
            keyedItem.scope.dispose();
            keyedItem.scope = null;
        }
        // Remove DOM nodes (including markers)
        let node = keyedItem.start;
        while (node) {
            const next = node.nextSibling;
            removeNode(node);
            if (node === keyedItem.end)
                break;
            node = next;
        }
    };
    const clearBetween = (startNode, endNode) => {
        let node = startNode.nextSibling;
        while (node && node !== endNode) {
            const next = node.nextSibling;
            removeNode(node);
            node = next;
        }
    };
    const moveRangeBefore = (startNode, endNode, referenceNode) => {
        const parent = referenceNode.parentNode;
        if (!parent)
            return;
        let node = startNode;
        while (node) {
            const next = node.nextSibling;
            parent.insertBefore(node, referenceNode);
            if (node === endNode)
                break;
            node = next;
        }
    };
    let hasValidatedOnce = false;
    const reusableOldMap = new Map();
    const reusableSeenNextKeys = new Set();
    const throwDuplicateKey = (key, scheduleFatal) => {
        const error = new Error(`[Dalila] Duplicate key "${key}" detected in forEach. ` +
            `Keys must be unique within the same list. Check your keyFn implementation.`);
        if (scheduleFatal) {
            queueMicrotask(() => {
                throw error;
            });
        }
        throw error;
    };
    const validateNoDuplicateKeys = (arr) => {
        if (!isInDevMode())
            return;
        const scheduleFatal = hasValidatedOnce;
        hasValidatedOnce = true;
        const seenKeys = new Set();
        arr.forEach((item, index) => {
            const key = getKey(item, index);
            if (seenKeys.has(key)) {
                throwDuplicateKey(key, scheduleFatal);
            }
            seenKeys.add(key);
        });
    };
    const disposeItemScope = (item) => {
        if (!item.scope)
            return;
        item.scope.dispose();
        item.scope = null;
    };
    const cleanup = () => {
        if (disposed)
            return;
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
        if (disposed)
            return;
        const newItems = items();
        // Validate again on updates (will be caught by effect error handler)
        validateNoDuplicateKeys(newItems);
        reusableOldMap.clear();
        currentItems.forEach(item => reusableOldMap.set(item.key, item));
        const nextItems = [];
        reusableSeenNextKeys.clear();
        // Phase 1: Build next list + detect updates/new
        newItems.forEach((item, index) => {
            const key = getKey(item, index);
            if (reusableSeenNextKeys.has(key))
                return; // prod-mode: ignore dup keys silently
            reusableSeenNextKeys.add(key);
            const existing = reusableOldMap.get(key);
            if (existing) {
                reusableOldMap.delete(key);
                if (existing.value !== item) {
                    existing.value = item;
                    existing.dirty = true;
                }
                nextItems.push(existing);
            }
            else {
                const created = {
                    key,
                    value: item,
                    start: document.createComment(`for:${key}:start`),
                    end: document.createComment(`for:${key}:end`),
                    scope: null,
                    indexSignal: signal(index),
                    dirty: true,
                };
                nextItems.push(created);
            }
        });
        // Phase 2: Remove items no longer present
        for (const staleItem of reusableOldMap.values()) {
            removeRange(staleItem);
        }
        // Phase 3: Move/insert items to correct positions
        const parent = end.parentNode;
        if (parent) {
            let cursor = start;
            nextItems.forEach(item => {
                const nextSibling = cursor.nextSibling;
                const inDom = item.start.parentNode === parent;
                if (!inDom) {
                    const referenceNode = nextSibling || end;
                    referenceNode.before(item.start, item.end);
                }
                else if (nextSibling !== item.start) {
                    const referenceNode = nextSibling || end;
                    moveRangeBefore(item.start, item.end, referenceNode);
                }
                cursor = item.end;
            });
        }
        // Phase 4: Dispose scopes and clear content for changed items
        nextItems.forEach(item => {
            if (!item.dirty)
                return;
            disposeItemScope(item);
            clearBetween(item.start, item.end);
        });
        // Phase 5: Update reactive indices only when index actually changes
        nextItems.forEach((item, index) => {
            if (item.indexSignal.peek() !== index) {
                item.indexSignal.set(index);
            }
        });
        // Phase 6: Render changed items
        nextItems.forEach(item => {
            if (!item.dirty)
                return;
            item.scope = createScope();
            withScope(item.scope, () => {
                const indexGetter = () => item.indexSignal();
                const templateResult = template(item.value, indexGetter);
                const nodes = Array.isArray(templateResult) ? templateResult : [templateResult];
                item.end.before(...nodes);
            });
            item.dirty = false;
        });
        currentItems = nextItems;
    };
    // IMPORTANT: append markers BEFORE creating the effect,
    // so a synchronous effect run can still render into the fragment safely.
    const frag = document.createDocumentFragment();
    frag.append(start, end);
    frag.dispose = cleanup;
    // Run update reactively and capture dispose
    disposeEffect = effect(() => {
        if (disposed)
            return;
        update();
    });
    // Cleanup on parent scope disposal
    if (parentScope) {
        parentScope.onCleanup(cleanup);
    }
    else {
        stopAutoDispose = registerAutoDispose(start, end, cleanup);
        if (isInDevMode()) {
            console.warn('[Dalila] forEach() called outside of a scope. ' +
                'The effect will not be tied to a scope. ' +
                'It will auto-dispose when removed from the DOM, ' +
                'or call fragment.dispose() for manual cleanup if needed.');
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
export function createList(items, template, keyFn) {
    return forEach(items, (item, index) => {
        const idx = index();
        return template(item, idx);
    }, keyFn);
}
