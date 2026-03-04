import type { BindContext, DisposeFunction } from './bind.js';
type PortalExpressionResult = {
    ok: true;
    value: unknown;
} | {
    ok: false;
    reason: 'parse' | 'missing_identifier';
    message: string;
    identifier?: string;
};
interface BindPortalDirectiveDeps {
    qsaIncludingRoot: (root: Element, selector: string) => Element[];
    parseExpression: (source: string) => unknown;
    evalExpressionAst: (ast: any, ctx: BindContext) => PortalExpressionResult;
    resolve: (value: unknown) => unknown;
    warn: (message: string) => void;
    bindEffect: (target: Element | null | undefined, fn: () => void) => void;
}
export declare function syncPortalElement(el: HTMLElement): void;
export declare function bindPortalDirective(root: Element, ctx: BindContext, cleanups: DisposeFunction[], deps: BindPortalDirectiveDeps): void;
export {};
