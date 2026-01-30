/**
 * Testing utilities for watch.ts
 *
 * This file is NOT exported in the public API (src/index.ts).
 * It should only be imported directly by test files.
 *
 * @internal
 */
import { __resetWarningsForTests } from './watch.js';
/**
 * Reset all warning flags to their initial state.
 * Use this in tests to ensure deterministic warning behavior.
 */
export function resetWarnings() {
    __resetWarningsForTests();
}
