import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bind } from '../dist/runtime/bind.js';
import { signal } from '../dist/core/index.js';
import { defineComponent } from '../dist/runtime/component.js';

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

test('d-boundary swaps between children and fallback', async () => {
  await withDom(async (doc) => {
    const error = signal(null);

    const root = el(
      doc,
      `
      <div>
        <section d-boundary="<p class='fallback' data-error-message></p>" d-boundary-error="error">
          <span class="child-content">Safe Content</span>
        </section>
      </div>
      `
    );

    const dispose = bind(root, { error });
    await tick(20);

    assert.ok(root.querySelector('[data-boundary-children]'));
    assert.ok(root.querySelector('.child-content'));
    assert.equal(root.querySelector('.fallback'), null);

    error.set(new Error('boundary boom'));
    await tick(20);

    assert.equal(root.querySelector('[data-boundary-children]'), null);
    const fallback = root.querySelector('.fallback');
    assert.ok(fallback);
    assert.equal(fallback.textContent, 'boundary boom');

    error.set(null);
    await tick(20);

    assert.ok(root.querySelector('[data-boundary-children]'));
    assert.ok(root.querySelector('.child-content'));
    assert.equal(root.querySelector('.fallback'), null);

    dispose();
  });
});

test('d-boundary mounts initial children synchronously when error is null', async () => {
  await withDom(async (doc) => {
    const error = signal(null);
    const root = el(
      doc,
      `
      <div>
        <section d-boundary="<p class='fallback'>Error</p>" d-boundary-error="error">
          <span class="child-content">Sync Content</span>
        </section>
      </div>
      `
    );

    const dispose = bind(root, { error });

    // No await: content must exist immediately after bind().
    assert.ok(root.querySelector('[data-boundary-children]'));
    assert.ok(root.querySelector('.child-content'));
    assert.equal(root.querySelector('.fallback'), null);

    dispose();
  });
});

test('d-boundary fallback is bind-processed and can trigger reset', async () => {
  await withDom(async (doc) => {
    const error = signal(null);
    let resetCalls = 0;
    const reset = () => {
      resetCalls++;
      error.set(null);
    };

    const root = el(
      doc,
      `
      <div>
        <section
          d-boundary="<button class='retry' d-on-click='reset'>Retry</button>"
          d-boundary-error="error"
          d-boundary-reset="reset"
        >
          <span class="child-content">Safe Content</span>
        </section>
      </div>
      `
    );

    const dispose = bind(root, { error, reset });
    await tick(20);

    error.set(new Error('boom'));
    await tick(20);

    const retry = root.querySelector('.retry');
    assert.ok(retry);
    retry.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await tick(20);

    assert.equal(resetCalls, 1);
    assert.equal(root.querySelector('.retry'), null);
    assert.ok(root.querySelector('.child-content'));

    dispose();
  });
});

test('d-boundary does not double-mount child components', async () => {
  await withDom(async (doc) => {
    let mounts = 0;

    const Child = defineComponent({
      tag: 'x-boundary-once',
      template: '<p>child</p>',
      setup: (_props, ctx) => {
        ctx.onMount(() => {
          mounts++;
        });
        return {};
      },
    });

    const root = el(
      doc,
      `
      <div>
        <section d-boundary="<p class='fallback'>err</p>" d-boundary-error="err">
          <x-boundary-once></x-boundary-once>
        </section>
      </div>
      `
    );

    const err = signal(null);
    const dispose = bind(root, { err }, {
      components: {
        'x-boundary-once': Child,
      },
    });

    await tick(20);
    assert.equal(mounts, 1);

    dispose();
  });
});

test('d-boundary on detached root does not duplicate children', async () => {
  await withDom(async (doc) => {
    const error = signal(null);

    const root = doc.createElement('section');
    root.setAttribute('d-boundary', "<p class='fallback'>err</p>");
    root.setAttribute('d-boundary-error', 'error');
    root.innerHTML = '<span class="detached-child">Detached Content</span>';

    const dispose = bind(root, { error });
    await tick(20);

    assert.equal(root.querySelectorAll('.detached-child').length, 1);
    assert.equal(root.querySelectorAll('[data-boundary-children]').length, 1);

    error.set(new Error('boom'));
    await tick(20);
    assert.equal(root.querySelectorAll('.detached-child').length, 0);
    assert.equal(root.querySelectorAll('.fallback').length, 1);

    error.set(null);
    await tick(20);
    assert.equal(root.querySelectorAll('.detached-child').length, 1);
    assert.equal(root.querySelectorAll('[data-boundary-children]').length, 1);

    dispose();
  });
});

test('nested d-boundary does not double-bind stale inner nodes', async () => {
  await withDom(async (doc) => {
    let mounts = 0;

    const Child = defineComponent({
      tag: 'x-boundary-nested-once',
      template: '<p>nested</p>',
      setup: (_props, ctx) => {
        ctx.onMount(() => {
          mounts++;
        });
        return {};
      },
    });

    const outerError = signal(null);
    const innerError = signal(null);

    const root = el(
      doc,
      `
      <div d-boundary="<p>outer error</p>" d-boundary-error="outerError">
        <section d-boundary="<p>inner error</p>" d-boundary-error="innerError">
          <x-boundary-nested-once></x-boundary-nested-once>
        </section>
      </div>
      `
    );

    const dispose = bind(root, { outerError, innerError }, {
      components: {
        'x-boundary-nested-once': Child,
      },
    });
    await tick(20);

    assert.equal(mounts, 1);

    dispose();
  });
});

test('d-boundary preserves host element in DOM', async () => {
  await withDom(async (doc) => {
    const error = signal(null);
    const root = el(
      doc,
      `
      <section id="boundary-host" class="host-class" d-boundary="<p class='fallback'>Error</p>" d-boundary-error="error">
        <span class="child-content">Host Child</span>
      </section>
      `
    );

    const hostRef = root;
    const dispose = bind(root, { error });

    assert.equal(hostRef.isConnected, true);
    assert.equal(hostRef.id, 'boundary-host');
    assert.equal(hostRef.classList.contains('host-class'), true);
    assert.ok(hostRef.querySelector('[data-boundary-children]'));

    error.set(new Error('boom'));
    await tick(20);

    assert.equal(hostRef.isConnected, true);
    assert.equal(hostRef.id, 'boundary-host');
    assert.equal(hostRef.classList.contains('host-class'), true);
    assert.ok(hostRef.querySelector('.fallback'));

    dispose();
  });
});

test('d-boundary children are not double-bound by parent directive pass', async () => {
  await withDom(async (doc) => {
    let clicks = 0;
    const inc = () => {
      clicks++;
    };

    const root = el(
      doc,
      `
      <div>
        <section d-boundary="<p class='fallback'>err</p>" d-boundary-error="error">
          <button class="inside-btn" d-on-click="inc">Inside</button>
        </section>
      </div>
      `
    );

    const error = signal(null);
    const dispose = bind(root, { error, inc });
    await tick(20);

    const btn = root.querySelector('.inside-btn');
    assert.ok(btn);
    btn.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
    await tick(0);

    assert.equal(clicks, 1);
    dispose();
  });
});
