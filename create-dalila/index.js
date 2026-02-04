#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const projectName = args[0];

// Colors for terminal
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;
const yellow = (text) => `\x1b[33m${text}\x1b[0m`;
const bold = (text) => `\x1b[1m${text}\x1b[0m`;

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
`);
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

function main() {
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

  // Success message
  console.log(`${green('Done!')} Created ${bold(projectName)}\n`);
  console.log('Next steps:\n');
  console.log(`  ${cyan('cd')} ${projectName}`);
  console.log(`  ${cyan('npm install')}`);
  console.log(`  ${cyan('npm run dev')}`);
  console.log();
  console.log('When you update files in src/app, regenerate routes with:');
  console.log(`  ${cyan('npm run routes')}`);
  console.log();
  console.log(`Open ${cyan('http://localhost:4242')} to see your app.`);
  console.log();
}

main();
