import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient } from '../dist/http/index.js';

const originalFetch = global.fetch;
const originalWindow = (global as any).window;
const originalDocument = (global as any).document;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalWindow === undefined) delete (global as any).window;
  else (global as any).window = originalWindow;

  if (originalDocument === undefined) delete (global as any).document;
  else (global as any).document = originalDocument;
});

function setupBrowserGlobals() {
  (global as any).window = {
    location: new URL('https://app.example.com/current'),
  };

  (global as any).document = {
    cookie: 'XSRF-TOKEN=test-token',
    querySelector: () => null,
  };
}

function mockFetchCapture() {
  const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
  global.fetch = (async (input: any, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

test('http xsrf: sends token for same-origin unsafe request', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({ xsrf: true });

  await http.post('/api/x', { ok: true });

  assert.equal(calls.length, 1);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], 'test-token');
});

test('http xsrf: does not send token for cross-origin request', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({ xsrf: true });

  await http.post('https://api.externa.com/x', { ok: true });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], undefined);
});

test('http xsrf: sends token when baseURL is relative and url is relative', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({ xsrf: true });

  await http.request({
    method: 'POST',
    baseURL: '/api',
    url: 'x',
    data: { ok: true },
  });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], 'test-token');
});

test('http xsrf: does not send token when only absolute cross-origin baseURL is provided', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({ xsrf: true });

  await http.request({
    method: 'POST',
    baseURL: 'https://api.externa.com',
    data: { ok: true },
  });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], undefined);
});

test('http xsrf: interceptor changing url to cross-origin prevents token', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({
    xsrf: true,
    onRequest: (config) => ({ ...config, url: 'https://api.externa.com/x' }),
  });

  await http.post('/api/x', { ok: true });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], undefined);
});

test('http xsrf: interceptor-provided header value is preserved', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({
    xsrf: true,
    onRequest: (config) => ({
      ...config,
      headers: {
        ...(config.headers ?? {}),
        'x-xsrf-token': 'interceptor-token',
      },
    }),
  });

  await http.post('/api/x', { ok: true });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['x-xsrf-token'], 'interceptor-token');
  assert.equal(headers['X-XSRF-TOKEN'], undefined);
});

test('http xsrf: undefined interceptor header does not send literal "undefined"', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({
    xsrf: true,
    onRequest: (config) => ({
      ...config,
      headers: {
        ...(config.headers ?? {}),
        'x-xsrf-token': undefined as any,
      },
    }),
  });

  await http.post('/api/x', { ok: true });

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(Object.prototype.hasOwnProperty.call(headers, 'x-xsrf-token'), false);
  assert.equal(headers['X-XSRF-TOKEN'], 'test-token');
});

test('http xsrf: safe methods do not send token', async () => {
  setupBrowserGlobals();
  const calls = mockFetchCapture();
  const http = createHttpClient({ xsrf: true });

  await http.get('/api/x');

  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers['X-XSRF-TOKEN'], undefined);
});
