import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bind } from '../dist/runtime/bind.js';
import { signal } from '../dist/core/index.js';

function setupDom(html: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const { window } = dom;
  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).Element = window.Element;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Node = window.Node;
  (globalThis as any).NodeFilter = window.NodeFilter;
  (globalThis as any).Event = window.Event;
  return dom;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
}

test('stress runtime: d-each handles large lists and reactive updates', async () => {
  const dom = setupDom('<ul id="app"><li d-each="items">{item}</li></ul>');
  const app = document.getElementById('app') as HTMLElement;
  const items = signal(Array.from({ length: 1200 }, (_, i) => `item-${i}`));

  const dispose = bind(app, { items });
  await waitFor(() => app.querySelectorAll('li').length === 1200);
  assert.equal(app.querySelectorAll('li').length, 1200);

  items.set(Array.from({ length: 1400 }, (_, i) => `next-${i}`));
  await waitFor(() => app.querySelectorAll('li').length === 1400);
  assert.equal(app.querySelectorAll('li').length, 1400);

  dispose();
  dom.window.close();
});

test('stress runtime: many reactive bindings survive churn', async () => {
  const count = 180;
  const html = `<div id="app">${Array.from({ length: count }, (_, i) => `<span data-i="${i}" d-text="v${i}"></span>`).join('')}</div>`;
  const dom = setupDom(html);
  const app = document.getElementById('app') as HTMLElement;

  const ctx: Record<string, ReturnType<typeof signal<number>>> = {};
  for (let i = 0; i < count; i += 1) ctx[`v${i}`] = signal(i);

  const dispose = bind(app, ctx);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  for (let round = 0; round < 35; round += 1) {
    for (let i = 0; i < count; i += 1) {
      ctx[`v${i}`].set(round + i);
    }
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  for (let i = 0; i < count; i += 1) {
    const el = app.querySelector(`span[data-i="${i}"]`) as HTMLSpanElement;
    assert.equal(el.textContent, String(34 + i));
  }

  dispose();
  dom.window.close();
});

test('stress runtime: repeated mount/unmount does not keep event handlers attached', async () => {
  const dom = setupDom('<div id="app"><button id="btn" d-on-click="inc">+</button><span d-text="count"></span></div>');
  const app = document.getElementById('app') as HTMLElement;
  const btn = document.getElementById('btn') as HTMLButtonElement;
  const count = signal(0);

  for (let i = 0; i < 120; i += 1) {
    const dispose = bind(app, {
      count,
      inc: () => count.update((n) => n + 1),
    });

    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(count(), i + 1);
    dispose();

    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    assert.equal(count(), i + 1);
  }

  dom.window.close();
});
