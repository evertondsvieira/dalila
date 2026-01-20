import { effect } from './signal.js';
import { createScope, withScope, Scope } from './scope.js';
import { scheduleMicrotask } from './scheduler.js';

/**
 * Conditional DOM rendering primitive with per-branch lifetime.
 *
 * `when()` returns a stable DOM slot delimited by two comment markers:
 *   <!-- when:start --> ...dynamic content... <!-- when:end -->
 *
 * Behavior:
 * - Tracks only `test()` in the reactive effect.
 * - Swaps the rendered branch only when the boolean result changes.
 * - Branch rendering is executed in a microtask (outside reactive tracking),
 *   preventing internal branch reads from subscribing the outer effect.
 *
 * Lifetime:
 * - Each mounted branch owns a Scope. On branch swap, the previous scope is disposed,
 *   running cleanups for effects/listeners/timers created within the branch.
 *
 * Notes:
 * - DOM-first: manipulates real Nodes directly (no VDOM).
 * - The returned fragment can be appended anywhere; markers keep a stable insertion point.
 */
export function when(
  test: () => any,
  thenFn: () => Node | Node[],
  elseFn?: () => Node | Node[]
): DocumentFragment {
  /** Stable range markers in the DOM. */
  const start = document.createComment('when:start');
  const end = document.createComment('when:end');

  /** Nodes currently mounted between start/end. */
  let currentNodes: Node[] = [];

  /** Scope that owns resources created by the currently mounted branch. */
  let branchScope: Scope | null = null;

  /** Last evaluated boolean branch selector. */
  let lastCond: boolean | undefined = undefined;

  /** Coalescing: only one scheduled swap per tick. */
  let swapScheduled = false;
  let pendingCond: boolean | undefined = undefined;

  /**
   * Remove currently mounted nodes and dispose their scope.
   * This is the "branch teardown".
   */
  const clear = () => {
    if (branchScope) {
      branchScope.dispose();
      branchScope = null;
    }

    for (const n of currentNodes) {
      if (n.parentNode) n.parentNode.removeChild(n);
    }
    currentNodes = [];
  };

  /**
   * Mount nodes right before the end marker and record branch scope.
   */
  const mount = (nodes: Node[], scope: Scope) => {
    currentNodes = nodes;
    branchScope = scope;
    end.before(...nodes);
  };

  /**
   * Swap branch DOM for the given condition.
   * Runs outside reactive tracking (scheduled via microtask).
   */
  const swap = (cond: boolean) => {
    clear();

    const nextScope = createScope();

    try {
      // Render the chosen branch inside its own scope.
      const result = withScope(nextScope, () => (cond ? thenFn() : elseFn?.()));

      if (!result) {
        // No nodes: dispose unused scope and leave slot empty.
        nextScope.dispose();
        return;
      }

      const nodes = Array.isArray(result) ? result : [result];
      mount(nodes, nextScope);
    } catch (err) {
      // Avoid leaking the new scope on errors.
      nextScope.dispose();
      throw err;
    }
  };

  /**
   * Reactive driver:
   * - Tracks only `test()`.
   * - If the boolean branch does not change, do nothing (no remount).
   * - If it changes, schedule a single swap (coalesced).
   */
  effect(() => {
    const cond = !!test();

    // If branch selector didn't change, keep current DOM as-is.
    if (lastCond === cond) return;

    lastCond = cond;
    pendingCond = cond;

    if (swapScheduled) return;
    swapScheduled = true;

    // Schedule the actual DOM swap outside reactive tracking.
    scheduleMicrotask(() => {
      swapScheduled = false;

      // Use the last requested condition if multiple updates happened in the same tick.
      const next = pendingCond!;
      pendingCond = undefined;

      swap(next);
    });
  });

  /** Return a fragment containing stable markers. */
  const frag = document.createDocumentFragment();
  frag.append(start, end);
  return frag;
}
