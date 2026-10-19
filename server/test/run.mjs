#!/usr/bin/env node
/**
 * Cross-platform test entry point.
 *
 * `node --test test/*.test.js` relies on the *shell* to expand the glob: cmd.exe
 * and PowerShell do not, so the same command failed on Windows. `node --test
 * test/` would run every file in the directory, including helpers. This runner
 * enumerates `*.test.js` itself and hands explicit paths to the test runner, so
 * the behaviour is identical on Node 20 and 22, on every OS, and new test files
 * are picked up automatically.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => path.join(here, name));

if (!files.length) {
  console.error('no *.test.js files found in server/test');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...files, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error('failed to start the test runner:', error.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
