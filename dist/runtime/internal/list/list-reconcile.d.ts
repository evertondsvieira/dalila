export declare function removeMissingKeys(keys: Iterable<string>, nextKeys: Set<string>, removeKey: (key: string) => void): void;
export declare function recreateChangedOrderedClones(orderedClones: Element[], orderedKeys: string[], changedKeys: Set<string>, recreateAt: (key: string, orderedIndex: number) => Element): void;
export declare function insertOrderedClonesBefore(parent: Node, orderedClones: Element[], referenceNode: Node): void;
