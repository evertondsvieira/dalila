import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

async function withDom(fn: (doc: Document) => void | Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).DocumentFragment = dom.window.DocumentFragment;
  (globalThis as any).NodeFilter = dom.window.NodeFilter;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;

  try {
    await fn(dom.window.document);
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).DocumentFragment;
    delete (globalThis as any).NodeFilter;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
  }
}

test('html tagged template preserves literal text and attributes that look like slot tokens', async () => {
  await withDom(async (doc) => {
    const { html } = await import('../dist/core/html.js');
    const fragment = html`<p data-token="__DALILA_SLOT_0__">__DALILA_SLOT_0__ ${'ok'}</p>`;
    const root = doc.createElement('div');
    root.appendChild(fragment);

    const paragraph = root.querySelector('p');
    assert.ok(paragraph);
    assert.equal(paragraph.getAttribute('data-token'), '__DALILA_SLOT_0__');
    assert.equal(paragraph.textContent, '__DALILA_SLOT_0__ ok');
  });
});
