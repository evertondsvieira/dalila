import { type SchedulerPriority } from '../../../core/scheduler.js';
export declare function runWithResolvedPriority(resolvePriority: () => SchedulerPriority, render: () => void): void;
export declare function createQueuedListRerender<T>(options: {
    resolvePriority: () => SchedulerPriority;
    isDisposed: () => boolean;
    setQueued: (queued: boolean) => void;
    isQueued: () => boolean;
    render: (items: T) => void;
}): (items: T) => void;
export declare function createFrameRerender(options: {
    resolvePriority: () => SchedulerPriority;
    isDisposed: () => boolean;
    isPending: () => boolean;
    setPending: (pending: boolean) => void;
    render: () => void;
}): () => void;
