export interface FormPathWatcher {
  path: string;
  callback: (next: unknown, prev: unknown) => void;
  lastValue: unknown;
}

export interface NotifyPathWatchersOptions {
  changedPath?: string;
  preferFieldArrayPath?: string;
  preferFieldArrayPaths?: Iterable<string>;
}

interface PathWatchStoreOptions {
  readPathValue: (path: string, preferFieldArrayPaths?: Set<string>) => unknown;
  isPathRelated: (a: string, b: string) => boolean;
  onCallbackError?: (error: unknown) => void;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function areValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!areValuesEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!(key in b)) return false;
      if (!areValuesEqual(a[key], b[key])) return false;
    }
    return true;
  }

  return false;
}

export function createPathWatchStore(options: PathWatchStoreOptions) {
  const watchers = new Set<FormPathWatcher>();

  function notify(opts: NotifyPathWatchersOptions = {}): void {
    if (watchers.size === 0) return;

    const preferFieldArrayPaths =
      opts.preferFieldArrayPaths != null
        ? new Set<string>(opts.preferFieldArrayPaths)
        : opts.preferFieldArrayPath
          ? new Set<string>([opts.preferFieldArrayPath])
          : undefined;

    for (const watcher of watchers) {
      if (opts.changedPath && !options.isPathRelated(opts.changedPath, watcher.path)) continue;

      const next = options.readPathValue(watcher.path, preferFieldArrayPaths);
      if (areValuesEqual(next, watcher.lastValue)) continue;

      const prev = watcher.lastValue;
      watcher.lastValue = next;

      try {
        watcher.callback(next, prev);
      } catch (error) {
        options.onCallbackError?.(error);
      }
    }
  }

  function add(path: string, callback: (next: unknown, prev: unknown) => void): FormPathWatcher {
    const watcher: FormPathWatcher = {
      path,
      callback,
      lastValue: options.readPathValue(path),
    };
    watchers.add(watcher);
    return watcher;
  }

  function remove(watcher: FormPathWatcher): void {
    watchers.delete(watcher);
  }

  function clear(): void {
    watchers.clear();
  }

  function size(): number {
    return watchers.size;
  }

  return {
    notify,
    add,
    remove,
    clear,
    size,
  };
}
