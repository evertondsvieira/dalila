import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const devServer = require('../scripts/dev-server.cjs') as {
  getRequestPath: (url: string) => string | null;
  safeDecodeUrlPath: (url: string) => string | null;
  generatePreloadScript: (name: string, defaultValue: string, storageType?: string) => string;
  createSecurityHeaders: (headers?: Record<string, string>) => Record<string, string>;
};

test('dev-server: malformed URL decoding returns null instead of throwing', () => {
  assert.equal(devServer.safeDecodeUrlPath('/foo%E0%A4%A'), null);
  assert.equal(devServer.getRequestPath('/foo%E0%A4%A?x=1'), null);
});

test('dev-server: preload script escapes </script> breakout sequences', () => {
  const script = devServer.generatePreloadScript(
    `x'</script><script>alert(1)</script>`,
    `</script><img src=x onerror=alert(1)>`
  );

  assert.equal(script.includes('</script>'), false);
  assert.ok(script.includes('\\x3C'));
});

test('dev-server: security headers include CSP and nosniff defaults', () => {
  const headers = devServer.createSecurityHeaders({
    'Content-Type': 'text/html; charset=utf-8',
  });

  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /script-src 'self' 'unsafe-inline'/);
  assert.equal(headers['Content-Type'], 'text/html; charset=utf-8');
});
