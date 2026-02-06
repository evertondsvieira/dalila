import { spawn } from 'node:child_process';

const procs = [];

function run(cmd, args) {
  const proc = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
  });

  procs.push(proc);

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
  });

  return proc;
}

run('dalila', ['routes', 'watch']);
run('dalila-dev', []);

function shutdown() {
  for (const proc of procs) {
    proc.kill('SIGINT');
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
