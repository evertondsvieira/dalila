import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
