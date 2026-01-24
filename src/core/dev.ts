let isDevMode = true;

export function setDevMode(enabled: boolean): void {
  isDevMode = enabled;
}

export function isInDevMode(): boolean {
  return isDevMode;
}
