import { configure, getSnapshot, isEnabled, reset, setEnabled, subscribe, } from "./devtools.js";
let isDevMode = true;
export function setDevMode(enabled) {
    isDevMode = enabled;
}
export function isInDevMode() {
    return isDevMode;
}
export function setDevtoolsEnabled(enabled, options) {
    setEnabled(enabled, options);
}
export function isDevtoolsEnabled() {
    return isEnabled();
}
export function configureDevtools(options) {
    configure(options);
}
export function getDevtoolsSnapshot() {
    return getSnapshot();
}
export function onDevtoolsEvent(listener) {
    return subscribe(listener);
}
export function resetDevtools() {
    reset();
}
/**
 * Initialize dev tools runtime bridge for graph inspection.
 * Returns a promise for future async initialization support.
 */
export async function initDevTools(options = {}) {
    setDevMode(true);
    setEnabled(true, {
        exposeGlobalHook: options.exposeGlobalHook ?? true,
        dispatchEvents: options.dispatchEvents ?? true,
        maxEvents: options.maxEvents,
    });
}
