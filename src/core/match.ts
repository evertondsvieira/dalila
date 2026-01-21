import { effect } from "./signal.js";
import { createScope, getCurrentScope, withScope, type Scope } from "./scope.js";
import { scheduleMicrotask } from "./scheduler.js";

/**
 * Multi-branch conditional DOM primitive with per-case lifetime.
 *
 * `match()` renders exactly one case at a time, chosen by `value()`.
 * It returns a stable DOM "slot" delimited by two comment markers:
 *
 *   <!-- match:start --> ...active case... <!-- match:end -->
 *
 * Design goals:
 * - DOM-first: direct Node insertion/removal (no VDOM).
 * - No "flash": initial case is mounted synchronously.
 * - Correct reactivity: the reactive driver tracks only `value()`.
 * - Isolation: each case runs inside its own `Scope`, so effects/listeners/timers
 *   created by a case are disposed when that case unmounts.
 * - Safety: swaps are scheduled via microtask to avoid accidental dependency
 *   tracking from inside the case render function.
 *
 * Cases:
 * - `cases[v]` runs when `value()` equals `v`.
 * - `cases["_"]` is an optional fallback when there is no exact match.
 */
export function match<T extends string | number | symbol>(
  value: () => T,
  cases: Record<T | "_", () => Node | Node[]>
): DocumentFragment {
  /** Stable range markers that define the insertion point. */
  const start = document.createComment("match:start");
  const end = document.createComment("match:end");

  /** Nodes currently mounted between `start` and `end`. */
  let currentNodes: Node[] = [];

  /** Scope owning the currently mounted case (disposed on swap). */
  let caseScope: Scope | null = null;

  /** Last resolved case key (exact match or "_"). */
  let lastKey: T | "_" | undefined = undefined;

  /** Microtask coalescing: allow only one pending swap per tick. */
  let swapScheduled = false;
  let pendingKey: T | "_" | undefined = undefined;

  /**
   * Guard to prevent "orphan" microtasks from touching DOM after this match()
   * is disposed by a parent scope.
   */
  let disposed = false;

  /** Own-property check (works with symbols and ignores prototype chain). */
  const has = (k: PropertyKey) => Object.prototype.hasOwnProperty.call(cases, k);

  /**
   * Unmount current case:
   * - Dispose scope to run cleanups (effects/listeners/timers).
   * - Remove DOM nodes currently mounted in the slot.
   */
  const clear = () => {
    if (caseScope) {
      caseScope.dispose();
      caseScope = null;
    }

    for (const n of currentNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    currentNodes = [];
  };

  /**
   * Mount nodes right before the end marker and bind them to `scope`.
   * Keeping the markers stable makes swaps predictable and cheap.
   */
  const mount = (nodes: Node[], scope: Scope) => {
    currentNodes = nodes;
    caseScope = scope;
    end.before(...nodes);
  };

  /**
   * Resolve a runtime value to an actual render key:
   * - exact match if present,
   * - otherwise "_" fallback if present,
   * - otherwise throws (explicit + debuggable failure).
   */
  const resolveKey = (v: T): T | "_" => {
    const key = (has(v) ? v : "_") as T | "_";
    if (!has(key)) {
      throw new Error(`No case found for value: ${String(v)} (and no "_" fallback)`);
    }
    return key;
  };

  /**
   * Swap the mounted DOM to the given key.
   * This function is intentionally called outside reactive tracking.
   *
   * Important: the case render function runs inside a fresh `Scope`,
   * so anything created by that case is automatically cleaned up on swap.
   */
  const swap = (key: T | "_") => {
    clear();

    const nextScope = createScope();

    try {
      const fn = cases[key];
      if (!fn) {
        // Should be unreachable if resolveKey is used, but keep it defensive.
        nextScope.dispose();
        throw new Error(`No case found for key: ${String(key)}`);
      }

      const result = withScope(nextScope, () => fn());
      if (!result) {
        // Allow "empty" cases: nothing is mounted, scope is discarded.
        nextScope.dispose();
        return;
      }

      const nodes = Array.isArray(result) ? result : [result];
      mount(nodes, nextScope);
    } catch (err) {
      // Never leak the newly created scope on errors.
      nextScope.dispose();
      throw err;
    }
  };

  /** The returned fragment contains only stable markers; content lives between them. */
  const frag = document.createDocumentFragment();
  frag.append(start, end);

  /**
   * Initial mount is synchronous to avoid content flash.
   *
   * CRITICAL: markers must already be in the fragment before `swap()`,
   * because `swap()` inserts using `end.before(...)`.
   */
  const initialKey = resolveKey(value());
  lastKey = initialKey;
  swap(initialKey);

  /**
   * Reactive driver:
   * - Tracks only `value()`.
   * - If the selected key doesn't change, we do nothing (no remount).
   * - If it changes, we schedule a microtask swap (coalesced).
   *
   * Why microtask?
   * - It prevents any reads inside a case render function from becoming
   *   dependencies of this outer effect.
   */
  effect(() => {
    const key = resolveKey(value());
    if (lastKey === key) return;

    lastKey = key;
    pendingKey = key;

    if (swapScheduled) return;
    swapScheduled = true;

    scheduleMicrotask(() => {
      swapScheduled = false;
      if (disposed) return;

      const next = pendingKey!;
      pendingKey = undefined;

      swap(next);
    });
  });

  /**
   * If this match() is created inside a parent scope, we auto-cleanup:
   * - prevent pending microtasks from doing work,
   * - dispose current case scope,
   * - remove mounted nodes.
   */
  const parentScope = getCurrentScope();
  if (parentScope) {
    parentScope.onCleanup(() => {
      disposed = true;
      clear();
    });
  }

  return frag;
}
