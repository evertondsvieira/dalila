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
export declare function match<T extends string | number | symbol>(value: () => T, cases: Record<T | "_", () => Node | Node[]>): DocumentFragment;
