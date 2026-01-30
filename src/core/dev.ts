let isDevMode = true;

export function setDevMode(enabled: boolean): void {
  isDevMode = enabled;
}

export function isInDevMode(): boolean {
  return isDevMode;
}

/**
 * Initialize dev tools. Currently just enables dev mode.
 * Returns a promise for future async initialization support.
 */
export async function initDevTools(): Promise<void> {
  setDevMode(true);
}
