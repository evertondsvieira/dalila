/**
 * Dalila Runtime Module
 *
 * Provides declarative DOM binding with reactive updates.
 * No eval, no inline JS - only identifier resolution.
 *
 * @module dalila/runtime
 */
export { bind, autoBind, mount, configure } from './bind.js';
export { fromHtml } from './fromHtml.js';
export { defineComponent } from './component.js';
