/**
 * Register a global error handler for effects/computed invalidations.
 *
 * Use this to report errors without crashing the reactive graph.
 */
export declare function setEffectErrorHandler(handler: (error: Error, source: string) => void): void;
export interface Signal<T> {
    /** Read the current value (with dependency tracking if inside an effect). */
    (): T;
    /** Set a new value and notify subscribers. */
    set(value: T): void;
    /** Update the value using a function. */
    update(fn: (v: T) => T): void;
    /** Read the current value without creating a dependency (no tracking). */
    peek(): T;
    /** Subscribe to value changes manually (outside of effects). Returns unsubscribe function. */
    on(callback: (value: T) => void): () => void;
}
/**
 * Create a signal: a mutable value with automatic dependency tracking.
 *
 * Reads:
 * - if there is an active effect, subscribe it (dynamic deps supported)
 *
 * Writes:
 * - update the value immediately
 * - notify subscribers (immediately, or deferred via batch queue)
 *
 * Lifecycle:
 * - effects remove themselves from subscriber sets on re-run and on dispose
 * - signals do not "own" subscriber lifetimes; they only maintain the set
 */
export declare function signal<T>(initialValue: T): Signal<T>;
/**
 * Create an effect: reruns `fn` whenever any tracked signal changes.
 *
 * Scheduling:
 * - the initial run is scheduled (microtask) to coalesce multiple writes
 *
 * Dependency tracking:
 * - before each run, the effect unsubscribes from previous dependencies
 * - during the run, reads resubscribe to the new dependencies (dynamic deps)
 *
 * Scope:
 * - if created inside a scope, the effect runs inside that scope
 * - the effect is disposed automatically when the scope disposes
 */
export declare function effect(fn: () => void): () => void;
/**
 * Create a computed signal (derived, cached, read-only).
 *
 * Semantics:
 * - lazy: computes on first read
 * - cached: returns the cached value until invalidated
 * - synchronous invalidation: dependencies mark it dirty immediately
 *
 * Dependency tracking:
 * - while computing, we collect dependencies into an internal "markDirty" effect
 * - those dependencies will synchronously mark this computed as dirty on change
 *
 * Subscription:
 * - other effects can subscribe to the computed like a normal signal
 */
export declare function computed<T>(fn: () => T): Signal<T>;
/**
 * Async effect with cancellation.
 *
 * Semantics:
 * - provides an AbortSignal to the callback
 * - on re-run, aborts the previous run before starting the next
 * - when disposed, aborts the current run and stops future scheduling
 */
export declare function effectAsync(fn: (signal: AbortSignal) => void): () => void;
/**
 * Run a function without tracking any signal reads as dependencies.
 *
 * Use this inside an effect when you want to read a signal's value
 * without creating a dependency on it.
 *
 * Example:
 * ```ts
 * effect(() => {
 *   const tracked = count();        // This read is tracked
 *   const untracked = untrack(() => other()); // This read is NOT tracked
 * });
 * ```
 */
export declare function untrack<T>(fn: () => T): T;
