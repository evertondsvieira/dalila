#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const DEFAULT_TEST_GLOB = 'tests/**/*.test.ts';
const NODE_TEST_ARGS = [
  '--experimental-strip-types',
  '--test',
  '--test-concurrency=1',
];

const FORWARDED_VALUE_OPTIONS = new Set([
  '--test-name-pattern',
  '--test-skip-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-shard',
  '--watch-path',
  '--test-timeout',
]);

function hasExplicitTestSelector(args) {
  let expectingValue = false;

  for (const arg of args) {
    if (expectingValue) {
      expectingValue = false;
      continue;
    }

    if (arg === '--') {
      return true;
    }

    if (FORWARDED_VALUE_OPTIONS.has(arg)) {
      expectingValue = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      const optionName = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
      if (FORWARDED_VALUE_OPTIONS.has(optionName)) {
        continue;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    return true;
  }

  return false;
}

const forwardedArgs = process.argv.slice(2);
const finalArgs = hasExplicitTestSelector(forwardedArgs)
  ? [...NODE_TEST_ARGS, ...forwardedArgs]
  : [...NODE_TEST_ARGS, DEFAULT_TEST_GLOB, ...forwardedArgs];

const result = spawnSync(process.execPath, finalArgs, { stdio: 'inherit' });

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
