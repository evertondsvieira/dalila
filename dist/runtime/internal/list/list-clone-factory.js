import { createListItemMetadata } from './list-metadata.js';
/**
 * Shared factory for list directives (`d-each`, `d-virtual-each`) that:
 * - clones the template
 * - builds child context with item + metadata signals
 * - binds the clone
 * - registers clone/dispose/metadata in the directive-local registry
 */
export function createListBoundCloneFactory(options) {
    const { template, parentCtx, alias = 'item', decorateClone, bindClone, register, } = options;
    return (key, item, index, count) => {
        const clone = template.cloneNode(true);
        const itemCtx = Object.create(parentCtx);
        if (typeof item === 'object' && item !== null) {
            Object.assign(itemCtx, item);
        }
        const metadata = createListItemMetadata(index, count);
        // Expose item under alias + standard compatibility aliases/metadata.
        itemCtx[alias] = item;
        if (alias !== 'item')
            itemCtx.item = item;
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
