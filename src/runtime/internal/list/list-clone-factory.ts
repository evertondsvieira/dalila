import { createListItemMetadata, type ListItemMetadataSignals } from './list-metadata.js';

export interface CreateListBoundCloneFactoryOptions {
  template: Element;
  parentCtx: Record<string, unknown>;
  alias?: string;
  decorateClone?: (clone: Element, index: number) => void;
  bindClone: (clone: Element, itemCtx: Record<string, unknown>) => () => void;
  register: (
    key: string,
    clone: Element,
    dispose: () => void,
    metadata: ListItemMetadataSignals,
    item: unknown
  ) => void;
}

/**
 * Shared factory for list directives (`d-each`, `d-virtual-each`) that:
 * - clones the template
 * - builds child context with item + metadata signals
 * - binds the clone
 * - registers clone/dispose/metadata in the directive-local registry
 */
export function createListBoundCloneFactory(
  options: CreateListBoundCloneFactoryOptions
): (key: string, item: unknown, index: number, count: number) => Element {
  const {
    template,
    parentCtx,
    alias = 'item',
    decorateClone,
    bindClone,
    register,
  } = options;

  return (key: string, item: unknown, index: number, count: number): Element => {
    const clone = template.cloneNode(true) as Element;

    const itemCtx = Object.create(parentCtx) as Record<string, unknown>;
    if (typeof item === 'object' && item !== null) {
      Object.assign(itemCtx, item as Record<string, unknown>);
    }

    const metadata = createListItemMetadata(index, count);

    // Expose item under alias + standard compatibility aliases/metadata.
    itemCtx[alias] = item;
    if (alias !== 'item') itemCtx.item = item;
    itemCtx.key = key;
    itemCtx.$index = metadata.$index;
    itemCtx.$count = metadata.$count;
    itemCtx.$first = metadata.$first;
    itemCtx.$last = metadata.$last;
    itemCtx.$odd = metadata.$odd;
    itemCtx.$even = metadata.$even;

    clone.setAttribute('data-dalila-internal-bound', '');
    decorateClone?.(clone, index);

    const dispose = bindClone(clone, itemCtx);
    register(key, clone, dispose, metadata, item);

    return clone;
  };
}
