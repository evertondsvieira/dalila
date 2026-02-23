/**
 * Component system tests
 *
 * Covers defineComponent + bind({ components }) integration:
 *   1  Basic component renders template
 *   2  Static prop via attribute
 *   3  Dynamic prop via d-props-name — initial value
 *   4  Reactive prop — parent signal updates component
 *   5  setup() returns values usable in template
 *   6  computed() in setup reflected in template
 *   7  provide/inject between parent and component
 *   8  Default slot
 *   9  Named slot
 *  10  Slot fallback (no content provided)
 *  11  Slot content has access to PARENT context (not component)
 *  12  Component inside d-each
 *  13  Nested components (A contains B)
 *  14  Cleanup on dispose (scope cascades)
 *  15  mount() imperative API
 *  16  Warning for missing required prop
 *  17  Warning for d-props-* referencing missing key
 *  18  Multiple components in same bind scope
 *  19  Template-only component (no setup)
 *  20  Boolean prop coercion
 *  21  Kebab-to-camelCase in d-props-is-admin
 */

import test   from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { signal, computed, effect, createScope, withScope, onCleanup } from '../dist/core/index.js';
import { bind, mount, configure } from '../dist/runtime/bind.js';
import { defineComponent }   from '../dist/runtime/component.js';
import { createContext, provide, inject } from '../dist/context/context.js';

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

async function captureWarns(fn) {
  const warns = [];
  const orig  = console.warn;
  console.warn = (...args) => warns.push(args.map(String).join(' '));
  try { await fn(); }
  finally { console.warn = orig; }
  return warns;
}

// ─── 1  Basic component renders template ─────────────────────────────────────

test('component – basic render', async () => {
  await withDom(async (doc) => {
    const Greeting = defineComponent({
      tag: 'x-greeting',
      template: '<p>Hello World</p>',
    });

    const root = el(doc, '<div><x-greeting></x-greeting></div>');
    const handle = bind(root, {}, { components: { 'x-greeting': Greeting } });
    await tick(10);

    assert.ok(root.querySelector('p'));
    assert.equal(root.querySelector('p').textContent, 'Hello World');

    handle();
  });
});

// ─── 2  Static prop via attribute ────────────────────────────────────────────

test('component – static prop via attribute', async () => {
  await withDom(async (doc) => {
    const Hello = defineComponent({
      tag: 'x-hello',
      template: '<span>{name}</span>',
      props: { name: String },
      setup(props) {
        return { name: props.name };
      },
    });

    const root = el(doc, '<div><x-hello name="Ana"></x-hello></div>');
    const handle = bind(root, {}, { components: { 'x-hello': Hello } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'Ana');

    handle();
  });
});

test('component – static camelCase prop via kebab-case attribute', async () => {
  await withDom(async (doc) => {
    const User = defineComponent({
      tag: 'x-user-static',
      template: '<span>{isAdmin}</span>',
      props: { isAdmin: Boolean },
      setup(props) {
        return { isAdmin: props.isAdmin };
      },
    });

    const root = el(doc, '<div><x-user-static is-admin="true"></x-user-static></div>');
    const handle = bind(root, {}, { components: { 'x-user-static': User } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'true');

    handle();
  });
});

// ─── 3  Dynamic prop via d-props-name — initial value ────────────────────────

test('component – dynamic prop initial value', async () => {
  await withDom(async (doc) => {
    const Display = defineComponent({
      tag: 'x-display',
      template: '<span>{value}</span>',
      props: { value: String },
      setup(props) {
        return { value: props.value };
      },
    });

    const name = signal('Bob');
    const root = el(doc, '<div><x-display d-props-value="name"></x-display></div>');
    const handle = bind(root, { name }, { components: { 'x-display': Display } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'Bob');

    handle();
  });
});

// ─── 4  Reactive prop — parent signal updates component ─────────────────────

test('component – reactive prop sync', async () => {
  await withDom(async (doc) => {
    const Display = defineComponent({
      tag: 'x-display',
      template: '<span>{value}</span>',
      props: { value: String },
      setup(props) {
        return { value: props.value };
      },
    });

    const name = signal('Alice');
    const root = el(doc, '<div><x-display d-props-value="name"></x-display></div>');
    const handle = bind(root, { name }, { components: { 'x-display': Display } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'Alice');

    name.set('Carol');
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'Carol');

    handle();
  });
});

// ─── 5  setup() returns values usable in template ────────────────────────────

test('component – setup return values in template', async () => {
  await withDom(async (doc) => {
    const Counter = defineComponent({
      tag: 'x-counter',
      template: '<span>{count}</span>',
      setup() {
        const count = signal(42);
        return { count };
      },
    });

    const root = el(doc, '<div><x-counter></x-counter></div>');
    const handle = bind(root, {}, { components: { 'x-counter': Counter } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, '42');

    handle();
  });
});

// ─── 6  computed() in setup reflected in template ────────────────────────────

test('component – computed in setup', async () => {
  await withDom(async (doc) => {
    const Doubler = defineComponent({
      tag: 'x-doubler',
      template: '<span>{doubled}</span>',
      props: { value: Number },
      setup(props) {
        const doubled = computed(() => (props.value() ?? 0) * 2);
        return { doubled };
      },
    });

    const num = signal(5);
    const root = el(doc, '<div><x-doubler d-props-value="num"></x-doubler></div>');
    const handle = bind(root, { num }, { components: { 'x-doubler': Doubler } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, '10');

    num.set(7);
    await tick(10);

    assert.equal(root.querySelector('span').textContent, '14');

    handle();
  });
});

// ─── 7  provide/inject between parent and component ──────────────────────────

test('component – provide/inject works', async () => {
  await withDom(async (doc) => {
    const ThemeCtx = createContext('theme');

    const ThemeDisplay = defineComponent({
      tag: 'x-theme-display',
      template: '<span>{theme}</span>',
      setup() {
        const theme = inject(ThemeCtx);
        return { theme: signal(theme) };
      },
    });

    const root = el(doc, '<div><x-theme-display></x-theme-display></div>');

    const scope = createScope();
    withScope(scope, () => {
      provide(ThemeCtx, 'dark');
      bind(root, {}, { components: { 'x-theme-display': ThemeDisplay } });
    });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'dark');

    scope.dispose();
  });
});

// ─── 8  Default slot ─────────────────────────────────────────────────────────

test('component – default slot', async () => {
  await withDom(async (doc) => {
    const Card = defineComponent({
      tag: 'x-card',
      template: '<div class="card"><slot></slot></div>',
    });

    const root = el(doc, '<div><x-card><p>Slot content</p></x-card></div>');
    const handle = bind(root, {}, { components: { 'x-card': Card } });
    await tick(10);

    assert.ok(root.querySelector('.card p'));
    assert.equal(root.querySelector('.card p').textContent, 'Slot content');

    handle();
  });
});

// ─── 9  Named slot ───────────────────────────────────────────────────────────

test('component – named slot', async () => {
  await withDom(async (doc) => {
    const Layout = defineComponent({
      tag: 'x-layout',
      template: '<header><slot name="header"></slot></header><main><slot></slot></main>',
    });

    const root = el(doc, `
      <div>
        <x-layout>
          <span d-slot="header">Title</span>
          <p>Body</p>
        </x-layout>
      </div>
    `);
    const handle = bind(root, {}, { components: { 'x-layout': Layout } });
    await tick(10);

    assert.equal(root.querySelector('header span').textContent, 'Title');
    assert.equal(root.querySelector('main p').textContent, 'Body');

    handle();
  });
});

test('component – repeated named slot accumulates all children', async () => {
  await withDom(async (doc) => {
    const Layout = defineComponent({
      tag: 'x-layout-repeat',
      template: '<header><slot name="header"></slot></header>',
    });

    const root = el(doc, `
      <div>
        <x-layout-repeat>
          <span d-slot="header">Title</span>
          <small d-slot="header">Subtitle</small>
        </x-layout-repeat>
      </div>
    `);
    const handle = bind(root, {}, { components: { 'x-layout-repeat': Layout } });
    await tick(10);

    const title = root.querySelector('header span');
    const subtitle = root.querySelector('header small');
    assert.ok(title);
    assert.ok(subtitle);
    assert.equal(title.textContent, 'Title');
    assert.equal(subtitle.textContent, 'Subtitle');

    handle();
  });
});

// ─── 10  Slot fallback (no content provided) ─────────────────────────────────

test('component – slot fallback preserved when no content', async () => {
  await withDom(async (doc) => {
    const Box = defineComponent({
      tag: 'x-box',
      template: '<div class="box"><slot>Default text</slot></div>',
    });

    const root = el(doc, '<div><x-box></x-box></div>');
    const handle = bind(root, {}, { components: { 'x-box': Box } });
    await tick(10);

    assert.equal(root.querySelector('.box').textContent, 'Default text');

    handle();
  });
});

// ─── 11  Slot content has access to PARENT context ───────────────────────────

test('component – slot content bound with parent context', async () => {
  await withDom(async (doc) => {
    const Wrapper = defineComponent({
      tag: 'x-wrapper',
      template: '<div class="wrapper"><slot></slot></div>',
      setup() {
        const inner = signal('component-value');
        return { inner };
      },
    });

    const outer = signal('parent-value');
    const root = el(doc, `
      <div>
        <x-wrapper><span>{outer}</span></x-wrapper>
      </div>
    `);
    const handle = bind(root, { outer }, { components: { 'x-wrapper': Wrapper } });
    await tick(10);

    // Slot content should resolve from parent ctx, not component ctx
    assert.equal(root.querySelector('.wrapper span').textContent, 'parent-value');

    handle();
  });
});

// ─── 12  Component inside d-each ─────────────────────────────────────────────

test('component – inside d-each', async () => {
  await withDom(async (doc) => {
    const Tag = defineComponent({
      tag: 'x-tag',
      template: '<span class="tag">{label}</span>',
      props: { label: String },
      setup(props) {
        return { label: props.label };
      },
    });

    const items = signal(['A', 'B', 'C']);
    const root = el(doc, `
      <div>
        <ul>
          <li d-each="items"><x-tag d-props-label="item"></x-tag></li>
        </ul>
      </div>
    `);
    const handle = bind(root, { items }, { components: { 'x-tag': Tag } });
    await tick(10);

    const tags = root.querySelectorAll('.tag');
    assert.equal(tags.length, 3);
    assert.equal(tags[0].textContent, 'A');
    assert.equal(tags[1].textContent, 'B');
    assert.equal(tags[2].textContent, 'C');

    handle();
  });
});

// ─── 13  Nested components (A contains B) ────────────────────────────────────

test('component – nested components', async () => {
  await withDom(async (doc) => {
    const Inner = defineComponent({
      tag: 'x-inner',
      template: '<em>inner</em>',
    });

    const Outer = defineComponent({
      tag: 'x-outer',
      template: '<div class="outer"><x-inner></x-inner></div>',
    });

    const root = el(doc, '<div><x-outer></x-outer></div>');
    const handle = bind(root, {}, {
      components: { 'x-outer': Outer, 'x-inner': Inner },
    });
    await tick(10);

    assert.ok(root.querySelector('.outer em'));
    assert.equal(root.querySelector('.outer em').textContent, 'inner');

    handle();
  });
});

// ─── 14  Cleanup on dispose ──────────────────────────────────────────────────

test('component – cleanup on dispose', async () => {
  await withDom(async (doc) => {
    let disposed = false;

    const Comp = defineComponent({
      tag: 'x-comp',
      template: '<span>hi</span>',
      setup() {
        onCleanup(() => { disposed = true; });
        return {};
      },
    });

    const root = el(doc, '<div><x-comp></x-comp></div>');
    const handle = bind(root, {}, { components: { 'x-comp': Comp } });
    await tick(10);

    assert.equal(disposed, false);

    handle();
    await tick(10);

    assert.equal(disposed, true);
  });
});

// ─── 15  mount() imperative API ──────────────────────────────────────────────

test('component – mount() imperative API', async () => {
  await withDom(async (doc) => {
    const Greeter = defineComponent({
      tag: 'x-greeter',
      template: '<span>{name}</span>',
      props: { name: String },
      setup(props) {
        return { name: props.name };
      },
    });

    const target = el(doc, '<div></div>');
    const handle = mount(Greeter, target, { name: 'Eve' });
    await tick(10);

    assert.equal(target.querySelector('span').textContent, 'Eve');

    handle();
  });
});

// ─── 16  Warning for missing required prop ───────────────────────────────────

test('component – warning for missing required prop', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Strict = defineComponent({
      tag: 'x-strict',
      template: '<span>ok</span>',
      props: {
        title: { type: String, required: true },
      },
    });

    const root = el(doc, '<div><x-strict></x-strict></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-strict': Strict } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('required') && w.includes('title')));

    delete (globalThis as any).__dalila_dev;
  });
});

// ─── 17  Warning for d-props-* referencing missing key ───────────────────────

test('component – warning for d-props-* with missing key', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Comp = defineComponent({
      tag: 'x-missing',
      template: '<span>ok</span>',
      props: { value: String },
    });

    const root = el(doc, '<div><x-missing d-props-value="nonExistent"></x-missing></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-missing': Comp } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('nonExistent') && w.includes('not found')));

    delete (globalThis as any).__dalila_dev;
  });
});

test('component – warning for undeclared d-props-* in schema', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Comp = defineComponent({
      tag: 'x-typed',
      template: '<span>ok</span>',
      props: { value: String },
    });

    const root = el(doc, '<div><x-typed d-props-valeu="value"></x-typed></div>');
    const warns = await captureWarns(async () => {
      bind(root, { value: signal('x') }, { components: { 'x-typed': Comp } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('not declared in props schema') && w.includes('d-props-valeu')));

    delete (globalThis as any).__dalila_dev;
  });
});

// ─── 18  Multiple components in same bind scope ──────────────────────────────

test('component – multiple components in same scope', async () => {
  await withDom(async (doc) => {
    const CompA = defineComponent({
      tag: 'x-comp-a',
      template: '<span class="a">A</span>',
    });

    const CompB = defineComponent({
      tag: 'x-comp-b',
      template: '<span class="b">B</span>',
    });

    const root = el(doc, `
      <div>
        <x-comp-a></x-comp-a>
        <x-comp-b></x-comp-b>
      </div>
    `);
    const handle = bind(root, {}, {
      components: { 'x-comp-a': CompA, 'x-comp-b': CompB },
    });
    await tick(10);

    assert.equal(root.querySelector('.a').textContent, 'A');
    assert.equal(root.querySelector('.b').textContent, 'B');

    handle();
  });
});

// ─── 19  Template-only component (no setup) ──────────────────────────────────

test('component – template-only (no setup)', async () => {
  await withDom(async (doc) => {
    const Divider = defineComponent({
      tag: 'x-divider',
      template: '<hr />',
    });

    const root = el(doc, '<div><x-divider></x-divider></div>');
    const handle = bind(root, {}, { components: { 'x-divider': Divider } });
    await tick(10);

    assert.ok(root.querySelector('hr'));

    handle();
  });
});

// ─── 20  Boolean prop coercion ───────────────────────────────────────────────

test('component – Boolean prop coercion', async () => {
  await withDom(async (doc) => {
    const Toggle = defineComponent({
      tag: 'x-toggle',
      template: '<span>{active}</span>',
      props: { active: Boolean },
      setup(props) {
        return { active: props.active };
      },
    });

    const root = el(doc, `
      <div>
        <x-toggle active="true"></x-toggle>
      </div>
    `);
    const handle = bind(root, {}, { components: { 'x-toggle': Toggle } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'true');

    handle();
  });
});

// ─── 21  Kebab-to-camelCase in d-props-is-admin ──────────────────────────────

test('component – kebab-to-camelCase d-props-is-admin', async () => {
  await withDom(async (doc) => {
    const UserBadge = defineComponent({
      tag: 'x-user-badge',
      template: '<span>{isAdmin}</span>',
      props: { isAdmin: Boolean },
      setup(props) {
        return { isAdmin: props.isAdmin };
      },
    });

    const isAdmin = signal(true);
    const root = el(doc, `
      <div>
        <x-user-badge d-props-is-admin="isAdmin"></x-user-badge>
      </div>
    `);
    const handle = bind(root, { isAdmin }, { components: { 'x-user-badge': UserBadge } });
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'true');

    handle();
  });
});

// ─── 22  Child-to-parent via ctx.emit() ──────────────────────────────────────

test('component – child emits event to parent via ctx.emit()', async () => {
  await withDom(async (doc) => {
    const FruitPicker = defineComponent({
      tag: 'fruit-picker',
      template: '<button d-each="items" d-on-click="select">{item}</button>',
      props: {
        items: { type: Array, default: [] },
      },
      setup(props, ctx) {
        const select = (e) => ctx.emit('select', e.target.textContent);
        return { items: props.items, select };
      },
    });

    const selected = signal('nenhuma');
    const frutas = signal(['Maçã', 'Banana', 'Manga']);
    const handleSelect = (fruta) => selected.set(fruta);

    const root = el(doc, `
      <div>
        <p class="result">{selected}</p>
        <fruit-picker d-props-items="frutas" d-on-select="handleSelect"></fruit-picker>
      </div>
    `);

    const handle = bind(root, { selected, frutas, handleSelect }, {
      components: { 'fruit-picker': FruitPicker },
    });
    await tick(10);

    assert.equal(root.querySelector('.result').textContent, 'nenhuma');

    const buttons = root.querySelectorAll('button');
    assert.equal(buttons.length, 3);

    buttons[1].click();
    await tick(10);
    assert.equal(selected(), 'Banana');
    assert.equal(root.querySelector('.result').textContent, 'Banana');

    buttons[2].click();
    await tick(10);
    assert.equal(selected(), 'Manga');
    assert.equal(root.querySelector('.result').textContent, 'Manga');

    handle();
  });
});

// ─── 23  d-emit-click emits DOM Event when d-emit-value is absent ────────────

test('component – d-emit-click emits DOM Event when no binding', async () => {
  await withDom(async (doc) => {
    const Btn = defineComponent({
      tag: 'x-btn',
      template: '<button d-emit-click="press">Go</button>',
    });

    let received = null;
    const root = el(doc, `
      <div>
        <x-btn d-on-press="onPress"></x-btn>
      </div>
    `);

    const handle = bind(root, {
      onPress: (arg) => { received = arg; },
    }, { components: { 'x-btn': Btn } });
    await tick(10);

    root.querySelector('button').click();
    await tick(10);

    assert.ok(received instanceof doc.defaultView.Event, 'should receive a DOM Event');

    handle();
  });
});

// ─── 24  d-emit-click + d-emit-value emits resolved value ────────────────────

test('component – d-emit-click with d-emit-value resolves ctx value', async () => {
  await withDom(async (doc) => {
    const Picker = defineComponent({
      tag: 'x-picker',
      template: '<button d-emit-click="pick" d-emit-value="value">Go</button>',
      props: { value: String },
    });

    let received = null;
    const root = el(doc, `
      <div>
        <x-picker value="hello" d-on-pick="onPick"></x-picker>
      </div>
    `);

    const handle = bind(root, {
      onPick: (arg) => { received = arg; },
    }, { components: { 'x-picker': Picker } });
    await tick(10);

    root.querySelector('button').click();
    await tick(10);

    assert.equal(received, 'hello');

    handle();
  });
});

test('component – d-emit-value supports member expressions', async () => {
  await withDom(async (doc) => {
    const Picker = defineComponent({
      tag: 'x-picker-member',
      template: '<button d-emit-click="pick" d-emit-value="value.id">Go</button>',
      props: { value: Object },
    });

    let received = null;
    const root = el(doc, `
      <div>
        <x-picker-member d-props-value="item" d-on-pick="onPick"></x-picker-member>
      </div>
    `);

    const handle = bind(root, {
      item: signal({ id: 'abc-123' }),
      onPick: (arg) => { received = arg; },
    }, { components: { 'x-picker-member': Picker } });
    await tick(10);

    root.querySelector('button').click();
    await tick(10);

    assert.equal(received, 'abc-123');

    handle();
  });
});

// ─── 25  d-emit inside d-each — each item emits its own value ─────────────────

test('component – d-emit inside d-each emits per-item value', async () => {
  await withDom(async (doc) => {
    const List = defineComponent({
      tag: 'x-list',
      template: '<button d-each="items" d-emit-click="select" d-emit-value="item">{item}</button>',
      props: { items: Array },
    });

    const results = [];
    const items = signal(['A', 'B', 'C']);
    const root = el(doc, `
      <div>
        <x-list d-props-items="items" d-on-select="onSelect"></x-list>
      </div>
    `);
    const handle = bind(root, {
      items,
      onSelect: (val) => results.push(val),
    }, { components: { 'x-list': List } });
    await tick(10);

    const buttons = root.querySelectorAll('button');
    assert.equal(buttons.length, 3);

    buttons[0].click();
    buttons[2].click();
    await tick(10);

    assert.deepStrictEqual(results, ['A', 'C']);

    handle();
  });
});

test('component in slot runs setup once (no stale detached rebind)', async () => {
  await withDom(async (doc) => {
    let setupCalls = 0;

    const Child = defineComponent({
      tag: 'x-child-once',
      template: '<span>child</span>',
      setup() {
        setupCalls += 1;
        return {};
      },
    });

    const Parent = defineComponent({
      tag: 'x-parent-slot',
      template: '<section><slot></slot></section>',
    });

    const root = el(doc, `
      <div>
        <x-parent-slot>
          <x-child-once></x-child-once>
        </x-parent-slot>
      </div>
    `);

    const handle = bind(root, {}, {
      components: {
        'x-parent-slot': Parent,
        'x-child-once': Child,
      },
    });
    await tick(20);

    assert.equal(setupCalls, 1);
    assert.ok(root.querySelector('section span'));

    handle();
  });
});

test('component – d-emit-focus works without bind events configuration', async () => {
  await withDom(async (doc) => {
    const InputComp = defineComponent({
      tag: 'x-focus-input',
      template: '<input d-emit-focus="focused" />',
    });

    let called = false;
    const root = el(doc, `
      <div>
        <x-focus-input d-on-focused="onFocused"></x-focus-input>
      </div>
    `);

    const handle = bind(root, {
      onFocused: () => { called = true; },
    }, {
      components: { 'x-focus-input': InputComp },
    });
    await tick(10);

    const input = root.querySelector('input');
    input.dispatchEvent(new doc.defaultView.Event('focus'));
    await tick(10);

    assert.equal(called, true);

    handle();
  });
});

test('component – warning for empty d-emit value', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Btn = defineComponent({
      tag: 'x-empty-emit',
      template: '<button d-emit-click="">Go</button>',
    });

    const root = el(doc, `
      <div>
        <x-empty-emit d-on-go="onGo"></x-empty-emit>
      </div>
    `);

    const warns = await captureWarns(async () => {
      bind(root, { onGo: () => {} }, { components: { 'x-empty-emit': Btn } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('d-emit-click') && w.includes('empty value')));

    delete (globalThis as any).__dalila_dev;
  });
});

// ─── 26  d-emit outside component — no error ─────────────────────────────────

test('d-emit outside component does nothing (no error)', async () => {
  await withDom(async (doc) => {
    const root = el(doc, `
      <div>
        <button d-emit-click="foo">Click</button>
      </div>
    `);

    // Should not throw
    const handle = bind(root, {});
    await tick(10);

    root.querySelector('button').click();
    await tick(10);

    handle();
  });
});

// ─── 27  bind('.app', ctx) with string selector ──────────────────────────────

test('bind() accepts a string CSS selector', async () => {
  await withDom(async (doc) => {
    const div = doc.createElement('div');
    div.className = 'myapp';
    div.innerHTML = '<p>{msg}</p>';
    doc.body.appendChild(div);

    const handle = bind('.myapp', { msg: signal('hi') });
    await tick(10);

    assert.equal(div.querySelector('p').textContent, 'hi');

    handle();
    doc.body.removeChild(div);
  });
});

// ─── 28  bind('#nope', ctx) with invalid selector — throws ───────────────────

test('bind() with invalid selector throws', async () => {
  await withDom(async () => {
    assert.throws(
      () => bind('#nonexistent', {}),
      /element not found/
    );
  });
});

// ─── 29  mount() with camelCase prop ────────────────────────────────────────

test('mount() converts camelCase props to kebab-case attributes', async () => {
  await withDom(async (doc) => {
    const Comp = defineComponent({
      tag: 'x-camel-test',
      template: '<span>{isAdmin}</span>',
      props: { isAdmin: Boolean },
      setup(props) { return { isAdmin: props.isAdmin }; },
    });

    const target = doc.createElement('div');
    doc.body.appendChild(target);

    const handle = mount(Comp, target, { isAdmin: signal(true) });
    await tick(20);

    assert.equal(
      target.querySelector('span').textContent,
      'true',
    );

    handle();
    doc.body.removeChild(target);
  });
});

// ─── 30  mount() isolation — does not rebind existing target content ────────

test('mount() only binds the created component, not the whole target', async () => {
  await withDom(async (doc) => {
    const counter = signal(0);

    const target = doc.createElement('div');
    target.innerHTML = '<p>{counter}</p>';
    doc.body.appendChild(target);

    // Pre-bind the target so {counter} resolves
    const outerHandle = bind(target, { counter });
    await tick(20);
    assert.equal(target.querySelector('p').textContent, '0');

    const Comp = defineComponent({
      tag: 'x-iso-test',
      template: '<span>OK</span>',
    });

    const mountHandle = mount(Comp, target, {});
    await tick(20);

    // Bump counter — the outer bind should still own the <p>
    counter.set(42);
    await tick(20);
    assert.equal(target.querySelector('p').textContent, '42');
    assert.equal(target.querySelector('span').textContent, 'OK');

    mountHandle();
    outerHandle();
    doc.body.removeChild(target);
  });
});

// ─── 31  d-props-* reactive sync with zero-arity getter ────────────────────

test('d-props-* reactively syncs zero-arity getter functions', async () => {
  await withDom(async (doc) => {
    const sig = signal('hello');

    const Comp = defineComponent({
      tag: 'x-getter-test',
      template: '<span>{label}</span>',
      props: { label: String },
      setup(props) { return { label: props.label }; },
    });

    const root = el(doc, `
      <div>
        <x-getter-test d-props-label="derivedLabel"></x-getter-test>
      </div>
    `);

    const handle = bind(root, { derivedLabel: () => sig() }, {
      components: { 'x-getter-test': Comp },
    });
    await tick(20);

    assert.equal(root.querySelector('span').textContent, 'hello');

    sig.set('world');
    await tick(20);

    assert.equal(root.querySelector('span').textContent, 'world');

    handle();
  });
});

// ─── 32  components option preserves prototype-backed context lookups ───────

test('bind({ components }) preserves inherited context values', async () => {
  await withDom(async (doc) => {
    const Picker = defineComponent({
      tag: 'x-proto-picker',
      template: '<button d-each="items" d-emit-click="select" d-emit-value="item">{item}</button>',
      props: { items: Array },
    });

    const selected = signal('');
    class ProtoCtx {
      [key: string]: unknown;
      declare items: any;
      declare onSelect: (value: unknown) => void;
    }
    ProtoCtx.prototype.items = signal(['A', 'B']);
    ProtoCtx.prototype.onSelect = (value) => selected.set(String(value));

    const root = el(doc, `
      <div>
        <x-proto-picker d-props-items="items" d-on-select="onSelect"></x-proto-picker>
      </div>
    `);

    const handle = bind(root, new ProtoCtx(), {
      components: { 'x-proto-picker': Picker },
    });
    await tick(20);

    const buttons = root.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    buttons[1].click();
    await tick(20);

    assert.equal(selected(), 'B');

    handle();
  });
});

test('component – warning when setup overrides prop binding name', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Comp = defineComponent({
      tag: 'x-shadow-prop',
      template: '<span>{name}</span>',
      props: { name: String },
      setup() {
        return { name: signal('shadow') };
      },
    });

    const root = el(doc, '<div><x-shadow-prop name="real"></x-shadow-prop></div>');
    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-shadow-prop': Comp } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('setup() returned') && w.includes('overrides a prop binding')));

    delete (globalThis as any).__dalila_dev;
  });
});

test('bind({ components }) warns when registry key differs from component tag', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Comp = defineComponent({
      tag: 'x-real-key',
      template: '<span>ok</span>',
    });

    const root = el(doc, '<div><x-real-key></x-real-key></div>');
    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-alias-key': Comp } });
      await tick(10);
    });

    assert.ok(root.querySelector('span'));
    assert.ok(warns.some(w => w.includes('components key') && w.includes('x-alias-key') && w.includes('x-real-key')));

    delete (globalThis as any).__dalila_dev;
  });
});

// ─── Factory defaults ─────────────────────────────────────────────────────────

test('component – factory default creates separate instances', async () => {
  await withDom(async (doc) => {
    const Comp = defineComponent({
      tag: 'x-factory-def',
      template: '<span>{count}</span>',
      props: {
        items: { type: Array, default: () => [] },
      },
      setup(props) {
        const count = computed(() => (props.items() ?? []).length);
        return { count };
      },
    });

    const root = el(doc, `
      <div>
        <x-factory-def></x-factory-def>
        <x-factory-def></x-factory-def>
      </div>
    `);
    const handle = bind(root, {}, { components: { 'x-factory-def': Comp } });
    await tick(10);

    const spans = root.querySelectorAll('span');
    assert.equal(spans.length, 2);
    assert.equal(spans[0].textContent, '0');
    assert.equal(spans[1].textContent, '0');

    handle();
  });
});

// ─── mount(selector, vm) overload ─────────────────────────────────────────────

test('mount(selector, vm) overload works like bind', async () => {
  await withDom(async (doc) => {
    const div = doc.createElement('div');
    div.className = 'mount-test';
    div.innerHTML = '<p d-text="msg"></p>';
    doc.body.appendChild(div);

    const handle = mount('.mount-test', { msg: signal('hello') });
    await tick(10);

    assert.equal(div.querySelector('p').textContent, 'hello');

    handle();
    doc.body.removeChild(div);
  });
});

// ─── configure() ──────────────────────────────────────────────────────────────

test('configure() sets global component registry', async () => {
  await withDom(async (doc) => {
    const Tag = defineComponent({
      tag: 'x-cfg-tag',
      template: '<span>configured</span>',
    });

    configure({ components: [Tag] });

    const root = el(doc, '<div><x-cfg-tag></x-cfg-tag></div>');
    const handle = bind(root, {});
    await tick(10);

    assert.equal(root.querySelector('span').textContent, 'configured');

    handle();

    // Reset global config
    configure({});
  });
});

test('configure({}) resets global component registry', async () => {
  await withDom(async (doc) => {
    const Tag = defineComponent({
      tag: 'x-cfg-reset',
      template: '<span>configured</span>',
    });

    configure({ components: [Tag] });

    const rootA = el(doc, '<div><x-cfg-reset></x-cfg-reset></div>');
    const handleA = bind(rootA, {});
    await tick(10);
    assert.equal(rootA.querySelector('span').textContent, 'configured');
    handleA();

    configure({});

    const rootB = el(doc, '<div><x-cfg-reset></x-cfg-reset></div>');
    const handleB = bind(rootB, {});
    await tick(10);
    assert.equal(rootB.querySelector('span'), null);
    assert.ok(rootB.querySelector('x-cfg-reset'));
    handleB();
  });
});

// ─── 34  Single-root template renders without wrapper ─────────────────────────

test('component – single-root template has no wrapper element', async () => {
  await withDom(async (doc) => {
    const Card = defineComponent({
      tag: 'x-card-nowrap',
      template: '<section class="card">Content</section>',
    });

    const root = el(doc, '<div><x-card-nowrap></x-card-nowrap></div>');
    const handle = bind(root, {}, { components: { 'x-card-nowrap': Card } });
    await tick(10);

    // The <section> should be a direct child — no dalila-c or div wrapper
    assert.ok(root.querySelector('section.card'));
    assert.equal(root.querySelector('dalila-c'), null);
    assert.equal(root.firstElementChild.tagName, 'SECTION');

    handle();
  });
});

// ─── 35  Multi-root template uses <dalila-c> wrapper ──────────────────────────

test('component – multi-root template uses dalila-c wrapper', async () => {
  await withDom(async (doc) => {
    const Layout = defineComponent({
      tag: 'x-multi-root',
      template: '<header>H</header><main>M</main>',
    });

    const root = el(doc, '<div><x-multi-root></x-multi-root></div>');
    const handle = bind(root, {}, { components: { 'x-multi-root': Layout } });
    await tick(10);

    // Should use dalila-c, not a plain div
    const wrapper = root.querySelector('dalila-c');
    assert.ok(wrapper, 'expected <dalila-c> wrapper for multi-root template');
    assert.equal(wrapper.style.display, 'contents');
    assert.ok(wrapper.querySelector('header'));
    assert.ok(wrapper.querySelector('main'));
    // No plain div wrapper
    assert.equal(root.querySelectorAll(':scope > div[style*="contents"]').length, 0);

    handle();
  });
});

// ─── 36  Warning for empty template ───────────────────────────────────────────

test('component – warning for empty template', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Empty = defineComponent({
      tag: 'x-empty-tpl',
      template: '   ',
    });

    const root = el(doc, '<div><x-empty-tpl></x-empty-tpl></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-empty-tpl': Empty } });
      await tick(10);
    });

    assert.ok(warns.some(w => w.includes('x-empty-tpl') && w.includes('template is empty')));

    delete (globalThis as any).__dalila_dev;
  });
});

// ─── 37  Warning for Array/Object prop as static attribute ────────────────────

test('component – warning for Array prop as static attribute', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const List = defineComponent({
      tag: 'x-arr-warn',
      template: '<span>ok</span>',
      props: { items: Array },
    });

    const root = el(doc, '<div><x-arr-warn items="[1,2,3]"></x-arr-warn></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-arr-warn': List } });
      await tick(10);
    });

    assert.ok(warns.some(w =>
      w.includes('x-arr-warn') &&
      w.includes('items') &&
      w.includes('Array') &&
      w.includes('static string attribute')
    ));

    delete (globalThis as any).__dalila_dev;
  });
});

test('component – warning for Object prop as static attribute', async () => {
  await withDom(async (doc) => {
    (globalThis as any).__dalila_dev = true;

    const Config = defineComponent({
      tag: 'x-obj-warn',
      template: '<span>ok</span>',
      props: { config: Object },
    });

    const root = el(doc, '<div><x-obj-warn config="{a:1}"></x-obj-warn></div>');

    const warns = await captureWarns(async () => {
      bind(root, {}, { components: { 'x-obj-warn': Config } });
      await tick(10);
    });

    assert.ok(warns.some(w =>
      w.includes('x-obj-warn') &&
      w.includes('config') &&
      w.includes('Object') &&
      w.includes('static string attribute')
    ));

    delete (globalThis as any).__dalila_dev;
  });
});
