export function removeMissingKeys(keys, nextKeys, removeKey) {
    for (const key of Array.from(keys)) {
        if (nextKeys.has(key))
            continue;
        removeKey(key);
    }
}
export function recreateChangedOrderedClones(orderedClones, orderedKeys, changedKeys, recreateAt) {
    for (let i = 0; i < orderedClones.length; i++) {
        const key = orderedKeys[i];
        if (!changedKeys.has(key))
            continue;
        orderedClones[i] = recreateAt(key, i);
    }
}
export function insertOrderedClonesBefore(parent, orderedClones, referenceNode) {
    let ref = referenceNode;
    for (let i = orderedClones.length - 1; i >= 0; i--) {
        const clone = orderedClones[i];
        if (clone.nextSibling !== ref) {
            parent.insertBefore(clone, ref);
        }
        ref = clone;
    }
}
