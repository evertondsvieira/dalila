import type { BindContext, DisposeFunction, TransitionConfig } from './bind.js';
type TransitionRegistry = Map<string, TransitionConfig>;
interface TransitionController {
    hasTransition: boolean;
    enter: () => void;
    leave: (onDone: () => void) => void;
}
interface BindIfDirectiveDeps {
    qsaIncludingRoot: (root: Element, selector: string) => Element[];
    normalizeBinding: (raw: string | null) => string | null;
    warn: (message: string) => void;
    resolve: (value: unknown) => unknown;
    bindEffect: (target: Element | null | undefined, fn: () => void) => void;
    createTransitionController: (el: HTMLElement, registry: TransitionRegistry, cleanups: DisposeFunction[]) => TransitionController;
    syncPortalElement: (el: HTMLElement) => void;
}
export declare function bindIfDirective(root: Element, ctx: BindContext, cleanups: DisposeFunction[], transitionRegistry: TransitionRegistry, deps: BindIfDirectiveDeps): void;
export {};
