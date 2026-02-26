export function createListCloneRegistry(options) {
    const clonesByKey = new Map();
    const disposesByKey = new Map();
    const metadataByKey = new Map();
    const itemsByKey = new Map();
    const removeKey = (key) => {
        const clone = clonesByKey.get(key);
        if (clone)
            options?.onBeforeRemoveClone?.(clone, key);
        clone?.remove();
        clonesByKey.delete(key);
        metadataByKey.delete(key);
        itemsByKey.delete(key);
        const dispose = disposesByKey.get(key);
        if (dispose) {
            dispose();
            disposesByKey.delete(key);
        }
    };
    const cleanup = () => {
        for (const key of Array.from(clonesByKey.keys())) {
            removeKey(key);
        }
        clonesByKey.clear();
        disposesByKey.clear();
        metadataByKey.clear();
        itemsByKey.clear();
    };
    return {
        clonesByKey,
        disposesByKey,
        metadataByKey,
        itemsByKey,
        register(key, clone, dispose, metadata, item) {
            metadataByKey.set(key, metadata);
            itemsByKey.set(key, item);
            disposesByKey.set(key, dispose);
            clonesByKey.set(key, clone);
        },
        removeKey,
        cleanup,
    };
}
