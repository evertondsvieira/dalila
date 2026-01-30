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
export declare function when(test: () => any, thenFn: () => Node | Node[], elseFn?: () => Node | Node[]): DocumentFragment;
