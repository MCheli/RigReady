// Runs the app in development on a scenario instead of the real machine:
//
//   npm run dev:scenario -- flying-pedals-unplugged
//
// The app uses fixture-backed providers and a temp data folder; nothing real is touched.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const scenarios = path.join(root, 'fixtures', 'scenarios');
const name = process.argv[2];
const file = name ? path.join(scenarios, `${name}.yaml`) : undefined;

if (!file || !existsSync(file)) {
  const available = readdirSync(scenarios)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => `  ${f.slice(0, -5)}`)
    .join('\n');
  console.error(`Usage: npm run dev:scenario -- <scenario>\n\nScenarios:\n${available}`);
  process.exit(2);
}

const env = { ...process.env, RIGREADY_SCENARIO: file };
delete env.RIGREADY_HOME; // a scenario without RIGREADY_HOME gets its own temp data folder
const cli = path.join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const child = spawn(process.execPath, [cli, 'dev'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
