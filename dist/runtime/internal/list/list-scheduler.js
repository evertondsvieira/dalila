import { schedule, withSchedulerPriority } from '../../../core/scheduler.js';
export function runWithResolvedPriority(resolvePriority, render) {
    const priority = resolvePriority();
    withSchedulerPriority(priority, render);
}
export function createQueuedListRerender(options) {
    let pending = null;
    return (items) => {
        if (options.isDisposed())
            return;
        pending = items;
        if (options.isQueued())
            return;
        options.setQueued(true);
        const priority = options.resolvePriority();
        schedule(() => {
            options.setQueued(false);
            if (options.isDisposed()) {
                pending = null;
                return;
            }
            const next = pending;
            pending = null;
            if (next === null)
                return;
            withSchedulerPriority(priority, () => options.render(next));
        }, { priority });
    };
}
export function createFrameRerender(options) {
    return () => {
        if (options.isDisposed())
            return;
        if (options.isPending())
            return;
        options.setPending(true);
        const priority = options.resolvePriority();
        schedule(() => {
            options.setPending(false);
            if (options.isDisposed())
                return;
            withSchedulerPriority(priority, options.render);
        }, { priority });
    };
}
