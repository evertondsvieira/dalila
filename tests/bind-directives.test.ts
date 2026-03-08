/**
 * bind() directive tests
 *
 * Covers every structural fix applied to the runtime binder:
 *   1  Root-inclusive queries          (directives on the root element itself)
 *   2  Nested d-each                   (inner loop inside outer loop template)
 *   3  Double-bind prevention          (boundary marker stops re-processing clones)
 *   4  Manual bind() inside a clone    (boundary = closest ancestor, not root)
 *   5  resolve() guard                 (functions with params are never called)
 *   6  IDL properties                  (value / checked / disabled via property, not attribute)
 *   7  match with dynamic cases        (cases re-queried inside the effect)
 *   8  ctx parent inheritance          (handlers from outer scope reachable in each)
 *   9  Positional helpers              ($index $count $first $last $odd $even)
 *  10  d-each keyed diff               (reuse/reorder nodes by key)
 *  11  null / undefined normalisation  (text, d-html, match all render '' not "undefined")
 *  12  d-attr boolean / removal        (false/null → remove, true → empty attr)
 *  13  d-html XSS warning              (dev-mode heuristic warning)
 *  14  d-attr dangerous sink guardrails (inline handlers / javascript: blocked)
 *  15  d-virtual-each                  (windowed rendering with scroll-driven updates)
 */

import test   from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { signal, computed }  from '../dist/core/signal.js';
import { scheduleMicrotask } from '../dist/core/scheduler.js';
import { isInDevMode, setDevMode } from '../dist/core/dev.js';
import { bind, configure, createPortalTarget, scrollToVirtualIndex }    from '../dist/runtime/bind.js';
import { fromHtml } from '../dist/runtime/fromHtml.js';

// ─── shared helpers ─────────────────────────────────────────────────────────

const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Spin up a fresh JSDOM for the duration of one test.
 * Globals are set before `fn` runs and torn down afterwards.
 */
async function withDom(fn: (doc: Document) => void | Promise<void>) {
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
    await tick(20); // let any trailing microtasks settle
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
function el(doc: Document, html: string): HTMLElement {
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html.trim();
  const root = wrapper.firstElementChild;
  assert.ok(root);
  doc.body.appendChild(root);
  return root as HTMLElement;
}

function removeElementsFromHtml(html: string, selector: string): string {
  const doc = globalThis.document?.implementation?.createHTMLDocument('sanitize')
    ?? new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const wrapper = doc.createElement('div');
  wrapper.innerHTML = html;
  wrapper.querySelectorAll(selector).forEach((node) => node.remove());
  return wrapper.innerHTML;
}

/** Run fn, collect every console.warn call, return the array of messages. */
async function captureWarns(fn: () => void | Promise<void>): Promise<string[]> {
  const warns: string[] = [];
  const orig  = console.warn;
  console.warn = (...args) => warns.push(args.map(String).join(' '));
  try { await fn(); }
  finally { console.warn = orig; }
  return warns;
}

async function captureZeroDelayTimeouts<T>(
  fn: () => Promise<T> | T
): Promise<Array<() => void>> {
  const scheduled: Array<() => void> = [];
  const originalSetTimeout = globalThis.setTimeout;

  (globalThis as any).setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (timeout === 0 && typeof handler === 'function') {
      scheduled.push(() => handler(...args));
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }
    return originalSetTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  try {
    await fn();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  return scheduled;
}

async function withTrustedTypesInnerHtmlEnforcement(
  doc: Document,
  fn: () => void | Promise<void>
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(doc.defaultView!.Element.prototype, 'innerHTML');
  assert.ok(descriptor?.get);
  assert.ok(descriptor?.set);

  Object.defineProperty(doc.defaultView!.Element.prototype, 'innerHTML', {
    configurable: true,
    enumerable: descriptor.enumerable ?? false,
    get: descriptor.get,
    set(value: unknown) {
      if (typeof value === 'string') {
        throw new TypeError('TrustedHTML required');
      }

      const trustedHtml = value && typeof value === 'object' && '__trusted_html' in (value as Record<string, unknown>)
        ? (value as Record<string, unknown>).__trusted_html
        : value;

      return descriptor.set!.call(this, String(trustedHtml ?? ''));
    },
  });

  try {
    await fn();
  } finally {
    Object.defineProperty(doc.defaultView!.Element.prototype, 'innerHTML', descriptor);
  }
}

// ─── 1  Root-inclusive queries ──────────────────────────────────────────────

test('root inclusive – d-html on root element', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    bind(root, { content: 'hello <b>world</b>' });
    await tick(10);
    assert.equal(root.innerHTML, 'hello <b>world</b>');
  });
});

test('root inclusive – d-on-click on root element', async () => {
  await withDom(async (doc) => {
    let clicks = 0;
    const root = el(doc, '<button d-on-click="inc">click</button>');
    bind(root, { inc: () => { clicks++; } });
    await tick(10);
    root.click();
    assert.equal(clicks, 1);
  });
});

test('d-on-click schedules implicit high-priority microtasks', async () => {
  await withDom(async (doc) => {
    const order: string[] = [];
    const root = el(doc, '<button d-on-click="inc">click</button>');

    bind(root, {
      inc: () => {
        scheduleMicrotask(() => order.push('low'), { priority: 'low' });
        scheduleMicrotask(() => order.push('default-in-event')); // should inherit high
        scheduleMicrotask(() => order.push('medium'), { priority: 'medium' });
      },
    });

    await tick(10);
    root.click();
    await tick(10);

    assert.deepEqual(order, ['default-in-event', 'medium', 'low']);
  });
});

test('root inclusive – d-when on root element', async () => {
  await withDom(async (doc) => {
    const visible = signal(false);
    const root = el(doc, '<div d-when="visible">text</div>');
    bind(root, { visible });
    await tick(10);
    assert.equal(root.style.display, 'none');
    visible.set(true);
    await tick(10);
    assert.equal(root.style.display, '');
  });
});

test('root inclusive – d-attr on root element', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-attr-title="t"></div>');
    bind(root, { t: 'tooltip' });
    await tick(10);
    assert.equal(root.getAttribute('title'), 'tooltip');
  });
});

test('root inclusive – d-if on root element', async () => {
  await withDom(async (doc) => {
    const show = signal(true);
    const root = el(doc, '<div d-if="show">content</div>');
    bind(root, { show });
    await tick(10);
    assert.ok(doc.body.contains(root), 'visible when true');

    show.set(false);
    await tick(10);
    assert.ok(!doc.body.contains(root), 'removed when false');
  });
});

test('d-when + d-transition – delays hide until transition duration', async () => {
  await withDom(async (doc) => {
    configure({
      transitions: [{ name: 'fade', duration: 30 }],
    });

    const visible = signal(true);
    const root = el(doc, '<div d-when="visible" d-transition="fade">text</div>');
    bind(root, { visible });
    await tick(10);
    assert.equal(root.style.display, '');
    assert.equal(root.hasAttribute('data-enter'), true);

    visible.set(false);
    await tick(5);
    assert.equal(root.hasAttribute('data-leave'), true);
    assert.equal(root.style.display, '', 'still visible while leaving');

    await tick(40);
    assert.equal(root.style.display, 'none', 'hidden after leave duration');
    configure({});
  });
});

test('d-if + d-transition – calls custom enter/leave hooks', async () => {
  await withDom(async (doc) => {
    let enters = 0;
    let leaves = 0;

    configure({
      transitions: [{
        name: 'slide-up',
        enter: () => { enters++; },
        leave: () => { leaves++; },
      }],
    });

    const show = signal(true);
    const root = el(doc, '<div><p d-if="show" d-transition="slide-up">yes</p></div>');
    bind(root, { show });
    await tick(10);
    assert.equal(enters, 1);

    show.set(false);
    await tick(10);
    assert.equal(leaves, 1);
    assert.equal(root.querySelectorAll('p').length, 0);

    show.set(true);
    await tick(10);
    assert.equal(enters, 2);
    assert.equal(root.querySelectorAll('p').length, 1);
    configure({});
  });
});

test('d-portal – static selector target and conditional expression', async () => {
  await withDom(async (doc) => {
    const modalRoot = doc.createElement('div');
    modalRoot.id = 'modal-root';
    doc.body.appendChild(modalRoot);

    const showModal = signal(false);
    const root = el(
      doc,
      `<div id="host"><section d-portal="showModal ? '#modal-root' : null">content</section></div>`
    );
    bind(root, { showModal });
    await tick(10);

    const section = root.querySelector('section');
    assert.equal(section.parentElement?.id, 'host');

    showModal.set(true);
    await tick(10);
    assert.equal(section.parentElement?.id, 'modal-root');

    showModal.set(false);
    await tick(10);
    assert.equal(section.parentElement?.id, 'host');
  });
});

test('createPortalTarget + d-portal identifier target', async () => {
  await withDom(async (doc) => {
    const modalTarget = createPortalTarget('overlay-root');
    const root = el(doc, '<div id="host"><aside d-portal="modalTarget">overlay</aside></div>');
    bind(root, { modalTarget });
    await tick(10);

    const aside = doc.querySelector('#overlay-root aside');
    assert.ok(aside, 'portal content should render inside the created target');
    assert.equal(aside.parentElement?.id, 'overlay-root');
    assert.ok(doc.getElementById('overlay-root'), 'portal target should be created');
  });
});

// ─── 2  Nested d-each ───────────────────────────────────────────────────────

test('nested d-each – inner loop renders inside outer loop clone', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <div d-each="groups">
          <span class="name">{name}</span>
          <ul d-each="children">
            <li>{label}</li>
          </ul>
        </div>
      </div>
    `);

    bind(root, {
      groups: [
        { name: 'A', children: [{ label: 'a1' }, { label: 'a2' }] },
        { name: 'B', children: [{ label: 'b1' }] },
      ],
    });
    await tick(10);

    const names  = Array.from(root.querySelectorAll('.name')).map(n => n.textContent);
    const labels = Array.from(root.querySelectorAll('li')).map(l => l.textContent);

    assert.deepEqual(names,  ['A', 'B']);
    assert.deepEqual(labels, ['a1', 'a2', 'b1']);
  });
});

test('nested d-each – missing inner array renders nothing (no ctx leak)', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <div d-each="files">
          <span class="path">{path}</span>
          <ul d-each="checks">
            <li class="check">{result}</li>
          </ul>
        </div>
      </div>
    `);

    bind(root, {
      files: [
        { path: 'runtime/bind.ts', checks: [{ result: 'LGTM' }] },
        { path: 'runtime/each.ts', checks: undefined },
        { path: 'tests/bind.test.ts', checks: null },
        { path: 'README.md', checks: [{ result: 'TODO' }] },
      ],
    });

    await tick(10);

    const paths = Array.from(root.querySelectorAll('.path')).map(n => n.textContent);
    const checks = Array.from(root.querySelectorAll('.check')).map(n => n.textContent);

    assert.deepEqual(paths, [
      'runtime/bind.ts',
      'runtime/each.ts',
      'tests/bind.test.ts',
      'README.md',
    ]);

    // only the 2 real inner items should exist
    assert.deepEqual(checks, ['LGTM', 'TODO']);
  });
});

// ─── 3  Double-bind prevention ──────────────────────────────────────────────

test('no double-bind – click handler fires exactly once per click', async () => {
  await withDom(async (doc) => {
    let clicks = 0;
    const root = el(doc, `
      <div>
        <div d-each="items">
          <button d-on-click="inc">click</button>
        </div>
      </div>
    `);

    bind(root, {
      items: [{ label: 'A' }],
      inc:   () => { clicks++; },
    });
    await tick(10);

    root.querySelector('button').click();
    assert.equal(clicks, 1, 'handler must fire exactly once');
  });
});

test('no double-bind – text inside each clone is not duplicated', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-each="items">{name}</span>
      </div>
    `);
    bind(root, { items: [{ name: 'X' }] });
    await tick(10);
    assert.equal(root.querySelector('span').textContent, 'X');
  });
});

// ─── 4  Manual bind() inside a clone ────────────────────────────────────────

test('manual bind() on sub-element inside d-each clone works correctly', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <div d-each="items">
          <div class="target"></div>
        </div>
      </div>
    `);
    bind(root, { items: [{ id: 1 }] });
    await tick(10);

    const target = root.querySelector('.target');
    assert.ok(target, 'target must exist inside clone');

    // Append a bindable child and bind it manually
    const child = doc.createElement('span');
    child.textContent = '{val}';
    target.appendChild(child);

    bind(child, { val: signal('manual') });
    await tick(10);

    assert.equal(child.textContent, 'manual', 'manual bind inside clone must resolve');
  });
});

// ─── 5  resolve() guard ─────────────────────────────────────────────────────

test('resolve guard – handler in d-when= is never called, warns in dev', async () => {
  await withDom(async (doc) => {
    let called = false;
    const root = el(doc, '<div d-when="handler">text</div>');

    const warns = await captureWarns(async () => {
      bind(root, { handler: (e) => { called = true; } });
      await tick(10);
    });

    assert.equal(called, false, 'handler must not execute');
    assert.ok(warns.some(w => w.includes('resolve()')), 'must warn');
  });
});

test('resolve guard – handler in d-if= is never called, element removed (falsy)', async () => {
  await withDom(async (doc) => {
    let called = false;
    const root = el(doc, '<div d-if="handler">text</div>');

    await captureWarns(async () => {
      bind(root, { handler: (e) => { called = true; } });
      await tick(10);
    });

    assert.equal(called, false);
    assert.ok(!doc.body.contains(root), 'undefined → falsy → removed');
  });
});

test('d-when rejects braced attribute bindings', async () => {
  await withDom(async (doc) => {
    const visible = signal(false);
    const root = el(doc, '<div d-when="{visible}">text</div>');

    const warns = await captureWarns(async () => {
      bind(root, { visible });
      await tick(10);
    });

    assert.equal(root.style.display, '', 'd-when binding should be ignored when using braces');

    visible.set(true);
    await tick(10);
    assert.equal(root.style.display, '', 'ignored binding must not become reactive');
    assert.ok(
      warns.some(w => w.includes('plain identifiers')),
      'must warn about deprecated braced attribute syntax'
    );
  });
});

// ─── 6  IDL properties ──────────────────────────────────────────────────────

test('d-attr-value sets .value property – survives simulated user input', async () => {
  await withDom(async (doc) => {
    const val = signal('initial');
    const root = el(doc, '<input d-attr-value="val" />') as HTMLInputElement;
    bind(root, { val });
    await tick(10);
    assert.equal(root.value, 'initial');

    root.value = 'user-typed';          // simulate user interaction
    val.set('updated');                  // signal wins via property set
    await tick(10);
    assert.equal(root.value, 'updated');
  });
});

test('d-attr-checked toggles .checked reactively', async () => {
  await withDom(async (doc) => {
    const checked = signal(true);
    const root = el(doc, '<input type="checkbox" d-attr-checked="checked" />') as HTMLInputElement;
    bind(root, { checked });
    await tick(10);
    assert.equal(root.checked, true);

    checked.set(false);
    await tick(10);
    assert.equal(root.checked, false);
  });
});

test('d-attr-disabled toggles .disabled reactively', async () => {
  await withDom(async (doc) => {
    const disabled = signal(false);
    const root = el(doc, '<button d-attr-disabled="disabled">go</button>') as HTMLButtonElement;
    bind(root, { disabled });
    await tick(10);
    assert.equal(root.disabled, false);

    disabled.set(true);
    await tick(10);
    assert.equal(root.disabled, true);
  });
});

// ─── 7  match with dynamic cases ────────────────────────────────────────────

test('d-match – dynamically appended [case] is found on next signal change', async () => {
  await withDom(async (doc) => {
    const mode = signal('a');
    const root = el(doc, `
      <div d-match="mode">
        <div case="a">A</div>
        <div case="b">B</div>
      </div>
    `);
    bind(root, { mode });
    await tick(10);

    assert.equal((root.querySelector('[case="a"]') as HTMLElement).style.display, '');
    assert.equal((root.querySelector('[case="b"]') as HTMLElement).style.display, 'none');

    // Dynamically add a new case after initial bind
    const caseC = doc.createElement('div');
    caseC.setAttribute('case', 'c');
    caseC.textContent = 'C';
    root.appendChild(caseC);

    mode.set('c');
    await tick(10);

    assert.equal(caseC.style.display, '',     'new case visible');
    assert.equal((root.querySelector('[case="a"]') as HTMLElement).style.display, 'none');
    assert.equal((root.querySelector('[case="b"]') as HTMLElement).style.display, 'none');
  });
});

// ─── 8  ctx parent inheritance ──────────────────────────────────────────────

test('d-each – parent handler accessible inside clone via prototype chain', async () => {
  await withDom(async (doc) => {
    let clicked = false;
    const root = el(doc, `
      <div>
        <div d-each="items">
          <button d-on-click="onPick">{name}</button>
        </div>
      </div>
    `);

    bind(root, {
      items:  [{ name: 'A' }, { name: 'B' }],
      onPick: () => { clicked = true; },
    });
    await tick(10);

    const btns = root.querySelectorAll('button');
    assert.equal(btns.length, 2);

    btns[1].click();
    assert.equal(clicked, true, 'parent handler must be reachable');
  });
});

// ─── 9  Positional helpers ──────────────────────────────────────────────────

test('d-each – $index $count $first $last $odd $even are correct', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <div d-each="items">
          <span class="i">{$index}</span>
          <span class="n">{$count}</span>
          <span class="f">{$first}</span>
          <span class="l">{$last}</span>
          <span class="o">{$odd}</span>
          <span class="e">{$even}</span>
        </div>
      </div>
    `);
    bind(root, { items: ['a', 'b', 'c'] });
    await tick(10);

    const clones = root.querySelectorAll('[data-dalila-internal-bound]');
    assert.equal(clones.length, 3);

    // index 0 – first, even
    const g = (clone, cls) => clone.querySelector(`.${cls}`).textContent;
    assert.equal(g(clones[0], 'i'), '0');
    assert.equal(g(clones[0], 'n'), '3');
    assert.equal(g(clones[0], 'f'), 'true');
    assert.equal(g(clones[0], 'l'), 'false');
    assert.equal(g(clones[0], 'o'), 'false');
    assert.equal(g(clones[0], 'e'), 'true');

    // index 1 – middle, odd
    assert.equal(g(clones[1], 'i'), '1');
    assert.equal(g(clones[1], 'f'), 'false');
    assert.equal(g(clones[1], 'l'), 'false');
    assert.equal(g(clones[1], 'o'), 'true');
    assert.equal(g(clones[1], 'e'), 'false');

    // index 2 – last, even
    assert.equal(g(clones[2], 'i'), '2');
    assert.equal(g(clones[2], 'f'), 'false');
    assert.equal(g(clones[2], 'l'), 'true');
    assert.equal(g(clones[2], 'o'), 'false');
    assert.equal(g(clones[2], 'e'), 'true');
  });
});

test('d-each – {item} renders primitive items directly', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <span d-each="items">{item}</span>
      </div>
    `);
    bind(root, { items: ['hello', 'world'] });
    await tick(10);

    const spans = root.querySelectorAll('span');
    assert.equal(spans[0].textContent, 'hello');
    assert.equal(spans[1].textContent, 'world');
  });
});

test('d-each – d-key preserves DOM nodes on reorder and updates values', async () => {
  await withDom(async (doc) => {
    const a = { id: 'a', name: 'Alpha' };
    const b = { id: 'b', name: 'Beta' };
    const c = { id: 'c', name: 'Gamma' };
    const items = signal([
      a,
      b,
      c,
    ]);

    const root = el(doc, `
      <ul>
        <li d-each="items" d-key="id">{name}</li>
      </ul>
    `);
    bind(root, { items });
    await tick(10);

    const before = Array.from(root.querySelectorAll('li'));
    assert.deepEqual(before.map((n) => n.textContent), ['Alpha', 'Beta', 'Gamma']);

    // Reorder using the same item references: nodes should be moved/reused.
    items.set([c, a, b]);
    await tick(10);

    const afterReorder = Array.from(root.querySelectorAll('li'));
    assert.equal(afterReorder[0], before[2], 'key "c" node should be moved, not recreated');
    assert.equal(afterReorder[1], before[0], 'key "a" node should be moved, not recreated');
    assert.equal(afterReorder[2], before[1], 'key "b" node should be moved, not recreated');

    // When a keyed item value changes, only that keyed clone is recreated.
    items.set([
      c,
      { id: 'a', name: 'Alpha updated' },
      b,
    ]);
    await tick(10);

    const afterUpdate = Array.from(root.querySelectorAll('li'));
    assert.equal(afterUpdate[0], afterReorder[0], 'unchanged key should keep node');
    assert.notEqual(afterUpdate[1], afterReorder[1], 'changed keyed item should recreate only that node');
    assert.equal(afterUpdate[2], afterReorder[2], 'unchanged key should keep node');
    assert.deepEqual(afterUpdate.map((n) => n.textContent), ['Gamma', 'Alpha updated', 'Beta']);
  });
});

test('d-each – falls back to item.id key when d-key is omitted', async () => {
  await withDom(async (doc) => {
    const one = { id: 1, name: 'One' };
    const two = { id: 2, name: 'Two' };
    const items = signal([
      one,
      two,
    ]);

    const root = el(doc, `
      <ul>
        <li d-each="items">{name}</li>
      </ul>
    `);
    bind(root, { items });
    await tick(10);

    const before = Array.from(root.querySelectorAll('li'));

    items.set([two, one]);
    await tick(10);

    const after = Array.from(root.querySelectorAll('li'));
    assert.equal(after[0], before[1]);
    assert.equal(after[1], before[0]);
  });
});

test('d-virtual-each – renders only the visible window and updates on scroll', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );

    const root = el(doc, `
      <div id="viewport">
        <div
          class="row"
          d-virtual-each="items"
          d-key="id"
          d-virtual-item-height="20"
          d-virtual-overscan="0"
        >
          {label}
        </div>
      </div>
    `);

    Object.defineProperty(root, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(root, { items });
    await tick(20);

    const firstWindow = root.querySelectorAll('.row[data-dalila-internal-bound]');
    assert.equal(firstWindow.length, 5);
    assert.equal(firstWindow[0].textContent.trim(), 'Item 0');
    assert.equal(firstWindow[4].textContent.trim(), 'Item 4');

    root.scrollTop = 400;
    root.dispatchEvent(new window.Event('scroll'));
    await tick(20);

    const secondWindow = root.querySelectorAll('.row[data-dalila-internal-bound]');
    assert.equal(secondWindow.length, 5);
    assert.equal(secondWindow[0].textContent.trim(), 'Item 20');
    assert.equal(secondWindow[4].textContent.trim(), 'Item 24');
  });
});

test('d-virtual-each – supports dynamic measured heights via d-virtual-measure="auto"', async () => {
  await withDom(async (doc) => {
    const OriginalResizeObserver = globalThis.ResizeObserver;

    class TestResizeObserver {
      callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void;
      constructor(callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        const index = Number(target.getAttribute('data-dalila-virtual-index') ?? '0');
        const height = index === 0 ? 60 : 20;
        this.callback([{ target, contentRect: { height } }]);
      }
      unobserve() {}
      disconnect() {}
    }

    (globalThis as any).ResizeObserver = TestResizeObserver;

    try {
      const items = signal(
        Array.from({ length: 50 }, (_, i) => ({ id: i, label: `Item ${i}` }))
      );

      const root = el(doc, `
        <div id="viewport">
          <div
            class="row"
            d-virtual-each="items"
            d-key="id"
            d-virtual-measure="auto"
            d-virtual-estimated-height="20"
            d-virtual-overscan="0"
          >
            {label}
          </div>
        </div>
      `);

      Object.defineProperty(root, 'clientHeight', {
        configurable: true,
        value: 60,
      });

      bind(root, { items });
      await tick(20);

      root.scrollTop = 60;
      root.dispatchEvent(new window.Event('scroll'));
      await tick(20);

      const windowRows = root.querySelectorAll('.row[data-dalila-internal-bound]');
      assert.equal(windowRows[0].textContent.trim(), 'Item 1');
    } finally {
      (globalThis as any).ResizeObserver = OriginalResizeObserver;
    }
  });
});

test('d-virtual-each – dynamic heights are reset/remapped when dataset changes with same length', async () => {
  await withDom(async (doc) => {
    const OriginalResizeObserver = globalThis.ResizeObserver;
    let emitMeasurements = true;

    class TestResizeObserver {
      callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void;
      constructor(callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        if (!emitMeasurements) return;
        const index = Number(target.getAttribute('data-dalila-virtual-index') ?? '0');
        const height = index === 0 ? 80 : 20;
        this.callback([{ target, contentRect: { height } }]);
      }
      unobserve() {}
      disconnect() {}
    }

    (globalThis as any).ResizeObserver = TestResizeObserver;

    try {
      const items = signal([
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ]);

      const root = el(doc, `
        <div id="viewport">
          <div
            class="row"
            d-virtual-each="items"
            d-key="id"
            d-virtual-measure="auto"
            d-virtual-estimated-height="20"
            d-virtual-overscan="0"
          >
            {label}
          </div>
        </div>
      `);

      Object.defineProperty(root, 'clientHeight', {
        configurable: true,
        value: 120,
      });

      bind(root, { items });
      await tick(20);

      const topSpacer = root.querySelector('[data-dalila-virtual-spacer="top"]');
      assert.equal(topSpacer.getAttribute('data-dalila-virtual-total'), '100');

      emitMeasurements = false;
      items.set([
        { id: 'x', label: 'X' },
        { id: 'y', label: 'Y' },
      ]);
      await tick(20);

      assert.equal(topSpacer.getAttribute('data-dalila-virtual-total'), '40');
    } finally {
      (globalThis as any).ResizeObserver = OriginalResizeObserver;
    }
  });
});

test('d-virtual-each – exposes __dalilaVirtualList.scrollToIndex()', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 200 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );

    const root = el(doc, `
      <div id="viewport">
        <div
          class="row"
          d-virtual-each="items"
          d-key="id"
          d-virtual-item-height="20"
          d-virtual-overscan="0"
        >
          {label}
        </div>
      </div>
    `);

    Object.defineProperty(root, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(root, { items });
    await tick(20);

    const api = (root as any).__dalilaVirtualList;
    assert.ok(api && typeof api.scrollToIndex === 'function');

    api.scrollToIndex(10);
    await tick(20);

    assert.equal(root.scrollTop, 200);
  });
});

test('d-virtual-each – public scrollToVirtualIndex() scrolls to target index', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 200 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );

    const root = el(doc, `
      <div id="viewport">
        <div
          class="row"
          d-virtual-each="items"
          d-key="id"
          d-virtual-item-height="20"
          d-virtual-overscan="0"
        >
          {label}
        </div>
      </div>
    `);

    Object.defineProperty(root, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(root, { items });
    await tick(20);

    const ok = scrollToVirtualIndex(root, 30, { align: 'start' });
    await tick(20);

    assert.equal(ok, true);
    assert.equal(root.scrollTop, 600);
  });
});

test('d-virtual-each – triggers d-virtual-infinite once per item count at list end', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 20 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );
    let calls = 0;
    const loadMore = () => {
      calls += 1;
    };

    const root = el(doc, `
      <div id="viewport">
        <div
          class="row"
          d-virtual-each="items"
          d-key="id"
          d-virtual-item-height="20"
          d-virtual-overscan="0"
          d-virtual-infinite="loadMore"
        >
          {label}
        </div>
      </div>
    `);

    Object.defineProperty(root, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(root, { items, loadMore });
    await tick(20);

    root.scrollTop = 300;
    root.dispatchEvent(new window.Event('scroll'));
    root.dispatchEvent(new window.Event('scroll'));
    await tick(20);

    assert.equal(calls, 1);
  });
});

test('d-virtual-each – d-virtual-infinite uses visible end (ignores overscan)', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 20 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );
    let calls = 0;
    const loadMore = () => {
      calls += 1;
    };

    const root = el(doc, `
      <div id="viewport">
        <div
          class="row"
          d-virtual-each="items"
          d-key="id"
          d-virtual-item-height="20"
          d-virtual-overscan="5"
          d-virtual-infinite="loadMore"
        >
          {label}
        </div>
      </div>
    `);

    Object.defineProperty(root, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(root, { items, loadMore });
    await tick(20);

    // Visible end = 15 (< 20). Overscan end may already reach 20, but must not trigger yet.
    root.scrollTop = 200;
    root.dispatchEvent(new window.Event('scroll'));
    await tick(20);
    assert.equal(calls, 0);

    // Visible end reaches list end here.
    root.scrollTop = 300;
    root.dispatchEvent(new window.Event('scroll'));
    await tick(20);
    assert.equal(calls, 1);
  });
});

test('d-virtual-each – dynamic mode does not trigger infinite at exact viewport boundary', async () => {
  await withDom(async (doc) => {
    const OriginalResizeObserver = globalThis.ResizeObserver;

    class TestResizeObserver {
      callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void;
      constructor(callback: (entries: Array<{ target: Element; contentRect: { height: number } }>) => void) {
        this.callback = callback;
      }
      observe(target: Element) {
        this.callback([{ target, contentRect: { height: 20 } }]);
      }
      unobserve() {}
      disconnect() {}
    }

    (globalThis as any).ResizeObserver = TestResizeObserver;

    try {
      const items = signal(
        Array.from({ length: 20 }, (_, i) => ({ id: i, label: `Item ${i}` }))
      );
      let calls = 0;
      const loadMore = () => {
        calls += 1;
      };

      const root = el(doc, `
        <div id="viewport">
          <div
            class="row"
            d-virtual-each="items"
            d-key="id"
            d-virtual-measure="auto"
            d-virtual-estimated-height="20"
            d-virtual-overscan="0"
            d-virtual-infinite="loadMore"
          >
            {label}
          </div>
        </div>
      `);

      Object.defineProperty(root, 'clientHeight', {
        configurable: true,
        value: 100,
      });

      bind(root, { items, loadMore });
      await tick(20);

      // Bottom at 380; last row starts at 380, so it is still not visible.
      root.scrollTop = 280;
      root.dispatchEvent(new window.Event('scroll'));
      await tick(20);
      assert.equal(calls, 0);

      // Bottom at 400; last row is now visible.
      root.scrollTop = 300;
      root.dispatchEvent(new window.Event('scroll'));
      await tick(20);
      assert.equal(calls, 1);
    } finally {
      (globalThis as any).ResizeObserver = OriginalResizeObserver;
    }
  });
});

test('d-virtual-each – scroll restoration cache is scoped per list instance', async () => {
  await withDom(async (doc) => {
    const items = signal(
      Array.from({ length: 100 }, (_, i) => ({ id: i, label: `Item ${i}` }))
    );

    const rootA = el(doc, `
      <section>
        <div id="viewport-a">
          <div
            class="row"
            d-virtual-each="items"
            d-key="id"
            d-virtual-item-height="20"
            d-virtual-overscan="0"
          >
            {label}
          </div>
        </div>
      </section>
    `).querySelector('#viewport-a');

    Object.defineProperty(rootA, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    const disposeA = bind(rootA, { items });
    await tick(20);

    rootA.scrollTop = 300;
    rootA.dispatchEvent(new window.Event('scroll'));
    await tick(20);
    disposeA();

    const rootB = el(doc, `
      <main>
        <div id="viewport-b">
          <div
            class="row"
            d-virtual-each="items"
            d-key="id"
            d-virtual-item-height="20"
            d-virtual-overscan="0"
          >
            {label}
          </div>
        </div>
      </main>
    `).querySelector('#viewport-b');

    Object.defineProperty(rootB, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    bind(rootB, { items });
    await tick(20);

    assert.equal(rootB.scrollTop, 0);
  });
});

test('d-virtual-each – falls back to d-each when item height is invalid', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <ul>
        <li d-virtual-each="items">{item}</li>
      </ul>
    `);

    const warns = await captureWarns(async () => {
      bind(root, { items: ['a', 'b', 'c'] });
      await tick(10);
    });

    const lis = root.querySelectorAll('li');
    assert.equal(lis.length, 3);
    assert.deepEqual(Array.from(lis).map((n) => n.textContent), ['a', 'b', 'c']);
    assert.ok(
      warns.some((w) => w.includes('Falling back to d-each')),
      'must warn about invalid virtual item height and fallback'
    );
  });
});

// ─── 11  null / undefined normalisation ─────────────────────────────────────

test('text – signal returning null renders empty string', async () => {
  await withDom(async (doc) => {
    const val = signal(null);
    const root = el(doc, '<span>{val}</span>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.textContent, '');
  });
});

test('text – signal returning undefined renders empty string', async () => {
  await withDom(async (doc) => {
    const val = signal(undefined);
    const root = el(doc, '<span>{val}</span>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.textContent, '');
  });
});

test('text interpolation – supports arithmetic expressions like {count + 1}', async () => {
  await withDom(async (doc) => {
    const count = signal(1);
    const root = el(doc, '<span>{count + 1}</span>');
    bind(root, { count });
    await tick(10);
    assert.equal(root.textContent, '2');

    count.set(4);
    await tick(10);
    assert.equal(root.textContent, '5');
  });
});

test('text interpolation – static expressions render synchronously on bind()', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<span>{1 + 2}</span>');
    bind(root, {});
    assert.equal(root.textContent, '3');
  });
});

test('text interpolation – signal expressions seed initial value synchronously', async () => {
  await withDom(async (doc) => {
    const count = signal(5);
    const root = el(doc, '<span>{count + 1}</span>');
    bind(root, { count });
    assert.equal(root.textContent, '6');
  });
});

test('text interpolation – supports property access like {items.length}', async () => {
  await withDom(async (doc) => {
    const items = signal(['a']);
    const root = el(doc, '<span>{items.length}</span>');
    bind(root, { items });
    await tick(10);
    assert.equal(root.textContent, '1');

    items.set(['a', 'b', 'c']);
    await tick(10);
    assert.equal(root.textContent, '3');
  });
});

test('text interpolation – supports index literal member path like {items[0].title}', async () => {
  await withDom(async (doc) => {
    const items = signal([{ title: 'First' }]);
    const root = el(doc, '<span>{items[0].title}</span>');
    bind(root, { items });
    await tick(10);
    assert.equal(root.textContent, 'First');

    items.set([{ title: 'Second' }]);
    await tick(10);
    assert.equal(root.textContent, 'Second');
  });
});

test('text interpolation – keyword literals keep parser semantics in fast-path', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<span>{true}|{false}|{null}|{undefined}</span>');
    bind(root, {});
    await tick(10);
    assert.equal(root.textContent, 'true|false||');
  });
});

test('text interpolation – supports conditional ternary expression', async () => {
  await withDom(async (doc) => {
    const isActive = signal(false);
    const root = el(doc, `<span>{isActive ? 'Yes' : 'No'}</span>`);
    bind(root, { isActive });
    await tick(10);
    assert.equal(root.textContent, 'No');

    isActive.set(true);
    await tick(10);
    assert.equal(root.textContent, 'Yes');
  });
});

test('text interpolation – ternary is right-associative', async () => {
  await withDom(async (doc) => {
    const a = signal(false);
    const b = signal(true);
    const root = el(doc, `<span>{a ? 'A' : b ? 'B' : 'C'}</span>`);
    bind(root, { a, b });
    await tick(10);
    assert.equal(root.textContent, 'B');

    b.set(false);
    await tick(10);
    assert.equal(root.textContent, 'C');
  });
});

test('text interpolation – supports optional chaining with property access', async () => {
  await withDom(async (doc) => {
    const user = signal(undefined);
    const root = el(doc, '<span>{user?.name}</span>');
    bind(root, { user });
    await tick(10);
    assert.equal(root.textContent, '');

    user.set({ name: 'Dalila' });
    await tick(10);
    assert.equal(root.textContent, 'Dalila');
  });
});

test('text interpolation – supports optional chaining with bracket access', async () => {
  await withDom(async (doc) => {
    const items = signal(undefined);
    const root = el(doc, '<span>{items?.[0]?.title}</span>');
    bind(root, { items });
    await tick(10);
    assert.equal(root.textContent, '');

    items.set([{ title: 'First' }]);
    await tick(10);
    assert.equal(root.textContent, 'First');

    items.set([]);
    await tick(10);
    assert.equal(root.textContent, '');
  });
});

test('text interpolation – member access tracks nested signal properties', async () => {
  await withDom(async (doc) => {
    const name = signal('Ana');
    const root = el(doc, '<span>{user.name}</span>');
    bind(root, { user: { name } });
    assert.equal(root.textContent, 'Ana');

    name.set('Bia');
    await tick(10);
    assert.equal(root.textContent, 'Bia');
  });
});

test('text interpolation – member access tracks nested zero-arity getter properties', async () => {
  await withDom(async (doc) => {
    const base = signal('A');
    const root = el(doc, '<span>{user.name}</span>');
    bind(root, { user: { name: () => `${base()}!` } });
    assert.equal(root.textContent, 'A!');

    base.set('B');
    await tick(10);
    assert.equal(root.textContent, 'B!');
  });
});

test('d-pre – skips directives and interpolation inside subtree', async () => {
  await withDom(async (doc) => {
    const count = signal(0);
    const root = el(doc, `
      <div>
        <section id="raw-block" d-pre>
          <button id="raw-btn" d-on-click="inc" onclick="alert(1)">+</button>
          <p id="raw-text">{count}</p>
          <a id="raw-link" href="javascript:alert(2)">x</a>
        </section>
        <p id="live">{count}</p>
      </div>
    `);

    bind(root, {
      count,
      inc: () => count.update((n) => n + 1),
    });
    await tick(10);

    const live = root.querySelector('#live') as HTMLElement;
    const rawBlock = root.querySelector('#raw-block') as HTMLElement;

    assert.equal(live.textContent, '0');
    assert.ok(rawBlock.hasAttribute('data-dalila-raw'));
    assert.equal(rawBlock.querySelector('button'), null, 'raw subtree must be converted to text');
    assert.match(rawBlock.textContent ?? '', /d-on-click="inc"/);
    assert.match(rawBlock.textContent ?? '', /\{count\}/);
    assert.match(rawBlock.textContent ?? '', /href="javascript:alert\(2\)"/);

    const snapshot = rawBlock.textContent;

    count.set(2);
    await tick(10);
    assert.equal(live.textContent, '2');
    assert.equal(rawBlock.textContent, snapshot, 'raw block must stay frozen');
  });
});

test('d-raw – alias for d-pre skip behavior', async () => {
  await withDom(async (doc) => {
    const name = signal('Ana');
    const root = el(doc, `
      <div>
        <article id="raw-alias" d-raw>
          <p id="raw-name">{name}</p>
          <button id="raw-name-btn" d-on-click="rename">rename</button>
        </article>
        <p id="live-name">{name}</p>
      </div>
    `);

    bind(root, {
      name,
      rename: () => name.set('Bia'),
    });
    await tick(10);

    const liveName = root.querySelector('#live-name') as HTMLElement;
    const rawAlias = root.querySelector('#raw-alias') as HTMLElement;

    assert.equal(liveName.textContent, 'Ana');
    assert.ok(rawAlias.hasAttribute('data-dalila-raw'));
    assert.equal(rawAlias.querySelector('#raw-name-btn'), null);
    assert.match(rawAlias.textContent ?? '', /\{name\}/);
    assert.match(rawAlias.textContent ?? '', /d-on-click="rename"/);
  });
});

test('raw tag syntax – <d-pre> works without d-pre attribute', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <d-pre id="raw-tag">
          <button d-on-click="inc">+</button>
          <p>{count}</p>
        </d-pre>
      </div>
    `);

    bind(root, {
      count: signal(1),
      inc: () => {},
    });
    await tick(10);

    const rawTag = root.querySelector('#raw-tag') as HTMLElement;
    assert.ok(rawTag.hasAttribute('data-dalila-raw'));
    assert.equal(rawTag.querySelector('button'), null);
    assert.match(rawTag.textContent ?? '', /d-on-click="inc"/);
    assert.match(rawTag.textContent ?? '', /\{count\}/);
    assert.ok(
      doc.getElementById('dalila-raw-block-default-styles'),
      'runtime should inject default raw block style helper'
    );
  });
});

test('d-pre – repeated bind on same DOM does not double-escape raw content', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <d-pre id="raw-rebind">
          <button d-on-click="inc">+</button>
          <p>{count}</p>
        </d-pre>
      </div>
    `);

    const disposeA = bind(root, {
      count: signal(1),
      inc: () => {},
    });
    await tick(10);

    const raw = root.querySelector('#raw-rebind') as HTMLElement;
    const first = raw.innerHTML;
    assert.match(first, /&lt;button/);
    assert.doesNotMatch(first, /&amp;lt;/);

    disposeA();

    const disposeB = bind(root, {
      count: signal(2),
      inc: () => {},
    });
    await tick(10);

    const second = raw.innerHTML;
    assert.equal(second, first, 'rebind should not escape raw content again');
    assert.doesNotMatch(second, /&amp;lt;/);

    disposeB();
  });
});

test('d-html – signal returning null renders empty innerHTML', async () => {
  await withDom(async (doc) => {
    const content = signal(null);
    const root = el(doc, '<div d-html="content"></div>');
    bind(root, { content });
    await tick(10);
    assert.equal(root.innerHTML, '');
  });
});

test('d-html – getter returning undefined renders empty innerHTML', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    bind(root, { content: () => undefined });
    await tick(10);
    assert.equal(root.innerHTML, '');
  });
});

test('d-match – null signal normalises to empty string, matches case=""', async () => {
  await withDom(async (doc) => {
    const mode = signal(null);
    const root = el(doc, `
      <div d-match="mode">
        <div case="">empty</div>
        <div case="a">A</div>
      </div>
    `);
    bind(root, { mode });
    await tick(10);

    assert.equal((root.querySelector('[case=""]') as HTMLElement).style.display, '');
    assert.equal((root.querySelector('[case="a"]') as HTMLElement).style.display, 'none');
  });
});

// ─── 12  d-attr boolean / removal semantics ────────────────────────────────

test('d-attr – false removes the attribute entirely', async () => {
  await withDom(async (doc) => {
    const val = signal(false);
    const root = el(doc, '<div d-attr-data-x="val"></div>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.getAttribute('data-x'), null);
  });
});

test('d-attr – null removes the attribute entirely', async () => {
  await withDom(async (doc) => {
    const val = signal(null);
    const root = el(doc, '<div d-attr-data-x="val"></div>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.getAttribute('data-x'), null);
  });
});

test('d-attr – true sets attribute as empty string (boolean attr)', async () => {
  await withDom(async (doc) => {
    const val = signal(true);
    const root = el(doc, '<div d-attr-data-x="val"></div>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.getAttribute('data-x'), '');
  });
});

test('d-attr – reactive toggle: true → false → true', async () => {
  await withDom(async (doc) => {
    const val = signal(true);
    const root = el(doc, '<div d-attr-data-x="val"></div>');
    bind(root, { val });
    await tick(10);
    assert.equal(root.getAttribute('data-x'), '');

    val.set(false);
    await tick(10);
    assert.equal(root.getAttribute('data-x'), null);

    val.set(true);
    await tick(10);
    assert.equal(root.getAttribute('data-x'), '');
  });
});

test('d-attr – blocks javascript: URL in href and warns', async () => {
  await withDom(async (doc) => {
    const url = signal(' javascript:alert(1)');
    const root = el(doc, '<a d-attr-href="url">x</a>');

    const warns = await captureWarns(async () => {
      bind(root, { url });
      await tick(10);
    });

    assert.equal(root.getAttribute('href'), null);
    assert.ok(warns.some(w => w.includes('blocked dangerous URL protocol')));
  });
});

test('d-attr – blocks data: and file: URL protocols on common URL attributes', async () => {
  await withDom(async (doc) => {
    const href = signal('data:text/html,%3Cscript%3Ealert(1)%3C/script%3E');
    const src = signal('file:///etc/passwd');
    const root = el(doc, `
      <div>
        <a id="link" d-attr-href="href">x</a>
        <img id="image" d-attr-src="src" />
      </div>
    `);

    const warns = await captureWarns(async () => {
      bind(root, { href, src });
      await tick(10);
    });

    const link = root.querySelector('#link');
    const image = root.querySelector('#image');
    assert.ok(link);
    assert.ok(image);
    assert.equal(link.getAttribute('href'), null);
    assert.equal(image.getAttribute('src'), null);
    assert.ok(warns.some(w => w.includes('blocked dangerous URL protocol')));
  });
});

test('d-attr – allows safe URL protocols and relative URLs', async () => {
  await withDom(async (doc) => {
    const mailto = signal('mailto:test@example.com');
    const blob = signal('blob:https://app.example/1234');
    const relative = signal('/profile');
    const root = el(doc, `
      <div>
        <a id="mailto" d-attr-href="mailto">email</a>
        <a id="blob" d-attr-href="blob">blob</a>
        <img id="relative" d-attr-src="relative" />
      </div>
    `);

    bind(root, { mailto, blob, relative });
    await tick(10);

    assert.equal(root.querySelector('#mailto')?.getAttribute('href'), 'mailto:test@example.com');
    assert.equal(root.querySelector('#blob')?.getAttribute('href'), 'blob:https://app.example/1234');
    assert.equal(root.querySelector('#relative')?.getAttribute('src'), '/profile');
  });
});

test('d-attr – blocks inline event handler attributes and warns', async () => {
  await withDom(async (doc) => {
    const handlerCode = signal('alert(1)');
    const root = el(doc, '<button d-attr-onclick="handlerCode">x</button>');

    const warns = await captureWarns(async () => {
      bind(root, { handlerCode });
      await tick(10);
    });

    assert.equal(root.getAttribute('onclick'), null);
    assert.ok(warns.some(w => w.includes('inline event handler attributes are blocked')));
  });
});

test('d-attr – blocks SVG SMIL inline handler attributes and warns', async () => {
  await withDom(async (doc) => {
    const handlerCode = signal('alert(1)');
    const root = el(doc, '<svg><animate id="anim" d-attr-onbegin="handlerCode"></animate></svg>');

    const warns = await captureWarns(async () => {
      bind(root, { handlerCode });
      await tick(10);
    });

    const animate = root.querySelector('#anim');
    assert.ok(animate);
    assert.equal(animate.getAttribute('onbegin'), null);
    assert.ok(warns.some(w => w.includes('inline event handler attributes are blocked')));
  });
});

test('d-attr – allows non-event custom attributes starting with on', async () => {
  await withDom(async (doc) => {
    const onboardingId = signal('flow-123');
    const root = el(doc, '<my-card d-attr-onboarding-id="onboardingId"></my-card>');

    const warns = await captureWarns(async () => {
      bind(root, { onboardingId });
      await tick(10);
    });

    assert.equal(root.getAttribute('onboarding-id'), 'flow-123');
    assert.ok(!warns.some(w => w.includes('inline event handler attributes are blocked')));
  });
});

test('d-attr – security.strict blocks srcdoc attribute', async () => {
  await withDom(async (doc) => {
    const srcdoc = signal('<script>alert(1)</script>');
    const root = el(doc, '<iframe d-attr-srcdoc="srcdoc"></iframe>');

    const warns = await captureWarns(async () => {
      bind(root, { srcdoc }, { security: { strict: true } });
      await tick(10);
    });

    assert.equal(root.getAttribute('srcdoc'), null);
    assert.ok(warns.some(w => w.includes('blocked raw HTML attribute')));
  });
});

test('d-attr – security.strict false does not inherit strict-only blockers from defaults', async () => {
  await withDom(async (doc) => {
    const srcdoc = signal('<p>ok</p>');
    const root = el(doc, '<iframe d-attr-srcdoc="srcdoc"></iframe>');

    bind(root, { srcdoc }, { security: { strict: false } });
    await tick(10);

    assert.equal(root.getAttribute('srcdoc'), '<p>ok</p>');
  });
});

test('d-attr – blocks dangerous protocols on object data attributes', async () => {
  await withDom(async (doc) => {
    const url = signal('data:text/html,%3Cscript%3Ealert(1)%3C/script%3E');
    const root = el(doc, '<object d-attr-data="url"></object>');

    const warns = await captureWarns(async () => {
      bind(root, { url });
      await tick(10);
    });

    assert.equal(root.getAttribute('data'), null);
    assert.ok(warns.some(w => w.includes('blocked dangerous URL protocol')));
  });
});

test('d-attr – security.strict is propagated to d-each clone bindings', async () => {
  await withDom(async (doc) => {
    const items = signal(['<b>x</b>']);
    const root = el(doc, '<iframe d-each="items" d-attr-srcdoc="item"></iframe>');

    const warns = await captureWarns(async () => {
      bind(root, { items }, { security: { strict: true } });
      await tick(10);
    });

    const iframe = doc.querySelector('iframe');
    assert.ok(iframe);
    assert.equal(iframe.getAttribute('srcdoc'), null);
    assert.ok(warns.some(w => w.includes('blocked raw HTML attribute')));
  });
});

test('security.warnAsError – throws in dev mode instead of warning', async () => {
  await withDom(async (doc) => {
    const handlerCode = 'alert(1)';
    const root = el(doc, '<button d-attr-onclick="handlerCode">x</button>');

    assert.throws(() => {
      bind(root, { handlerCode }, { security: { warnAsError: true } });
    });
  });
});

test('security.warnAsError – clears stale blocked href before throwing', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<a href="javascript:alert(1)" d-attr-href="href">x</a>');

    assert.throws(() => {
      bind(root, { href: 'javascript:alert(2)' }, { security: { warnAsError: true } });
    }, /blocked dangerous URL protocol/i);

    assert.equal(root.getAttribute('href'), null);
  });
});

test('security.warnAsError – clears stale srcdoc before heuristic HTML errors', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<iframe srcdoc="<script>alert(1)</script>" d-attr-srcdoc="markup"></iframe>');

    assert.throws(() => {
      bind(root, { markup: '<script>alert(2)</script>' }, {
        security: {
          warnAsError: true,
          strict: false,
          blockRawHtmlAttrs: false,
        },
      });
    }, /suspicious HTML detected/i);

    assert.equal(root.getAttribute('srcdoc'), null);
  });
});

test('security.warnAsError – signal-backed security warnings fail outside effect scheduling', async () => {
  await withDom(async (doc) => {
    const href = signal('https://example.com');
    const root = el(doc, '<a d-attr-href="href">x</a>');
    const dispose = bind(root, { href }, { security: { warnAsError: true } });
    await tick(10);

    try {
      const scheduledFatalThrows = await captureZeroDelayTimeouts(async () => {
        href.set('javascript:alert(1)');
        await tick(20);
      });

      assert.equal(scheduledFatalThrows.length > 0, true);
      assert.throws(() => {
        scheduledFatalThrows[0]();
      }, /blocked dangerous URL protocol/i);
    } finally {
      dispose();
    }
  });
});

test('security.warnAsError – non-security runtime warnings remain warnings', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-text="missing"></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { security: { warnAsError: true } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('d-text: "missing" not found in context')));
  });
});

test('security.warnAsError – clears stale innerHTML before sanitizeHtml requirement errors', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"><script>alert(1)</script></div>');

    assert.throws(() => {
      bind(root, { content: '<b>blocked</b>' }, {
        useDefaultSanitizeHtml: false,
        security: {
          warnAsError: true,
          requireHtmlSanitizerForDHtml: true,
        },
      });
    }, /requires a custom sanitizeHtml/i);

    assert.equal(root.innerHTML, '');
  });
});

test('security.warnAsError – allows d-html content made safe by the default sanitizer', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');

    assert.doesNotThrow(() => {
      bind(root, { content: '<script>alert(1)</script><b>ok</b>' }, {
        security: { warnAsError: true },
      });
    });

    assert.equal(root.innerHTML, '<b>ok</b>');
  });
});

test('security.warnAsError – aborted bind rolls back effects and two-way listeners', async () => {
  await withDom(async (doc) => {
    const name = signal('start');
    const originalSet = name.set.bind(name);
    let setCalls = 0;
    name.set = (nextValue) => {
      setCalls++;
      originalSet(nextValue);
    };

    const root = el(doc, `
      <div>
        <span class="value" d-text="name"></span>
        <input class="field" d-bind-value="name" />
        <div class="html" d-html="content"></div>
      </div>
    `);

    assert.throws(() => {
      bind(root, { name, content: '<b>blocked</b>' }, {
        useDefaultSanitizeHtml: false,
        security: {
          warnAsError: true,
          requireHtmlSanitizerForDHtml: true,
        },
      });
    }, /requires a custom sanitizeHtml/i);

    const valueEl = root.querySelector('.value');
    const field = root.querySelector('.field') as HTMLInputElement | null;
    assert.ok(valueEl);
    assert.ok(field);
    assert.equal(valueEl.textContent, 'start');
    assert.equal(field.value, '');

    setCalls = 0;
    name.set('after-failure');
    await tick(10);
    assert.equal(setCalls, 1);
    assert.equal(valueEl.textContent, 'start');
    assert.equal(field.value, '');

    setCalls = 0;
    field.value = 'typed-while-failed';
    field.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(setCalls, 0);
    assert.equal(name(), 'after-failure');

    field.setAttribute('d-bind-value', 'name');
    bind(root, { name, content: '<b>ok</b>' }, {
      sanitizeHtml: (html) => html,
      security: {
        warnAsError: true,
        requireHtmlSanitizerForDHtml: true,
      },
    });
    await tick(10);

    assert.equal(valueEl.textContent, 'after-failure');
    assert.equal(field.value, 'after-failure');

    setCalls = 0;
    field.value = 'retry-success';
    field.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(setCalls, 1);
    assert.equal(name(), 'retry-success');
  });
});

test('security.warnAsError – production mode does not throw on Trusted Types sink failures', async () => {
  await withDom(async (doc) => {
    const previousDevMode = isInDevMode();
    setDevMode(false);

    try {
      const root = el(doc, '<div d-html="content"></div>');

      assert.doesNotThrow(() => {
        bind(root, { content: '<b>blocked</b>' }, {
          security: {
            trustedTypes: true,
            trustedTypesPolicyName: 'prod-policy',
            trustedTypesPolicy: {
              createHTML: () => {
                throw new Error('policy rejected markup');
              },
            },
            warnAsError: true,
          },
        });
      });

      assert.equal(root.innerHTML, '');
    } finally {
      setDevMode(previousDevMode);
    }
  });
});

test('trustedTypes – html sinks do not auto-enable runtime policies by default', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const content = signal('<b>ok</b>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        calls.push(name);
        return { createHTML: (input: string) => input };
      },
    };

    try {
      bind(root, { content });
      await tick(10);

      assert.equal(calls.length, 0);
      assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – runtime uses "dalila" as the default policy name', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
        calls.push(name);
        return { createHTML: rules.createHTML };
      },
    };

    try {
      bind(root, { content: '<b>ok</b>' }, {
        security: {
          trustedTypes: true,
        },
      });
      await tick(10);

      assert.ok(calls.includes('dalila'));
      assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – creates and uses runtime policy for HTML sinks when available', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const content = signal('<b>ok</b>');

    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];
    (globalThis as any).trustedTypes = {
      createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
        calls.push(name);
        return { createHTML: rules.createHTML };
      },
    };

    try {
      bind(root, { content }, { security: { trustedTypes: true, trustedTypesPolicyName: 'dalila-test' } });
      await tick(10);
      assert.ok(calls.includes('dalila-test'));
      assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – retries policy creation when API appears after first bind', async () => {
  await withDom(async (doc) => {
    const rootA = el(doc, '<div d-html="content"></div>');
    const rootB = el(doc, '<div d-html="content"></div>');
    const content = signal('<b>ok</b>');
    const policyName = `dalila-late-polyfill-${Math.random().toString(36).slice(2)}`;

    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    try {
      delete (globalThis as any).trustedTypes;
      bind(rootA, { content }, { security: { trustedTypes: true, trustedTypesPolicyName: policyName } });
      await tick(10);

      (globalThis as any).trustedTypes = {
        createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
          calls.push(name);
          return { createHTML: rules.createHTML };
        },
      };

      bind(rootB, { content }, { security: { trustedTypes: true, trustedTypesPolicyName: policyName } });
      await tick(10);

      assert.ok(calls.includes(policyName));
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – reuses provided policy when lookup APIs are unavailable', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const content = signal('<b>ok</b>');
    const policy = {
      createHTML: (input: string) => input,
    };

    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        calls.push(name);
        throw new Error(`duplicate policy: ${name}`);
      },
    };

    try {
      bind(root, { content }, {
        security: {
          trustedTypes: true,
          trustedTypesPolicyName: 'existing-policy',
          trustedTypesPolicy: policy,
        },
      });
      await tick(10);

      assert.equal(calls.length, 0);
      assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – duplicate policy names fail closed when lookup APIs are unavailable', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];
    const policyName = `duplicate-policy-${Math.random().toString(36).slice(2)}`;

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        calls.push(name);
        throw new Error(`duplicate policy: ${name}`);
      },
    };

    try {
      assert.throws(() => {
        bind(root, { content: '<b>blocked</b>' }, {
          security: {
            trustedTypes: true,
            trustedTypesPolicyName: policyName,
          },
        });
      }, new RegExp(`Trusted Types policy "${policyName}" could not be created or reused|duplicate policy: ${policyName}`));

      assert.ok(calls.includes(policyName));
      assert.equal(root.innerHTML, '');
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('fromHtml – uses configured Trusted Types policy name for template parsing', async () => {
  await withDom(async () => {
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
        calls.push(name);
        if (name !== 'dalila-fromhtml') {
          throw new Error(`unexpected policy ${name}`);
        }
        return { createHTML: rules.createHTML };
      },
    };

    try {
      configure({
        security: {
          trustedTypes: true,
          trustedTypesPolicyName: 'dalila-fromhtml',
        },
      });

      const root = fromHtml('<section><span d-text="name"></span></section>', {
        data: { name: 'Dalila' },
      });
      await tick(10);

      assert.ok(calls.includes('dalila-fromhtml'));
      assert.equal(root.textContent, 'Dalila');
    } finally {
      configure({});
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('fromHtml – surfaces clear Trusted Types configuration errors when policy creation fails', async () => {
  await withDom(async () => {
    const original = (globalThis as any).trustedTypes;

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        throw new Error(`duplicate policy: ${name}`);
      },
    };

    try {
      assert.throws(() => {
        fromHtml('<section><span>Blocked</span></section>', {
          security: {
            trustedTypes: true,
            trustedTypesPolicyName: 'existing-template-policy',
          },
        });
      }, /Trusted Types policy "existing-template-policy" could not be created or reused|duplicate policy: existing-template-policy/i);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('fromHtml – propagates local sanitizeHtml for strict d-html bindings', async () => {
  await withDom(async () => {
    const root = fromHtml('<section><div d-html="content"></div></section>', {
      data: { content: '<img src=x onerror=alert(1)><b>ok</b>' },
      sanitizeHtml: (html) => removeElementsFromHtml(html, 'img'),
      security: { strict: true },
    });
    await tick(10);

    const htmlTarget = root.querySelector('[d-html]');
    assert.ok(htmlTarget);
    assert.equal(htmlTarget.innerHTML, '<b>ok</b>');
  });
});

test('fromHtml – returns the actual single root element when markup has one root', async () => {
  await withDom(async () => {
    const root = fromHtml('<section class="card"><span d-text="name"></span></section>', {
      data: { name: 'Dalila' },
    });
    await tick(10);

    assert.equal(root.tagName, 'SECTION');
    assert.equal(root.className, 'card');
    assert.equal(root.style.display, '');
    assert.equal(root.textContent, 'Dalila');
  });
});

test('trustedTypes – policy rejections do not fall back to raw HTML writes', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const policy = {
      createHTML: (_input: string) => {
        throw new Error('policy rejected markup');
      },
    };

    assert.throws(() => {
      bind(root, { content: '<b>blocked</b>' }, {
        security: {
          trustedTypes: true,
          trustedTypesPolicyName: 'rejecting-policy',
          trustedTypesPolicy: policy,
        },
      });
    }, /policy rejected markup/i);
    assert.equal(root.innerHTML, '');
  });
});

test('trustedTypes – built-in d-html sanitizer runs before rejecting policy sees markup', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const warns = await captureWarns(async () => {
      bind(root, { content: '<img src=x onerror=alert(1)><b>ok</b>' }, {
        security: {
          trustedTypes: true,
          trustedTypesPolicyName: 'sanitize-before-policy',
          trustedTypesPolicy: {
            createHTML: (input: string) => {
              if (/onerror\s*=|<script[\s>]/i.test(input)) {
                throw new Error('unsafe markup rejected');
              }
              return input;
            },
          },
        },
      });
      await tick(10);
    });

    assert.equal(root.innerHTML.includes('onerror'), false);
    assert.equal(root.innerHTML.includes('<img'), true);
    assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
    assert.equal(warns.some(w => w.includes('sanitizeHtml() failed')), false);
  });
});

test('trustedTypes – built-in d-html sanitizer works under enforced Trusted Types', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string, rules: { createHTML: (input: string) => string }) => {
        calls.push(name);
        return {
          createHTML: (input: string) => ({ __trusted_html: rules.createHTML(input) }),
        };
      },
    };

    try {
      await withTrustedTypesInnerHtmlEnforcement(doc, async () => {
        bind(root, { content: '<b>safe</b>' }, {
          security: {
            trustedTypes: true,
            trustedTypesPolicyName: 'enforced-tt',
          },
        });
        await tick(10);
      });

      assert.equal(root.innerHTML, '<b>safe</b>');
      assert.ok(calls.includes('enforced-tt'));
      assert.ok(calls.includes('enforced-tt--dalila-parse'));
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – enforced mode reuses provided policy without creating parse policy', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        calls.push(name);
        throw new Error(`unexpected policy creation: ${name}`);
      },
    };

    const policy = {
      createHTML: (input: string) => ({ __trusted_html: input }),
    };

    try {
      await withTrustedTypesInnerHtmlEnforcement(doc, async () => {
        bind(root, { content: '<b>safe</b>' }, {
          security: {
            trustedTypes: true,
            trustedTypesPolicyName: 'existing-policy',
            trustedTypesPolicy: policy,
          },
        });
        await tick(10);
      });

      assert.equal(root.innerHTML, '<b>safe</b>');
      assert.equal(calls.length, 0);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – enforced mode sanitizes before provided policy sees markup', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');
    const original = (globalThis as any).trustedTypes;
    const calls: string[] = [];

    (globalThis as any).trustedTypes = {
      createPolicy: (name: string) => {
        calls.push(name);
        throw new Error(`unexpected policy creation: ${name}`);
      },
    };

    const policy = {
      createHTML: (input: string) => {
        if (/onerror\s*=|<script[\s>]/i.test(input)) {
          throw new Error('unsafe markup rejected');
        }
        return { __trusted_html: input };
      },
    };

    try {
      const warns = await captureWarns(async () => {
        await withTrustedTypesInnerHtmlEnforcement(doc, async () => {
          bind(root, { content: '<img src=x onerror=alert(1)><b>ok</b>' }, {
            security: {
              trustedTypes: true,
              trustedTypesPolicyName: 'existing-policy',
              trustedTypesPolicy: policy,
            },
          });
          await tick(10);
        });
      });

      assert.equal(root.innerHTML.includes('onerror'), false);
      assert.equal(root.innerHTML.includes('<img'), true);
      assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
      assert.equal(calls.length, 0);
      assert.equal(warns.some(w => w.includes('sanitizeHtml() failed')), false);
    } finally {
      (globalThis as any).trustedTypes = original;
    }
  });
});

test('trustedTypes – reactive policy rejections clear sink and fail with warnAsError', async () => {
  await withDom(async (doc) => {
    const content = signal('<b>ok</b>');
    const root = el(doc, '<div d-html="content"></div>');
    const dispose = bind(root, { content }, {
      security: {
        trustedTypes: true,
        trustedTypesPolicyName: 'reactive-reject',
        trustedTypesPolicy: {
          createHTML: (input: string) => {
            if (input.includes('blocked')) {
              throw new Error('policy rejected markup');
            }
            return input;
          },
        },
        warnAsError: true,
      },
    });
    await tick(10);

    try {
      assert.equal(root.innerHTML, '<b>ok</b>');

      const scheduledFatalThrows = await captureZeroDelayTimeouts(async () => {
        content.set('<b>blocked</b>');
        await tick(20);
      });

      assert.equal(root.innerHTML, '');
      assert.equal(scheduledFatalThrows.length > 0, true);
      assert.throws(() => {
        scheduledFatalThrows[0]();
      }, /failed to apply Trusted Types HTML.*policy rejected markup|policy rejected markup/i);
    } finally {
      dispose();
    }
  });
});

// ─── 13  d-html XSS warning (dev mode) ─────────────────────────────────────

test('d-html – warns on <script> in dev mode, built-in sanitizer removes it', async () => {
  await withDom(async (doc) => {
    const content = signal('<script>alert(1)</script>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('suspicious HTML detected')),
      'must emit XSS warning');
    assert.equal(root.innerHTML, '');
  });
});

test('d-html – warns on onerror= pattern in dev mode', async () => {
  await withDom(async (doc) => {
    const content = signal('<img onerror=alert(1) src=x>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('suspicious HTML detected')));
  });
});

test('d-html – does not warn on javascript: or onload= text content', async () => {
  await withDom(async (doc) => {
    const content = signal('<pre>javascript:alert(1)</pre><code>onload=demo()</code>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content });
      await tick(10);
    });

    assert.equal(warns.some(w => w.includes('suspicious HTML detected')), false);
    assert.equal(root.innerHTML, '<pre>javascript:alert(1)</pre><code>onload=demo()</code>');
  });
});

test('d-attr-srcdoc – warns on encoded data:text/html payloads in raw HTML mode', async () => {
  await withDom(async (doc) => {
    const markup = signal('<iframe src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"></iframe>');
    const root = el(doc, '<iframe d-attr-srcdoc="markup"></iframe>');

    const warns = await captureWarns(async () => {
      bind(root, { markup }, {
        security: {
          strict: false,
          blockRawHtmlAttrs: false,
        },
      });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('suspicious HTML detected')));
    assert.equal(root.getAttribute('srcdoc')?.includes('data:text/html'), true);
  });
});

test('d-html – built-in sanitizer removes blocked tags like iframe', async () => {
  await withDom(async (doc) => {
    const content = signal('<p>ok</p><iframe src="https://evil.example"></iframe>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    assert.equal(root.innerHTML.includes('<iframe'), false);
    assert.equal(root.innerHTML.includes('<p>ok</p>'), true);
  });
});

test('d-html – built-in sanitizer removes style tags', async () => {
  await withDom(async (doc) => {
    const content = signal('<style>body{display:none}</style><p>ok</p>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    assert.equal(root.innerHTML.includes('<style'), false);
    assert.equal(root.innerHTML.includes('display:none'), false);
    assert.equal(root.innerHTML.includes('<p>ok</p>'), true);
  });
});

test('d-html – built-in sanitizer strips inline style attributes', async () => {
  await withDom(async (doc) => {
    const content = signal('<div style="position:fixed;inset:0;color:red">ok</div>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    assert.equal(root.innerHTML.includes('style='), false);
    assert.equal(root.innerHTML.includes('position:fixed'), false);
    assert.equal(root.textContent, 'ok');
  });
});

test('d-html – built-in sanitizer strips javascript: URL attributes', async () => {
  await withDom(async (doc) => {
    const content = signal('<a href="javascript:alert(1)">click</a>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    assert.equal(root.innerHTML.includes('javascript:'), false);
    assert.equal(root.innerHTML.includes('href='), false);
    assert.equal(root.innerHTML.includes('click'), true);
  });
});

test('d-html – built-in sanitizer strips data: and file: URL attributes', async () => {
  await withDom(async (doc) => {
    const content = signal([
      '<a href="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E">click</a>',
      '<img src="file:///etc/passwd" alt="blocked">',
    ].join(''));
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    assert.equal(root.innerHTML.includes('data:text/html'), false);
    assert.equal(root.innerHTML.includes('file:///etc/passwd'), false);
    assert.equal(root.innerHTML.includes('href='), false);
    assert.equal(root.innerHTML.includes('src='), false);
    assert.equal(root.innerHTML.includes('click'), true);
  });
});

test('d-html – built-in sanitizer also sanitizes nested template contents', async () => {
  await withDom(async (doc) => {
    const content = signal('<template><img src=x onerror=alert(1)><script>alert(1)</script><b>ok</b></template>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content });
    await tick(10);

    const nestedTemplate = root.querySelector('template') as HTMLTemplateElement | null;
    assert.ok(nestedTemplate);
    assert.equal(nestedTemplate.innerHTML.includes('onerror'), false);
    assert.equal(nestedTemplate.innerHTML.includes('<script'), false);
    assert.equal(nestedTemplate.innerHTML.includes('<b>ok</b>'), true);
  });
});

test('d-html – uses sanitizeHtml override when provided', async () => {
  await withDom(async (doc) => {
    const content = signal('<img src=x onerror=alert(1)><b>ok</b>');
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content }, {
      sanitizeHtml: (html) => removeElementsFromHtml(html, 'img'),
    });
    await tick(10);

    assert.equal(root.innerHTML.includes('<img'), false);
    assert.equal(root.innerHTML.includes('<b>ok</b>'), true);
  });
});

test('d-html – custom sanitizeHtml runs before warnAsError heuristic checks', async () => {
  await withDom(async (doc) => {
    const content = signal('<script>alert(1)</script><b>ok</b>');
    const root = el(doc, '<div d-html="content"></div>');

    const scheduledFatalThrows = await captureZeroDelayTimeouts(async () => {
      bind(root, { content }, {
        sanitizeHtml: (html) => removeElementsFromHtml(html, 'script'),
        security: { warnAsError: true },
      });
      await tick(20);
    });

    assert.equal(scheduledFatalThrows.length, 0);
    assert.equal(root.innerHTML, '<b>ok</b>');
  });
});

test('d-html – requireHtmlSanitizerForDHtml disables built-in fallback and renders empty', async () => {
  await withDom(async (doc) => {
    const content = signal('<b>ok</b>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content }, {
        useDefaultSanitizeHtml: false,
        security: { requireHtmlSanitizerForDHtml: true },
      });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('requires a custom sanitizeHtml()')));
    assert.equal(root.innerHTML, '');
  });
});

test('d-html – requireHtmlSanitizerForDHtml fails fast with warnAsError', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');

    assert.throws(() => {
      bind(root, { content: '<b>ok</b>' }, {
        useDefaultSanitizeHtml: false,
        security: {
          requireHtmlSanitizerForDHtml: true,
          warnAsError: true,
        },
      });
    }, /requires a custom sanitizeHtml\(\)/i);
  });
});

test('d-html – useDefaultSanitizeHtml false preserves raw HTML when strict mode is disabled', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div d-html="content"></div>');

    bind(root, { content: '<style>body{display:none}</style><p>ok</p>' }, {
      useDefaultSanitizeHtml: false,
      security: { strict: false },
    });
    await tick(10);

    assert.equal(root.innerHTML.includes('<style>body{display:none}</style>'), true);
    assert.equal(root.innerHTML.includes('<p>ok</p>'), true);
  });
});

test('d-html – sanitizeHtml is propagated to d-each clone bindings', async () => {
  await withDom(async (doc) => {
    const items = signal(['<img src=x><b>ok</b>']);
    const root = el(doc, '<div d-each="items" d-html="item"></div>');

    bind(root, { items }, {
      sanitizeHtml: (html) => removeElementsFromHtml(html, 'img'),
    });
    await tick(10);

    const div = doc.querySelector('div');
    assert.ok(div);
    assert.equal(div.innerHTML, '<b>ok</b>');
  });
});

test('d-html – useDefaultSanitizeHtml false is propagated to d-each clone bindings', async () => {
  await withDom(async (doc) => {
    const items = signal(['<b>ok</b>']);
    const root = el(doc, '<div d-each="items" d-html="item"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { items }, {
        useDefaultSanitizeHtml: false,
        security: { requireHtmlSanitizerForDHtml: true },
      });
      await tick(10);
    });

    const div = doc.querySelector('div');
    assert.ok(div);
    assert.equal(div.innerHTML, '');
    assert.ok(warns.some(w => w.includes('requires a custom sanitizeHtml()')));
  });
});

test('d-html – security.strict requires custom sanitizeHtml and renders empty without it', async () => {
  await withDom(async (doc) => {
    const content = signal('<img src=x onerror=alert(1)><b>safe</b>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content }, {
        useDefaultSanitizeHtml: false,
        security: { strict: true },
      });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('requires a custom sanitizeHtml()')));
    assert.equal(root.innerHTML, '');
  });
});

test('runtime defaults – configure({}) restores the secure default profile', async () => {
  await withDom(async (doc) => {
    const markup = signal('<p>trusted</p>');

    configure({
      security: {
        strict: false,
        blockRawHtmlAttrs: false,
        requireHtmlSanitizerForDHtml: false,
      },
    });

    const relaxedRoot = el(doc, '<iframe d-attr-srcdoc="markup"></iframe>');
    bind(relaxedRoot, { markup });
    await tick(10);
    assert.equal(relaxedRoot.getAttribute('srcdoc'), '<p>trusted</p>');

    configure({});

    const hardenedRoot = el(doc, '<iframe d-attr-srcdoc="markup"></iframe>');
    await captureWarns(async () => {
      bind(hardenedRoot, { markup });
      await tick(10);
    });
    assert.equal(hardenedRoot.getAttribute('srcdoc'), null);
  });
});

test('runtime defaults – use DOMPurify automatically when available', async () => {
  await withDom(async (doc) => {
    configure({});

    const originalDomPurify = (globalThis as any).DOMPurify;
    const calls: Array<Record<string, unknown>> = [];
    (globalThis as any).DOMPurify = {
      sanitize: (html: string, options: Record<string, unknown>) => {
        calls.push(options);
        return removeElementsFromHtml(html, 'img');
      },
    };

    try {
      const content = signal('<img src=x onerror=alert(1)><b>safe</b>');
      const root = el(doc, '<div d-html="content"></div>');

      bind(root, { content });
      await tick(10);

      assert.equal(calls.length, 1);
      assert.equal(root.innerHTML, '<b>safe</b>');
    } finally {
      (globalThis as any).DOMPurify = originalDomPurify;
      configure({});
    }
  });
});

test('configure() – global sanitizeHtml applies to d-html and local override wins', async () => {
  await withDom(async (doc) => {
    const content = signal('<i>a</i><b>b</b>');
    const root1 = el(doc, '<div d-html="content"></div>');
    const root2 = el(doc, '<div d-html="content"></div>');

    configure({
      sanitizeHtml: (html) => html.replace(/<i>|<\/i>/g, ''),
    });

    bind(root1, { content });
    bind(root2, { content }, {
      sanitizeHtml: (html) => html.replace(/<b>|<\/b>/g, ''),
    });
    await tick(10);

    assert.equal(root1.innerHTML, 'a<b>b</b>');
    assert.equal(root2.innerHTML, '<i>a</i>b');
    configure({});
  });
});

// ─── 15  d-bind-* two-way binding ──────────────────────────────────────────

test('d-bind-value – signal → input (outbound)', async () => {
  await withDom(async (doc) => {
    const name = signal('hello');
    const root = el(doc, '<div><input d-bind-value="name" /></div>');
    bind(root, { name });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.value, 'hello');
  });
});

test('d-bind-value – input → signal (inbound)', async () => {
  await withDom(async (doc) => {
    const name = signal('');
    const root = el(doc, '<div><input d-bind-value="name" /></div>');
    bind(root, { name });
    await tick(10);

    const input = root.querySelector('input');
    input.value = 'typed';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);

    assert.equal(name(), 'typed');
  });
});

test('d-bind-value – two-way roundtrip', async () => {
  await withDom(async (doc) => {
    const name = signal('A');
    const root = el(doc, '<div><input d-bind-value="name" /></div>');
    bind(root, { name });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.value, 'A');

    // User types 'B'
    input.value = 'B';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(name(), 'B');

    // Programmatic update to 'C'
    name.set('C');
    await tick(10);
    assert.equal(input.value, 'C');
  });
});

test('d-bind-value – textarea', async () => {
  await withDom(async (doc) => {
    const text = signal('initial');
    const root = el(doc, '<div><textarea d-bind-value="text"></textarea></div>');
    bind(root, { text });
    await tick(10);

    const ta = root.querySelector('textarea');
    assert.equal(ta.value, 'initial');

    ta.value = 'updated';
    ta.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(text(), 'updated');
  });
});

test('d-bind-value – select uses change event', async () => {
  await withDom(async (doc) => {
    const choice = signal('b');
    const root = el(doc, `<div>
      <select d-bind-value="choice">
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>
    </div>`);
    bind(root, { choice });
    await tick(10);

    const select = root.querySelector('select');
    assert.equal(select.value, 'b');

    select.value = 'c';
    select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    await tick(10);
    assert.equal(choice(), 'c');
  });
});

test('d-bind-checked – checkbox two-way', async () => {
  await withDom(async (doc) => {
    const done = signal(false);
    const root = el(doc, '<div><input type="checkbox" d-bind-checked="done" /></div>');
    bind(root, { done });
    await tick(10);

    const cb = root.querySelector('input');
    assert.equal(cb.checked, false);

    // Simulate user click
    cb.checked = true;
    cb.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    await tick(10);
    assert.equal(done(), true);

    // Programmatic uncheck
    done.set(false);
    await tick(10);
    assert.equal(cb.checked, false);
  });
});

test('d-bind-disabled / d-bind-readonly – outbound property bindings', async () => {
  await withDom(async (doc) => {
    const disabled = signal(false);
    const readonly = signal(false);
    const root = el(doc, '<div><input d-bind-disabled="disabled" d-bind-readonly="readonly" /></div>');
    bind(root, { disabled, readonly });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.disabled, false);
    assert.equal(input.readOnly, false);

    disabled.set(true);
    readonly.set(true);
    await tick(10);
    assert.equal(input.disabled, true);
    assert.equal(input.readOnly, true);
  });
});

test('d-bind-maxlength / d-bind-placeholder / d-bind-pattern – outbound bindings', async () => {
  await withDom(async (doc) => {
    const maxLen = signal(12);
    const placeholder = signal('Type here');
    const pattern = signal('[a-z]+');
    const root = el(
      doc,
      '<div><input d-bind-maxlength="maxLen" d-bind-placeholder="placeholder" d-bind-pattern="pattern" /></div>'
    );
    bind(root, { maxLen, placeholder, pattern });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.maxLength, 12);
    assert.equal(input.placeholder, 'Type here');
    assert.equal(input.pattern, '[a-z]+');

    maxLen.set(5);
    placeholder.set('Changed');
    pattern.set('[0-9]+');
    await tick(10);
    assert.equal(input.maxLength, 5);
    assert.equal(input.placeholder, 'Changed');
    assert.equal(input.pattern, '[0-9]+');
  });
});

test('d-bind-multiple – outbound property binding on select', async () => {
  await withDom(async (doc) => {
    const isMultiple = signal(false);
    const root = el(doc, `<div>
      <select d-bind-multiple="isMultiple">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>
    </div>`);
    bind(root, { isMultiple });
    await tick(10);

    const select = root.querySelector('select');
    assert.equal(select.multiple, false);

    isMultiple.set(true);
    await tick(10);
    assert.equal(select.multiple, true);
  });
});

test('d-bind-* supports multiple bindings on the same element', async () => {
  await withDom(async (doc) => {
    const name = signal('A');
    const ph = signal('Type');
    const disabled = signal(false);
    const root = el(
      doc,
      '<div><input d-bind-value="name" d-bind-placeholder="ph" d-bind-disabled="disabled" /></div>'
    );
    bind(root, { name, ph, disabled });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.value, 'A');
    assert.equal(input.placeholder, 'Type');
    assert.equal(input.disabled, false);

    name.set('B');
    ph.set('Changed');
    disabled.set(true);
    await tick(10);
    assert.equal(input.value, 'B');
    assert.equal(input.placeholder, 'Changed');
    assert.equal(input.disabled, true);
  });
});

test('d-bind-transform / d-bind-parse – applies outbound and inbound transforms', async () => {
  await withDom(async (doc) => {
    const price = signal(1000);
    const formatPrice = (value) => `R$ ${Number(value).toFixed(2)}`;
    const parsePrice = (value) => Number(String(value).replace(/[^\d.-]/g, ''));
    const root = el(
      doc,
      '<div><input d-bind-value="price" d-bind-transform="formatPrice" d-bind-parse="parsePrice" /></div>'
    );
    bind(root, { price, formatPrice, parsePrice });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.value, 'R$ 1000.00');

    input.value = 'R$ 1250.00';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(price(), 1250);
  });
});

test('d-bind-value – warns when binding is not a signal', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div><input d-bind-value="name" /></div>');

    const warns = await captureWarns(async () => {
      bind(root, { name: 'plain string' });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('must be a signal')),
      'must warn that binding is not a signal');
  });
});

test('d-bind-value – read-only signal keeps outbound and disables inbound', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const source = signal('derived');
    const readonly = computed(() => source());
    const root = el(doc, '<div><input d-bind-value="readonly" /></div>');

    const warns = await captureWarns(async () => {
      bind(root, { readonly });
      await tick(10);
    });

    const input = root.querySelector('input');
    assert.equal(input.value, 'derived');
    assert.ok(warns.some(w => w.includes('read-only') && w.includes('inbound updates disabled')),
      'must warn about read-only signal inbound disable');

    // Inbound user input must not throw and must not update source.
    input.value = 'typed';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(source(), 'derived');

    // Outbound sync still works.
    source.set('updated');
    await tick(10);
    assert.equal(input.value, 'updated');

    delete (globalThis as any).__dalila_dev;
  });
});

test('d-bind-value – cleanup on dispose', async () => {
  await withDom(async (doc) => {
    const name = signal('before');
    const root = el(doc, '<div><input d-bind-value="name" /></div>');
    const dispose = bind(root, { name });
    await tick(10);

    const input = root.querySelector('input');
    assert.equal(input.value, 'before');

    dispose();

    // After dispose, input events should not update the signal
    input.value = 'after';
    input.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    await tick(10);
    assert.equal(name(), 'before', 'signal must not change after dispose');
  });
});

// ─── d-text ──────────────────────────────────────────────────────────────────

test('d-text – static value', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div><span d-text="msg"></span></div>');
    bind(root, { msg: 'hello' });
    await tick(10);
    assert.equal(root.querySelector('span').textContent, 'hello');
  });
});

test('d-text – signal value', async () => {
  await withDom(async (doc) => {
    const msg = signal('initial');
    const root = el(doc, '<div><span d-text="msg"></span></div>');
    bind(root, { msg });
    await tick(10);
    assert.equal(root.querySelector('span').textContent, 'initial');

    msg.set('updated');
    await tick(10);
    assert.equal(root.querySelector('span').textContent, 'updated');
  });
});

test('d-text – computed value', async () => {
  await withDom(async (doc) => {
    const count = signal(5);
    const doubled = computed(() => count() * 2);
    const root = el(doc, '<div><span d-text="doubled"></span></div>');
    bind(root, { doubled });
    await tick(10);
    assert.equal(root.querySelector('span').textContent, '10');

    count.set(3);
    await tick(10);
    assert.equal(root.querySelector('span').textContent, '6');
  });
});

test('d-text – null/undefined renders empty string', async () => {
  await withDom(async (doc) => {
    const root = el(doc, '<div><span d-text="val"></span></div>');
    bind(root, { val: null });
    await tick(10);
    assert.equal(root.querySelector('span').textContent, '');
  });
});

// ─── d-if + d-else ───────────────────────────────────────────────────────────

test('d-if + d-else – basic toggle', async () => {
  await withDom(async (doc) => {
    const show = signal(true);
    const root = el(doc, '<div><p d-if="show">yes</p><p d-else>no</p></div>');
    bind(root, { show });
    await tick(10);

    assert.equal(root.querySelectorAll('p').length, 1);
    assert.equal(root.querySelector('p').textContent, 'yes');

    show.set(false);
    await tick(10);

    assert.equal(root.querySelectorAll('p').length, 1);
    assert.equal(root.querySelector('p').textContent, 'no');

    show.set(true);
    await tick(10);
    assert.equal(root.querySelector('p').textContent, 'yes');
  });
});

test('d-if + d-else – initial false shows else', async () => {
  await withDom(async (doc) => {
    const show = signal(false);
    const root = el(doc, '<div><p d-if="show">yes</p><p d-else>no</p></div>');
    bind(root, { show });
    await tick(10);

    assert.equal(root.querySelectorAll('p').length, 1);
    assert.equal(root.querySelector('p').textContent, 'no');
  });
});

test('d-if without d-else – backward compat', async () => {
  await withDom(async (doc) => {
    const show = signal(true);
    const root = el(doc, '<div><p d-if="show">visible</p></div>');
    bind(root, { show });
    await tick(10);

    assert.equal(root.querySelectorAll('p').length, 1);

    show.set(false);
    await tick(10);

    assert.equal(root.querySelectorAll('p').length, 0);
  });
});

// ─── d-each alias ────────────────────────────────────────────────────────────

test('d-each – "items as fruit" alias in context', async () => {
  await withDom(async (doc) => {
    const items = signal(['Apple', 'Banana', 'Cherry']);
    const root = el(doc, '<div><span d-each="items as fruit" d-text="fruit"></span></div>');
    bind(root, { items });
    await tick(10);

    const spans = root.querySelectorAll('span');
    assert.equal(spans.length, 3);
    assert.equal(spans[0].textContent, 'Apple');
    assert.equal(spans[1].textContent, 'Banana');
    assert.equal(spans[2].textContent, 'Cherry');
  });
});

test('d-each – plain syntax backward compat', async () => {
  await withDom(async (doc) => {
    const items = signal(['A', 'B']);
    const root = el(doc, '<div><span d-each="items">{item}</span></div>');
    bind(root, { items });
    await tick(10);

    const spans = root.querySelectorAll('span');
    assert.equal(spans.length, 2);
    assert.equal(spans[0].textContent, 'A');
    assert.equal(spans[1].textContent, 'B');
  });
});

test('d-each – alias with d-key resolves item', async () => {
  await withDom(async (doc) => {
    const items = signal(['X', 'Y']);
    const root = el(doc, '<div><span d-each="items as letter" d-key="letter" d-text="letter"></span></div>');
    bind(root, { items });
    await tick(10);

    const spans = root.querySelectorAll('span');
    assert.equal(spans.length, 2);
    assert.equal(spans[0].textContent, 'X');
    assert.equal(spans[1].textContent, 'Y');
  });
});
