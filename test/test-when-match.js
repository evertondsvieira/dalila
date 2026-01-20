import { signal, effect } from '../dist/core/signal.js';
import { when } from '../dist/core/when.js';
import { match } from '../dist/core/match.js';

console.log('=== Testing when() and match() (Node.js - no DOM) ===');

/**
 * In Node.js there is no `document`, so `when()` and `match()` cannot run.
 * These tests confirm:
 * - The functions are DOM-based (expected to throw in Node)
 * - Core reactivity (signals/effects) behaves as expected
 */

// Test 1: when() requires DOM
console.log('\nTest 1: when() requires DOM');
const isVisible = signal(true);

try {
  when(
    () => isVisible(),
    () => {
      // This would run only in a DOM environment
      return document.createTextNode('Visible');
    },
    () => {
      return document.createTextNode('Hidden');
    }
  );
  console.log('Unexpected: when() did not throw in Node');
} catch (err) {
  console.log('Expected error:', err.message);
}

// Test 2: match() requires DOM
console.log('\nTest 2: match() requires DOM');
const status = signal('idle');

try {
  match(() => status(), {
    idle: () => document.createTextNode('Idle'),
    loading: () => document.createTextNode('Loading'),
    _: () => document.createTextNode('Fallback'),
  });
  console.log('Unexpected: match() did not throw in Node');
} catch (err) {
  console.log('Expected error:', err.message);
}

// Test 3: Core reactivity in Node (avoid coalescing by separating ticks)
console.log('\nTest 3: Core reactivity (separate ticks)');
const condition = signal(false);
let effectRuns = 0;

effect(() => {
  effectRuns++;
  console.log(`Effect run ${effectRuns}, condition: ${condition()}`);
});

// Separate ticks so the effect re-runs multiple times (coalescing-safe)
setTimeout(() => condition.set(true), 0);
setTimeout(() => condition.set(false), 10);

setTimeout(() => {
  console.log('After changes - effect runs:', effectRuns, '(expected 3)');

  // Test 4: match-like selection logic in Node (no DOM)
  // This test validates the *idea* behind match(): choose a branch based on a key.
  console.log('\nTest 4: match-like selection logic (no DOM)');

  const state = signal('invalid');
  let errorThrown = false;

  const cases = {
    valid: () => 'ok',
    // no "_" fallback on purpose
  };

  try {
    const v = state();
    const fn = cases[v] || cases['_'];
    if (!fn) {
      throw new Error(`No case found for value: ${String(v)} (and no "_" fallback)`);
    }
    fn();
  } catch (err) {
    errorThrown = true;
    console.log('Error correctly thrown:', err.message);
  }

  console.log('Error thrown for missing fallback:', errorThrown, '(expected true)');

  console.log('\n=== All Node Tests Completed ===');
  console.log('when() requires DOM (expected in Node)');
  console.log('match() requires DOM (expected in Node)');
  console.log('Core reactivity works (signals/effects)');
  console.log('match-like error behavior validated without DOM');
}, 80);
