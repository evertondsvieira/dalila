import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bind } from '../dist/runtime/bind.js';
import { signal } from '../dist/core/index.js';

function initDom(markup: string) {
  const dom = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
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

test('edge DOM: bind tolerates malformed/fragmented HTML trees', async () => {
  const dom = initDom('<div id="app"><span d-text="name"><p d-on-click="noop">x</div>');
  const app = document.getElementById('app') as HTMLElement;
  const name = signal('Dalila');

  const dispose = bind(app, {
    name,
    noop: () => {},
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(app.textContent?.includes('Dalila'), true);

  name.set('Updated');
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(app.textContent?.includes('Updated'), true);

  dispose();
  dom.window.close();
});

test('edge DOM: detached nodes in d-each updates do not crash runtime', async () => {
  const dom = initDom('<div id="app"><div d-each="items">{item}</div></div>');
  const app = document.getElementById('app') as HTMLElement;
  const items = signal(['a', 'b', 'c']);

  const dispose = bind(app, { items });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const first = app.querySelector('div');
  if (first?.parentNode) first.parentNode.removeChild(first);

  items.set(['x', 'y', 'z', 'w']);
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  assert.ok(app.childNodes.length >= 0);

  dispose();
  dom.window.close();
});
