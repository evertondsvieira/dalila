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
    assert.match(builtHtml, /"dalila\/components\/ui\/runtime"\s*:\s*"\/vendor\/dalila\/components\/ui\/runtime\.js"/);
    assert.match(builtHtml, /"dalila\/components\/ui\/env"\s*:\s*"\/vendor\/dalila\/components\/ui\/env\.js"/);
    assert.match(builtHtml, /"dompurify"\s*:\s*"\/vendor\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
    assert.match(builtHtml, /"fancy-lib"\s*:\s*"\/vendor\/node_modules\/fancy-lib\/dist\/index\.js"/);
    assert.match(builtHtml, /\[d-loading\]\{visibility:hidden\}/);
    assert.match(builtHtml, /app-theme/);

    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'src', 'style.css')));
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
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
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
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
    assert.ok(fs.existsSync(path.join(rootDir, 'dist', 'vendor', 'dalila', 'runtime', 'index.js')));
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
