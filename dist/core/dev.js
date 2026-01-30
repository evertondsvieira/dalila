let isDevMode = true;
export function setDevMode(enabled) {
    isDevMode = enabled;
}
export function isInDevMode() {
    return isDevMode;
}
/**
 * Initialize dev tools. Currently just enables dev mode.
 * Returns a promise for future async initialization support.
 */
export async function initDevTools() {
    setDevMode(true);
}
