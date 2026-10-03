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
// The sidecar uses only the standard library; ctypes is what reaches DirectInput.
const probe = spawnSync(
  python,
  ['-c', 'import ctypes, json, uuid, sys; print(sys.version.split()[0])'],
  {
    encoding: 'utf8',
  }
);
if (probe.status !== 0) fail(`the Python runtime does not start: ${probe.stderr.trim()}`);
console.log(`sidecar check: Python ${probe.stdout.trim()} runtime is in place`);
