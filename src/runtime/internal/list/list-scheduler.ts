import { schedule, withSchedulerPriority, type SchedulerPriority } from '../../../core/scheduler.js';

export function runWithResolvedPriority(
  resolvePriority: () => SchedulerPriority,
  render: () => void
): void {
  const priority = resolvePriority();
  withSchedulerPriority(priority, render);
}

export function createQueuedListRerender<T>(options: {
  resolvePriority: () => SchedulerPriority;
  isDisposed: () => boolean;
  setQueued: (queued: boolean) => void;
  isQueued: () => boolean;
  render: (items: T) => void;
}): (items: T) => void {
  let pending: T | null = null;

  return (items: T) => {
    if (options.isDisposed()) return;
    pending = items;
    if (options.isQueued()) return;

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
      if (next === null) return;
      withSchedulerPriority(priority, () => options.render(next));
    }, { priority });
  };
}

export function createFrameRerender(options: {
  resolvePriority: () => SchedulerPriority;
  isDisposed: () => boolean;
  isPending: () => boolean;
  setPending: (pending: boolean) => void;
  render: () => void;
}): () => void {
  return () => {
    if (options.isDisposed()) return;
    if (options.isPending()) return;
    options.setPending(true);
    const priority = options.resolvePriority();
    schedule(() => {
      options.setPending(false);
      if (options.isDisposed()) return;
      withSchedulerPriority(priority, options.render);
    }, { priority });
  };
}
