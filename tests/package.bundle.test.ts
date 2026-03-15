import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('package metadata exposes granular bundle-friendly entry points', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  );
  const uiPackageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'packages', 'dalila-ui', 'package.json'), 'utf8')
  );
  const watchDevSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'watch-dev.cjs'),
    'utf8'
  );
  const coreIndexSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'index.ts'),
    'utf8'
  );

  assert.deepEqual(packageJson.sideEffects, ['./packages/dalila-ui/src/*/*.css']);
  assert.match(packageJson.scripts.build, /ensure-ui-local-links\.cjs/);
  assert.equal(packageJson.scripts.dev, 'node scripts/watch-dev.cjs');
  assert.ok(packageJson.exports['./core/signal']);
  assert.ok(packageJson.exports['./core/persist']);
  assert.ok(packageJson.exports['./runtime/bind']);
  assert.ok(packageJson.exports['./runtime/from-html']);
  assert.ok(packageJson.exports['./http']);
  assert.ok(packageJson.exports['./components/ui']);
  assert.ok(packageJson.exports['./components/ui/dialog']);
  assert.ok(packageJson.exports['./components/ui/runtime']);
  assert.equal(packageJson.exports['./components/ui/*/*.css'], './packages/dalila-ui/src/*/*.css');
  assert.ok(packageJson.files.includes('packages/dalila-ui/dist'));
  assert.ok(packageJson.files.includes('packages/dalila-ui/src/*/*.css'));
  assert.ok(packageJson.files.includes('scripts/ensure-ui-local-links.cjs'));
  assert.equal(packageJson.overrides.undici, '^7.24.0');
  assert.deepEqual(uiPackageJson.sideEffects, ['./src/*/*.css']);
  assert.ok(uiPackageJson.exports['.']);
  assert.ok(uiPackageJson.exports['./dialog']);
  assert.ok(uiPackageJson.exports['./runtime']);
  assert.match(watchDevSource, /packages', 'dalila-ui', 'tsconfig\.json/);
  assert.doesNotMatch(coreIndexSource, /installDefaultSecurityObservability\(\)/);
});

test('published package contents stay within unpacked size budget', () => {
  const repoRoot = process.cwd();
  const publishedRoots = [
    path.join(repoRoot, 'dist'),
    path.join(repoRoot, 'packages', 'dalila-ui', 'dist'),
    path.join(repoRoot, 'packages', 'dalila-ui', 'src'),
    path.join(repoRoot, 'scripts', 'dev-server.cjs'),
    path.join(repoRoot, 'README.md'),
  ];

  let publishedBytes = 0;
  let publishedFileCount = 0;
  for (const rootPath of publishedRoots) {
    const stat = fs.statSync(rootPath);
    if (stat.isFile()) {
      publishedBytes += stat.size;
      publishedFileCount += 1;
      continue;
    }

    for (const entry of fs.readdirSync(rootPath, { recursive: true })) {
      if (typeof entry !== 'string') {
        continue;
      }

      const entryPath = path.join(rootPath, entry);
      const entryStat = fs.statSync(entryPath);
      if (!entryStat.isFile()) {
        continue;
      }

      if (rootPath.endsWith(path.join('packages', 'dalila-ui', 'src')) && !entryPath.endsWith('.css')) {
        continue;
      }

      publishedBytes += entryStat.size;
      publishedFileCount += 1;
    }
  }

  assert.ok(publishedBytes < 1_700_000, `expected published files < 1.7 MB, got ${publishedBytes}`);
  assert.ok(publishedFileCount < 320, `expected published file count < 320, got ${publishedFileCount}`);
});

test('dalila-ui package contents stay within unpacked size budget', () => {
  const repoRoot = process.cwd();
  const publishedRoots = [
    path.join(repoRoot, 'packages', 'dalila-ui', 'dist'),
    path.join(repoRoot, 'packages', 'dalila-ui', 'src'),
    path.join(repoRoot, 'packages', 'dalila-ui', 'README.md'),
  ];

  let publishedBytes = 0;
  let publishedFileCount = 0;
  for (const rootPath of publishedRoots) {
    const stat = fs.statSync(rootPath);
    if (stat.isFile()) {
      publishedBytes += stat.size;
      publishedFileCount += 1;
      continue;
    }

    for (const entry of fs.readdirSync(rootPath, { recursive: true })) {
      if (typeof entry !== 'string') {
        continue;
      }

      const entryPath = path.join(rootPath, entry);
      const entryStat = fs.statSync(entryPath);
      if (!entryStat.isFile()) {
        continue;
      }

      if (rootPath.endsWith(path.join('packages', 'dalila-ui', 'src')) && !entryPath.endsWith('.css')) {
        continue;
      }

      publishedBytes += entryStat.size;
      publishedFileCount += 1;
    }
  }

  assert.ok(publishedBytes < 500_000, `expected dalila-ui files < 500 kB, got ${publishedBytes}`);
  assert.ok(publishedFileCount < 120, `expected dalila-ui file count < 120, got ${publishedFileCount}`);
});
