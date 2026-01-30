export declare function createVirtualList<T>(items: () => T[], itemHeight: number | ((item: T, index: number) => number), renderItem: (item: T, index: number) => HTMLElement, options: {
    container: HTMLElement;
    bufferSize?: number;
    keyFn?: (item: T) => string;
}): void;
export declare function createSimpleVirtualList<T>(items: () => T[], itemHeight: number, renderItem: (item: T, index: number) => HTMLElement, container: HTMLElement, bufferSize?: number): void;
export declare function createVirtualTable<T>(data: () => T[], columns: {
    key: keyof T;
    header: string;
    width: string;
}[], renderCell: (item: T, column: {
    key: keyof T;
    header: string;
    width: string;
}, index: number) => HTMLElement, container: HTMLElement, rowHeight?: number, bufferSize?: number): void;
export declare function createInfiniteScroll<T>(fetchFn: (offset: number, limit: number) => Promise<T[]>, renderItem: (item: T, index: number) => HTMLElement, container: HTMLElement, options?: {
    itemHeight?: number;
    bufferSize?: number;
    initialLoad?: number;
    loadMoreThreshold?: number;
}): {
    items: () => T[];
    loading: () => boolean;
    error: () => Error | null;
    refresh: () => Promise<void>;
};
