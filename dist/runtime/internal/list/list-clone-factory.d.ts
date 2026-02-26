import { type ListItemMetadataSignals } from './list-metadata.js';
export interface CreateListBoundCloneFactoryOptions {
    template: Element;
    parentCtx: Record<string, unknown>;
    alias?: string;
    decorateClone?: (clone: Element, index: number) => void;
    bindClone: (clone: Element, itemCtx: Record<string, unknown>) => () => void;
    register: (key: string, clone: Element, dispose: () => void, metadata: ListItemMetadataSignals, item: unknown) => void;
}
/**
 * Shared factory for list directives (`d-each`, `d-virtual-each`) that:
 * - clones the template
 * - builds child context with item + metadata signals
 * - binds the clone
 * - registers clone/dispose/metadata in the directive-local registry
 */
export declare function createListBoundCloneFactory(options: CreateListBoundCloneFactoryOptions): (key: string, item: unknown, index: number, count: number) => Element;
