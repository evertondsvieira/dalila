import {
  configure,
  DevtoolsEvent,
  DevtoolsRuntimeOptions,
  DevtoolsSnapshot,
  getSnapshot,
  isEnabled,
  reset,
  setEnabled,
  subscribe,
} from "./devtools.js";

let isDevMode = true;

export function setDevMode(enabled: boolean): void {
  isDevMode = enabled;
}

export function isInDevMode(): boolean {
  return isDevMode;
}

export interface InitDevToolsOptions extends DevtoolsRuntimeOptions {}

export function setDevtoolsEnabled(enabled: boolean, options?: DevtoolsRuntimeOptions): void {
  setEnabled(enabled, options);
}

export function isDevtoolsEnabled(): boolean {
  return isEnabled();
}

export function configureDevtools(options: DevtoolsRuntimeOptions): void {
  configure(options);
}

export function getDevtoolsSnapshot(): DevtoolsSnapshot {
  return getSnapshot();
}

export function onDevtoolsEvent(listener: (event: DevtoolsEvent) => void): () => void {
  return subscribe(listener);
}

export function resetDevtools(): void {
  reset();
}

/**
 * Initialize dev tools runtime bridge for graph inspection.
 * Returns a promise for future async initialization support.
 */
export async function initDevTools(options: InitDevToolsOptions = {}): Promise<void> {
  setDevMode(true);
  setEnabled(true, {
    exposeGlobalHook: options.exposeGlobalHook ?? true,
    dispatchEvents: options.dispatchEvents ?? true,
    maxEvents: options.maxEvents,
  });
}
