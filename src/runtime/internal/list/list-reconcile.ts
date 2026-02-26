export function removeMissingKeys(
  keys: Iterable<string>,
  nextKeys: Set<string>,
  removeKey: (key: string) => void
): void {
  for (const key of Array.from(keys)) {
    if (nextKeys.has(key)) continue;
    removeKey(key);
  }
}

export function recreateChangedOrderedClones(
  orderedClones: Element[],
  orderedKeys: string[],
  changedKeys: Set<string>,
  recreateAt: (key: string, orderedIndex: number) => Element
): void {
  for (let i = 0; i < orderedClones.length; i++) {
    const key = orderedKeys[i];
    if (!changedKeys.has(key)) continue;
    orderedClones[i] = recreateAt(key, i);
  }
}

export function insertOrderedClonesBefore(
  parent: Node,
  orderedClones: Element[],
  referenceNode: Node
): void {
  let ref: Node = referenceNode;
  for (let i = orderedClones.length - 1; i >= 0; i--) {
    const clone = orderedClones[i];
    if (clone.nextSibling !== ref) {
      parent.insertBefore(clone, ref);
    }
    ref = clone;
  }
}
