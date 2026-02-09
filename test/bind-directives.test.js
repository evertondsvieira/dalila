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
 *  13  d-html XSS warning              (dev-mode warn on <script> / onerror / javascript:)
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

  globalThis.window            = dom.window;
  globalThis.document          = dom.window.document;
  globalThis.Node              = dom.window.Node;
  globalThis.NodeFilter        = dom.window.NodeFilter;
  globalThis.Element           = dom.window.Element;
  globalThis.HTMLElement       = dom.window.HTMLElement;
  globalThis.DocumentFragment  = dom.window.DocumentFragment;
  globalThis.Comment           = dom.window.Comment;

  try {
    await fn(dom.window.document);
  } finally {
    await tick(20); // let any trailing microtasks settle
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.NodeFilter;
    delete globalThis.Element;
    delete globalThis.HTMLElement;
    delete globalThis.DocumentFragment;
    delete globalThis.Comment;
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
    const root = el(doc, '<input d-attr-value="val" />');
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
    const root = el(doc, '<input type="checkbox" d-attr-checked="checked" />');
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
    const root = el(doc, '<button d-attr-disabled="disabled">go</button>');
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

    assert.equal(root.querySelector('[case="a"]').style.display, '');
    assert.equal(root.querySelector('[case="b"]').style.display, 'none');

    // Dynamically add a new case after initial bind
    const caseC = doc.createElement('div');
    caseC.setAttribute('case', 'c');
    caseC.textContent = 'C';
    root.appendChild(caseC);

    mode.set('c');
    await tick(10);

    assert.equal(caseC.style.display, '',     'new case visible');
    assert.equal(root.querySelector('[case="a"]').style.display, 'none');
    assert.equal(root.querySelector('[case="b"]').style.display, 'none');
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

    assert.equal(root.querySelector('[case=""]').style.display, '');
    assert.equal(root.querySelector('[case="a"]').style.display, 'none');
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

// ─── 13  d-html XSS warning (dev mode) ─────────────────────────────────────

test('d-html – warns on <script> in dev mode, still renders', async () => {
  await withDom(async (doc) => {
    const content = signal('<script>alert(1)</script>');
    const root = el(doc, '<div d-html="content"></div>');

    const warns = await captureWarns(async () => {
      bind(root, { content });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('potentially unsafe')),
      'must emit XSS warning');
    assert.ok(root.innerHTML.includes('script'),
      'd-html is intentionally raw – content still renders');
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

    assert.ok(warns.some(w => w.includes('potentially unsafe')));
  });
});
