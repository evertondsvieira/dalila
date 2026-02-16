/**
 * Dalila Runtime Module
 *
 * Provides declarative DOM binding with reactive updates.
 * No eval, no inline JS - only identifier resolution.
 *
 * @module dalila/runtime
 */

export {
  bind,
  autoBind,
  mount,
  configure,
  createPortalTarget,
  getVirtualListController,
  scrollToVirtualIndex
} from './bind.js';
export type {
  BindOptions,
  BindContext,
  BindData,
  DisposeFunction,
  BindHandle,
  TransitionConfig,
  VirtualListAlign,
  VirtualScrollToIndexOptions,
  VirtualListController
} from './bind.js';

export { fromHtml } from './fromHtml.js';
export type { FromHtmlOptions } from './fromHtml.js';

export { defineComponent } from './component.js';
export type {
  Component, ComponentDefinition, PropsSchema, PropSignals, SetupContext,
  TypedPropSignals, TypedSetupContext, EmitsSchema, RefsSchema, TypedEmit, TypedRef,
} from './component.js';
