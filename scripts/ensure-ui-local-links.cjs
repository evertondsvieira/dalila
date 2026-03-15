#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const uiNodeModulesDir = path.join(repoRoot, 'packages', 'dalila-ui', 'node_modules');
const dalilaLinkPath = path.join(uiNodeModulesDir, 'dalila');

function ensureDalilaLink() {
  fs.mkdirSync(uiNodeModulesDir, { recursive: true });

  if (fs.existsSync(dalilaLinkPath)) {
    try {
      if (fs.realpathSync(dalilaLinkPath) === repoRoot) {
        return;
      }
    } catch {
      // Fall through and try to recreate the local link.
    }

    fs.rmSync(dalilaLinkPath, { recursive: true, force: true });
  }

  const target = process.platform === 'win32'
    ? repoRoot
    : path.relative(uiNodeModulesDir, repoRoot);
  const type = process.platform === 'win32' ? 'junction' : 'dir';

  fs.symlinkSync(target, dalilaLinkPath, type);
}

try {
  ensureDalilaLink();
} catch (error) {
  console.warn('[ensure-ui-local-links] Failed to link dalila into packages/dalila-ui/node_modules:', error);
}
