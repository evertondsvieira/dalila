import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('package metadata exposes granular bundle-friendly entry points', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
  );
  const coreIndexSource = fs.readFileSync(
    path.join(process.cwd(), 'src', 'core', 'index.ts'),
    'utf8'
  );

  assert.deepEqual(packageJson.sideEffects, ['./src/components/ui/*/*.css']);
  assert.ok(packageJson.exports['./core/signal']);
  assert.ok(packageJson.exports['./core/persist']);
  assert.ok(packageJson.exports['./runtime/bind']);
  assert.ok(packageJson.exports['./runtime/from-html']);
  assert.doesNotMatch(coreIndexSource, /installDefaultSecurityObservability\(\)/);
});

test('published package contents stay within unpacked size budget', () => {
  const repoRoot = process.cwd();
  const publishedRoots = [
    path.join(repoRoot, 'dist'),
    path.join(repoRoot, 'src', 'components', 'ui'),
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

      if (rootPath.endsWith(path.join('src', 'components', 'ui')) && !entryPath.endsWith('.css')) {
        continue;
      }

      publishedBytes += entryStat.size;
      publishedFileCount += 1;
    }
  }

  assert.ok(publishedBytes < 1_100_000, `expected published files < 1.1 MB, got ${publishedBytes}`);
  assert.ok(publishedFileCount < 230, `expected published file count < 230, got ${publishedFileCount}`);
});
