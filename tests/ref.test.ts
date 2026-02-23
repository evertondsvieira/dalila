/**
 * d-ref directive tests
 *
 * Covers declarative element reference collection via d-ref="name":
 *   1  getRef returns correct element
 *   2  getRefs returns record with all refs
 *   3  getRef returns null for unknown name
 *   4  Single and double quotes work
 *   5  Refs cleared after dispose — getRef returns null
 *   6  Duplicate ref name warning in dev mode
 *   7  d-ref on root element is collected
 *   8  Refs inside d-each clones do NOT appear in parent scope
 *   9  Empty d-ref attribute is ignored
 *  10  BindHandle is callable as function (backward compat)
 *  11  d-ref coexists with other directives (d-when, d-on-click)
 */

import test   from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { signal }  from '../dist/core/signal.js';
import { bind }    from '../dist/runtime/bind.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/**
 * Spin up a fresh JSDOM for the duration of one test.
 * Globals are set before `fn` runs and torn down afterwards.
 */
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
  (globalThis as any).DocumentFragment  = dom.window.DocumentFragment;
  (globalThis as any).Comment           = dom.window.Comment;

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
    delete (globalThis as any).DocumentFragment;
    delete (globalThis as any).Comment;
  }
}

/** Parse HTML, append first element child to body, return it. */
function el(doc, html) {
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  doc.body.appendChild(root);
  return root;
}

/** Run fn, collect every console.warn call, return the array of messages. */
async function captureWarns(fn) {
  const warns = [];
  const orig  = console.warn;
  console.warn = (...args) => warns.push(args.map(String).join(' '));
  try { await fn(); }
  finally { console.warn = orig; }
  return warns;
}

// ─── 1  getRef returns correct element ──────────────────────────────────────

test('d-ref – getRef returns the correct element', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <input d-ref="searchInput" type="text" />
        <button d-ref="submitBtn">Go</button>
      </div>
    `);

    const handle = bind(root, {});
    await tick(10);

    const input = root.querySelector('input');
    const btn   = root.querySelector('button');

    assert.equal(handle.getRef('searchInput'), input);
    assert.equal(handle.getRef('submitBtn'), btn);

    handle();
  });
});

// ─── 2  getRefs returns record with all refs ────────────────────────────────

test('d-ref – getRefs returns a frozen record of all refs', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="a">A</span>
        <span d-ref="b">B</span>
        <span d-ref="c">C</span>
      </div>
    `);

    const handle = bind(root, {});
    await tick(10);

    const refs = handle.getRefs();
    assert.deepEqual(Object.keys(refs).sort(), ['a', 'b', 'c']);
    assert.equal(refs.a, root.querySelector('[d-ref="a"]'));
    assert.equal(refs.b, root.querySelector('[d-ref="b"]'));
    assert.equal(refs.c, root.querySelector('[d-ref="c"]'));

    // Frozen
    assert.ok(Object.isFrozen(refs));

    handle();
  });
});

// ─── 3  getRef returns null for unknown name ────────────────────────────────

test('d-ref – getRef returns null for non-existent ref name', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="exists">hi</span>
      </div>
    `);

    const handle = bind(root, {});
    await tick(10);

    assert.equal(handle.getRef('nope'), null);

    handle();
  });
});

// ─── 4  Single and double quotes work ───────────────────────────────────────

test('d-ref – works with both single and double quoted attribute values', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="double">D</span>
        <span d-ref='single'>S</span>
      </div>
    `);

    const handle = bind(root, {});
    await tick(10);

    assert.ok(handle.getRef('double') !== null);
    assert.ok(handle.getRef('single') !== null);

    handle();
  });
});

// ─── 5  Refs cleared after dispose ──────────────────────────────────────────

test('d-ref – refs are cleared after dispose()', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <input d-ref="myInput" />
      </div>
    `);

    const handle = bind(root, {});
    await tick(10);

    assert.ok(handle.getRef('myInput') !== null);

    // Dispose
    handle();

    assert.equal(handle.getRef('myInput'), null);
    assert.deepEqual(handle.getRefs(), {});
  });
});

// ─── 6  Duplicate ref name warning ──────────────────────────────────────────

test('d-ref – warns on duplicate ref name in dev mode', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="dup">first</span>
        <span d-ref="dup">second</span>
      </div>
    `);

    const warns = await captureWarns(async () => {
      const handle = bind(root, {});
      await tick(10);

      // Last-write-wins
      const ref = handle.getRef('dup');
      assert.equal(ref.textContent, 'second');

      handle();
    });

    assert.ok(warns.some(w => w.includes('duplicate ref name "dup"')),
      'must emit duplicate warning');
  });
});

// ─── 7  d-ref on root element is collected ──────────────────────────────────

test('d-ref – ref on root element itself is collected', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-ref="rootEl">content</div>');

    const handle = bind(root, {});
    await tick(10);

    assert.equal(handle.getRef('rootEl'), root);

    handle();
  });
});

// ─── 8  Refs inside d-each clones do NOT appear in parent scope ─────────────

test('d-ref – refs inside d-each clones are NOT in parent scope', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="outside">outside</span>
        <div d-each="items">
          <span d-ref="inside">{name}</span>
        </div>
      </div>
    `);

    const handle = bind(root, {
      items: [{ name: 'A' }, { name: 'B' }],
    });
    await tick(10);

    // Parent scope should have "outside" but NOT "inside"
    assert.ok(handle.getRef('outside') !== null);
    assert.equal(handle.getRef('inside'), null,
      'd-ref inside d-each clone must not leak into parent scope');

    handle();
  });
});

// ─── 9  Empty d-ref attribute is ignored ────────────────────────────────────

test('d-ref – empty attribute value is ignored with warning', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-ref="">empty</span>
        <span d-ref="  ">whitespace</span>
        <span d-ref="valid">ok</span>
      </div>
    `);

    const warns = await captureWarns(async () => {
      const handle = bind(root, {});
      await tick(10);

      // Only "valid" should be collected
      const refs = handle.getRefs();
      assert.deepEqual(Object.keys(refs), ['valid']);

      handle();
    });

    assert.ok(warns.some(w => w.includes('empty ref name')),
      'must warn about empty ref name');
  });
});

// ─── 10  BindHandle is callable as function (backward compat) ───────────────

test('d-ref – BindHandle is callable as a dispose function', async () => {
  await withDom(async (doc) => {
    const count = signal(0);
    const root = el(doc, '<div>{count}</div>');

    const handle = bind(root, { count });
    await tick(10);

    // handle is a function
    assert.equal(typeof handle, 'function');

    // Can be used where () => void is expected
    const disposeFn = handle;
    disposeFn();

    // After calling, refs are cleared (prove dispose ran)
    assert.equal(handle.getRef('anything'), null);
  });
});

// ─── 11  d-ref coexists with other directives ──────────────────────────────

test('d-ref – coexists with d-when and d-on-click without interference', async () => {
  await withDom(async (doc) => {
    let clicked = false;
    const visible = signal(true);

    const root = el(doc, `
      <div>
        <span d-ref="msg" d-when="visible">Hello</span>
        <button d-ref="btn" d-on-click="onClick">Click</button>
      </div>
    `);

    const handle = bind(root, {
      visible,
      onClick: () => { clicked = true; },
    });
    await tick(10);

    // Refs are collected
    const msgEl = handle.getRef('msg') as HTMLElement | null;
    const btnEl = handle.getRef('btn') as HTMLButtonElement | null;
    assert.ok(msgEl !== null);
    assert.ok(btnEl !== null);

    // d-when works
    assert.notEqual(msgEl.style.display, 'none');
    visible.set(false);
    await tick(10);
    assert.equal(msgEl.style.display, 'none');

    // d-on-click works
    btnEl.click();
    assert.equal(clicked, true);

    handle();
  });
});
