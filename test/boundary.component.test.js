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

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.NodeFilter = dom.window.NodeFilter;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.HTMLTemplateElement = dom.window.HTMLTemplateElement;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.Comment = dom.window.Comment;

  try {
    await fn(dom.window.document);
  } finally {
    await tick(20);
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.NodeFilter;
    delete globalThis.Element;
    delete globalThis.HTMLElement;
    delete globalThis.HTMLTemplateElement;
    delete globalThis.DocumentFragment;
    delete globalThis.Comment;
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
