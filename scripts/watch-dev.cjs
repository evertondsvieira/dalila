#!/usr/bin/env node

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const tscBin = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const ensureUiLocalLinksScript = path.join(repoRoot, 'scripts', 'ensure-ui-local-links.cjs');

const watchTargets = [
  {
    label: 'dalila',
    args: [tscBin, '--watch'],
  },
  {
    label: 'dalila-ui',
    args: [tscBin, '--watch', '-p', path.join('packages', 'dalila-ui', 'tsconfig.json')],
  },
];

const children = new Set();
let shuttingDown = false;
let exitCode = 0;

function spawnWatcher(target) {
  const child = spawn(process.execPath, target.args, {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    children.delete(child);

    if (shuttingDown) {
      return;
    }

    if (signal || (typeof code === 'number' && code !== 0)) {
      exitCode = typeof code === 'number' ? code : 1;
      shutdown();
      return;
    }

    console.error(`[watch-dev] ${target.label} watcher exited unexpectedly.`);
    exitCode = 1;
    shutdown();
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }

    console.error(`[watch-dev] Failed to start ${target.label} watcher:`, error);
    exitCode = 1;
    shutdown();
  });

  children.add(child);
}

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill(signal);
    } catch {
      // Ignore child shutdown failures.
    }
  }

  if (children.size === 0) {
    process.exit(exitCode);
    return;
  }

  const poll = setInterval(() => {
    if (children.size === 0) {
      clearInterval(poll);
      process.exit(exitCode);
    }
  }, 50);

  poll.unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const ensureLinks = spawnSync(process.execPath, [ensureUiLocalLinksScript], {
  cwd: repoRoot,
  stdio: 'inherit',
});

if (ensureLinks.status !== 0) {
  process.exit(ensureLinks.status ?? 1);
}

for (const target of watchTargets) {
  spawnWatcher(target);
}
