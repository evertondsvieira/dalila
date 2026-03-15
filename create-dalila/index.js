#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const projectName = args.find((arg) => !arg.startsWith('-'));
const forceUi = args.includes('--ui');
const forceNoUi = args.includes('--no-ui');

// Colors for terminal
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const MIN_NODE = { major: 22, minor: 6, patch: 0 };

function printHelp() {
  console.log(`
${bold('create-dalila')} - Create a new Dalila project

${bold('Usage:')}
  npm create dalila ${cyan('<project-name>')}
  npx create-dalila ${cyan('<project-name>')}

${bold('Examples:')}
  npm create dalila my-app
  npx create-dalila todo-app

${bold('Options:')}
  -h, --help     Show this help message
  -v, --version  Show version
  --ui           Include dalila-ui starter assets
  --no-ui        Generate the starter without dalila-ui
`);
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function parseNodeVersion(version) {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
  };
}

function ensureSupportedNode() {
  const current = parseNodeVersion(process.versions.node);
  if (compareVersions(current, MIN_NODE) >= 0) return;

  console.error(
    `${yellow('Error:')} Node.js ${MIN_NODE.major}.${MIN_NODE.minor}.${MIN_NODE.patch}+ is required to create and run Dalila apps.\n`
  );
  console.error(`Current version: ${process.versions.node}`);
  console.error('Please upgrade Node.js and try again.\n');
  process.exit(1);
}

function suggestPackageName(input) {
  return (input || 'my-app')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._~-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[._-]+/, '')
    .replace(/[._-]+$/, '') || 'my-app';
}

function validateProjectName(name) {
  const trimmed = name.trim();
  const errors = [];

  if (trimmed.length === 0) {
    errors.push('Project name cannot be empty.');
  }
  if (trimmed !== name) {
    errors.push('Project name cannot start or end with spaces.');
  }
  if (trimmed.length > 214) {
    errors.push('Project name must be 214 characters or fewer.');
  }
  if (trimmed.includes('/')) {
    errors.push('Use an unscoped package name (e.g. "my-app").');
  }
  if (/[A-Z]/.test(trimmed)) {
    errors.push('Project name must be lowercase.');
  }
  if (trimmed.startsWith('.') || trimmed.startsWith('_')) {
    errors.push('Project name cannot start with "." or "_".');
  }
  if (!/^[a-z0-9][a-z0-9._~-]*$/.test(trimmed)) {
    errors.push('Use only lowercase letters, numbers, ".", "_", "~", and "-".');
  }
  if (trimmed === 'node_modules' || trimmed === 'favicon.ico') {
    errors.push(`"${trimmed}" is not a valid package name.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    suggested: suggestPackageName(trimmed),
  };
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function updatePackageJson(projectPath, projectName) {
  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.name = projectName;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function updateTemplatePlaceholders(projectPath, projectName) {
  const trustedTypesPolicyName = `${projectName}-html`;
  const mainPath = path.join(projectPath, 'src', 'main.ts');
  const source = fs.readFileSync(mainPath, 'utf8');
  fs.writeFileSync(
    mainPath,
    source.replaceAll('__DALILA_TRUSTED_TYPES_POLICY__', trustedTypesPolicyName)
  );
}

function stripUiFromPackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies && typeof pkg.dependencies === 'object') {
    delete pkg.dependencies['dalila-ui'];
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

function applyHeadlessStarter(projectPath) {
  stripUiFromPackageJson(projectPath);

  const uiDir = path.join(projectPath, 'src', 'components', 'ui');
  if (fs.existsSync(uiDir)) {
    fs.rmSync(uiDir, { recursive: true, force: true });
  }

  fs.writeFileSync(
    path.join(projectPath, 'src', 'style.css'),
    [
      '* {',
      '  box-sizing: border-box;',
      '  margin: 0;',
      '  padding: 0;',
      '}',
      '',
      ':root {',
      '  --bg: #f5f7fb;',
      '  --surface: #ffffff;',
      '  --text: #1f2937;',
      '  --muted: #5f6b7c;',
      '  --border: #dce2eb;',
      '  --primary: #1d4ed8;',
      '  --primary-hover: #1e40af;',
      '}',
      '',
      'body {',
      '  margin: 0;',
      '  min-height: 100vh;',
      '  background: radial-gradient(circle at top right, #dbeafe 0%, var(--bg) 48%);',
      '  color: var(--text);',
      '  font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;',
      '}',
      '',
      '#app {',
      '  max-width: 760px;',
      '  margin: 0 auto;',
      '  padding: 2rem 1rem 3rem;',
      '}',
      '',
      '.app-shell {',
      '  display: grid;',
      '  gap: 1rem;',
      '}',
      '',
      '.app-header {',
      '  background: var(--surface);',
      '  border: 1px solid var(--border);',
      '  border-radius: 14px;',
      '  padding: 1rem 1.25rem;',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 1rem;',
      '}',
      '',
      '.app-header h1 {',
      '  font-size: 1.2rem;',
      '}',
      '',
      '.app-header p {',
      '  color: var(--muted);',
      '  font-size: 0.9rem;',
      '}',
      '',
      '.app-nav {',
      '  display: flex;',
      '  gap: 0.5rem;',
      '}',
      '',
      '.app-nav a {',
      '  text-decoration: none;',
      '  color: var(--primary);',
      '  font-weight: 600;',
      '  padding: 0.45rem 0.7rem;',
      '  border-radius: 8px;',
      '}',
      '',
      '.app-nav a:hover {',
      '  background: #eff6ff;',
      '  color: var(--primary-hover);',
      '}',
      '',
      '.app-main {',
      '  display: grid;',
      '  gap: 1rem;',
      '}',
      '',
      '.card {',
      '  background: var(--surface);',
      '  border: 1px solid var(--border);',
      '  border-radius: 14px;',
      '  padding: 1.2rem;',
      '}',
      '',
      '.card h2 {',
      '  margin-bottom: 0.5rem;',
      '}',
      '',
      '.card p {',
      '  color: var(--muted);',
      '  margin-top: 0.4rem;',
      '}',
      '',
      '.buttons {',
      '  margin-top: 1rem;',
      '  display: flex;',
      '  gap: 0.75rem;',
      '}',
      '',
      'button {',
      '  border: none;',
      '  border-radius: 10px;',
      '  padding: 0.6rem 1rem;',
      '  min-width: 3rem;',
      '  background: var(--primary);',
      '  color: #ffffff;',
      '  font-size: 1.1rem;',
      '  cursor: pointer;',
      '}',
      '',
      'button:hover {',
      '  background: var(--primary-hover);',
      '}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(projectPath, 'src', 'app', 'layout.html'),
    [
      '<div class="app-shell">',
      '  <header class="app-header">',
      '    <div>',
      '      <h1>Dalila Router App</h1>',
      '      <p>File-based routing starter template</p>',
      '    </div>',
      '    <nav class="app-nav">',
      '      <a d-link href="/">Home</a>',
      '      <a d-link href="/about">About</a>',
      '    </nav>',
      '  </header>',
      '',
      '  <main class="app-main" data-slot="children"></main>',
      '</div>',
      '',
    ].join('\n')
  );
}

async function resolveUiPreference() {
  if (forceUi && forceNoUi) {
    console.error(`${yellow('Error:')} Use only one of --ui or --no-ui.\n`);
    process.exit(1);
  }

  if (forceUi) return true;
  if (forceNoUi) return false;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question('Include dalila-ui starter styles and assets? [Y/n] ');
    const normalized = answer.trim().toLowerCase();
    if (normalized === '' || normalized === 'y' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'n' || normalized === 'no') {
      return false;
    }
    return true;
  } finally {
    rl.close();
  }
}

async function main() {
  ensureSupportedNode();

  // Handle flags
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  if (args.includes('-v') || args.includes('--version')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    console.log(pkg.version);
    process.exit(0);
  }

  // Validate project name
  if (!projectName) {
    console.error(`${yellow('Error:')} Please specify the project name:\n`);
    console.log(`  npm create dalila ${cyan('<project-name>')}\n`);
    console.log('For example:');
    console.log(`  npm create dalila ${cyan('my-app')}\n`);
    process.exit(1);
  }

  const validation = validateProjectName(projectName);
  if (!validation.valid) {
    console.error(`${yellow('Error:')} Invalid project name "${projectName}".\n`);
    for (const error of validation.errors) {
      console.error(`- ${error}`);
    }
    console.error('\nTry something like:');
    console.error(`  npm create dalila ${cyan(validation.suggested)}\n`);
    process.exit(1);
  }

  // Check if directory exists
  const projectPath = path.resolve(process.cwd(), projectName);

  if (fs.existsSync(projectPath)) {
    console.error(`${yellow('Error:')} Directory "${projectName}" already exists.\n`);
    process.exit(1);
  }

  console.log();
  console.log(`Creating ${bold(projectName)}...`);
  console.log();

  // Copy template
  const templatePath = path.join(__dirname, 'template');
  copyDir(templatePath, projectPath);

  // Update package.json with project name
  updatePackageJson(projectPath, projectName);
  updateTemplatePlaceholders(projectPath, projectName);
  const includeUi = await resolveUiPreference();
  if (!includeUi) {
    applyHeadlessStarter(projectPath);
  }

  // Success message
  console.log(`${green('Done!')} Created ${bold(projectName)}\n`);
  console.log('Next steps:\n');
  console.log(`  ${cyan('cd')} ${projectName}`);
  console.log(`  ${cyan('npm install')}  ${green('(routes will be generated automatically)')}`);
  console.log(`  ${cyan('npm run dev')}`);
  console.log();
  console.log(`Open ${cyan('http://localhost:4242')} to see your app.`);
  console.log();
  console.log(`Starter UI: ${cyan(includeUi ? 'dalila-ui included' : 'headless starter')}`);
  console.log();
  console.log('When you update files in src/app, regenerate routes with:');
  console.log(`  ${cyan('npm run routes')}`);
  console.log();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
