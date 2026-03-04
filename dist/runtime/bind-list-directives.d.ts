import type { SchedulerPriority } from '../core/scheduler.js';
import type { BindContext, BindOptions, DisposeFunction, VirtualListController, VirtualScrollToIndexOptions } from './bind.js';
interface BindListDirectiveDeps {
    qsaIncludingRoot: (root: Element, selector: string) => Element[];
    normalizeBinding: (raw: string | null) => string | null;
    warn: (message: string) => void;
    resolve: (value: unknown) => unknown;
    bind: (root: Element, ctx: BindContext, options: BindOptions) => (() => void);
    bindEffect: (target: Element | null | undefined, fn: () => void) => void;
    inheritNestedBindOptions: (parent: BindOptions, overrides: BindOptions) => BindOptions;
    isSignal: (value: unknown) => value is (() => unknown) & {
        set: unknown;
        update: unknown;
    };
    resolveListRenderPriority: () => SchedulerPriority;
}
export declare function getVirtualListController(target: Element | null): VirtualListController | null;
export declare function scrollToVirtualIndex(target: Element | null, index: number, options?: VirtualScrollToIndexOptions): boolean;
export declare function bindVirtualEachDirective(root: Element, ctx: BindContext, cleanups: DisposeFunction[], options: BindOptions, deps: BindListDirectiveDeps): void;
export declare function bindEachDirective(root: Element, ctx: BindContext, cleanups: DisposeFunction[], options: BindOptions, deps: BindListDirectiveDeps): void;
export {};
