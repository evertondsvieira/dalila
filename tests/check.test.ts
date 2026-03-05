import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runCheck } from '../dist/cli/check.js';
import { runSecuritySmokeChecks } from '../dist/cli/security-smoke.js';

function withTempProject(run) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dalila-check-'));
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'tmp', private: true }, null, 2)
  );
  fs.writeFileSync(
    path.join(rootDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: './dist',
          rootDir: '.',
        },
        include: ['src/**/*'],
      },
      null,
      2
    )
  );

  const appDir = path.join(rootDir, 'src', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  const write = (relativePath, content) => {
    const absolutePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    return absolutePath;
  };

  // Capture console output
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => logs.push(args.join(' '));

  return Promise.resolve()
    .then(() => run({ rootDir, appDir, write, logs }))
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
      fs.rmSync(rootDir, { recursive: true, force: true });
    });
}

// 1. Valid template → exit code 0
test('Check - valid template with loader returns exit code 0', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { count: 42, items: [] }; }`
    );
    write('src/app/page.html', `<div><p>{count}</p><ul d-each="items"><li>{item}</li></ul></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 2. Invalid identifier → exit code 1 with diagnostic
test('Check - invalid identifier reports error and exits 1', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { count: 42 }; }`
    );
    write('src/app/page.html', `<div><p>{cont}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"cont" is not defined in template context/);
  });
});

// 3. Builtins (path, query, params, fullPath) always valid
test('Check - builtins are always valid without loader', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.html',
      `<div>
  <p>{path}</p>
  <p>{query}</p>
  <p>{params}</p>
  <p>{fullPath}</p>
</div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 4. Route params ([id] → {id}) are valid
test('Check - route params from dynamic segments are valid', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/users/[id]/page.html', `<div><p>{id}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 5. Loop vars ($index, $count) valid within template that has d-each
test('Check - loop vars are valid when d-each is present', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [] }; }`
    );
    write(
      'src/app/page.html',
      `<div>
  <ul d-each="items">
    <li>{item} - {$index} of {$count}</li>
  </ul>
</div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 6. Loop vars outside loop scope should fail
test('Check - loop vars outside d-each scope are invalid', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [] }; }`
    );
    write(
      'src/app/page.html',
      `<div>{item}</div><ul d-each="items"><li>{item}</li></ul>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"item" is not defined in template context/);
  });
});

// 7. Callback-local params should not be reported
test('Check - callback-local identifiers are ignored in directives', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [{ active: true }] }; }`
    );
    write('src/app/page.html', `<div d-if="items.some(item => item.active)">ok</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 8. Did-you-mean suggestion works
test('Check - did-you-mean suggestion is shown for typos', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { count: 0, fetchMore: () => {} }; }`
    );
    write('src/app/page.html', `<div><p>{cont}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Did you mean "count"/);
  });
});

// 9. Page without loader → only builtins valid
test('Check - page without loader only allows builtins', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<div><p>{unknownVar}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"unknownVar" is not defined in template context/);
  });
});

// 10. d-on-click with typo → error
test('Check - d-on-click with typo reports error', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { fetchMore: () => {} }; }`
    );
    write(
      'src/app/page.html',
      `<div><button d-on-click="fetcMore">Load</button></div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"fetcMore" is not defined in template context \(d-on-click\)/);
    assert.match(output, /Did you mean "fetchMore"/);
  });
});

// 11. htmlPath external template is checked
test('Check - htmlPath external template is validated', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/dashboard/page.ts',
      [
        `export const htmlPath = '@/views/dashboard.html';`,
        `export function view() { return document.createElement('div'); }`,
        `export async function loader() { return { stats: {} }; }`,
      ].join('\n')
    );
    write(
      'src/views/dashboard.html',
      `<div><p>{statz}</p></div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"statz" is not defined in template context/);
    assert.match(output, /Did you mean "stats"/);
  });
});

// 12. loader exported as const is detected
test('Check - export const loader is detected for template context', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export const loader = async () => ({ count: 42 });`
    );
    write('src/app/page.html', `<div><p>{count}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 13. loader exported from export-list is detected
test('Check - export { loader } form is detected for template context', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      [
        `const loader = async () => ({ count: 42 });`,
        `export { loader };`,
      ].join('\n')
    );
    write('src/app/page.html', `<div><p>{count}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 14. loader re-export is detected
test('Check - re-exported loader is detected for template context', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/data.ts', `export const loader = async () => ({ count: 42 });`);
    write('src/app/page.ts', `export { loader } from './data';`);
    write('src/app/page.html', `<div><p>{count}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 15. strict mode fails when exported loader cannot be inferred
test('Check - strict mode reports unanalyzable loader export', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export const loader = 123;`);
    write('src/app/page.html', `<div><p>{path}</p></div>`);

    const exitCode = await runCheck(appDir, { strict: true });
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Strict mode/);
    assert.match(output, /exports "loader", but its return type could not be inferred/);
  });
});

// 16. single-quoted directives are validated
test('Check - single-quoted directive expressions are parsed', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { fetchMore: () => {} }; }`
    );
    write('src/app/page.html', `<button d-on-click='fetcMore'>Load</button>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"fetcMore" is not defined in template context \(d-on-click\)/);
  });
});

// 17. multi-line interpolations are validated
test('Check - multi-line interpolation expressions are parsed', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { count: 42 }; }`
    );
    write(
      'src/app/page.html',
      `<div>{
  cont
}</div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"cont" is not defined in template context \(interpolation\)/);
  });
});

// 18. item-scope identifiers are valid inside d-each blocks
test('Check - item field identifiers are allowed inside loop scope', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [{ name: 'A' }] }; }`
    );
    write('src/app/page.html', `<ul d-each="items"><li>{name}</li></ul>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 19. single-quoted d-each contributes loop scope
test('Check - single-quoted d-each enables loop-only identifiers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [] }; }`
    );
    write('src/app/page.html', `<ul d-each='items'><li>{item} {$index}</li></ul>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 20. typo in d-each source expression is still reported
test('Check - d-each source expression keeps undefined checks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [] }; }`
    );
    write('src/app/page.html', `<ul d-each="itms"><li>{name}</li></ul>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"itms" is not defined in template context \(d-each\)/);
  });
});

// 21. non-strict mode ignores identifiers when loader return is primitive
test('Check - non-strict skips primitive loader return template identifiers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return 123; }`);
    write('src/app/page.html', `<div>{toFixed}</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 22. strict mode flags non-object loader return as uninferable
test('Check - strict mode reports primitive loader return as uninferable', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return 123; }`);
    write('src/app/page.html', `<div>{path}</div>`);

    const exitCode = await runCheck(appDir, { strict: true });
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Strict mode/);
    assert.match(output, /exports "loader", but its return type could not be inferred/);
  });
});

// 23. non-strict mode ignores identifiers when loader return is array
test('Check - non-strict skips array loader return template identifiers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return [1, 2, 3]; }`);
    write('src/app/page.html', `<div>{map}</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 24. braces inside string literals do not break interpolation scanning
test('Check - interpolation with brace in string still validates identifiers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { a: 'ok' }; }`
    );
    write('src/app/page.html', `<div>{a === '}' ? missing : a}</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"missing" is not defined in template context \(interpolation\)/);
  });
});

// 25. virtual-each sizing directives are validated
test('Check - virtual directives participate in identifier checks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [], height: 240, loadMore: () => {} }; }`
    );
    write(
      'src/app/page.html',
      `<ul d-virtual-each="items" d-virtual-height="heigt" d-virtual-infinite="lodMore"><li>{item}</li></ul>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"heigt" is not defined in template context \(d-virtual-height\)/);
    assert.match(output, /"lodMore" is not defined in template context \(d-virtual-infinite\)/);
  });
});

test('Check - d-virtual-measure="auto" is treated as valid literal', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [] }; }`
    );
    write(
      'src/app/page.html',
      `<ul d-virtual-each="items" d-virtual-measure="auto"><li>{item}</li></ul>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 26. d-bind directives participate in identifier checks
test('Check - d-bind directives participate in identifier checks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { name: 'Ana', parseName: (v: string) => v.trim() }; }`
    );
    write(
      'src/app/page.html',
      `<input d-bind-value="naem" d-bind-parse="parseName" />`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"naem" is not defined in template context \(d-bind-value\)/);
  });
});

test('Check - d-portal expressions participate in identifier checks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { showModal: true }; }`
    );
    write(
      'src/app/page.html',
      `<div d-portal="showModa ? '#modal-root' : null">Modal</div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"showModa" is not defined in template context \(d-portal\)/);
  });
});

// 26. non-strict mode skips template var errors when loader shape is not inferable
test('Check - non-strict ignores template identifiers for non-inferable loader types', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader(): Promise<any> { return { count: 42 }; }`
    );
    write('src/app/page.html', `<div><p>{count}</p><p>{unknownFromAny}</p></div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 27. strict mode still fails for non-inferable loader types
test('Check - strict flags Promise<any> loader return as non-inferable', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader(): Promise<any> { return { count: 42 }; }`
    );
    write('src/app/page.html', `<div><p>{count}</p></div>`);

    const exitCode = await runCheck(appDir, { strict: true });
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Strict mode/);
    assert.match(output, /exports "loader", but its return type could not be inferred/);
  });
});

// 28. object literal keys are not treated as required root identifiers
test('Check - object literal property keys are ignored in identifier checks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { value: 1 }; }`
    );
    write('src/app/page.html', `<div>{({ foo: value })}</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 29. destructuring aliases only register bound local names
test('Check - destructuring alias does not hide undefined identifiers in callbacks', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [{ id: 1 }] }; }`
    );
    write(
      'src/app/page.html',
      `<div d-if="items.some(({ id: userId }) => id > 0)"></div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"id" is not defined in template context \(d-if\)/);
  });
});

// 30. identifiers inside template literal interpolations are validated
test('Check - template literal ${...} expressions are validated', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { userName: 'Ada' }; }`
    );
    write('src/app/page.html', `<div>{\`hello \${userNmae}\`}</div>`);

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"userNmae" is not defined in template context \(interpolation\)/);
  });
});

// 31. loop scope parsing handles ">" inside quoted attribute values
test('Check - d-each with arrow expression still creates loop scope', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [{ active: true }] }; }`
    );
    write(
      'src/app/page.html',
      `<ul d-each="items.filter(i => i.active)"><li>{item}</li></ul>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 32. quoted > inside attributes does not break text interpolation boundaries
test('Check - braces in directive attribute values are not parsed as text interpolation', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { items: [1], ok: true }; }`
    );
    write(
      'src/app/page.html',
      `<div d-if="items.some(i => ({ ok: i > 0 }))">{ok}</div>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 33. d-pre blocks are ignored by template identifier checks
test('Check - d-pre ignores interpolation and directives in subtree', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { ok: true }; }`
    );
    write(
      'src/app/page.html',
      `<div d-pre><button d-on-click="missingHandler">x</button><p>{missingValue}</p></div><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 34. pre/code raw text blocks are ignored by identifier checks
test('Check - pre/code interpolation is ignored', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { label: 'ok', click: () => {} }; }`
    );
    write(
      'src/app/page.html',
      `<pre><code><button d-on-click="click">x</button> {alsoMissing}</code></pre><p>{label}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 34b. directives in pre/code must still be validated like runtime bind()
test('Check - pre/code directives are validated', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { label: 'ok' }; }`
    );
    write(
      'src/app/page.html',
      `<pre><button d-on-click="missingHandler">x</button></pre><p>{label}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"missingHandler" is not defined in template context \(d-on-click\)/);
  });
});

// 35. d-raw alias blocks are ignored by template identifier checks
test('Check - d-raw ignores interpolation and directives in subtree', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { ok: true }; }`
    );
    write(
      'src/app/page.html',
      `<section d-raw><button d-on-click="missingHandler">x</button><p>{missingValue}</p></section><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 36. <d-pre> custom tag blocks are ignored by template identifier checks
test('Check - <d-pre> tag ignores interpolation and directives in subtree', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { ok: true }; }`
    );
    write(
      'src/app/page.html',
      `<d-pre><button d-on-click="missingHandler">x</button><p>{missingValue}</p></d-pre><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 37. "d-pre" text inside normal attribute values must not create raw blocks
test('Check - d-pre token inside quoted attribute value does not suppress diagnostics', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write(
      'src/app/page.ts',
      `export async function loader() { return { ok: true }; }`
    );
    write(
      'src/app/page.html',
      `<div title="example d-pre token"><p>{missingValue}</p></div><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"missingValue" is not defined in template context \(interpolation\)/);
  });
});

// 38. <pre> literals inside script/style text must not create raw ranges
test('Check - script/style text literals do not suppress later interpolation diagnostics', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return { ok: true }; }`);
    write(
      'src/app/page.html',
      `<script>const tpl = '<pre>demo</pre><d-pre>x</d-pre>';</script><style>.x::before{content:"<pre>";}</style><p>{missingAfterScript}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"missingAfterScript" is not defined in template context \(interpolation\)/);
  });
});

// 39. d-pre marker before "/>" must be parsed as attribute name (not "d-pre/")
test('Check - d-pre boolean attribute before /> still creates raw range', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return { ok: true }; }`);
    write(
      'src/app/page.html',
      `<div d-pre/><p>{missingInsideRaw}</p><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 40. Non-void raw tags with "/>" are treated as open tags by HTML parser
test('Check - <d-pre/> and <d-raw/> stay open and suppress diagnostics in following subtree', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return { ok: true }; }`);
    write(
      'src/app/page.html',
      `<d-pre/><p>{missingInsideDPre}</p></d-pre><d-raw/><p>{missingInsideDRaw}</p></d-raw><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 0, `Expected exit 0 but got ${exitCode}. Logs:\n${logs.join('\n')}`);
  });
});

// 41. Void elements are self-closing even without "/>" and must not swallow siblings
test('Check - void tag with d-pre does not suppress diagnostics after the tag', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.ts', `export async function loader() { return { ok: true }; }`);
    write(
      'src/app/page.html',
      `<img d-pre><p>{missingAfterImg}</p><p>{ok}</p>`
    );

    const exitCode = await runCheck(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /"missingAfterImg" is not defined in template context \(interpolation\)/);
  });
});

test('Security smoke - inline event handlers fail automatically', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<button onclick="alert(1)">boom</button>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Dalila Security Smoke/);
    assert.match(output, /Inline event handler found in template/);
  });
});

test('Security smoke - d-html is reported as warning without failing the run', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<div d-html="content"></div>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 0);

    const output = logs.join('\n');
    assert.match(output, /d-html renders raw HTML/);
    assert.match(output, /warning/);
  });
});

test('Security smoke - scans project src when pointed at src root', async () => {
  await withTempProject(async ({ rootDir, appDir, write, logs }) => {
    write('src/main.ts', `document.body.innerHTML = userHtml;`);
    write('src/app/page.html', `<div>ok</div>`);

    const exitCode = await runSecuritySmokeChecks(path.join(rootDir, 'src'));
    assert.equal(exitCode, 0);

    const output = logs.join('\n');
    assert.match(output, /src\/main\.ts|src\\main\.ts/);
    assert.match(output, /Raw HTML sink assignment found in source/);
  });
});

test('Security smoke - respects appDir scope and ignores sibling files', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/main.ts', `document.body.innerHTML = userHtml;`);
    write('src/app/page.html', `<div>ok</div>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 0);

    const output = logs.join('\n');
    assert.doesNotMatch(output, /src\/main\.ts|src\\main\.ts/);
    assert.match(output, /No dangerous template patterns found/);
  });
});

test('Security smoke - custom attributes starting with on do not fail as inline handlers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<my-card onboarding="flow-1"></my-card>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 0);

    const output = logs.join('\n');
    assert.doesNotMatch(output, /Inline event handler found in template/);
    assert.match(output, /No dangerous template patterns found/);
  });
});

test('Security smoke - on*= inside quoted attribute values does not fail as inline handler', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<div data-tooltip="onclick=copy"></div>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 0);

    const output = logs.join('\n');
    assert.doesNotMatch(output, /Inline event handler found in template/);
    assert.match(output, /No dangerous template patterns found/);
  });
});

test('Security smoke - SVG SMIL inline handlers fail automatically', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<svg><animate onbegin="alert(1)"></animate></svg>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Inline event handler found in template/);
  });
});

test('Security smoke - quoted > does not hide later inline handlers', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<div title="1 > 0" onclick="alert(1)"></div>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Inline event handler found in template/);
  });
});

test('Security smoke - quoted > does not hide later dangerous URLs', async () => {
  await withTempProject(async ({ appDir, write, logs }) => {
    write('src/app/page.html', `<a title="1 > 0" href="javascript:alert(1)">x</a>`);

    const exitCode = await runSecuritySmokeChecks(appDir);
    assert.equal(exitCode, 1);

    const output = logs.join('\n');
    assert.match(output, /Executable javascript: URL found in template sink/);
  });
});
