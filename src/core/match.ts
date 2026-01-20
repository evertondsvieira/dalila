import { effect } from './signal.js';
import { createScope, withScope, Scope } from './scope.js';
import { scheduleMicrotask } from './scheduler.js';

/**
 * Multi-branch conditional rendering primitive with per-case lifetime.
 *
 * `match()` selects a rendering function based on the current `value()`.
 *
 * Behavior:
 * - Tracks only `value()` in the reactive effect.
 * - Swaps the rendered case only when the selected key changes.
 * - Case rendering runs in a microtask (outside reactive tracking), preventing
 *   internal case reads from subscribing the outer effect.
 *
 * Lifetime:
 * - Each mounted case owns a Scope. On case swap, the previous scope is disposed,
 *   running cleanups for effects/listeners/timers created within the case.
 *
 * Cases:
 * - `cases[v]` renders when `value()` equals `v`
 * - `cases["_"]` is the default/fallback case
 */
export function match<T extends string | number | symbol>(
  value: () => T,
  cases: Record<T | '_', () => Node | Node[]>
): DocumentFragment {
  /** Stable range markers in the DOM. */
  const start = document.createComment('match:start');
  const end = document.createComment('match:end');

  /** Nodes currently mounted between start/end. */
  let currentNodes: Node[] = [];

  /** Scope that owns resources created by the currently mounted case. */
  let caseScope: Scope | null = null;

  /** Last selected key (either a concrete T or '_' fallback). */
  let lastKey: T | '_' | undefined = undefined;

  /** Coalescing: only one scheduled swap per tick. */
  let swapScheduled = false;
  let pendingKey: T | '_' | undefined = undefined;

  // Safer membership check (handles symbols and avoids prototype chain hits).
  const has = (k: PropertyKey) => Object.prototype.hasOwnProperty.call(cases, k);

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

  const mount = (nodes: Node[], scope: Scope) => {
    currentNodes = nodes;
    caseScope = scope;
    end.before(...nodes);
  };

  /**
   * Swap to a given case key.
   * Runs outside reactive tracking (scheduled via microtask).
   */
  const swap = (key: T | '_') => {
    clear();

    const nextScope = createScope();

    try {
      const fn = cases[key];

      if (!fn) {
        nextScope.dispose();
        throw new Error(`No case found for key: ${String(key)}`);
      }

      const result = withScope(nextScope, () => fn());

      if (!result) {
        nextScope.dispose();
        return;
      }

      const nodes = Array.isArray(result) ? result : [result];
      mount(nodes, nextScope);
    } catch (err) {
      nextScope.dispose();
      throw err;
    }
  };

  /**
   * Reactive driver:
   * - Reads `value()` exactly once per update.
   * - Selects the active key: exact match if present, otherwise '_' if present.
   * - If the key did not change, do nothing (no remount).
   * - If it changed, schedule a single swap (coalesced).
   */
  effect(() => {
    const v = value();

    // Pick key using own-property checks (no prototype chain).
    const key = (has(v) ? v : '_') as T | '_';

    // If neither exact case nor default exists, surface it clearly.
    if (!has(key)) {
      throw new Error(`No case found for value: ${String(v)} (and no "_" fallback)`);
    }

    if (lastKey === key) return;

    lastKey = key;
    pendingKey = key;

    if (swapScheduled) return;
    swapScheduled = true;

    // Swap outside reactive tracking.
    scheduleMicrotask(() => {
      swapScheduled = false;

      const next = pendingKey!;
      pendingKey = undefined;

      swap(next);
    });
  });

  const frag = document.createDocumentFragment();
  frag.append(start, end);
  return frag;
}
