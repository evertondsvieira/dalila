import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let dom: JSDOM;
let documentRef: Document;
let windowRef: Window & typeof globalThis;

function setupDOM() {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  });
  documentRef = dom.window.document;
  windowRef = dom.window as any;
  (globalThis as any).document = documentRef;
  (globalThis as any).window = windowRef;
  (globalThis as any).HTMLElement = windowRef.HTMLElement;
  (globalThis as any).Element = windowRef.Element;
  (globalThis as any).Node = windowRef.Node;
  (globalThis as any).NodeFilter = (windowRef as any).NodeFilter;
  (globalThis as any).Event = windowRef.Event;
}

describe('mountUI security propagation', () => {
  beforeEach(setupDOM);

  it('runtime HTML sink detection does not hang on malformed attribute starters', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(hasExecutableHtmlSinkPattern('<img " src="javascript:alert(1)">'), true);
    assert.equal(hasExecutableHtmlSinkPattern('<div "></div>'), false);
  });

  it('runtime HTML sink detection recovers after unterminated quoted attributes', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<div foo="></div><img src="javascript:alert(1)">'),
      true
    );
  });

  it('runtime HTML sink detection keeps quoted URLs executable when they contain <', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<a href="javascript:alert(1)//<">x</a>'),
      true
    );
  });

  it('runtime HTML sink detection keeps quoted URLs executable when they contain tag-like < text', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<a href="javascript:alert(1)//<img">x</a>'),
      true
    );
  });

  it('runtime HTML sink detection ignores tag-like text inside safely quoted URLs', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<a href="https://example.com/?q=<img src=javascript:alert(1)>">x</a>'),
      false
    );
  });

  it('runtime HTML sink detection ignores benign data image URLs', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<img src="data:image/png;base64,aaaa">'),
      false
    );
  });

  it('runtime HTML sink detection flags executable data URLs', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<iframe src="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"></iframe>'),
      true
    );
  });

  it('runtime HTML sink detection continues scanning after comment-like text in quoted attrs', async () => {
    const { hasExecutableHtmlSinkPattern } = await import('../dist/runtime/html-sinks.js');

    assert.equal(
      hasExecutableHtmlSinkPattern('<img title="<!--" src="javascript:alert(1)">'),
      true
    );
  });

  it('propagates strict security to runtime bindings and blocks dangerous URLs', async () => {
    const { mountUI } = await import('../dist/components/ui/runtime.js');
    const { signal } = await import('../dist/core/signal.js');

    const root = documentRef.createElement('div');
    root.innerHTML = '<d-link id="l" d-attr-href="href">Profile</d-link>';
    documentRef.body.appendChild(root);

    const href = signal('javascript:alert(1)');
    const dispose = mountUI(root, {
      context: { href },
      security: { strict: true },
    });

    const anchor = documentRef.getElementById('l') as HTMLAnchorElement;
    assert.ok(anchor);
    assert.equal(anchor.getAttribute('href'), null);

    dispose();
  });

  it('propagates sanitizeHtml into mountUI bind call', async () => {
    const { mountUI } = await import('../dist/components/ui/runtime.js');
    const { signal } = await import('../dist/core/signal.js');

    const root = documentRef.createElement('div');
    root.innerHTML = '<div id="content" d-html="html"></div>';
    documentRef.body.appendChild(root);

    const html = signal('<img src=x><b>safe</b>');
    const dispose = mountUI(root, {
      context: { html },
      sanitizeHtml: (value: string) => value.replace(/<img[^>]*>/gi, ''),
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const content = documentRef.getElementById('content') as HTMLElement;
    assert.ok(content);
    assert.equal(content.innerHTML, '<b>safe</b>');

    dispose();
  });
});
