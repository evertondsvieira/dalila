function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}
function areValuesEqual(a, b) {
    if (Object.is(a, b))
        return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (!areValuesEqual(a[i], b[i]))
                return false;
        }
        return true;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const aKeys = Object.keys(a);
        const bKeys = Object.keys(b);
        if (aKeys.length !== bKeys.length)
            return false;
        for (const key of aKeys) {
            if (!(key in b))
                return false;
            if (!areValuesEqual(a[key], b[key]))
                return false;
        }
        return true;
    }
    return false;
}
export function createPathWatchStore(options) {
    const watchers = new Set();
    function notify(opts = {}) {
        if (watchers.size === 0)
            return;
        const preferFieldArrayPaths = opts.preferFieldArrayPaths != null
            ? new Set(opts.preferFieldArrayPaths)
            : opts.preferFieldArrayPath
                ? new Set([opts.preferFieldArrayPath])
                : undefined;
        for (const watcher of watchers) {
            if (opts.changedPath && !options.isPathRelated(opts.changedPath, watcher.path))
                continue;
            const next = options.readPathValue(watcher.path, preferFieldArrayPaths);
            if (areValuesEqual(next, watcher.lastValue))
                continue;
            const prev = watcher.lastValue;
            watcher.lastValue = next;
            try {
                watcher.callback(next, prev);
            }
            catch (error) {
                options.onCallbackError?.(error);
            }
        }
    }
    function add(path, callback) {
        const watcher = {
            path,
            callback,
            lastValue: options.readPathValue(path),
        };
        watchers.add(watcher);
        return watcher;
    }
    function remove(watcher) {
        watchers.delete(watcher);
    }
    function clear() {
        watchers.clear();
    }
    function size() {
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
