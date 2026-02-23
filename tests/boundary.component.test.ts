import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bind } from '../dist/runtime/bind.js';
import { createErrorBoundary } from '../dist/runtime/boundary.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).Node = dom.window.Node;
  (globalThis as any).NodeFilter = dom.window.NodeFilter;
  (globalThis as any).Element = dom.window.Element;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  (globalThis as any).HTMLTemplateElement = dom.window.HTMLTemplateElement;
  (globalThis as any).DocumentFragment = dom.window.DocumentFragment;
  (globalThis as any).Comment = dom.window.Comment;

  try {
    await fn(dom.window.document);
  } finally {
    await tick(20);
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).NodeFilter;
    delete (globalThis as any).Element;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLTemplateElement;
    delete (globalThis as any).DocumentFragment;
    delete (globalThis as any).Comment;
  }
}

function el(doc, html) {
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  doc.body.appendChild(root);
  return root;
}

test('createErrorBoundary creates active d-boundary wrapper', async () => {
  await withDom(async (doc) => {
    const Boundary = createErrorBoundary({
      fallback: '<p class="fallback">Failed</p>'
    });

    const tag = Boundary.definition.tag;
    const root = el(doc, `<div><${tag}><span class="child">Inside</span></${tag}></div>`);

    const dispose = bind(root, {}, {
      components: {
        [tag]: Boundary,
      },
    });

    await tick(30);

    assert.ok(root.querySelector('[data-boundary-children]'));
    assert.ok(root.querySelector('.child'));

    dispose();
  });
});
