export declare function extractSlots(el: Element): {
    defaultSlot: DocumentFragment;
    namedSlots: Map<string, DocumentFragment>;
};
export declare function fillSlots(root: Element, defaultSlot: DocumentFragment, namedSlots: Map<string, DocumentFragment>): void;
export declare function bindSlotFragments(defaultSlot: DocumentFragment, namedSlots: Map<string, DocumentFragment>, parentCtx: Record<string, unknown>, events: string[], cleanups: Array<() => void>, bindFragmentRoot: (root: Element, ctx: Record<string, unknown>, options: {
    events: string[];
    _skipLifecycle: true;
    _internal: true;
}) => (() => void)): void;
