import { getCurrentScope, withScope } from './scope.js';
import { scheduleMicrotask, isBatching, queueInBatch } from './scheduler.js';
import { aliasEffectToNode, linkSubscriberSetToSignal, registerEffect, registerSignal, trackDependency, trackEffectDispose, trackEffectRun, trackSignalRead, trackSignalWrite, untrackDependencyBySet, } from './devtools.js';
/**
 * Optional global error handler for reactive execution.
 *
 * The runtime keeps running even if an effect/computed throws:
 * - if a handler is registered, we forward errors to it
 * - otherwise we log to the console
 */
let effectErrorHandler = null;
/**
 * Register a global error handler for effects/computed invalidations.
 *
 * Use this to report errors without crashing the reactive graph.
 */
export function setEffectErrorHandler(handler) {
    effectErrorHandler = handler;
}
/**
 * Normalize unknown throws into Error and route to the global handler (or console).
 */
function reportEffectError(error, source) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (effectErrorHandler)
        effectErrorHandler(err, source);
    else
        console.error(`[Dalila] Error in ${source}:`, err);
}
/**
 * Currently executing effect for dependency collection.
 * Any signal read while this is set subscribes this effect.
 */
let activeEffect = null;
/**
 * Scope associated with the currently executing effect.
 *
 * Best-effort safety:
 * - effects run inside an owning scope
 * - signals only subscribe the active effect if the caller is in the same scope
 */
let activeScope = null;
/**
 * Per-tick dedupe for async effects.
 * Multiple writes in the same tick schedule an effect only once.
 */
const pendingEffects = new Set();
/**
 * Stable runner per effect (function identity).
 *
 * Why:
 * - when batching, we enqueue a function into the batch queue
 * - dedupe uses function identity
 * - each effect needs a stable runner function across schedules
 */
const effectRunners = new WeakMap();
/**
 * Schedule an effect with correct semantics:
 * - computed invalidations run synchronously (mark dirty immediately)
 * - normal effects run async (microtask), coalesced/deduped per tick
 * - inside batch(): queue into the batch queue to flush once
 */
function scheduleEffect(eff) {
    if (eff.disposed)
        return;
    // Computed invalidation: run immediately so computed becomes dirty synchronously.
    if (eff.sync) {
        try {
            eff();
        }
        catch (error) {
            reportEffectError(error, 'computed');
        }
        return;
    }
    // Dedup before scheduling.
    if (pendingEffects.has(eff))
        return;
    pendingEffects.add(eff);
    // Create / reuse stable runner (so batch dedupe works correctly).
    let runEffect = effectRunners.get(eff);
    if (!runEffect) {
        runEffect = () => {
            pendingEffects.delete(eff);
            if (eff.disposed)
                return;
            try {
                eff();
            }
            catch (error) {
                reportEffectError(error, 'effect');
            }
        };
        effectRunners.set(eff, runEffect);
    }
    // During batch: defer scheduling into the batch queue (no microtask overhead).
    // Outside batch: schedule in a microtask (coalescing across multiple writes).
    if (isBatching())
        queueInBatch(runEffect);
    else
        scheduleMicrotask(runEffect);
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
export function signal(initialValue) {
    const owningScope = getCurrentScope();
    let value = initialValue;
    const subscribers = new Set();
    let signalRef;
    const read = () => {
        trackSignalRead(signalRef);
        if (activeEffect && !activeEffect.disposed) {
            // Scope-aware subscription guard (best effort):
            // - if the active effect is not scoped, allow subscription
            // - if scoped, only subscribe when currently executing inside that scope
            if (!activeScope) {
                if (!subscribers.has(activeEffect)) {
                    subscribers.add(activeEffect);
                    (activeEffect.deps ?? (activeEffect.deps = new Set())).add(subscribers);
                    trackDependency(signalRef, activeEffect);
                }
            }
            else {
                const current = getCurrentScope();
                if (activeScope === current) {
                    if (!subscribers.has(activeEffect)) {
                        subscribers.add(activeEffect);
                        (activeEffect.deps ?? (activeEffect.deps = new Set())).add(subscribers);
                        trackDependency(signalRef, activeEffect);
                    }
                }
            }
        }
        return value;
    };
    const notify = () => {
        for (const eff of subscribers)
            scheduleEffect(eff);
    };
    read.set = (nextValue) => {
        // No-op on identical values.
        if (Object.is(value, nextValue))
            return;
        // State updates are immediate even inside `batch()`.
        value = nextValue;
        trackSignalWrite(signalRef, nextValue);
        // Notify now, or defer into the batch queue.
        if (isBatching())
            queueInBatch(notify);
        else
            notify();
    };
    read.update = (fn) => {
        read.set(fn(value));
    };
    read.peek = () => value;
    read.on = (callback) => {
        // Create a lightweight effect-like subscriber for manual subscriptions
        const subscriber = (() => {
            if (subscriber.disposed)
                return;
            callback(value);
        });
        subscriber.disposed = false;
        subscribers.add(subscriber);
        (subscriber.deps ?? (subscriber.deps = new Set())).add(subscribers);
        // Return unsubscribe function
        return () => {
            if (subscriber.disposed)
                return;
            subscriber.disposed = true;
            subscribers.delete(subscriber);
            subscriber.deps?.delete(subscribers);
        };
    };
    signalRef = read;
    registerSignal(signalRef, 'signal', {
        scopeRef: owningScope,
        initialValue,
    });
    linkSubscriberSetToSignal(subscribers, signalRef);
    return read;
}
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
export function effect(fn) {
    const owningScope = getCurrentScope();
    const cleanupDeps = () => {
        if (!run.deps)
            return;
        for (const depSet of run.deps) {
            depSet.delete(run);
            untrackDependencyBySet(depSet, run);
        }
        run.deps.clear();
    };
    const dispose = () => {
        if (run.disposed)
            return;
        run.disposed = true;
        cleanupDeps();
        pendingEffects.delete(run);
        trackEffectDispose(run);
    };
    const run = (() => {
        if (run.disposed)
            return;
        trackEffectRun(run);
        // Dynamic deps: unsubscribe from previous reads.
        cleanupDeps();
        const prevEffect = activeEffect;
        const prevScope = activeScope;
        activeEffect = run;
        activeScope = owningScope ?? null;
        try {
            // Run inside owning scope so resources created by the effect are scoped.
            if (owningScope)
                withScope(owningScope, fn);
            else
                fn();
        }
        finally {
            activeEffect = prevEffect;
            activeScope = prevScope;
        }
    });
    registerEffect(run, 'effect', owningScope);
    scheduleEffect(run);
    if (owningScope)
        owningScope.onCleanup(dispose);
    return dispose;
}
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
export function computed(fn) {
    const owningScope = getCurrentScope();
    let value;
    let dirty = true;
    const subscribers = new Set();
    let signalRef;
    // Dep sets that `markDirty` is currently registered in (so we can unsubscribe on recompute).
    let trackedDeps = new Set();
    /**
     * Internal invalidator.
     * Runs synchronously when any dependency changes.
     */
    const markDirty = (() => {
        if (dirty)
            return;
        dirty = true;
        for (const eff of subscribers)
            scheduleEffect(eff);
    });
    markDirty.disposed = false;
    markDirty.sync = true;
    const cleanupDeps = () => {
        for (const depSet of trackedDeps) {
            depSet.delete(markDirty);
            untrackDependencyBySet(depSet, markDirty);
        }
        trackedDeps.clear();
        if (markDirty.deps)
            markDirty.deps.clear();
    };
    const read = () => {
        trackSignalRead(signalRef);
        // Allow effects to subscribe to this computed (same rules as signal()).
        if (activeEffect && !activeEffect.disposed) {
            if (!activeScope) {
                if (!subscribers.has(activeEffect)) {
                    subscribers.add(activeEffect);
                    (activeEffect.deps ?? (activeEffect.deps = new Set())).add(subscribers);
                    trackDependency(signalRef, activeEffect);
                }
            }
            else {
                const current = getCurrentScope();
                if (activeScope === current) {
                    if (!subscribers.has(activeEffect)) {
                        subscribers.add(activeEffect);
                        (activeEffect.deps ?? (activeEffect.deps = new Set())).add(subscribers);
                        trackDependency(signalRef, activeEffect);
                    }
                }
            }
        }
        if (dirty) {
            cleanupDeps();
            const prevEffect = activeEffect;
            const prevScope = activeScope;
            // Collect deps into markDirty.
            activeEffect = markDirty;
            // During dependency collection for computed:
            // - we want to subscribe to its dependencies regardless of the caller scope.
            // - the computed's deps belong to the computed itself, not to whoever read it.
            activeScope = null;
            try {
                value = fn();
                dirty = false;
                // Snapshot the current dep sets for later unsubscription.
                if (markDirty.deps)
                    trackedDeps = new Set(markDirty.deps);
            }
            finally {
                activeEffect = prevEffect;
                activeScope = prevScope;
            }
        }
        return value;
    };
    read.set = () => {
        throw new Error('Cannot set a computed signal directly. Computed signals are derived from other signals.');
    };
    read.update = () => {
        throw new Error('Cannot update a computed signal directly. Computed signals are derived from other signals.');
    };
    read.peek = () => {
        // For computed, peek still needs to compute if dirty, but without tracking
        if (dirty) {
            cleanupDeps();
            const prevEffect = activeEffect;
            const prevScope = activeScope;
            activeEffect = markDirty;
            activeScope = null;
            try {
                value = fn();
                dirty = false;
                if (markDirty.deps)
                    trackedDeps = new Set(markDirty.deps);
            }
            finally {
                activeEffect = prevEffect;
                activeScope = prevScope;
            }
        }
        return value;
    };
    read.on = (callback) => {
        const subscriber = (() => {
            if (subscriber.disposed)
                return;
            // For computed, we need to get the latest value
            callback(read.peek());
        });
        subscriber.disposed = false;
        subscribers.add(subscriber);
        (subscriber.deps ?? (subscriber.deps = new Set())).add(subscribers);
        return () => {
            if (subscriber.disposed)
                return;
            subscriber.disposed = true;
            subscribers.delete(subscriber);
            subscriber.deps?.delete(subscribers);
        };
    };
    signalRef = read;
    registerSignal(signalRef, 'computed', {
        scopeRef: owningScope,
    });
    linkSubscriberSetToSignal(subscribers, signalRef);
    aliasEffectToNode(markDirty, signalRef);
    registerEffect(markDirty, 'effect', owningScope);
    return read;
}
/**
 * Async effect with cancellation.
 *
 * Semantics:
 * - provides an AbortSignal to the callback
 * - on re-run, aborts the previous run before starting the next
 * - when disposed, aborts the current run and stops future scheduling
 */
export function effectAsync(fn) {
    const owningScope = getCurrentScope();
    let controller = null;
    const cleanupDeps = () => {
        if (!run.deps)
            return;
        for (const depSet of run.deps) {
            depSet.delete(run);
            untrackDependencyBySet(depSet, run);
        }
        run.deps.clear();
    };
    const dispose = () => {
        if (run.disposed)
            return;
        run.disposed = true;
        controller?.abort();
        controller = null;
        cleanupDeps();
        pendingEffects.delete(run);
        trackEffectDispose(run);
    };
    const run = (() => {
        if (run.disposed)
            return;
        trackEffectRun(run);
        // Abort previous run (if any), then create a new controller for this run.
        controller?.abort();
        controller = new AbortController();
        cleanupDeps();
        const prevEffect = activeEffect;
        const prevScope = activeScope;
        activeEffect = run;
        activeScope = owningScope ?? null;
        try {
            const exec = () => fn(controller.signal);
            if (owningScope)
                withScope(owningScope, exec);
            else
                exec();
        }
        finally {
            activeEffect = prevEffect;
            activeScope = prevScope;
        }
    });
    registerEffect(run, 'effectAsync', owningScope);
    scheduleEffect(run);
    if (owningScope)
        owningScope.onCleanup(dispose);
    return dispose;
}
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
export function untrack(fn) {
    const prevEffect = activeEffect;
    const prevScope = activeScope;
    activeEffect = null;
    activeScope = null;
    try {
        return fn();
    }
    finally {
        activeEffect = prevEffect;
        activeScope = prevScope;
    }
}
