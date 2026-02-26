import { type Signal } from '../../../core/signal.js';
import type { ComponentDefinition } from '../../component.js';
type WarnFn = (message: string) => void;
type NormalizeBindingFn = (raw: string | null) => string | null;
type SignalLike = (() => unknown) & {
    set?: unknown;
    update?: unknown;
};
type IsSignalFn = (value: unknown) => value is SignalLike;
export declare function resolveComponentProps(el: Element, parentCtx: Record<string, unknown>, def: ComponentDefinition, deps: {
    warn: WarnFn;
    normalizeBinding: NormalizeBindingFn;
    isSignal: IsSignalFn;
}): Record<string, Signal<unknown>>;
export {};
