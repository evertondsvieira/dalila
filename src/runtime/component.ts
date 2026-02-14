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

// ============================================================================
// Types
// ============================================================================

export type PropConstructor =
  | StringConstructor | NumberConstructor | BooleanConstructor
  | ArrayConstructor | ObjectConstructor | FunctionConstructor;

export interface PropDefinition {
  type: PropConstructor;
  required?: boolean;
  default?: unknown;
}

export type PropOption = PropConstructor | PropDefinition;
export type PropsSchema = Record<string, PropOption>;

// ── Typed prop inference ──

type InferPropType<T extends PropConstructor> =
  T extends StringConstructor ? string :
  T extends NumberConstructor ? number :
  T extends BooleanConstructor ? boolean :
  T extends ArrayConstructor ? unknown[] :
  T extends ObjectConstructor ? Record<string, unknown> :
  T extends FunctionConstructor ? Function : unknown;

type InferPropOptionType<T extends PropOption> =
  T extends PropConstructor ? InferPropType<T> :
  T extends { type: infer C extends PropConstructor; default: infer D }
    ? D extends (...args: any[]) => infer R ? R : InferPropType<C>
  : T extends { type: infer C extends PropConstructor } ? InferPropType<C>
  : unknown;

export type TypedPropSignals<P extends PropsSchema> = {
  [K in keyof P]: Signal<InferPropOptionType<P[K]>>;
};

/** @deprecated Use TypedPropSignals instead */
export type PropSignals<P> = { [K in keyof P]: Signal<unknown> };

// ── Emits and Refs schemas ──

export type EmitsSchema = Record<string, unknown>;
export type RefsSchema = Record<string, Element>;

export type TypedEmit<E extends EmitsSchema> = <K extends keyof E & string>(
  event: K, payload: E[K]
) => void;

export type TypedRef<R extends RefsSchema> = <K extends keyof R & string>(
  name: K
) => R[K] | null;

// ── SetupContext ──

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

export interface ComponentDefinition<
  P extends PropsSchema = PropsSchema,
  E extends EmitsSchema = EmitsSchema,
  R extends RefsSchema = RefsSchema
> {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly definition: ComponentDefinition<any, any, any>;
}

// ============================================================================
// defineComponent
// ============================================================================

export function defineComponent<
  P extends PropsSchema = PropsSchema,
  E extends EmitsSchema = EmitsSchema,
  R extends RefsSchema = RefsSchema
>(
  def: ComponentDefinition<P, E, R>
): Component {
  if (!def.tag || !def.tag.includes('-')) {
    throw new Error(`[Dalila] defineComponent: tag "${def.tag}" must contain a hyphen.`);
  }
  return { __dalila_component: true as const, definition: def };
}

export function isComponent(value: unknown): value is Component {
  return typeof value === 'object' && value !== null && (value as any).__dalila_component === true;
}

// ============================================================================
// Prop Helpers
// ============================================================================

export function normalizePropDef(option: PropOption): PropDefinition {
  return typeof option === 'function' ? { type: option as PropConstructor } : option as PropDefinition;
}

export function coercePropValue(raw: string, type: PropConstructor): unknown {
  switch (type) {
    case Number:  return Number(raw);
    case Boolean: return raw !== 'false' && raw !== '0';
    default:      return raw;
  }
}

export function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}
