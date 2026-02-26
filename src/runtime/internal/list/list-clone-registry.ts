export interface ListCloneRegistry<TMeta> {
  clonesByKey: Map<string, Element>;
  disposesByKey: Map<string, () => void>;
  metadataByKey: Map<string, TMeta>;
  itemsByKey: Map<string, unknown>;
  register(key: string, clone: Element, dispose: () => void, metadata: TMeta, item: unknown): void;
  removeKey(key: string): void;
  cleanup(): void;
}

export function createListCloneRegistry<TMeta>(options?: {
  onBeforeRemoveClone?: (clone: Element, key: string) => void;
}): ListCloneRegistry<TMeta> {
  const clonesByKey = new Map<string, Element>();
  const disposesByKey = new Map<string, () => void>();
  const metadataByKey = new Map<string, TMeta>();
  const itemsByKey = new Map<string, unknown>();

  const removeKey = (key: string): void => {
    const clone = clonesByKey.get(key);
    if (clone) options?.onBeforeRemoveClone?.(clone, key);
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

  const cleanup = (): void => {
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
