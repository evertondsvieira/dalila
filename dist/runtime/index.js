/**
 * Dalila Runtime Module
 *
 * Provides declarative DOM binding with reactive updates.
 * No eval, no inline JS - only identifier resolution.
 *
 * @module dalila/runtime
 */
export { bind, autoBind, mount, configure, createPortalTarget, getVirtualListController, scrollToVirtualIndex } from './bind.js';
export { fromHtml } from './fromHtml.js';
export { defineComponent, defineSimpleComponent, component } from './component.js';
export { createLazyComponent, createSuspense, getLazyComponent, preloadLazyComponent, isLazyComponentLoaded, getLazyComponentState, observeLazyElement, } from './lazy.js';
export { createErrorBoundary, bindBoundary, withErrorBoundary, createErrorBoundaryState, } from './boundary.js';
