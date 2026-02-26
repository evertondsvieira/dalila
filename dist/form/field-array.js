import { signal } from '../core/signal.js';
export function createFieldArray(basePath, options) {
    const keys = signal([]);
    const values = signal(new Map());
    let keyCounter = 0;
    function generateKey() {
        return `${basePath}_${keyCounter++}`;
    }
    function remapMetaState(oldIndices, newIndices) {
        if (!options.errors && !options.touchedSet && !options.dirtySet)
            return;
        const indexMap = new Map();
        for (let i = 0; i < oldIndices.length; i++) {
            indexMap.set(oldIndices[i], newIndices[i]);
        }
        if (options.errors) {
            options.errors.update((prev) => {
                const next = {};
                for (const [path, message] of Object.entries(prev)) {
                    const newPath = remapPath(path, indexMap);
                    next[newPath] = message;
                }
                return next;
            });
        }
        if (options.touchedSet) {
            options.touchedSet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    next.add(remapPath(path, indexMap));
                }
                return next;
            });
        }
        if (options.dirtySet) {
            options.dirtySet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    next.add(remapPath(path, indexMap));
                }
                return next;
            });
        }
    }
    function remapPath(path, indexMap) {
        const regex = new RegExp(`^${escapeRegExp(basePath)}\\[(\\d+)\\](.*)$`);
        const match = path.match(regex);
        if (!match)
            return path;
        const oldIndex = parseInt(match[1], 10);
        const rest = match[2];
        const newIndex = indexMap.get(oldIndex);
        if (newIndex === undefined)
            return path;
        return `${basePath}[${newIndex}]${rest}`;
    }
    function escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    function fields() {
        const currentKeys = keys();
        const currentValues = values();
        return currentKeys.map((key) => ({
            key,
            value: currentValues.get(key),
        }));
    }
    function length() {
        return keys().length;
    }
    function _getIndex(key) {
        return keys().indexOf(key);
    }
    function _translatePath(path) {
        const match = path.match(/^([^\[]+)\[(\d+)\](.*)$/);
        if (!match)
            return null;
        const [, arrayPath, indexStr, rest] = match;
        if (arrayPath !== basePath)
            return null;
        const index = parseInt(indexStr, 10);
        const currentKeys = keys();
        const key = currentKeys[index];
        if (!key)
            return null;
        return `${arrayPath}:${key}${rest}`;
    }
    function append(value) {
        const items = Array.isArray(value) ? value : [value];
        const newKeys = items.map(() => generateKey());
        keys.update((prev) => [...prev, ...newKeys]);
        values.update((prev) => {
            const next = new Map(prev);
            newKeys.forEach((key, i) => next.set(key, items[i]));
            return next;
        });
        options.onMutate?.();
    }
    function remove(key) {
        const removeIndex = _getIndex(key);
        const currentLength = keys().length;
        keys.update((prev) => prev.filter((k) => k !== key));
        values.update((prev) => {
            const next = new Map(prev);
            next.delete(key);
            return next;
        });
        if (removeIndex >= 0) {
            const prefix = `${basePath}[${removeIndex}]`;
            if (options.errors) {
                options.errors.update((prev) => {
                    const next = {};
                    for (const [path, message] of Object.entries(prev)) {
                        if (!path.startsWith(prefix))
                            next[path] = message;
                    }
                    return next;
                });
            }
            if (options.touchedSet) {
                options.touchedSet.update((prev) => {
                    const next = new Set();
                    for (const path of prev) {
                        if (!path.startsWith(prefix))
                            next.add(path);
                    }
                    return next;
                });
            }
            if (options.dirtySet) {
                options.dirtySet.update((prev) => {
                    const next = new Set();
                    for (const path of prev) {
                        if (!path.startsWith(prefix))
                            next.add(path);
                    }
                    return next;
                });
            }
            const oldIndices = [];
            const newIndices = [];
            for (let i = removeIndex + 1; i < currentLength; i++) {
                oldIndices.push(i);
                newIndices.push(i - 1);
            }
            if (oldIndices.length > 0)
                remapMetaState(oldIndices, newIndices);
        }
        options.onMutate?.();
    }
    function removeAt(index) {
        if (index < 0 || index >= keys().length)
            return;
        const key = keys()[index];
        if (key)
            remove(key);
    }
    function insert(index, value) {
        const len = keys().length;
        if (index < 0 || index > len)
            return;
        const key = generateKey();
        const currentLength = len;
        const oldIndices = [];
        const newIndices = [];
        for (let i = index; i < currentLength; i++) {
            oldIndices.push(i);
            newIndices.push(i + 1);
        }
        if (oldIndices.length > 0)
            remapMetaState(oldIndices, newIndices);
        keys.update((prev) => {
            const next = [...prev];
            next.splice(index, 0, key);
            return next;
        });
        values.update((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
        options.onMutate?.();
    }
    function move(fromIndex, toIndex) {
        const len = keys().length;
        if (fromIndex < 0 || fromIndex >= len || toIndex < 0 || toIndex >= len)
            return;
        if (fromIndex === toIndex)
            return;
        const oldIndices = [];
        const newIndices = [];
        if (fromIndex < toIndex) {
            oldIndices.push(fromIndex);
            newIndices.push(toIndex);
            for (let i = fromIndex + 1; i <= toIndex; i++) {
                oldIndices.push(i);
                newIndices.push(i - 1);
            }
        }
        else {
            oldIndices.push(fromIndex);
            newIndices.push(toIndex);
            for (let i = toIndex; i < fromIndex; i++) {
                oldIndices.push(i);
                newIndices.push(i + 1);
            }
        }
        remapMetaState(oldIndices, newIndices);
        keys.update((prev) => {
            const next = [...prev];
            const [item] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, item);
            return next;
        });
        options.onMutate?.();
    }
    function swap(indexA, indexB) {
        const len = keys().length;
        if (indexA < 0 || indexA >= len || indexB < 0 || indexB >= len)
            return;
        if (indexA === indexB)
            return;
        remapMetaState([indexA, indexB], [indexB, indexA]);
        keys.update((prev) => {
            const next = [...prev];
            [next[indexA], next[indexB]] = [next[indexB], next[indexA]];
            return next;
        });
        options.onMutate?.();
    }
    function replace(newValues) {
        const newKeys = newValues.map(() => generateKey());
        if (options.errors) {
            options.errors.update((prev) => {
                const next = {};
                for (const [path, message] of Object.entries(prev)) {
                    if (!path.startsWith(`${basePath}[`))
                        next[path] = message;
                }
                return next;
            });
        }
        if (options.touchedSet) {
            options.touchedSet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    if (!path.startsWith(`${basePath}[`))
                        next.add(path);
                }
                return next;
            });
        }
        if (options.dirtySet) {
            options.dirtySet.update((prev) => {
                const next = new Set();
                for (const path of prev) {
                    if (!path.startsWith(`${basePath}[`))
                        next.add(path);
                }
                return next;
            });
        }
        keys.set(newKeys);
        values.set(new Map(newKeys.map((key, i) => [key, newValues[i]])));
        options.onMutate?.();
    }
    function update(key, value) {
        values.update((prev) => {
            const next = new Map(prev);
            next.set(key, value);
            return next;
        });
        options.onMutate?.();
    }
    function updateAt(index, value) {
        if (index < 0 || index >= keys().length)
            return;
        const key = keys()[index];
        if (key)
            update(key, value);
    }
    function clear() {
        replace([]);
    }
    if (options.scope) {
        options.scope.onCleanup(() => {
            clear();
        });
    }
    return {
        fields,
        append,
        remove,
        removeAt,
        insert,
        move,
        swap,
        replace,
        update,
        updateAt,
        clear,
        length,
        _getIndex,
        _translatePath,
    };
}
