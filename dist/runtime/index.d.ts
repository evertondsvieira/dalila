/**
 * Dalila Runtime Module
 *
 * Provides declarative DOM binding with reactive updates.
 * No eval, no inline JS - only identifier resolution.
 *
 * @module dalila/runtime
 */
export { bind, autoBind } from './bind.js';
export type { BindOptions, BindContext, DisposeFunction } from './bind.js';
