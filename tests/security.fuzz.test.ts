import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { parsePath, setNestedValue, getNestedValue } from '../dist/form/path-utils.js';
import { bind } from '../dist/runtime/bind.js';
import { signal } from '../dist/core/index.js';
import { compileRoutes, findCompiledRouteStackResult } from '../dist/router/route-tables.js';

function createRng(seed = 123456789): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(rng: () => number, values: T[]): T {
  return values[Math.floor(rng() * values.length)];
}

function randomSafeKey(rng: () => number): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const len = 1 + Math.floor(rng() * 8);
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

function makePathFromParts(parts: Array<string | number>): string {
  return parts
    .map((part, index) => {
      if (typeof part === 'number') return `[${part}]`;
      if (/^[a-zA-Z_][\w-]*$/.test(part) && index === 0) return part;
      if (/^[a-zA-Z_][\w-]*$/.test(part)) return `.${part}`;
      if (index === 0) return part;
      return `[${part}]`;
    })
    .join('')
    .replace(/\.\[/g, '[');
}

test('fuzz form/path-utils: parse/set/get nested values remain stable', () => {
  const rng = createRng(7);
  for (let i = 0; i < 400; i += 1) {
    const depth = 1 + Math.floor(rng() * 5);
    const parts: Array<string | number> = [];
    for (let d = 0; d < depth; d += 1) {
      if (rng() < 0.35) parts.push(Math.floor(rng() * 4));
      else parts.push(randomSafeKey(rng));
    }

    const path = makePathFromParts(parts);
    const parsed = parsePath(path);
    assert.ok(parsed.length > 0, `parsed path should not be empty for ${path}`);

    const target: Record<string, unknown> = {};
    const payload = `v-${i}`;
    setNestedValue(target, path, payload);
    assert.equal(getNestedValue(target, path), payload);
  }
});

test('fuzz form/path-utils: unsafe prototype paths are always blocked', () => {
  const variants = [
    '__proto__.polluted',
    'constructor.prototype.polluted',
    'safe.__proto__.polluted',
    'a[__proto__].x',
    'a[constructor].prototype.x',
    'a.prototype.x',
  ];

  for (const path of variants) {
    const target: Record<string, unknown> = {};
    assert.throws(() => setNestedValue(target, path, 'x'));
  }
  assert.equal(({} as any).polluted, undefined);
});

test('fuzz runtime sinks: d-html baseline sanitizer strips script-like payloads', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root" d-html="content"></div></body></html>');
  const { window } = dom;
  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).Element = window.Element;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Node = window.Node;
  (globalThis as any).NodeFilter = window.NodeFilter;

  const root = window.document.getElementById('root') as HTMLElement;
  const content = signal('');
  const dispose = bind(root, { content });

  const rng = createRng(11);
  const payloads = [
    '<script>alert(1)</script>',
    '<style>body{display:none}</style>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '<div style="position:fixed;inset:0">x</div>',
    '<iframe src="https://evil.example"></iframe>',
    '<b>safe</b>',
  ];

  for (let i = 0; i < 200; i += 1) {
    content.set(pick(rng, payloads));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const html = root.innerHTML.toLowerCase();
    assert.equal(html.includes('<script'), false);
    assert.equal(html.includes('<style'), false);
    assert.equal(html.includes('style='), false);
    assert.equal(html.includes('javascript:'), false);
    assert.equal(html.includes(' onerror='), false);
  }

  dispose();
  dom.window.close();
});

test('fuzz runtime sinks: dangerous href protocols are consistently blocked', async () => {
  const dom = new JSDOM('<!doctype html><html><body><a id="a" d-attr-href="href">x</a></body></html>');
  const { window } = dom;
  (globalThis as any).window = window;
  (globalThis as any).document = window.document;
  (globalThis as any).Element = window.Element;
  (globalThis as any).HTMLElement = window.HTMLElement;
  (globalThis as any).Node = window.Node;
  (globalThis as any).NodeFilter = window.NodeFilter;

  const a = window.document.getElementById('a') as HTMLAnchorElement;
  const href = signal('https://safe.example');
  const dispose = bind(a, { href });

  const dangerous = [
    'javascript:alert(1)',
    ' JAVASCRIPT:alert(1)',
    '\n\tjavascript:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,%3Cscript%3Ealert(1)%3C/script%3E',
    'file:///etc/passwd',
  ];

  for (const value of dangerous) {
    href.set(value);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.equal(a.getAttribute('href'), null);
  }

  dispose();
  dom.window.close();
});

test('fuzz router params: malformed and encoded segments never crash matcher', () => {
  const routes = [{ path: '/users/:id', view: () => null }];
  const compiled = compileRoutes(routes);
  const rng = createRng(99);
  const alphabet = 'abcXYZ012%';

  for (let i = 0; i < 500; i += 1) {
    const len = 1 + Math.floor(rng() * 12);
    let segment = '';
    for (let j = 0; j < len; j += 1) segment += alphabet[Math.floor(rng() * alphabet.length)];
    if (rng() < 0.3) segment += '%E0%A4%A'; // known malformed sequence

    const pathname = `/users/${segment}`;
    const result = findCompiledRouteStackResult(pathname, compiled);
    assert.ok(result, `matcher should not crash for ${pathname}`);
    assert.equal(result?.exact, true);
    const value = (result?.stack?.[0]?.params as any)?.id;
    assert.equal(typeof value, 'string');
  }
});
