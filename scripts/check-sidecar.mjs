// Refuses to package an app whose input sidecar would not work.
// The 1.x releases shipped without the Python runtime; this makes that impossible.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const python = path.join(root, 'resources', 'python', 'python.exe');
const script = path.join(root, 'python', 'input_server.py');

const fail = (message) => {
  console.error(`sidecar check failed: ${message}`);
  console.error('Run "npm run setup:python" and try again.');
  process.exit(1);
};

if (!existsSync(script)) fail(`${script} is missing`);
if (!existsSync(python)) fail(`${python} is missing`);
const probe = spawnSync(python, ['-c', 'import pygame; print(pygame.version.ver)'], {
  encoding: 'utf8',
  env: { ...process.env, PYGAME_HIDE_SUPPORT_PROMPT: '1' },
});
if (probe.status !== 0) fail(`pygame does not import: ${probe.stderr.trim()}`);
console.log(`sidecar check: python runtime with pygame ${probe.stdout.trim()} is in place`);
