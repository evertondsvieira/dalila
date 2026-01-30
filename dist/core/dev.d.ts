export declare function setDevMode(enabled: boolean): void;
export declare function isInDevMode(): boolean;
/**
 * Initialize dev tools. Currently just enables dev mode.
 * Returns a promise for future async initialization support.
 */
export declare function initDevTools(): Promise<void>;
