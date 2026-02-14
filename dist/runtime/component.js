/**
 * Dalila Component System
 *
 * Declarative component definitions for use with bind().
 * This module contains only types, defineComponent, and pure helpers —
 * no imports from bind.ts (avoids circular dependency).
 *
 * @module dalila/runtime/component
 */
// ============================================================================
// defineComponent
// ============================================================================
export function defineComponent(def) {
    if (!def.tag || !def.tag.includes('-')) {
        throw new Error(`[Dalila] defineComponent: tag "${def.tag}" must contain a hyphen.`);
    }
    return { __dalila_component: true, definition: def };
}
export function isComponent(value) {
    return typeof value === 'object' && value !== null && value.__dalila_component === true;
}
// ============================================================================
// Prop Helpers
// ============================================================================
export function normalizePropDef(option) {
    return typeof option === 'function' ? { type: option } : option;
}
export function coercePropValue(raw, type) {
    switch (type) {
        case Number: return Number(raw);
        case Boolean: return raw !== 'false' && raw !== '0';
        default: return raw;
    }
}
export function kebabToCamel(str) {
    return str.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
export function camelToKebab(str) {
    return str.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}
