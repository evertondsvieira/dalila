import { effect, effectAsync, signal } from './signal.js';
import { getCurrentScope, withScope, type Scope } from './scope.js';

/**
 * Per-document watch context.
 * Maintains a single MutationObserver per document and tracks watched nodes.
 *
 * Notes:
 * - `watches` is a WeakMap to avoid keeping detached nodes alive (fixes Map<Node, ...> leaks).
 * - `watchCount` tracks active watch entries because WeakMap has no .size for observer disposal.
 */
interface DocumentWatchContext {
  observer: MutationObserver;
  watches: WeakMap<Node, Set<WatchEntry>>;
  watchCount: number;
}

/**
 * Individual watch entry.
 * Tracks effect function, cleanup, connection state, AND the scope captured at watch() time.
 *
 * Capturing the scope is critical so effects that start later (on DOM connect)
 * still run "inside" the original scope. (Fixes late-start effect created outside scope.)
 */
interface WatchEntry {
  fn: () => void;
  cleanup: (() => void) | null;
  hasConnected: boolean;
  effectStarted: boolean;
  scope: Scope | null;
}

/**
 * Global registry: Document -> WatchContext.
 * WeakMap ensures cleanup when Document is garbage collected.
 */
const documentWatchers = new WeakMap<Document, DocumentWatchContext>();

/**
 * One-time warning flags to avoid flooding console.
 */
let hasWarnedNoScope = false;
const warnedFunctions = new Set<string>();

/**
 * Reset warning flags (used by src/internal/watch-testing.ts for deterministic tests).
 * @internal
 */
export function __resetWarningsForTests(): void {
  warnedFunctions.clear();
  hasWarnedNoScope = false;
}

/**
 * Walk a subtree recursively, calling visitor for each node.
 * Supports any Node type (Element, Text, Comment, etc.) via childNodes.
 */
function walkSubtree(root: Node, visitor: (node: Node) => void): void {
  visitor(root);

  if (root.childNodes && root.childNodes.length > 0) {
    for (let i = 0; i < root.childNodes.length; i++) {
      walkSubtree(root.childNodes[i], visitor);
    }
  }
}

/**
 * Start a watch entry effect inside the entry's captured scope (if any).
 *
 * Why:
 * - `effect()` captures getCurrentScope() at creation time.
 * - watch entries can start later (when a node becomes connected), so we must re-enter
 *   the original scope to preserve cleanup semantics.
 */
function startEntryEffect(entry: WatchEntry): void {
  if (entry.effectStarted || entry.cleanup) return;

  entry.effectStarted = true;

  const create = () => effect(entry.fn);

  // Ensure the *creation* of the effect happens inside the captured scope.
  // effect() captures getCurrentScope() at creation time.
  entry.cleanup = entry.scope ? withScope(entry.scope, create) : create();
}

/**
 * Gets or creates a watch context for a document.
 * Ensures only ONE MutationObserver per document.
 */
function getDocumentWatchContext(doc: Document): DocumentWatchContext {
  let ctx = documentWatchers.get(doc);

  if (!ctx) {
    const watches = new WeakMap<Node, Set<WatchEntry>>();

    const observer = new MutationObserver((records) => {
      const candidates = new Set<Node>();

      // 1) removedNodes: collect candidates for cleanup (ONLY affected subtrees)
      for (const record of records) {
        for (let i = 0; i < record.removedNodes.length; i++) {
          const removed = record.removedNodes[i];

          walkSubtree(removed, (node) => {
            const entries = watches.get(node);
            if (entries && entries.size > 0) candidates.add(node);
          });
        }
      }

      // 2) addedNodes: mark connected and start effects (ONLY affected subtrees)
      for (const record of records) {
        for (let i = 0; i < record.addedNodes.length; i++) {
          const added = record.addedNodes[i];

          walkSubtree(added, (node) => {
            const entries = watches.get(node);
            if (!entries || entries.size === 0) return;

            for (const entry of entries) {
              entry.hasConnected = true;

              // Start effect if not started yet and node is connected
              if (!entry.effectStarted && node.isConnected) {
                startEntryEffect(entry);
              }
            }

            // Handles "move": remove+add in same batch
            candidates.delete(node);
          });
        }
      }

      // 3) Cleanup disconnected candidates in microtask (handles move correctly)
      if (candidates.size > 0) {
        queueMicrotask(() => {
          for (const node of candidates) {
            if (node.isConnected) continue;

            const entries = watches.get(node);
            if (!entries || entries.size === 0) continue;

            for (const entry of entries) {
              // Only cleanup if it was connected at least once
              if (entry.hasConnected && entry.cleanup) {
                entry.cleanup();
                entry.cleanup = null;

                // Allow restart if node reconnects later
                entry.effectStarted = false;
              }
            }
          }
        });
      }
    });

    observer.observe(doc, { childList: true, subtree: true });

    ctx = { observer, watches, watchCount: 0 };
    documentWatchers.set(doc, ctx);
  }

  return ctx;
}

/**
 * watch(node, fn)
 *
 * Runs `fn` inside a reactive effect while `node` is connected to the document.
 * - Signal reads inside `fn` are tracked (because `fn` runs inside effect()).
 * - When the node disconnects, the effect is disposed.
 * - If the node reconnects later, the effect may start again (best-effort, based on DOM mutations).
 *
 * Implementation notes / fixes:
 * 1) Scope capture: the scope at watch() time is stored on the entry so effects that start later
 *    still get created "inside" the original scope (fixes late-start effects created outside scope).
 * 2) Memory safety: watches uses WeakMap<Node, ...> so detached nodes are not kept alive.
 * 3) Observer lifecycle: we track ctx.watchCount (WeakMap has no .size) to know when to disconnect.
 */
export function watch(node: Node, fn: () => void): () => void {
  const currentScope = getCurrentScope();

  // Warn if no scope (one-time warning to avoid flooding)
  if (!currentScope && !hasWarnedNoScope) {
    hasWarnedNoScope = true;
    console.warn(
      '[Dalila] watch() called outside scope. ' +
        'The watch will work but you must call the returned dispose() function manually to avoid memory leaks. ' +
        'Consider using createScope() + withScope() for automatic cleanup.'
    );
  }

  // Get document (default to global document if node.ownerDocument is null)
  const doc = node.ownerDocument || document;
  const ctx = getDocumentWatchContext(doc);

  // Create watch entry (capture scope NOW)
  const entry: WatchEntry = {
    fn,
    cleanup: null,
    hasConnected: node.isConnected,
    effectStarted: false,
    scope: currentScope ?? null
  };

  // Register in watches (WeakMap) and increment count
  let set = ctx.watches.get(node);
  if (!set) {
    set = new Set<WatchEntry>();
    ctx.watches.set(node, set);
  }
  set.add(entry);
  ctx.watchCount++;

  // Start effect immediately if node is already connected (inside captured scope)
  if (node.isConnected) {
    startEntryEffect(entry);
  }

  // Dispose function (idempotent)
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;

    // Stop effect if running
    if (entry.cleanup) {
      entry.cleanup();
      entry.cleanup = null;
    }
    entry.effectStarted = false;

    // Remove entry from set (if set still exists)
    const entries = ctx.watches.get(node);
    if (entries) {
      entries.delete(entry);
      // If empty, delete the entry from WeakMap to free the Set immediately
      if (entries.size === 0) ctx.watches.delete(node);
    }

    // Decrement active watch count and disconnect observer if none left
    ctx.watchCount--;
    if (ctx.watchCount <= 0) {
      ctx.observer.disconnect();
      documentWatchers.delete(doc);
    }
  };

  // Register cleanup in scope if available
  if (currentScope) {
    currentScope.onCleanup(dispose);
  }

  return dispose;
}

/**
 * onCleanup(fn)
 *
 * Registers fn to run when the current scope is disposed.
 * If called outside a scope, fn is never called (no-op).
 */
export function onCleanup(fn: () => void): void {
  const scope = getCurrentScope();
  if (scope) scope.onCleanup(fn);
}

/**
 * useEvent(target, type, handler, options?)
 *
 * Attaches an event listener and returns an idempotent dispose() function.
 * - Inside a scope: listener is removed automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export function useEvent<T extends EventTarget>(
  target: T,
  type: string,
  handler: (event: Event) => void,
  options?: AddEventListenerOptions
): () => void {
  const scope = getCurrentScope();

  if (!scope && !warnedFunctions.has('useEvent')) {
    warnedFunctions.add('useEvent');
    console.warn(
      '[Dalila] useEvent() called outside scope. ' +
        'Event listener will not auto-cleanup. Call the returned dispose() function manually.'
    );
  }

  target.addEventListener(type, handler, options);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    target.removeEventListener(type, handler, options);
  };

  if (scope) scope.onCleanup(dispose);
  return dispose;
}

/**
 * useInterval(fn, ms)
 *
 * Starts an interval and returns an idempotent dispose() function.
 * - Inside a scope: interval is cleared automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export function useInterval(fn: () => void, ms: number): () => void {
  const scope = getCurrentScope();

  if (!scope && !warnedFunctions.has('useInterval')) {
    warnedFunctions.add('useInterval');
    console.warn(
      '[Dalila] useInterval() called outside scope. ' +
        'Interval will not auto-cleanup. Call the returned dispose() function manually.'
    );
  }

  const intervalId = setInterval(fn, ms);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(intervalId);
  };

  if (scope) scope.onCleanup(dispose);
  return dispose;
}

/**
 * useTimeout(fn, ms)
 *
 * Starts a timeout and returns an idempotent dispose() function.
 * - Inside a scope: timeout is cleared automatically on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 */
export function useTimeout(fn: () => void, ms: number): () => void {
  const scope = getCurrentScope();

  if (!scope && !warnedFunctions.has('useTimeout')) {
    warnedFunctions.add('useTimeout');
    console.warn(
      '[Dalila] useTimeout() called outside scope. ' +
        'Timeout will not auto-cleanup. Call the returned dispose() function manually.'
    );
  }

  const timeoutId = setTimeout(fn, ms);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeoutId);
  };

  if (scope) scope.onCleanup(dispose);
  return dispose;
}

/**
 * useFetch(url, options)
 *
 * Small convenience for "fetch + reactive state + abort" built on effectAsync().
 * Returns { data, loading, error, dispose }.
 *
 * Behavior:
 * - Runs the fetch inside effectAsync, which provides an AbortSignal.
 * - If url is a function, it tracks signal reads (reactive).
 * - Calling dispose() aborts the in-flight request (via effectAsync's signal).
 * - Inside a scope: auto-disposed on scope.dispose().
 * - Outside a scope: you must call dispose() manually (warns once).
 *
 * Limitations:
 * - No refresh(), no caching, no invalidation.
 * - For those features, use createResource / query().
 */
export function useFetch<T>(
  url: string | (() => string),
  options?: RequestInit
): {
  data: () => T | null;
  loading: () => boolean;
  error: () => Error | null;
  dispose: () => void;
} {
  const scope = getCurrentScope();

  if (!scope && !warnedFunctions.has('useFetch')) {
    warnedFunctions.add('useFetch');
    console.warn(
      '[Dalila] useFetch() called outside scope. ' +
        'Request will not auto-cleanup. Call the returned dispose() function manually.'
    );
  }

  const data = signal<T | null>(null);
  const loading = signal<boolean>(false);
  const error = signal<Error | null>(null);

  const dispose = effectAsync(async (signal) => {
    try {
      loading.set(true);
      error.set(null);

      const fetchUrl = typeof url === 'function' ? url() : url;
      const response = await fetch(fetchUrl, {
        ...options,
        signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = (await response.json()) as T;
      data.set(result);
    } catch (err) {
      if (signal.aborted) return;
      error.set(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!signal.aborted) {
        loading.set(false);
      }
    }
  });

  // Match the other lifecycle helpers: if we are inside a scope, dispose automatically.
  if (scope) scope.onCleanup(dispose);

  return { data, loading, error, dispose };
}
