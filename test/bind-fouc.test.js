/**
 * Test: bind() FOUC prevention
 *
 * Validates that bind() properly manages data-dalila-loading and data-dalila-ready
 * attributes to prevent Flash of Unstyled Content (FOUC).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Setup DOM
const { window } = new JSDOM(`<!DOCTYPE html><html><body></body></html>`);
global.window = window;
global.document = window.document;
global.Element = window.Element;
global.HTMLElement = window.HTMLElement;
global.NodeFilter = window.NodeFilter;
global.MutationObserver = window.MutationObserver;

// Import after DOM is set up
import { bind } from '../dist/runtime/bind.js';
import { signal } from '../dist/core/signal.js';

test('bind: removes d-loading when present', async () => {
  const root = document.createElement('div');
  root.setAttribute('d-loading', '');
  root.innerHTML = '<p>{count}</p>';

  const ctx = { count: signal(0) };

  // Initially has d-loading (added manually in HTML)
  assert.equal(root.hasAttribute('d-loading'), true);

  bind(root, ctx);

  // Wait for microtask
  await new Promise(resolve => queueMicrotask(resolve));

  // After bind completes, d-loading is removed
  assert.equal(root.hasAttribute('d-loading'), false);
  assert.equal(root.hasAttribute('d-ready'), true);
});

test('bind: adds d-ready after bindings complete', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>{count}</p>';

  const ctx = { count: signal(42) };

  bind(root, ctx);

  // Initially no d-ready
  assert.equal(root.hasAttribute('d-ready'), false);

  // Wait for microtask
  await new Promise(resolve => queueMicrotask(resolve));

  // After microtask, should have d-ready
  assert.equal(root.hasAttribute('d-ready'), true);
});

test('bind: text interpolation works correctly', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>{count}</p>';

  const ctx = { count: signal(5) };

  bind(root, ctx);

  // Wait for effects to run
  await new Promise(resolve => setTimeout(resolve, 10));

  const p = root.querySelector('p');
  assert.ok(p);
  assert.equal(p.textContent, '5');
});

test('bind: multiple interpolations', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>{greeting} {name}!</p>';

  const ctx = {
    greeting: signal('Hello'),
    name: signal('World')
  };

  bind(root, ctx);

  await new Promise(resolve => setTimeout(resolve, 10));

  const p = root.querySelector('p');
  assert.ok(p);
  assert.equal(p.textContent, 'Hello World!');
});

test('bind: works without d-loading attribute', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>{count}</p>';

  const ctx = { count: signal(0) };

  // No d-loading attribute initially
  assert.equal(root.hasAttribute('d-loading'), false);

  const dispose = bind(root, ctx);

  // Wait for ready
  await new Promise(resolve => queueMicrotask(resolve));

  // Should still add d-ready
  assert.equal(root.hasAttribute('d-ready'), true);

  dispose();
});

test('bind: reactive updates after ready', async () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>{count}</p>';

  const count = signal(0);
  const ctx = { count };

  bind(root, ctx);

  await new Promise(resolve => setTimeout(resolve, 10));

  // Should be ready
  assert.equal(root.hasAttribute('d-ready'), true);

  // Update signal
  count.set(10);

  await new Promise(resolve => setTimeout(resolve, 10));

  const p = root.querySelector('p');
  assert.equal(p.textContent, '10');
});
