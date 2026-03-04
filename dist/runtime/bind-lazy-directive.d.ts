import type { BindContext, BindOptions, DisposeFunction } from './bind.js';
interface BindLazyDirectiveDeps {
    qsaIncludingRoot: (root: Element, selector: string) => Element[];
    normalizeBinding: (raw: string | null) => string | null;
    warn: (message: string) => void;
    warnRawHtmlSinkHeuristic: (sink: string, source: string, html: string) => void;
    resolveSecurityOptions: (options: BindOptions) => unknown;
    bind: (root: Element, ctx: BindContext, options: BindOptions) => (() => void);
    bindEffect: (target: Element | null | undefined, fn: () => void) => void;
    inheritNestedBindOptions: (parent: BindOptions, overrides: BindOptions) => BindOptions;
}
export declare function bindLazyDirective(root: Element, ctx: BindContext, cleanups: DisposeFunction[], refs: Map<string, Element>, events: string[], options: BindOptions, deps: BindLazyDirectiveDeps): void;
export {};
