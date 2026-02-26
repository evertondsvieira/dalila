type WarnFn = (message: string) => void;
type ResolveFn = (value: unknown) => unknown;
type IsSignalLikeFn = (value: unknown) => boolean;
type VirtualListApiLike = {
    scrollToIndex: (index: number, options?: any) => void;
    refresh: () => void;
};
export declare function readVirtualNumberOption(raw: string | null, ctx: Record<string, unknown>, label: string, deps: {
    warn: WarnFn;
    resolve: ResolveFn;
}): number | null;
export declare function readVirtualHeightOption(raw: string | null, ctx: Record<string, unknown>, deps: {
    resolve: ResolveFn;
}): string | null;
export declare function readVirtualMeasureOption(raw: string | null, ctx: Record<string, unknown>, deps: {
    resolve: ResolveFn;
}): boolean;
export declare function readVirtualCallbackOption(raw: string | null, ctx: Record<string, unknown>, label: string, deps: {
    warn: WarnFn;
    isSignal: IsSignalLikeFn;
}): (() => unknown) | null;
export declare function createVirtualSpacer(template: Element, kind: 'top' | 'bottom'): HTMLElement;
export declare function getVirtualScrollRestoreValue(key: string): number | undefined;
export declare function setVirtualScrollRestoreValue(key: string, value: number): void;
export declare function clampVirtual(value: number, min: number, max: number): number;
export declare function getElementPositionPath(el: Element): string;
export declare function getVirtualRestoreKey(doc: Document, templatePath: string, scrollContainer: HTMLElement | null, bindingName: string, keyBinding: string | null): string;
export declare class VirtualHeightsIndex {
    private itemCount;
    private estimatedHeight;
    private tree;
    private overrides;
    constructor(itemCount: number, estimatedHeight: number);
    get count(): number;
    snapshotOverrides(): Map<number, number>;
    reset(itemCount: number, estimatedHeight: number, seed?: Map<number, number>): void;
    set(index: number, height: number): boolean;
    get(index: number): number;
    prefix(endExclusive: number): number;
    total(): number;
    lowerBound(target: number): number;
    indexAtOffset(offset: number): number;
    private addAt;
}
export declare function readVirtualListApi<T extends VirtualListApiLike>(target: Element | null): T | null;
export declare function setVirtualListApi(target: HTMLElement | null, api: VirtualListApiLike): void;
export declare function clearVirtualListApi(target: HTMLElement | null, api: VirtualListApiLike): void;
export {};
