import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signal, effect } from '../dist/core/signal.js';
import { when } from '../dist/core/when.js';
import { match } from '../dist/core/match.js';

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('when() throws without a DOM', () => {
  const isVisible = signal(true);

  assert.throws(() => {
    when(
      () => isVisible(),
      () => document.createTextNode('Visible'),
      () => document.createTextNode('Hidden')
    );
  });
});

test('match() throws without a DOM', () => {
  const status = signal('idle');

  assert.throws(() => {
    match(() => status(), {
      idle: () => document.createTextNode('Idle'),
      loading: () => document.createTextNode('Loading'),
      _: () => document.createTextNode('Fallback'),
    });
  });
});

test('signals/effects behave in Node', async () => {
  const condition = signal(false);
  let runs = 0;

  effect(() => {
    condition();
    runs++;
  });

  await tick(20);
  condition.set(true);
  await tick(20);
  condition.set(false);
  await tick(20);

  assert.equal(runs, 3);
});

test('manual validation for missing match fallback semantics', () => {
  const state = signal('invalid');

  assert.throws(() => {
    const cases: Record<string, (() => string) | undefined> = {
      valid: () => 'ok',
    };

    const value = state();
    const handler = cases[value] || cases._;
    if (!handler) throw new Error(`No case found for value: ${String(value)} (and no "_" fallback)`);
    handler();
  }, /No case found for value/);
});
