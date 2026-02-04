import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectHtmlPathDependencyDirs, generateRoutesFile } from '../dist/cli/routes-generator.js';

function withTempProject(run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-routes-'));
  fs.writeFileSync(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'tmp', private: true }, null, 2));

  const appDir = path.join(rootDir, 'src', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  const write = (relativePath, content) => {
    const absolutePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    return absolutePath;
  };

  return Promise.resolve()
    .then(() => run({ rootDir, appDir, write }))
    .finally(() => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    });
}

test('Routes generator - page.ts with view is emitted as eager view export', async () => {
  await withTempProject(async ({ appDir, rootDir, write }) => {
    write('src/app/home/page.ts', `
      export function view() {
        const el = document.createElement('div');
        el.textContent = 'home';
        return el;
      }
    `);

    const outputPath = path.join(rootDir, 'routes.generated.ts');
    await generateRoutesFile(appDir, outputPath);

    const generated = fs.readFileSync(outputPath, 'utf-8');
    assert.match(generated, /from '\.\/src\/app\/home\/page\.js';/);
    assert.match(generated, /view:\s*\([^)]* as any\)\.view/);
    assert.doesNotMatch(generated, /home_page_lazy\s*=\s*\(\)\s*=>\s*import\('\.\/src\/app\/home\/page\.js'\)/);
  });
});

test('Routes generator - loader-only page.ts is not declared as exact page route', async () => {
  await withTempProject(async ({ appDir, rootDir, write }) => {
    write('src/app/no-render/page.ts', `
      export async function loader() {
        return { ok: true };
      }
    `);

    const outputPath = path.join(rootDir, 'routes.generated.ts');
    const manifestPath = path.join(rootDir, 'routes.generated.manifest.ts');

    await generateRoutesFile(appDir, outputPath);

    const generatedRoutes = fs.readFileSync(outputPath, 'utf-8');
    const generatedManifest = fs.readFileSync(manifestPath, 'utf-8');
    assert.doesNotMatch(generatedRoutes, /path: '\/no-render'/);
    assert.doesNotMatch(generatedManifest, /pattern: '\/no-render'/);
  });
});

test('Routes generator - htmlPath dependency dirs include paths outside app dir', async () => {
  await withTempProject(async ({ appDir, rootDir, write }) => {
    write('src/app/dashboard/page.ts', `
      export const htmlPath = '@/features/views/dashboard/page.html';
      export function view() {
        const el = document.createElement('div');
        el.textContent = 'dashboard';
        return el;
      }
    `);

    write('src/app/profile/page.ts', `
      export const htmlPath = '@/features/views/profile/page.html';
      export function view() {
        const el = document.createElement('div');
        el.textContent = 'profile';
        return el;
      }
    `);

    write('src/features/views/dashboard/page.html', `<section>dashboard</section>`);
    // Intentionally do not create src/features/views/profile/page.html

    const dependencyDirs = collectHtmlPathDependencyDirs(appDir).map((dir) => path.resolve(dir));
    assert.ok(dependencyDirs.includes(path.resolve(rootDir, 'src/features/views/dashboard')));
    assert.ok(dependencyDirs.includes(path.resolve(rootDir, 'src/features/views/profile')));
  });
});
