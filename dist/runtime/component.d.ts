/**
 * Dalila Component System
 *
 * Declarative component definitions for use with bind().
 * This module contains only types, defineComponent, and pure helpers —
 * no imports from bind.ts (avoids circular dependency).
 *
 * @module dalila/runtime/component
 */
import type { Signal } from '../core/signal.js';
export type PropConstructor = StringConstructor | NumberConstructor | BooleanConstructor | ArrayConstructor | ObjectConstructor | FunctionConstructor;
export interface PropDefinition {
    type: PropConstructor;
    required?: boolean;
    default?: unknown;
}
export type PropOption = PropConstructor | PropDefinition;
export type PropsSchema = Record<string, PropOption>;
type InferPropType<T extends PropConstructor> = T extends StringConstructor ? string : T extends NumberConstructor ? number : T extends BooleanConstructor ? boolean : T extends ArrayConstructor ? unknown[] : T extends ObjectConstructor ? Record<string, unknown> : T extends FunctionConstructor ? Function : unknown;
type InferPropOptionType<T extends PropOption> = T extends PropConstructor ? InferPropType<T> : T extends {
    type: infer C extends PropConstructor;
    default: infer D;
} ? D extends (...args: any[]) => infer R ? R : InferPropType<C> : T extends {
    type: infer C extends PropConstructor;
} ? InferPropType<C> : unknown;
export type TypedPropSignals<P extends PropsSchema> = {
    [K in keyof P]: Signal<InferPropOptionType<P[K]>>;
};
/** @deprecated Use TypedPropSignals instead */
export type PropSignals<P> = {
    [K in keyof P]: Signal<unknown>;
};
export type EmitsSchema = Record<string, unknown>;
export type RefsSchema = Record<string, Element>;
export type TypedEmit<E extends EmitsSchema> = <K extends keyof E & string>(event: K, payload: E[K]) => void;
export type TypedRef<R extends RefsSchema> = <K extends keyof R & string>(name: K) => R[K] | null;
export interface TypedSetupContext<E extends EmitsSchema = EmitsSchema, R extends RefsSchema = RefsSchema> {
    ref: TypedRef<R>;
    refs(): Readonly<Partial<R>>;
    emit: TypedEmit<E>;
    onMount(fn: () => void): void;
    onCleanup(fn: () => void): void;
}
/** @deprecated Use TypedSetupContext instead */
export interface SetupContext {
    ref(name: string): Element | null;
    refs(): Readonly<Record<string, Element>>;
    emit(event: string, ...args: unknown[]): void;
    onMount(fn: () => void): void;
    onCleanup(fn: () => void): void;
}
export interface ComponentDefinition<P extends PropsSchema = PropsSchema, E extends EmitsSchema = EmitsSchema, R extends RefsSchema = RefsSchema> {
    tag: string;
    template: string;
    props?: P;
    setup?: (props: TypedPropSignals<P>, ctx: TypedSetupContext<E, R>) => Record<string, unknown>;
}
/**
 * Erased component handle used by bind() and mount().
 * The generic P from defineComponent is erased here so that
 * any Component can be stored in a Record<string, Component> registry
 * without variance issues.
 */
export interface Component {
    readonly __dalila_component: true;
    readonly definition: ComponentDefinition<any, any, any>;
}
export declare function defineComponent<P extends PropsSchema = PropsSchema, E extends EmitsSchema = EmitsSchema, R extends RefsSchema = RefsSchema>(def: ComponentDefinition<P, E, R>): Component;
export declare function isComponent(value: unknown): value is Component;
export declare function normalizePropDef(option: PropOption): PropDefinition;
export declare function coercePropValue(raw: string, type: PropConstructor): unknown;
export declare function kebabToCamel(str: string): string;
export declare function camelToKebab(str: string): string;
export {};
