import { effect } from './signal.js';
import { createScope, getCurrentScope, withScope, Scope } from './scope.js';
import { scheduleMicrotask } from './scheduler.js';

/**
 * Conditional DOM rendering with per-branch lifetime.
 *
 * `when()` returns a DocumentFragment containing two stable comment markers:
 *   <!-- when:start --> ...branch nodes... <!-- when:end -->
 *
 * Why markers?
 * - The markers act as a permanent insertion point, so the branch can be swapped
 *   without the caller managing placeholders or re-appending anything.
 *
 * Semantics:
 * - Initial render is synchronous (prevents “flash”).
 * - Updates track only `test()` (the condition), not the branch internals.
 * - Branch swaps are coalesced in a microtask to:
 *   1) merge rapid toggles into a single swap, and
 *   2) run branch rendering outside reactive tracking (avoid accidental subscriptions).
 *
 * Lifetime:
 * - Each mounted branch owns its own Scope.
 * - Swapping branches disposes the previous scope, cleaning up effects/listeners/timers
 *   created inside that branch.
 */
export function when(
  test: () => any,
  thenFn: () => Node | Node[],
  elseFn?: () => Node | Node[]
): DocumentFragment {
  /** Stable DOM anchors delimiting the dynamic range. */
  const start = document.createComment('when:start');
  const end = document.createComment('when:end');

  /** Nodes currently mounted between start/end. */
  let currentNodes: Node[] = [];

  /** Scope owning resources created by the mounted branch. */
  let branchScope: Scope | null = null;

  /** Last resolved boolean (used to avoid unnecessary remounts). */
  let lastCond: boolean | undefined = undefined;

  /** Coalescing state: ensure at most one scheduled swap per tick. */
  let swapScheduled = false;
  let pendingCond: boolean | undefined = undefined;

  /** Disposal guard to prevent orphan microtasks from touching dead DOM. */
  let disposed = false;

  /** Removes mounted nodes and disposes their branch scope. */
  const clear = () => {
    branchScope?.dispose();
    branchScope = null;

    for (const n of currentNodes) {
      n.parentNode?.removeChild(n);
    }
    currentNodes = [];
  };

  /** Inserts nodes before the end marker and records ownership. */
  const mount = (nodes: Node[], scope: Scope) => {
    currentNodes = nodes;
    branchScope = scope;
    end.before(...nodes);
  };

  /** Clears old branch and mounts the branch for `cond`. */
  const swap = (cond: boolean) => {
    clear();

    const nextScope = createScope();

    try {
      // Render inside an isolated scope so branch resources are tied to that branch.
      const result = withScope(nextScope, () => (cond ? thenFn() : elseFn?.()));

      if (!result) {
        // Allow “empty branch”: keep anchors, dispose the unused scope.
        nextScope.dispose();
        return;
      }

      const nodes = Array.isArray(result) ? result : [result];
      mount(nodes, nextScope);
    } catch (err) {
      // Never leak the newly created scope if branch rendering throws.
      nextScope.dispose();
      throw err;
    }
  };

  // Create the stable slot (anchors first, content inserted between them).
  const frag = document.createDocumentFragment();
  frag.append(start, end);

  // Initial render is synchronous so the caller sees the correct branch immediately
  // after appending the fragment to the DOM.
  const initialCond = !!test();
  lastCond = initialCond;
  swap(initialCond);

  /**
   * Reactive driver:
   * - tracks only `test()`
   * - swaps only when the boolean changes
   * - coalesces swaps via microtask (outside tracking)
   */
  effect(() => {
    const cond = !!test();
    if (lastCond === cond) return;

    lastCond = cond;
    pendingCond = cond;

    if (swapScheduled) return;
    swapScheduled = true;

    scheduleMicrotask(() => {
      swapScheduled = false;
      if (disposed) return;

      const next = pendingCond!;
      pendingCond = undefined;

      swap(next);
    });
  });

  // If `when()` is created inside a parent scope, dispose branch resources with it.
  const parentScope = getCurrentScope();
  if (parentScope) {
    parentScope.onCleanup(() => {
      disposed = true;
      clear();
    });
  }

  return frag;
}
