import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const devServer = require('../scripts/dev-server.cjs') as {
  resolveServerConfig: (argv?: string[], cwd?: string) => {
    projectDir: string;
    rootDir: string;
    distMode: boolean;
    isDalilaRepo: boolean;
    defaultEntry: string;
  };
  getRequestPath: (url: string) => string | null;
  safeDecodeUrlPath: (url: string) => string | null;
  shouldInjectBindings: (requestPath: string, htmlContent?: string) => boolean;
  createImportMapEntries: (dalilaPath: string) => Record<string, string>;
  createImportMapScript: (dalilaPath: string, sourceDirPath?: string) => string;
  buildUserProjectHeadAdditions: (projectRoot: string, dalilaPath: string) => string[];
  rewriteCssPackageImports: (
    source: string,
    options?: {
      dalilaUiSourcePath?: string | null;
      legacyDalilaUiSourcePath?: string | null;
    }
  ) => string;
  mergeImportMapIntoHtml: (
    html: string,
    dalilaPath: string,
    sourceDirPath?: string
  ) => { html: string; merged: boolean; script: string };
  injectHeadFragments: (html: string, fragments: string[], options?: { beforeModule?: boolean; beforeStyles?: boolean }) => string;
  collectTopLevelRecursiveWatchDirs: (baseDir: string) => string[];
  unwatchDirectoryTree: (
    dir: string,
    state?: {
      watchedDirs: Set<string>;
      watcherEntries: Map<string, { close?: () => void }>;
    }
  ) => void;
  generatePreloadScript: (name: string, defaultValue: string, storageType?: string) => string;
  createSecurityHeaders: (headers?: Record<string, string>) => Record<string, string>;
};

function withTempDir(run: (rootDir: string) => void) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-dev-server-'));
  try {
    run(rootDir);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
}

function write(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

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
  assert.ok(script.includes('\\u003C') || script.includes('\\x3C'));
});

test('dev-server: import map script escapes inline script breakout sequences', () => {
  const script = devServer.createImportMapScript(
    `/node_modules/dalila/dist</script><script>alert(1)</script>`,
    `/src/</script><img src=x onerror=alert(1)>/`
  );

  assert.equal(script.includes('</script><script>alert(1)</script>'), false);
  assert.equal(script.includes('</script><img src=x onerror=alert(1)>'), false);
  assert.ok(script.includes('\\u003C'));
  assert.match(script, /"dalila-ui"\s*:\s*"\/node_modules\/dalila-ui\/dist\/index\.js"/);
});

test('dev-server: repo fixtures using dynamic import still receive import map injection', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <title>Fixture</title>',
    '</head>',
    '<body>',
    '  <script>',
    "    import('../../packages/dalila-ui/dist/dialog/index.js');",
    '  </script>',
    '</body>',
    '</html>',
  ].join('\n');

  assert.equal(devServer.shouldInjectBindings('/examples/tests/ui-components.html', html), true);
});

test('dev-server: --dist resolves to the built dist root', () => {
  const config = devServer.resolveServerConfig(['--dist'], process.cwd());

  assert.equal(config.distMode, true);
  assert.equal(config.rootDir, path.join(process.cwd(), 'dist'));
  assert.equal(config.isDalilaRepo, false);
  assert.equal(config.defaultEntry, '/index.html');
});

test('dev-server: user project head additions include preload scripts and package helper entries', () => {
  withTempDir((rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            rootDir: 'app',
          },
          include: ['app'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'app/theme.ts',
      `persist(signal('dark'), { name: 'app-theme', preload: true });`
    );

    const fragments = devServer.buildUserProjectHeadAdditions(rootDir, '/node_modules/dalila/dist');
    const rendered = fragments.join('\n');
    const entries = devServer.createImportMapEntries('/node_modules/dalila/dist');

    assert.equal(entries['dalila/core/signal'], '/node_modules/dalila/dist/core/signal.js');
    assert.equal(entries['dalila/runtime/bind'], '/node_modules/dalila/dist/runtime/bind.js');
    assert.equal(entries['dalila/runtime/from-html'], '/node_modules/dalila/dist/runtime/fromHtml.js');
    assert.equal(entries['dalila/components/ui/runtime'], '/node_modules/dalila-ui/dist/runtime.js');
    assert.equal(entries['dalila/components/ui/env'], '/node_modules/dalila-ui/dist/env.js');
    assert.equal(entries['dalila-ui/runtime'], '/node_modules/dalila-ui/dist/runtime.js');
    assert.equal(entries['dalila-ui/env'], '/node_modules/dalila-ui/dist/env.js');
    assert.match(rendered, /app-theme/);
    assert.match(rendered, /"@\/"\s*:\s*"\/app\/"/);
    assert.match(rendered, /"dalila\/core\/signal"/);
    assert.match(rendered, /"dalila\/runtime\/bind"/);
    assert.match(rendered, /"dalila\/runtime\/from-html"/);
    assert.match(rendered, /"dalila\/components\/ui\/runtime"/);
    assert.match(rendered, /"dalila\/components\/ui\/env"/);
    assert.match(rendered, /"dalila-ui\/runtime"/);
    assert.match(rendered, /"dalila-ui\/env"/);
  });
});

test('dev-server: rewrites dalila-ui CSS package imports to served source paths', () => {
  const css = [
    '@import "dalila-ui/dalila/dalila.css";',
    "@import 'dalila/components/ui/button/button.css';",
    '@import "./local.css";',
  ].join('\n');

  const rewritten = devServer.rewriteCssPackageImports(css, {
    dalilaUiSourcePath: '/node_modules/dalila-ui/src',
    legacyDalilaUiSourcePath: '/node_modules/dalila/packages/dalila-ui/src',
  });

  assert.match(rewritten, /@import "\/node_modules\/dalila-ui\/src\/dalila\/dalila\.css"/);
  assert.match(rewritten, /@import '\/node_modules\/dalila\/packages\/dalila-ui\/src\/button\/button\.css'/);
  assert.match(rewritten, /@import "\.\/local\.css"/);
});

test('dev-server: falls back to the legacy compatibility source path when dalila-ui is not installed', () => {
  const css = '@import "dalila-ui/dalila/dalila.css";';
  const rewritten = devServer.rewriteCssPackageImports(css, {
    dalilaUiSourcePath: null,
    legacyDalilaUiSourcePath: '/node_modules/dalila/packages/dalila-ui/src',
  });

  assert.equal(rewritten, css);
});

test('dev-server: user project head additions resolve rootDir inherited through tsconfig extends', () => {
  withTempDir((rootDir) => {
    write(
      rootDir,
      'tsconfig.base.json',
      JSON.stringify(
        {
          compilerOptions: {
            rootDir: 'app',
          },
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          extends: './tsconfig.base.json',
          include: ['app'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'app/theme.ts',
      `persist(signal('dark'), { name: 'extended-theme', preload: true });`
    );

    const fragments = devServer.buildUserProjectHeadAdditions(rootDir, '/node_modules/dalila/dist');
    const rendered = fragments.join('\n');

    assert.match(rendered, /extended-theme/);
    assert.match(rendered, /"@\/"\s*:\s*"\/app\/"/);
  });
});

test('dev-server: user project head additions infer non-src source root when rootDir is omitted', () => {
  withTempDir((rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
          },
          include: ['app'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'app/theme.ts',
      `persist(signal('dark'), { name: 'inferred-theme', preload: true });`
    );

    const fragments = devServer.buildUserProjectHeadAdditions(rootDir, '/node_modules/dalila/dist');
    const rendered = fragments.join('\n');

    assert.match(rendered, /inferred-theme/);
    assert.match(rendered, /"@\/"\s*:\s*"\/app\/"/);
  });
});

test('dev-server: head fragments can be injected before module scripts', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <script type="module" src="/src/main.ts"></script>',
    '  <link rel="stylesheet" href="/src/style.css">',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');

  const injected = devServer.injectHeadFragments(
    html,
    ['  <script type="importmap">{"imports":{"dalila":"/dist/index.js"}}</script>'],
    { beforeModule: true, beforeStyles: true }
  );

  assert.ok(injected.indexOf('type="importmap"') < injected.indexOf('type="module"'));
});

test('dev-server: merges dalila entries into an existing import map without dropping dompurify', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <link rel="stylesheet" href="/src/style.css">',
    '  <script type="importmap">',
    '    {',
    '      "imports": {',
    '        "dompurify": "/node_modules/dompurify/dist/purify.es.mjs"',
    '      }',
    '    }',
    '  </script>',
    '  <script type="module" src="/src/main.ts"></script>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');

  const result = devServer.mergeImportMapIntoHtml(html, '/node_modules/dalila/dist');

  assert.equal(result.merged, true);
  assert.equal((result.html.match(/type="importmap"/g) || []).length, 0);
  assert.match(result.script, /"dompurify"\s*:\s*"\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
  assert.match(result.script, /"dalila"\s*:\s*"\/node_modules\/dalila\/dist\/index\.js"/);
  assert.match(result.script, /"dalila\/runtime\/bind"\s*:\s*"\/node_modules\/dalila\/dist\/runtime\/bind\.js"/);
  assert.match(result.script, /"dalila-ui"\s*:\s*"\/node_modules\/dalila-ui\/dist\/index\.js"/);
});

test('dev-server: malformed script attributes do not hang import map merging', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <script " type="importmap">',
    '    {"imports":{"dompurify":"/node_modules/dompurify/dist/purify.es.mjs"}}',
    '  </script>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');

  const result = devServer.mergeImportMapIntoHtml(html, '/node_modules/dalila/dist');

  assert.equal(result.merged, false);
  assert.equal(result.html, html);
});

test('dev-server: later valid import maps are still found after a malformed script opener', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <script foo="></script>',
    '  <script type="importmap">',
    '    {"imports":{"dompurify":"/node_modules/dompurify/dist/purify.es.mjs"}}',
    '  </script>',
    '</head>',
    '<body></body>',
    '</html>',
  ].join('\n');

  const result = devServer.mergeImportMapIntoHtml(html, '/node_modules/dalila/dist');

  assert.equal(result.merged, true);
  assert.equal((result.html.match(/type="importmap"/g) || []).length, 0);
  assert.match(result.script, /"dompurify"\s*:\s*"\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
  assert.match(result.script, /"dalila-ui"\s*:\s*"\/node_modules\/dalila-ui\/dist\/index\.js"/);
});

test('dev-server: top-level asset directories outside src remain recursively watched', () => {
  withTempDir((rootDir) => {
    write(rootDir, 'src/app/page.ts', 'export const x = 1;\n');
    write(rootDir, 'public/images/logo.svg', '<svg />\n');
    write(rootDir, 'assets/icons/menu.svg', '<svg />\n');
    write(rootDir, 'node_modules/pkg/index.js', 'export {};\n');
    write(rootDir, 'dist/app.js', 'console.log("built");\n');

    const watchedDirs = devServer.collectTopLevelRecursiveWatchDirs(rootDir)
      .map((dir) => path.relative(rootDir, dir).replace(/\\/g, '/'))
      .sort();

    assert.deepEqual(watchedDirs, ['assets', 'public']);
  });
});

test('dev-server: removing a watched directory clears it for later re-watch', () => {
  withTempDir((rootDir) => {
    const componentsDir = path.join(rootDir, 'src', 'components');
    const nestedDir = path.join(componentsDir, 'nested');
    const assetsDir = path.join(rootDir, 'assets');
    const closed: string[] = [];
    const state = {
      watchedDirs: new Set([componentsDir, nestedDir, assetsDir]),
      watcherEntries: new Map([
        [componentsDir, { close: () => { closed.push('components'); } }],
        [nestedDir, { close: () => { closed.push('nested'); } }],
        [assetsDir, { close: () => { closed.push('assets'); } }],
      ]),
    };

    devServer.unwatchDirectoryTree(componentsDir, state);

    assert.deepEqual(Array.from(state.watchedDirs).map((dir) => path.relative(rootDir, dir)).sort(), ['assets']);
    assert.equal(state.watcherEntries.has(componentsDir), false);
    assert.equal(state.watcherEntries.has(nestedDir), false);
    assert.equal(state.watcherEntries.has(assetsDir), true);
    assert.deepEqual(closed.sort(), ['components', 'nested']);

    state.watchedDirs.add(componentsDir);
    assert.equal(state.watchedDirs.has(componentsDir), true);
  });
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
