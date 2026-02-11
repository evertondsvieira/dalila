import { DevtoolsEvent, DevtoolsRuntimeOptions, DevtoolsSnapshot } from "./devtools.js";
export declare function setDevMode(enabled: boolean): void;
export declare function isInDevMode(): boolean;
export interface InitDevToolsOptions extends DevtoolsRuntimeOptions {
}
export declare function setDevtoolsEnabled(enabled: boolean, options?: DevtoolsRuntimeOptions): void;
export declare function isDevtoolsEnabled(): boolean;
export declare function configureDevtools(options: DevtoolsRuntimeOptions): void;
export declare function getDevtoolsSnapshot(): DevtoolsSnapshot;
export declare function onDevtoolsEvent(listener: (event: DevtoolsEvent) => void): () => void;
export declare function resetDevtools(): void;
/**
 * Initialize dev tools runtime bridge for graph inspection.
 * Returns a promise for future async initialization support.
 */
export declare function initDevTools(options?: InitDevToolsOptions): Promise<void>;
