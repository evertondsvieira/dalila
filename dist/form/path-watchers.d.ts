export interface FormPathWatcher {
    path: string;
    callback: (next: unknown, prev: unknown) => void;
    lastValue: unknown;
}
export interface NotifyPathWatchersOptions {
    changedPath?: string;
    preferFieldArrayPath?: string;
    preferFieldArrayPaths?: Iterable<string>;
}
interface PathWatchStoreOptions {
    readPathValue: (path: string, preferFieldArrayPaths?: Set<string>) => unknown;
    isPathRelated: (a: string, b: string) => boolean;
    onCallbackError?: (error: unknown) => void;
}
export declare function createPathWatchStore(options: PathWatchStoreOptions): {
    notify: (opts?: NotifyPathWatchersOptions) => void;
    add: (path: string, callback: (next: unknown, prev: unknown) => void) => FormPathWatcher;
    remove: (watcher: FormPathWatcher) => void;
    clear: () => void;
    size: () => number;
};
export {};
