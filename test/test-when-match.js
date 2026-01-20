import { signal, effect } from '../dist/core/signal.js';
import { when } from '../dist/core/when.js';
import { match } from '../dist/core/match.js';

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function logHeader(title) {
  console.log(`\n=== ${title} ===`);
}

async function assertWhenRequiresDom() {
  logHeader('when() throws without a DOM');
  const isVisible = signal(true);

  try {
    when(
      () => isVisible(),
      () => document.createTextNode('Visible'),
      () => document.createTextNode('Hidden')
    );
    console.log('Unexpected success: when() ran without a DOM');
  } catch (err) {
    console.log('Expected error:', err instanceof Error ? err.message : err);
  }
}

async function assertMatchRequiresDom() {
  logHeader('match() throws without a DOM');
  const status = signal('idle');

  try {
    match(() => status(), {
      idle: () => document.createTextNode('Idle'),
      loading: () => document.createTextNode('Loading'),
      _: () => document.createTextNode('Fallback'),
    });
    console.log('Unexpected success: match() ran without a DOM');
  } catch (err) {
    console.log('Expected error:', err instanceof Error ? err.message : err);
  }
}

async function assertCoreEffectReactivity() {
  logHeader('Signals/effects behave in Node');
  const condition = signal(false);
  let runs = 0;

  effect(() => {
    runs++;
    console.log(`Effect run ${runs} (condition=${condition()})`);
  });

  await tick(20);
  condition.set(true);
  await tick(20);
  condition.set(false);
  await tick(20);

  console.log('Final runs expected: 3 | observed:', runs);
}

async function assertMatchLikeErrorBehavior() {
  logHeader('Manual validation for missing match fallback');
  const state = signal('invalid');
  let errorThrown = false;

  try {
    const cases = {
      valid: () => 'ok',
      // deliberately omit "_" fallback
    };

    const value = state();
    const handler = cases[value] || cases['_'];
    if (!handler) throw new Error(`No case found for value: ${String(value)} (and no "_" fallback)`);
    handler();
  } catch (err) {
    errorThrown = true;
    console.log('Correct error thrown:', err instanceof Error ? err.message : err);
  }

  console.log('Was an error thrown?', errorThrown);
}

async function runNodeTests() {
  console.log('=== Headless reactivity checks (no DOM) ===');

  await assertWhenRequiresDom();
  await assertMatchRequiresDom();
  await assertCoreEffectReactivity();
  await assertMatchLikeErrorBehavior();

  console.log('\n=== End of headless reactivity checks ===');
  console.log('Expected outcomes: when/match throw without DOM, signals/effects remain functional.');
}

runNodeTests().catch((err) => {
  console.error('Unexpected error during Node tests:', err);
});
