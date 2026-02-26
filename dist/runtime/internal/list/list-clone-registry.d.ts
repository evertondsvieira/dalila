export interface ListCloneRegistry<TMeta> {
    clonesByKey: Map<string, Element>;
    disposesByKey: Map<string, () => void>;
    metadataByKey: Map<string, TMeta>;
    itemsByKey: Map<string, unknown>;
    register(key: string, clone: Element, dispose: () => void, metadata: TMeta, item: unknown): void;
    removeKey(key: string): void;
    cleanup(): void;
}
export declare function createListCloneRegistry<TMeta>(options?: {
    onBeforeRemoveClone?: (clone: Element, key: string) => void;
}): ListCloneRegistry<TMeta>;
