import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function withTempDir(run: (rootDir: string) => Promise<void>) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-scaffold-smoke-'));
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
}

function runCommand(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
}

function linkLocalDependency(targetPath: string, linkPath: string) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(targetPath, linkPath);
}

function installLocalSmokeDependencies(appDir: string) {
  const repoRoot = process.cwd();
  const nodeModulesDir = path.join(appDir, 'node_modules');
  const binDir = path.join(nodeModulesDir, '.bin');

  fs.mkdirSync(binDir, { recursive: true });

  linkLocalDependency(path.join(repoRoot), path.join(nodeModulesDir, 'dalila'));
  linkLocalDependency(path.join(repoRoot, 'node_modules', 'typescript'), path.join(nodeModulesDir, 'typescript'));
  linkLocalDependency(path.join(repoRoot, 'dist', 'cli', 'index.js'), path.join(binDir, 'dalila'));
  linkLocalDependency(path.join(repoRoot, 'node_modules', '.bin', 'tsc'), path.join(binDir, 'tsc'));
  linkLocalDependency(path.join(repoRoot, 'scripts', 'dev-server.cjs'), path.join(binDir, 'dalila-dev'));

  write(
    appDir,
    'node_modules/dompurify/package.json',
    JSON.stringify(
      {
        name: 'dompurify',
        version: '0.0.0-smoke',
        type: 'module',
        types: './index.d.ts',
        exports: {
          '.': {
            types: './index.d.ts',
            default: './dist/purify.es.mjs',
          },
        },
      },
      null,
      2
    )
  );
  write(
    appDir,
    'node_modules/dompurify/index.d.ts',
    [
      'declare const DOMPurify: {',
      '  sanitize(value: string, config?: unknown): string;',
      '};',
      '',
      'export default DOMPurify;',
      '',
    ].join('\n')
  );
  write(
    appDir,
    'node_modules/dompurify/dist/purify.es.mjs',
    'export default { sanitize(value) { return String(value); } };\n'
  );
}

function addSecondaryHtmlEntry(appDir: string) {
  write(
    appDir,
    'about.html',
    [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '  <title>About Smoke</title>',
      '  <script type="importmap">',
      '    {',
      '      "imports": {',
      '        "dompurify": "./node_modules/dompurify/dist/purify.es.mjs"',
      '      }',
      '    }',
      '  </script>',
      '  <script type="module" src="/src/about.ts"></script>',
      '</head>',
      '<body>',
      '  <main>',
      '    <h1>About</h1>',
      '    <p id="about-status">loading</p>',
      '  </main>',
      '</body>',
      '</html>',
      '',
    ].join('\n')
  );
  write(
    appDir,
    'src/about.ts',
    [
      "import { signal } from 'dalila/core/signal';",
      "import DOMPurify from 'dompurify';",
      '',
      "const status = signal('smoke-ok');",
      "const target = document.querySelector('#about-status');",
      '',
      'if (target) {',
      '  target.textContent = DOMPurify.sanitize(status());',
      '}',
      '',
    ].join('\n')
  );
}

test('create-dalila scaffold smoke covers build and multi-page dist packaging', async () => {
  const repoRoot = process.cwd();
  const createDalilaPath = path.join(repoRoot, 'create-dalila', 'index.js');

  await withTempDir(async (rootDir) => {
    runCommand(process.execPath, [createDalilaPath, '--ui', 'smoke-app'], rootDir);

    const appDir = path.join(rootDir, 'smoke-app');
    installLocalSmokeDependencies(appDir);
    addSecondaryHtmlEntry(appDir);

    runCommand('npm', ['run', 'build'], appDir);

    const homeHtml = fs.readFileSync(path.join(appDir, 'dist', 'index.html'), 'utf8');
    const aboutHtml = fs.readFileSync(path.join(appDir, 'dist', 'about.html'), 'utf8');
    const aboutJs = fs.readFileSync(path.join(appDir, 'dist', 'src', 'about.js'), 'utf8');
    const dompurifyModule = fs.readFileSync(
      path.join(appDir, 'dist', 'vendor', 'node_modules', 'dompurify', 'dist', 'purify.es.mjs'),
      'utf8'
    );
    const vendorDalilaDir = path.join(appDir, 'dist', 'vendor', 'dalila');
    const vendorDalilaJsFiles = fs.readdirSync(vendorDalilaDir, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.js'))
      .map((entry) => path.join(vendorDalilaDir, entry));
    const vendorDalilaJsBytes = vendorDalilaJsFiles
      .reduce((total, filePath) => total + fs.statSync(filePath).size, 0);

    assert.match(homeHtml, /src="\/src\/main\.js"/);
    assert.match(homeHtml, /"dompurify"\s*:\s*"\/vendor\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
    assert.match(aboutHtml, /src="\/src\/about\.js"/);
    assert.match(aboutHtml, /"dompurify"\s*:\s*"\/vendor\/node_modules\/dompurify\/dist\/purify\.es\.mjs"/);
    assert.match(aboutJs, /import DOMPurify from 'dompurify';/);
    assert.match(dompurifyModule, /sanitize\(value\)/);
    assert.ok(vendorDalilaJsBytes < 625_000, `expected optimized vendor/dalila graph, got ${vendorDalilaJsBytes} bytes`);
    assert.equal(fs.existsSync(path.join(vendorDalilaDir, 'components', 'ui', 'runtime.js')), false);
    assert.equal(fs.existsSync(path.join(vendorDalilaDir, 'core', 'query.js')), false);
    assert.equal(fs.existsSync(path.join(vendorDalilaDir, 'core', 'resource.js')), false);
    assert.equal(fs.existsSync(path.join(vendorDalilaDir, 'runtime', 'bind.d.ts')), false);
  });
});

test('create-dalila scaffold supports generating a headless starter without dalila-ui', async () => {
  const repoRoot = process.cwd();
  const createDalilaPath = path.join(repoRoot, 'create-dalila', 'index.js');

  await withTempDir(async (rootDir) => {
    runCommand(process.execPath, [createDalilaPath, '--no-ui', 'headless-app'], rootDir);

    const appDir = path.join(rootDir, 'headless-app');
    const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    const layoutHtml = fs.readFileSync(path.join(appDir, 'src', 'app', 'layout.html'), 'utf8');
    const styleCss = fs.readFileSync(path.join(appDir, 'src', 'style.css'), 'utf8');

    assert.equal(packageJson.dependencies['dalila-ui'], undefined);
    assert.equal(fs.existsSync(path.join(appDir, 'src', 'components', 'ui')), false);
    assert.match(layoutHtml, /<a d-link href="\/">Home<\/a>/);
    assert.match(layoutHtml, /<a d-link href="\/about">About<\/a>/);
    assert.doesNotMatch(styleCss, /components\/ui/);

    installLocalSmokeDependencies(appDir);
    runCommand('npm', ['run', 'build'], appDir);

    const homeHtml = fs.readFileSync(path.join(appDir, 'dist', 'index.html'), 'utf8');
    assert.doesNotMatch(homeHtml, /dalila-ui/);
  });
});
