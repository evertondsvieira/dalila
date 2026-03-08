import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function withTempDir(run: (rootDir: string) => unknown | Promise<unknown>) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-template-'));
  return Promise.resolve()
    .then(() => run(rootDir))
    .finally(() => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    });
}

function write(rootDir: string, relativePath: string, content: string) {
  const targetPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  return targetPath;
}

test('create-dalila template resolves DOMPurify in TypeScript and the browser', () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const mainSource = fs.readFileSync(
    path.join(templateDir, 'src', 'main.ts'),
    'utf8'
  );
  const indexSource = fs.readFileSync(
    path.join(templateDir, 'index.html'),
    'utf8'
  );

  assert.match(mainSource, /from ['"]dompurify['"]/);
  assert.doesNotMatch(mainSource, /from ['"]\/node_modules\/dompurify\/dist\/purify\.es\.mjs['"]/);
  assert.match(indexSource, /"dompurify"\s*:\s*"\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
});

test('create-dalila build packaging produces standalone dist assets', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(rootDir, 'index.html', fs.readFileSync(path.join(templateDir, 'index.html'), 'utf8'));
    write(rootDir, 'src/style.css', 'body { color: tomato; }\n');
    write(
      rootDir,
      'src/theme.ts',
      [
        `import { persist, signal } from 'dalila';`,
        `persist(signal('dark'), { name: 'app-theme', preload: true });`,
      ].join('\n')
    );
    write(
      rootDir,
      'dist/src/main.js',
      [
        `import { configure } from 'dalila/runtime';`,
        `import { createRouter } from 'dalila/router';`,
        `import DOMPurify from 'dompurify';`,
        `console.log(configure, createRouter, DOMPurify);`,
      ].join('\n')
    );

    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': {
              default: './dist/index.js',
            },
            './runtime': {
              default: './dist/runtime/index.js',
            },
            './router': {
              default: './dist/router/index.js',
            },
            './components/ui': {
              default: './dist/components/ui/index.js',
            },
            './components/ui/runtime': {
              default: './dist/components/ui/runtime.js',
            },
            './components/ui/env': {
              default: './dist/components/ui/env.js',
            },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/router/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/components/ui/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/components/ui/runtime.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/components/ui/env.js', 'export const isBrowser = true;\n');

    write(
      rootDir,
      'node_modules/dompurify/package.json',
      JSON.stringify({ name: 'dompurify', version: '0.0.0-test', type: 'module' }, null, 2)
    );
    write(
      rootDir,
      'node_modules/dompurify/dist/purify.es.mjs',
      'export default { sanitize(value) { return value; } };\n'
    );
    write(
      rootDir,
      'node_modules/fancy-lib/package.json',
      JSON.stringify({ name: 'fancy-lib', version: '0.0.0-test', type: 'module' }, null, 2)
    );
    write(rootDir, 'node_modules/fancy-lib/dist/index.js', 'export const fancy = true;\n');
    write(
      rootDir,
      'index.html',
      fs.readFileSync(path.join(templateDir, 'index.html'), 'utf8').replace(
        /"dompurify"\s*:\s*"\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/,
        [
          `"dompurify": "/node_modules/dompurify/dist/purify.es.mjs",`,
          `        "fancy-lib": "/node_modules/fancy-lib/dist/index.js"`,
        ].join('\n        ')
      )
    );

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /src="\/src\/main\.js"/);
    assert.doesNotMatch(builtHtml, /src="\/src\/main\.ts"/);
    assert.doesNotMatch(builtHtml, /:\s*"\/node_modules\//);
    assert.match(builtHtml, /"dalila\/runtime"\s*:\s*"\/vendor\/dalila\/runtime\/index\.js"/);
    assert.match(builtHtml, /"dalila\/router"\s*:\s*"\/vendor\/dalila\/router\/index\.js"/);
    assert.doesNotMatch(builtHtml, /"dalila\/components\/ui\/runtime"/);
    assert.doesNotMatch(builtHtml, /"dalila\/components\/ui\/env"/);
    assert.match(builtHtml, /"dompurify"\s*:\s*"\/vendor\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
    assert.match(builtHtml, /"fancy-lib"\s*:\s*"\/vendor\/node_modules\/fancy-lib\/dist\/index\.js"/);
    assert.match(builtHtml, /rel="modulepreload" href="\/vendor\/dalila\/runtime\/index\.js"/);
    assert.match(builtHtml, /\[d-loading\]\{visibility:hidden\}/);
    assert.match(builtHtml, /app-theme/);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'style.css')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'router', 'index.js')));
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'components', 'ui', 'runtime.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'node_modules', 'dompurify', 'dist', 'purify.es.mjs')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'node_modules', 'fancy-lib', 'dist', 'index.js')));
  });
});

test('create-dalila build packaging does not require dompurify when app removed it', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>App</title>',
        '  <link rel="stylesheet" href="/src/style.css">',
        '</head>',
        '<body>',
        '  <div id="app" d-loading></div>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/style.css', 'body { color: green; }\n');
    write(rootDir, 'dist/src/main.js', 'console.log("ok");\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.doesNotMatch(builtHtml, /dompurify/);
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
  });
});

test('create-dalila build packaging rewrites local source aliases and custom entry output', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'build',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Custom Entry</title>',
        '  <script type="module" src="/src/client.ts"></script>',
        '  <link rel="stylesheet" href="/assets/app.css">',
        '  <script type="importmap">',
        '    {',
        '      "imports": {',
        '        "app-utils": "/src/utils.ts"',
        '      },',
        '      "scopes": {',
        '        "/src/": {',
        '          "scoped-util": "/src/scoped.ts"',
        '        }',
        '      }',
        '    }',
        '  </script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'assets/app.css', 'body { color: purple; }\n');
    write(rootDir, 'assets/icons/logo.svg', '<svg />\n');
    write(rootDir, 'src/client.ts', 'export const client = true;\n');
    write(rootDir, 'src/partial.html', '<section>partial</section>\n');
    write(rootDir, 'src/utils.ts', 'export const value = 1;\n');
    write(rootDir, 'src/scoped.ts', 'export const scoped = true;\n');
    write(rootDir, 'build/client.js', 'import partial from "./partial.html?raw";\nconsole.log("client", partial);\n');
    write(rootDir, 'build/utils.js', 'export const value = 1;\n');
    write(rootDir, 'build/scoped.js', 'export const scoped = true;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    const importMapMatch = builtHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(importMapMatch);
    const importMap = JSON.parse(importMapMatch[1]);

    assert.equal(importMap.imports['app-utils'], '/utils.js');
    assert.equal(importMap.scopes['/']['scoped-util'], '/scoped.js');
    assert.ok(builtHtml.indexOf('type="importmap"') < builtHtml.indexOf('type="module"'));
    assert.match(builtHtml, /src="\/client\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'assets', 'app.css')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'assets', 'icons', 'logo.svg')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'client.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'partial.html')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'utils.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'scoped.js')));
  });
});

test('create-dalila build packaging rewrites dev-style js source urls and inline module bootstraps', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'build',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Inline Bootstrap</title>',
        '  <script type="module">',
        '    import "/src/client.js";',
        '    import { value } from "/src/utils.js";',
        '    await import("/src/lazy.js");',
        '    console.log(value);',
        '  </script>',
        '  <script type="importmap">',
        '    {',
        '      "imports": {',
        '        "app-utils": "/src/utils.js"',
        '      },',
        '      "scopes": {',
        '        "/src/": {',
        '          "scoped-util": "/src/scoped.js"',
        '        }',
        '      }',
        '    }',
        '  </script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/client.ts', 'export const client = true;\n');
    write(rootDir, 'src/utils.ts', 'export const value = 1;\n');
    write(rootDir, 'src/lazy.ts', 'export const lazy = true;\n');
    write(rootDir, 'src/scoped.ts', 'export const scoped = true;\n');
    write(rootDir, 'build/client.js', 'console.log("client");\n');
    write(rootDir, 'build/utils.js', 'export const value = 1;\n');
    write(rootDir, 'build/lazy.js', 'export const lazy = true;\n');
    write(rootDir, 'build/scoped.js', 'export const scoped = true;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    const importMapMatch = builtHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(importMapMatch);
    const importMap = JSON.parse(importMapMatch[1]);

    assert.equal(importMap.imports['app-utils'], '/utils.js');
    assert.equal(importMap.scopes['/']['scoped-util'], '/scoped.js');
    assert.match(builtHtml, /import "\/client\.js"/);
    assert.match(builtHtml, /from "\/utils\.js"/);
    assert.match(builtHtml, /import\("\/lazy\.js"\)/);
    assert.doesNotMatch(builtHtml, /\/src\/client\.js/);
    assert.doesNotMatch(builtHtml, /\/src\/utils\.js/);
    assert.doesNotMatch(builtHtml, /\/src\/lazy\.js/);
  });
});

test('create-dalila template escapes inline import map payloads', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { renderImportMapScript } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  const script = renderImportMapScript({
    imports: {
      unsafe: '/</script><script>alert(1)</script>.js',
    },
  });

  assert.equal(script.includes('</script><script>alert(1)</script>'), false);
  const importMapMatch = script.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(importMapMatch);

  const importMap = JSON.parse(importMapMatch[1]);
  assert.equal(importMap.imports.unsafe, '/</script><script>alert(1)</script>.js');
});

test('create-dalila build packaging preserves @/ alias and preload for custom rootDir', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'app',
            outDir: 'build',
          },
          include: ['app'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>App RootDir</title>',
        '  <script type="module" src="/app/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'app/main.ts', 'export const main = true;\n');
    write(rootDir, 'app/theme.ts', `persist(signal('dark'), { name: 'app-theme', preload: true });\n`);
    write(rootDir, 'build/main.js', 'console.log("main");\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    const importMapMatch = builtHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(importMapMatch);
    const importMap = JSON.parse(importMapMatch[1]);

    assert.equal(importMap.imports['@/'], '/');
    assert.match(builtHtml, /app-theme/);
    assert.match(builtHtml, /src="\/main\.js"/);
  });
});

test('create-dalila build packaging rewrites absolute source imports inside packaged js modules', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'build',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Absolute Source Imports</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'src/utils.ts', 'export const value = 1;\n');
    write(
      rootDir,
      'build/main.js',
      [
        'import { value } from "/src/utils.js";',
        'console.log(value);',
        '',
      ].join('\n')
    );
    write(rootDir, 'build/utils.js', 'export const value = 1;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtMain = fs.readFileSync(path.join(rootDir, 'dist', 'main.js'), 'utf8');
    assert.match(builtMain, /from "\/utils\.js"/);
    assert.doesNotMatch(builtMain, /\/src\/utils\.js/);
  });
});

test('create-dalila build packaging preserves compiled output when outDir is nested under dist', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'dist/client',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Nested OutDir</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'dist/client/main.js', 'console.log("main");\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /src="\/main\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'main.js')));
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
  });
});

test('create-dalila build packaging resolves rootDir inherited through tsconfig extends', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.base.json',
      JSON.stringify(
        {
          compilerOptions: {
            rootDir: 'app',
            outDir: 'build',
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
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
          },
          include: ['app'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>App RootDir Extends</title>',
        '  <script type="module" src="/app/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'app/main.ts', 'export const main = true;\n');
    write(rootDir, 'app/theme.ts', `persist(signal('dark'), { name: 'extended-theme', preload: true });\n`);
    write(rootDir, 'build/main.js', 'console.log("main");\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    const importMapMatch = builtHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(importMapMatch);
    const importMap = JSON.parse(importMapMatch[1]);

    assert.equal(importMap.imports['@/'], '/');
    assert.match(builtHtml, /extended-theme/);
    assert.match(builtHtml, /src="\/main\.js"/);
  });
});

test('create-dalila build packaging supports starter tsconfig without explicit rootDir', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(rootDir, 'tsconfig.json', fs.readFileSync(path.join(templateDir, 'tsconfig.json'), 'utf8'));
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Starter</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'routes.generated.ts', 'export const routes = [];\n');
    write(rootDir, 'routes.generated.manifest.ts', 'export const manifest = {};\n');
    write(rootDir, 'routes.generated.types.ts', 'export type Routes = [];\n');
    write(rootDir, 'dist/src/main.js', 'console.log("main");\n');
    write(rootDir, 'dist/routes.generated.js', 'export const routes = [];\n');
    write(rootDir, 'dist/routes.generated.manifest.js', 'export const manifest = {};\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /src="\/src\/main\.js"/);
  });
});

test('create-dalila build packaging rewrites relative node_modules import-map targets on secondary html pages', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Home</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'about.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>About</title>',
        '  <script type="module" src="/src/about.ts"></script>',
        '  <script type="importmap">',
        '    {',
        '      "imports": {',
        '        "fancy-lib": "./node_modules/fancy-lib/dist/index.js"',
        '      }',
        '    }',
        '  </script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'src/about.ts', 'export const about = true;\n');
    write(rootDir, 'dist/src/main.js', 'console.log("main");\n');
    write(rootDir, 'dist/src/about.js', 'console.log("about");\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');
    write(
      rootDir,
      'node_modules/fancy-lib/package.json',
      JSON.stringify({ name: 'fancy-lib', version: '0.0.0-test', type: 'module' }, null, 2)
    );
    write(rootDir, 'node_modules/fancy-lib/dist/index.js', 'export const fancy = true;\n');

    await buildProject(rootDir);

    const builtAboutHtml = fs.readFileSync(path.join(rootDir, 'dist', 'about.html'), 'utf8');
    const importMapMatch = builtAboutHtml.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    assert.ok(importMapMatch);
    const importMap = JSON.parse(importMapMatch[1]);

    assert.match(builtAboutHtml, /src="\/src\/about\.js"/);
    assert.equal(importMap.imports['fancy-lib'], '/vendor/node_modules/fancy-lib/dist/index.js');
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'node_modules', 'fancy-lib', 'dist', 'index.js')));
  });
});

test('create-dalila build packaging preserves emitted js loaded outside the static module graph', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'build',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Runtime Assets</title>',
        '  <script src="/shim.js"></script>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'build/main.js',
      [
        `navigator.serviceWorker.register('/sw.js');`,
        `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });`,
        `console.log('main');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'build/shim.js', `window.__dalilaShim = true;\n`);
    write(rootDir, 'build/sw.js', `self.addEventListener('install', () => {});\n`);
    write(rootDir, 'build/worker.js', `postMessage('ready');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /<script src="\/shim\.js"><\/script>/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'main.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'shim.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'sw.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'worker.js')));
  });
});

test('create-dalila build packaging preserves worker assets referenced from inline bootstrap scripts', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Inline Runtime Assets</title>',
        '  <script>',
        `    navigator.serviceWorker.register('/sw.js');`,
        `    new Worker('/worker.js', { type: 'module' });`,
        '  </script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/sw.js', `self.addEventListener('install', () => {});\n`);
    write(rootDir, 'dist/worker.js', `postMessage('ready');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'sw.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'worker.js')));
  });
});

test('create-dalila build packaging preserves source .map assets while stripping compiler sourcemaps', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'build',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Map Assets</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'src/maps/world.map', '{"name":"world"}\n');
    write(rootDir, 'build/main.js', `console.log('main');\n`);
    write(rootDir, 'build/main.js.map', '{"version":3}\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'maps', 'world.map')));
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'main.js.map')));
  });
});

test('create-dalila build packaging preserves Dalila imports started from classic bootstrap scripts', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Classic Bootstrap</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/shim.js',
      [
        `import('dalila/core/signal').then(({ signal }) => {`,
        `  console.log(signal('ok'));`,
        `});`,
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');
    write(rootDir, 'dist/.keep', '');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'shim.js')));
  });
});

test('create-dalila build packaging preserves Dalila imports reached via computed dynamic import()', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Computed Import</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/shim.js',
      [
        `const spec = 'dalila/core/signal';`,
        `await import(spec);`,
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');
    write(rootDir, 'dist/.keep', '');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
    assert.ok(
      builtHtml.indexOf('<script type="importmap">') < builtHtml.indexOf('<script src="/shim.js">'),
      'expected import map to be emitted before the classic bootstrap script'
    );
  });
});

test('create-dalila build packaging preserves Dalila imports from inline classic scripts', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Inline Classic</title>',
        '  <script>',
        `    import('dalila/core/signal');`,
        '  </script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');
    write(rootDir, 'dist/.keep', '');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
  });
});

test('create-dalila build packaging resolves Dalila imports for concatenated dynamic import paths with literal leaves', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Dynamic Dalila</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/shim.js',
      [
        `const leaf = 'core/signal';`,
        `await import('dalila/' + leaf);`,
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
            './core/query': { default: './dist/core/query.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');
    write(rootDir, 'node_modules/dalila/dist/core/query.js', 'export const query = true;\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'query.js')));
  });
});

test('create-dalila build packaging preserves user-authored .js.map assets', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            rootDir: 'src',
            outDir: 'dist/src',
          },
          include: ['src'],
        },
        null,
        2
      )
    );
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Map Asset</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'src/assets/vendor-lib.js.map', '{"version":3,"file":"vendor-lib.js"}\n');
    write(rootDir, 'dist/src/main.js', 'console.log("main");\n');
    write(rootDir, 'dist/src/main.js.map', '{"version":3,"file":"main.js"}\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './runtime': { default: './dist/runtime/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/runtime/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'assets', 'vendor-lib.js.map')));
    assert.ok(!fs.existsSync(path.join(rootDir, 'dist', 'src', 'main.js.map')));
  });
});

test('create-dalila build packaging keeps public assets from overwriting emitted dist files', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Public Overlay</title>',
        '  <script type="module" src="/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2020',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            outDir: 'dist',
          },
          include: ['main.ts'],
        },
        null,
        2
      )
    );
    write(rootDir, 'main.ts', 'export const main = true;\n');
    write(rootDir, 'dist/main.js', 'console.log("compiled-main");\n');
    write(rootDir, 'public/main.js', 'console.log("public-main");\n');
    write(rootDir, 'public/health.txt', 'ok\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.equal(fs.readFileSync(path.join(rootDir, 'dist', 'main.js'), 'utf8'), 'console.log("compiled-main");\n');
    assert.equal(fs.readFileSync(path.join(rootDir, 'dist', 'public', 'main.js'), 'utf8'), 'console.log("public-main");\n');
    assert.equal(fs.readFileSync(path.join(rootDir, 'dist', 'public', 'health.txt'), 'utf8'), 'ok\n');
  });
});

test('create-dalila build packaging does not modulepreload chunks reached only via import()', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Lazy Chunks</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body>',
        '  <div id="app"></div>',
        '</body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(rootDir, 'src/chunk.ts', 'export const chunk = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `import { signal } from 'dalila/core/signal';`,
        `void signal('main');`,
        `void import('/src/chunk.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/chunk.js', `export const chunk = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /rel="modulepreload" href="\/vendor\/dalila\/core\/signal\.js"/);
    assert.doesNotMatch(builtHtml, /rel="modulepreload" href="\/src\/chunk\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'chunk.js')));
  });
});

test('create-dalila build packaging preserves Dalila imports built from indirect dynamic import expressions', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Indirect Dalila Dynamic Import</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'shim.js', `const pkg = 'dalila'; await import(pkg + '/core/signal');\n`);
    write(rootDir, 'dist/shim.js', `const pkg = 'dalila'; await import(pkg + '/core/signal');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
  });
});

test('create-dalila build packaging resolves aliased Dalila import() specifiers before their declaration', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Aliased Dalila Import</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/shim.js',
      [
        `const load = () => import(spec);`,
        `const pkg = 'dalila';`,
        'const spec = `${pkg}/core/signal`;',
        `await load();`,
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
  });
});

test('create-dalila build packaging preserves Dalila imports for reassigned dynamic specifiers', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Reassigned Dalila Import</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/shim.js',
      [
        'let spec;',
        `spec = 'dalila/core/signal';`,
        'await import(spec);',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = (value) => value;\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
  });
});

test('create-dalila build packaging copies transitive Dalila files for full import-map fallbacks', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Dalila Fallback Closure</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'shim.js', `const leaf = 'core/signal'; await import('dalila/' + leaf);\n`);
    write(rootDir, 'dist/shim.js', `const leaf = 'core/signal'; await import('dalila/' + leaf);\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(
      rootDir,
      'node_modules/dalila/dist/core/signal.js',
      `import { devtools } from './devtools.js'; export const signal = () => devtools;\n`
    );
    write(rootDir, 'node_modules/dalila/dist/core/devtools.js', `export const devtools = true;\n`);

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'devtools.js')));
  });
});

test('create-dalila build packaging upgrades shared modules to static preloads when later discovered', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Mixed Classic And Module</title>',
        '  <script src="/shim.js"></script>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'import "/src/shared.js";\n');
    write(rootDir, 'src/shared.ts', 'export const shared = true;\n');
    write(rootDir, 'shim.js', `await import('/src/shared.js');\n`);
    write(rootDir, 'dist/shim.js', `await import('/src/shared.js');\n`);
    write(rootDir, 'dist/src/main.js', `import '/src/shared.js';\n`);
    write(rootDir, 'dist/src/shared.js', `export const shared = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(builtHtml, /rel="modulepreload" href="\/src\/shared\.js"/);
  });
});

test('create-dalila build packaging preserves compiled js modules in dist conservatively', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Preserve Compiled JS</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'import "/src/used.js";\n');
    write(rootDir, 'src/used.ts', 'export const used = true;\n');
    write(rootDir, 'src/unused.ts', 'export const unused = true;\n');
    write(rootDir, 'dist/src/main.js', `import '/src/used.js';\n`);
    write(rootDir, 'dist/src/used.js', `export const used = true;\n`);
    write(rootDir, 'dist/src/unused.js', `export const unused = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'main.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'used.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'unused.js')));
  });
});

test('create-dalila build packaging leaves plain inline classic-script pages untouched', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    const sourceHtml = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>Plain Inline Script</title>',
      '  <script>',
      '    window.analyticsReady = true;',
      '  </script>',
      '</head>',
      '<body></body>',
      '</html>',
      '',
    ].join('\n');

    write(rootDir, 'index.html', sourceHtml);
    write(rootDir, 'dist/plain.js', 'window.analyticsReady = true;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    const builtHtml = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.equal(builtHtml, sourceHtml);
  });
});

test('create-dalila build packaging preserves importScripts() dependencies in worker graphs', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Worker importScripts</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/shim.js', `new Worker('/worker.js');\n`);
    write(rootDir, 'dist/worker.js', `importScripts('/worker-helper.js');\npostMessage('ok');\n`);
    write(rootDir, 'dist/worker-helper.js', `self.__helper = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'worker.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'worker-helper.js')));
  });
});

test('create-dalila build packaging resolves classic-script worker urls against the HTML page', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Classic Script Runtime URLs</title>',
        '  <script src="/assets/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'dist/assets/shim.js',
      [
        `navigator.serviceWorker.register('./sw.js');`,
        `new Worker('./worker.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/sw.js', `self.addEventListener('install', () => {});\n`);
    write(rootDir, 'dist/worker.js', `postMessage('ready');\n`);
    write(rootDir, 'dist/assets/sw.js', `throw new Error('wrong sw');\n`);
    write(rootDir, 'dist/assets/worker.js', `throw new Error('wrong worker');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'sw.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'worker.js')));
  });
});

test('create-dalila build packaging preserves compiled js when local dynamic imports stay unresolved', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Unresolved Dynamic Local Import</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'void import("/src/" + window.__kind + ".js");\n');
    write(rootDir, 'dist/src/main.js', 'void import("/src/" + window.__kind + ".js");\n');
    write(rootDir, 'dist/src/alpha.js', 'export const alpha = true;\n');
    write(rootDir, 'dist/src/beta.js', 'export const beta = true;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'main.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'alpha.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'beta.js')));
  });
});

test('create-dalila build packaging ignores unrelated register() calls when tracing runtime assets', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Non ServiceWorker Register</title>',
        '  <script src="/shim.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/shim.js', `registry.register('/plugin.js');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'shim.js')));
  });
});

test('create-dalila build packaging resolves new URL aliases for worker and service worker assets', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Runtime URL Aliases</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const sw = new URL('./sw.js', import.meta.url);`,
        `navigator.serviceWorker.register(sw);`,
        `const workerUrl = new URL('./worker.js', import.meta.url);`,
        `new Worker(workerUrl, { type: 'module' });`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(rootDir, 'dist/src/worker.js', `postMessage('ready');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
  });
});

test('create-dalila build packaging resolves import-map relative targets against the HTML document', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Relative Import Map Target</title>',
        '  <script type="importmap">',
        '    {',
        '      "imports": {',
        '        "feature": "./feature.js"',
        '      }',
        '    }',
        '  </script>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'import "feature";\n');
    write(rootDir, 'dist/src/main.js', 'import "feature";\n');
    write(rootDir, 'dist/feature.js', 'export const feature = true;\n');
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    const packagedIndex = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(packagedIndex, /"feature"\s*:\s*"\.\/feature\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'feature.js')));
  });
});

test('create-dalila build packaging respects scope when resolving dynamic specifier aliases', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Scoped Dynamic Specifier</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const spec = '/src/alpha.js';`,
        `async function helper() { const spec = '/src/beta.js'; return import(spec); }`,
        `await import(spec);`,
        `void helper;`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/alpha.js', `export const alpha = true;\n`);
    write(rootDir, 'dist/src/beta.js', `export const beta = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'alpha.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'beta.js')));
  });
});

test('create-dalila build packaging preserves unresolved dynamic chunks from import-map-only modules', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Import Map Only Dynamic Module</title>',
        '  <script type="importmap">',
        '    {',
        '      "imports": {',
        '        "feature": "/src/feature.js"',
        '      }',
        '    }',
        '  </script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/feature.js', `void import('/src/' + kind + '.js');\n`);
    write(rootDir, 'dist/src/alpha.js', `export const alpha = true;\n`);
    write(rootDir, 'dist/src/beta.js', `export const beta = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'feature.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'alpha.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'beta.js')));
  });
});

test('create-dalila build packaging preserves branch-dependent dynamic import targets conservatively', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Branch Dynamic Specifier</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        'let spec;',
        `if (mode) spec = '/src/a.js';`,
        `else spec = '/src/b.js';`,
        'await import(spec);',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/a.js', `export const a = true;\n`);
    write(rootDir, 'dist/src/b.js', `export const b = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'a.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'b.js')));
  });
});

test('create-dalila build packaging preserves full Dalila import map for ambiguous dynamic Dalila imports', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Ambiguous Dalila Dynamic Import</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        'let spec;',
        `if (cond) spec = 'dalila/core/signal';`,
        `else spec = 'dalila/core/watch';`,
        'await import(spec);',
        '',
      ].join('\n')
    );
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
            './core/signal': { default: './dist/core/signal.js' },
            './core/watch': { default: './dist/core/watch.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');
    write(rootDir, 'node_modules/dalila/dist/core/signal.js', 'export const signal = true;\n');
    write(rootDir, 'node_modules/dalila/dist/core/watch.js', 'export const watch = true;\n');

    await buildProject(rootDir);

    const packagedIndex = fs.readFileSync(path.join(rootDir, 'dist', 'index.html'), 'utf8');
    assert.match(packagedIndex, /"dalila\/core\/signal"\s*:\s*"\/vendor\/dalila\/core\/signal\.js"/);
    assert.match(packagedIndex, /"dalila\/core\/watch"\s*:\s*"\/vendor\/dalila\/core\/watch\.js"/);
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'signal.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'core', 'watch.js')));
  });
});

test('create-dalila build packaging preserves unresolved runtime URL assets conservatively', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Unresolved Runtime URLs</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const assets = { workerPath };`,
        `new Worker(assets.workerPath);`,
        `navigator.serviceWorker.register('/workers/' + kind + '.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker-a.js', `postMessage('a');\n`);
    write(rootDir, 'dist/src/worker-b.js', `postMessage('b');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker-a.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker-b.js')));
  });
});

test('create-dalila build packaging traces aliased serviceWorker.register() calls', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Aliased Service Worker</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const { serviceWorker } = navigator;`,
        `serviceWorker.register('/src/sw.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
  });
});

test('create-dalila build packaging traces navigator aliases for serviceWorker.register() calls', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Navigator Alias Service Worker</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const nav = navigator;`,
        `nav.serviceWorker.register('/src/sw.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
  });
});

test('create-dalila build packaging traces destructured serviceWorker aliases from navigator aliases', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Destructured Navigator Alias Service Worker</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const nav = navigator;`,
        `const { serviceWorker } = nav;`,
        `serviceWorker.register('/src/sw.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
  });
});

test('create-dalila build packaging resolves import.meta.url aliases in new URL() worker bases', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Aliased Import Meta URL</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const base = import.meta.url;`,
        `new Worker(new URL('./worker.js', base), { type: 'module' });`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('ready');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
  });
});

test('create-dalila build packaging preserves import.meta.url aliases inside nested helpers', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Nested Import Meta URL Alias</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const base = import.meta.url;`,
        `function boot() {`,
        `  return new Worker(new URL('./worker.js', base), { type: 'module' });`,
        `}`,
        `void boot;`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('nested');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
  });
});

test('create-dalila build packaging traces self.importScripts() helper assets', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>self.importScripts</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      `new Worker('/src/worker.js');\n`
    );
    write(
      rootDir,
      'dist/src/worker.js',
      `self.importScripts('/src/worker-helper.js');\n`
    );
    write(rootDir, 'dist/src/worker-helper.js', `self.helperReady = true;\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker-helper.js')));
  });
});

test('create-dalila build packaging traces qualified Worker constructors', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Qualified Worker Constructor</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      `new window.Worker('/src/worker.js', { type: 'module' });\n`
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('ready');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
  });
});

test('create-dalila build packaging traces aliased service-worker register loaders', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Aliased Service Worker Register</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const { register } = navigator.serviceWorker;`,
        `register('/src/sw.js');`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
  });
});

test('create-dalila build packaging traces aliased Worker constructors from window destructuring', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Aliased Worker Constructor</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const { Worker: BrowserWorker } = window;`,
        `new BrowserWorker('/src/worker.js', { type: 'module' });`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('alias');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
  });
});

test('create-dalila build packaging includes inline classic pages that only use aliased worker and service-worker APIs', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Inline Classic Aliases</title>',
        '  <script>',
        '    const { Worker: BrowserWorker } = window;',
        '    const { register } = navigator.serviceWorker;',
        '    new BrowserWorker(\'/src/worker.js\', { type: \'module\' });',
        '    register(\'/src/sw.js\');',
        '  </script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('ready');\n`);
    write(rootDir, 'dist/src/sw.js', `self.addEventListener('install', () => {});\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'index.html')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'worker.js')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'sw.js')));
  });
});

test('create-dalila build packaging ignores remote new URL() worker bases', async () => {
  const templateDir = path.join(process.cwd(), 'create-dalila', 'template');
  const { buildProject } = await import(pathToFileURL(path.join(templateDir, 'build.mjs')).href);

  await withTempDir(async (rootDir) => {
    write(
      rootDir,
      'index.html',
      [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '  <title>Remote Worker Base</title>',
        '  <script type="module" src="/src/main.ts"></script>',
        '</head>',
        '<body></body>',
        '</html>',
        '',
      ].join('\n')
    );
    write(rootDir, 'src/main.ts', 'export const main = true;\n');
    write(
      rootDir,
      'dist/src/main.js',
      [
        `const CDN_BASE = 'https://cdn.example.com/assets/';`,
        `new Worker(new URL('./worker.js', CDN_BASE));`,
        '',
      ].join('\n')
    );
    write(rootDir, 'dist/src/worker.js', `postMessage('remote');\n`);
    write(
      rootDir,
      'node_modules/dalila/package.json',
      JSON.stringify(
        {
          name: 'dalila',
          version: '0.0.0-test',
          type: 'module',
          exports: {
            '.': { default: './dist/index.js' },
          },
        },
        null,
        2
      )
    );
    write(rootDir, 'node_modules/dalila/dist/index.js', 'export {};\n');

    await buildProject(rootDir);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'main.js')));
  });
});
