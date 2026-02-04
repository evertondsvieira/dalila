#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const cliPath = path.join(__dirname, '..', 'dist', 'cli', 'index.js');

if (fs.existsSync(cliPath)) {
  try {
    fs.chmodSync(cliPath, 0o755);
  } catch {
    // Ignore chmod errors on filesystems that don't expose POSIX modes.
  }
}
