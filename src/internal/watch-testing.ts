/**
 * Testing utilities for watch.ts
 * @internal
 */
import { __resetWarningsForTests } from '../core/watch.js';

export function resetWarnings(): void {
  __resetWarningsForTests();
}
