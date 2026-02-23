/**
 * Lazy loading components tests
 *
 * Covers:
 *   1  createLazyComponent creates a lazy component
 *   2  getLazyComponent retrieves registered components
 *   3  Lazy component starts in loading state
 *   4  Lazy component loads successfully
 *   5  Lazy component handles load error
 *   6  Lazy component supports loading delay
 *   7  d-lazy directive loads component when in viewport
 *   8  d-lazy shows loading template
 *   9  d-lazy shows error template
 *   10 preloadLazyComponent triggers loading
 *   11 isLazyComponentLoaded checks load state
 *   12 getLazyComponentState returns state
 */

import test   from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bind } from '../dist/runtime/bind.js';
import { defineComponent }   from '../dist/runtime/component.js';
import {
  createLazyComponent,
  createSuspense,
  getLazyComponent,
  preloadLazyComponent,
  isLazyComponentLoaded,
  getLazyComponentState,
  observeLazyElement,
} from '../dist/runtime/lazy.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  (globalThis as any).window            = dom.window;
  (globalThis as any).document          = dom.window.document;
  (globalThis as any).Node              = dom.window.Node;
  (globalThis as any).NodeFilter        = dom.window.NodeFilter;
  (globalThis as any).Element           = dom.window.Element;
  (globalThis as any).HTMLElement       = dom.window.HTMLElement;
  (globalThis as any).HTMLTemplateElement = dom.window.HTMLTemplateElement;
  (globalThis as any).DocumentFragment  = dom.window.DocumentFragment;
  (globalThis as any).Comment           = dom.window.Comment;
  (globalThis as any).IntersectionObserver = dom.window.IntersectionObserver;

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
    delete (globalThis as any).IntersectionObserver;
  }
}

function el(doc, html) {
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  doc.body.appendChild(root);
  return root;
}

// ─── 1  createLazyComponent creates a lazy component ─────────────────────────

test('lazy – createLazyComponent creates a component', async () => {
  await withDom(async (doc) => {
    // Create a simple component to load
    const TestComp = defineComponent({
      tag: 'test-lazy-comp',
      template: '<p>Loaded!</p>',
    });

    // Create lazy component with a loader that returns the component
    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    // Should return a component
    assert.ok(LazyComp);
    assert.ok(LazyComp.definition);
    assert.ok(LazyComp.definition.tag);
  });
});

// ─── 2  getLazyComponent retrieves registered components ───────────────────────

test('lazy – getLazyComponent retrieves registered component', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-reg-comp',
      template: '<p>Registered</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    // Should be able to retrieve from registry
    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);
    
    assert.ok(result);
    assert.equal(result.component.definition.tag, tag);
  });
});

// ─── 3  Lazy component starts in loading state ─────────────────────────────────

test('lazy – starts in loading state', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-loading-state',
      template: '<p>Loading State</p>',
    });

    // Without loadingDelay
    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    assert.ok(result);
    assert.equal(result.state.loading(), false);
    assert.equal(result.state.loaded(), false);
    assert.equal(result.state.error(), null);
    assert.equal(result.state.component(), null);

    // Trigger load - immediately sets loading to true (no delay)
    result.state.load();
    
    // Should be in loading state immediately
    assert.equal(result.state.loading(), true);
  });
});



// ─── 4  Lazy component loads successfully ─────────────────────────────────────

test('lazy – loads successfully', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-success',
      template: '<p>Success!</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    // Trigger load and wait
    result.state.load();
    await tick(50);

    // Should be loaded
    assert.equal(result.state.loading(), false);
    assert.equal(result.state.loaded(), true);
    assert.ok(result.state.component());
    assert.equal(result.state.error(), null);
  });
});

// ─── 5  Lazy component handles load error ─────────────────────────────────────

test('lazy – handles load error', async () => {
  await withDom(async (doc) => {
    const LazyComp = createLazyComponent(
      () => Promise.reject(new Error('Failed to load'))
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    // Trigger load and wait
    result.state.load();
    await tick(50);

    // Should have error
    assert.equal(result.state.loading(), false);
    assert.equal(result.state.loaded(), false);
    assert.ok(result.state.error());
    assert.equal(result.state.error()?.message, 'Failed to load');
  });
});

test('lazy – handles synchronous loader throw safely', async () => {
  await withDom(async (doc) => {
    const LazyComp = createLazyComponent(() => {
      throw new Error('sync loader failure');
    });

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    result.state.load();
    await tick(20);

    assert.equal(result.state.loading(), false);
    assert.equal(result.state.loaded(), false);
    assert.ok(result.state.error());
    assert.equal(result.state.error()?.message, 'sync loader failure');
  });
});

test('lazy – load() dedupes concurrent calls during loadingDelay', async () => {
  await withDom(async (doc) => {
    let calls = 0;
    const TestComp = defineComponent({
      tag: 'test-dedupe-delay',
      template: '<p>deduped</p>',
    });

    const LazyComp = createLazyComponent(
      () => {
        calls++;
        return new Promise<any>((resolve) => {
          setTimeout(() => resolve(TestComp), 30);
        });
      },
      { loadingDelay: 50 }
    );

    const state = getLazyComponentState(LazyComp.definition.tag);
    assert.ok(state);

    state.load();
    state.load();
    state.load();

    await tick(70);
    assert.equal(calls, 1);
    assert.equal(state.loaded(), true);
    assert.equal(state.loading(), false);
  });
});

// ─── 6  Lazy component supports loading delay ─────────────────────────────────
// Note: The current implementation starts loading immediately even with loadingDelay
// The delay only affects when the loading state is shown. This test verifies the
// basic functionality works (component loads successfully)

test('lazy – supports loading delay', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-delay',
      template: '<p>Delayed</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp),
      { loadingDelay: 100 }
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    // Trigger load - component should load successfully despite delay
    result.state.load();

    // Wait for component to load
    await tick(200);

    // Should be loaded
    assert.equal(result.state.loading(), false);
    assert.equal(result.state.loaded(), true);
    assert.ok(result.state.component());
  });
});



// ─── 7  d-lazy directive loads component when in viewport ─────────────────────
// Skipped: JSDOM doesn't fully support IntersectionObserver
// In a real browser environment, this would test loading when element enters viewport

test('lazy – d-lazy directive loads component', async () => {
  await withDom(async (doc) => {
    const OriginalIntersectionObserver = (globalThis as any).IntersectionObserver;
    class FakeIntersectionObserver {
      callback;
      constructor(callback) { this.callback = callback; }
      observe(target) {
        this.callback([{ isIntersecting: true, target }], this);
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    try {
    const TestComp = defineComponent({
      tag: 'test-lazy-dir',
      template: '<p>Lazy Loaded!</p>',
    });

    // Create lazy component
    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;

    // Create root with d-lazy element
    const root = el(doc, `<div><div d-lazy="${tag}">Placeholder</div></div>`);
    
    // Bind with the lazy component available in registry
    const handle = bind(root, {});
    await tick(50);

    // The element should be processed (d-lazy attribute removed)
    const lazyEl = root.querySelector('[d-lazy]');
    assert.equal(lazyEl, null);

    handle();
    } finally {
      (globalThis as any).IntersectionObserver = OriginalIntersectionObserver;
    }
  });
});


// ─── 8  d-lazy shows loading template ─────────────────────────────────────────
// Skipped: JSDOM doesn't fully support IntersectionObserver

test('lazy – d-lazy shows loading template', async () => {
  await withDom(async (doc) => {
    const OriginalIntersectionObserver = (globalThis as any).IntersectionObserver;
    class FakeIntersectionObserver {
      callback;
      constructor(callback) { this.callback = callback; }
      observe(target) {
        this.callback([{ isIntersecting: true, target }], this);
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    try {
    const TestComp = defineComponent({
      tag: 'test-loading-tpl',
      template: '<p>Content</p>',
    });

    // Create lazy component with delay
    const LazyComp = createLazyComponent(
      () => new Promise((resolve) => setTimeout(() => resolve(TestComp), 120)),
      { loadingDelay: 50 }
    );

    const tag = LazyComp.definition.tag;

    // Create root with d-lazy and loading template
    const root = el(doc, `
      <div>
        <div d-lazy="${tag}" d-lazy-loading="<span>Loading...</span>">Placeholder</div>
      </div>
    `);
    
    const handle = bind(root, {});
    await tick(70);

    // Loading template should be shown
    const loadingEl = root.querySelector('span');
    assert.ok(loadingEl);
    assert.equal(loadingEl.textContent, 'Loading...');

    // Wait for load to complete
    await tick(100);

      handle();
    } finally {
      (globalThis as any).IntersectionObserver = OriginalIntersectionObserver;
    }
  });
});

// ─── 9  d-lazy shows error template ─────────────────────────────────────────
// Skipped: JSDOM doesn't fully support IntersectionObserver

test('lazy – d-lazy shows error template', async () => {
  await withDom(async (doc) => {
    const OriginalIntersectionObserver = (globalThis as any).IntersectionObserver;
    class FakeIntersectionObserver {
      callback;
      constructor(callback) { this.callback = callback; }
      observe(target) {
        this.callback([{ isIntersecting: true, target }], this);
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    try {
    // Create lazy component that fails
    const LazyComp = createLazyComponent(
      () => Promise.reject(new Error('Load failed'))
    );

    const tag = LazyComp.definition.tag;

    // Create root with d-lazy and error template
    const root = el(doc, `
      <div>
        <div d-lazy="${tag}" d-lazy-error="<span>Error!</span>">Placeholder</div>
      </div>
    `);
    
    const handle = bind(root, {});
    await tick(50);

    // Error template should be shown
    const errorEl = root.querySelector('span');
    assert.ok(errorEl);
    assert.equal(errorEl.textContent, 'Error!');

    handle();
    } finally {
      (globalThis as any).IntersectionObserver = OriginalIntersectionObserver;
    }
  });
});

test('lazy – d-lazy replaces original placeholder element', async () => {
  await withDom(async (doc) => {
    let observerCallback = null;
    class FakeIntersectionObserver {
      constructor(cb) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const TestComp = defineComponent({
      tag: 'test-lazy-replace',
      template: '<p>Loaded content</p>',
    });

    const LazyComp = createLazyComponent(() => Promise.resolve(TestComp));
    const tag = LazyComp.definition.tag;

    const root = el(
      doc,
      `<div><div id="lazy-placeholder" d-lazy="${tag}">Placeholder</div></div>`
    );

    const handle = bind(root, {});
    const placeholder = doc.getElementById('lazy-placeholder');
    assert.ok(placeholder);
    assert.ok(observerCallback);

    observerCallback([{ target: placeholder, isIntersecting: true }]);
    await tick(50);

    assert.equal(root.textContent?.includes('Placeholder'), false);
    assert.ok(root.textContent?.includes('Loaded content'));

    handle();
  });
});

test('lazy – d-ref points to connected rendered node after d-lazy load', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    const TestComp = defineComponent({
      tag: 'test-lazy-ref',
      template: '<p class="loaded-node">Loaded via lazy</p>',
    });
    const LazyComp = createLazyComponent(() => Promise.resolve(TestComp));
    const tag = LazyComp.definition.tag;

    const root = el(
      doc,
      `<div><div d-ref="target" d-lazy="${tag}">Placeholder</div></div>`
    );

    const handle = bind(root, {});
    await tick(50);

    const refEl = handle.getRef('target');
    const loaded = root.querySelector('.loaded-node');
    assert.ok(refEl);
    assert.ok(loaded);
    assert.equal(refEl?.isConnected, true);
    assert.equal(refEl, loaded);

    handle();
  });
});

test('lazy – shared lazy component does not render offscreen instances before intersection', async () => {
  await withDom(async (doc) => {
    let observerCallback = null;
    class FakeIntersectionObserver {
      constructor(cb) {
        observerCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;

    const TestComp = defineComponent({
      tag: 'test-lazy-shared-visible',
      template: '<p class="loaded-shared">Loaded Shared</p>',
    });
    const LazyComp = createLazyComponent(() => Promise.resolve(TestComp));
    const tag = LazyComp.definition.tag;

    const root = el(
      doc,
      `
      <div>
        <div id="slot-a"><div class="lazy-a" d-lazy="${tag}">A Placeholder</div></div>
        <div id="slot-b"><div class="lazy-b" d-lazy="${tag}">B Placeholder</div></div>
      </div>
      `
    );

    const handle = bind(root, {});
    const first = root.querySelector('.lazy-a');
    assert.ok(first);
    assert.ok(observerCallback);

    observerCallback([{ target: first, isIntersecting: true }]);
    await tick(50);

    const slotA = root.querySelector('#slot-a');
    const slotB = root.querySelector('#slot-b');
    assert.ok(slotA?.querySelector('.loaded-shared'));
    assert.equal(slotA?.textContent?.includes('A Placeholder'), false);
    assert.equal(slotB?.textContent?.includes('B Placeholder'), true);
    assert.equal(slotB?.querySelector('.loaded-shared'), null);

    handle();
  });
});

test('lazy – forwards custom events option to lazy component bind', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    let presses = 0;
    const Pressable = defineComponent({
      tag: 'test-lazy-custom-event',
      template: '<button class="pressable" d-on-pointerdown="onPress">Press</button>',
      setup: () => ({
        onPress: () => {
          presses++;
        },
      }),
    });

    const LazyComp = createLazyComponent(() => Promise.resolve(Pressable));
    const tag = LazyComp.definition.tag;

    const root = el(
      doc,
      `<div><div d-lazy="${tag}">Placeholder</div></div>`
    );

    const dispose = bind(root, {}, { events: ['pointerdown'] });
    await tick(60);

    const btn = root.querySelector('.pressable');
    assert.ok(btn);
    btn.dispatchEvent(new doc.defaultView.Event('pointerdown', { bubbles: true }));
    await tick(0);

    assert.equal(presses, 1);
    dispose();
  });
});

test('lazy – uses createLazyComponent loading option as d-lazy fallback', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    const LazyComp = createLazyComponent(
      () => new Promise(() => {}),
      { loading: '<span class="opt-loading">Loading from option</span>' }
    );

    const tag = LazyComp.definition.tag;
    const root = el(doc, `<div><div id="lazy-opt-loading" d-lazy="${tag}">Placeholder</div></div>`);

    const handle = bind(root, {});
    await tick(30);

    const loadingEl = root.querySelector('.opt-loading');
    assert.ok(loadingEl);
    assert.equal(loadingEl.textContent, 'Loading from option');

    handle();
  });
});

test('lazy – uses createLazyComponent error option as d-lazy fallback', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    const LazyComp = createLazyComponent(
      () => Promise.reject(new Error('load failed')),
      { error: '<span class="opt-error">Error from option</span>' }
    );

    const tag = LazyComp.definition.tag;
    const root = el(doc, `<div><div id="lazy-opt-error" d-lazy="${tag}">Placeholder</div></div>`);

    const handle = bind(root, {});
    await tick(50);

    const errorEl = root.querySelector('.opt-error');
    assert.ok(errorEl);
    assert.equal(errorEl.textContent, 'Error from option');

    handle();
  });
});

test('lazy – observeLazyElement degrades gracefully without IntersectionObserver', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    const target = doc.createElement('div');
    doc.body.appendChild(target);

    let called = 0;
    const cleanup = observeLazyElement(target, () => {
      called++;
    });

    await tick(0);
    assert.equal(called, 1);

    cleanup();
    target.remove();
  });
});

test('lazy – observeLazyElement fallback cleanup cancels pending load', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    const target = doc.createElement('div');
    doc.body.appendChild(target);

    let called = 0;
    const cleanup = observeLazyElement(target, () => {
      called++;
    });
    cleanup();

    await tick(0);
    assert.equal(called, 0);

    target.remove();
  });
});

test('lazy – does not load d-lazy removed by d-if in fallback environments', async () => {
  await withDom(async (doc) => {
    (globalThis as any).IntersectionObserver = undefined;

    let calls = 0;
    const TestComp = defineComponent({
      tag: 'test-lazy-if-false',
      template: '<p>Should not load</p>',
    });

    const LazyComp = createLazyComponent(() => {
      calls++;
      return Promise.resolve(TestComp);
    });
    const tag = LazyComp.definition.tag;

    const show = () => false;
    const root = el(
      doc,
      `<div><div d-if="show" d-lazy="${tag}">Placeholder</div></div>`
    );

    const dispose = bind(root, { show });
    await tick(30);

    assert.equal(calls, 0);

    dispose();
  });
});

test('lazy – createSuspense keeps wrapped children rendered', async () => {
  await withDom(async (doc) => {
    const Suspense = createSuspense({
      loading: '<p>Loading...</p>',
      error: '<p>Error!</p>',
      loadingDelay: 100,
    });

    const tag = Suspense.definition.tag;
    const root = el(doc, `<div><${tag}><span class="suspense-child">Visible</span></${tag}></div>`);

    const dispose = bind(root, {}, {
      components: {
        [tag]: Suspense,
      },
    });
    await tick(20);

    assert.ok(root.querySelector('.suspense-child'));
    assert.equal(root.textContent?.includes('Visible'), true);

    dispose();
  });
});


// ─── 10 preloadLazyComponent triggers loading ─────────────────────────────────

test('lazy – preloadLazyComponent triggers loading', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-preload',
      template: '<p>Preload</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;

    // Preload should trigger load
    preloadLazyComponent(tag);
    await tick(50);

    const result = getLazyComponent(tag);
    assert.equal(result.state.loaded(), true);
  });
});

// ─── 11 isLazyComponentLoaded checks load state ───────────────────────────────

test('lazy – isLazyComponentLoaded checks load state', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-check-loaded',
      template: '<p>Check</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;

    // Initially not loaded
    assert.equal(isLazyComponentLoaded(tag), false);

    // Load it
    preloadLazyComponent(tag);
    await tick(50);

    // Should be loaded now
    assert.equal(isLazyComponentLoaded(tag), true);
  });
});

// ─── 12 getLazyComponentState returns state ───────────────────────────────────

test('lazy – getLazyComponentState returns state', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-state-access',
      template: '<p>State</p>',
    });

    const LazyComp = createLazyComponent(
      () => Promise.resolve(TestComp)
    );

    const tag = LazyComp.definition.tag;

    // Get state
    const state = getLazyComponentState(tag);
    assert.ok(state);
    assert.ok(typeof state.load === 'function');
    assert.ok(typeof state.retry === 'function');
    assert.ok(state.loading);
    assert.ok(state.error);
    assert.ok(state.component);
    assert.ok(state.loaded);
  });
});

// ─── 13 Lazy component retry after error ─────────────────────────────────────

test('lazy – retry after error', async () => {
  await withDom(async (doc) => {
    let loadCount = 0;
    const TestComp = defineComponent({
      tag: 'test-retry',
      template: '<p>Retry Success</p>',
    });

    const LazyComp = createLazyComponent(
      () => {
        loadCount++;
        if (loadCount === 1) {
          return Promise.reject(new Error('First try failed'));
        }
        return Promise.resolve(TestComp);
      }
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    // First load - should fail
    result.state.load();
    await tick(50);
    assert.ok(result.state.error());
    assert.equal(result.state.loaded(), false);

    // Reset error and retry
    result.state.retry();
    await tick(50);
    assert.equal(result.state.error(), null);
    assert.equal(result.state.loaded(), true);
  });
});

// ─── 14 Lazy component with custom error template ────────────────────────────

test('lazy – custom error template', async () => {
  await withDom(async (doc) => {
    const LazyComp = createLazyComponent(
      () => Promise.reject(new Error('Custom error')),
      { error: '<div class="error-msg">Failed to load: {error}</div>' }
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    result.state.load();
    await tick(50);

    assert.ok(result.state.error());
  });
});

// ─── 15 Lazy component with ES module default export ─────────────────────────

test('lazy – ES module default export', async () => {
  await withDom(async (doc) => {
    const TestComp = defineComponent({
      tag: 'test-esm-default',
      template: '<p>ESM Default</p>',
    });

    // Loader returns module with default export
    const LazyComp = createLazyComponent(
      () => Promise.resolve({ default: TestComp })
    );

    const tag = LazyComp.definition.tag;
    const result = getLazyComponent(tag);

    result.state.load();
    await tick(50);

    assert.equal(result.state.loaded(), true);
    assert.ok(result.state.component());
  });
});

// ─── observeLazyElement helper ─────────────────────────────────────────────────
// Skipped: JSDOM doesn't fully support IntersectionObserver

test('lazy – observeLazyElement triggers callback', async () => {
  await withDom(async (doc) => {
    let triggered = false;
    const OriginalIntersectionObserver = (globalThis as any).IntersectionObserver;

    class FakeIntersectionObserver {
      callback;
      constructor(callback) { this.callback = callback; }
      observe(target) {
        this.callback([{ isIntersecting: true, target }], this);
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).IntersectionObserver = FakeIntersectionObserver;
    
    const testEl = doc.createElement('div');
    doc.body.appendChild(testEl);

    // Simulate intersection by calling the callback directly
    // (Full IntersectionObserver testing would require more setup)
    const cleanup = observeLazyElement(
      testEl,
      () => { triggered = true; },
      0
    );

    await tick(0);
    assert.equal(triggered, true);
    assert.ok(typeof cleanup === 'function');
    
    cleanup();
    
    testEl.remove();
    (globalThis as any).IntersectionObserver = OriginalIntersectionObserver;
  });
});
