/**
 * npm run test:e2e:changed: the scenario test files that what you changed can reach.
 *
 * `npm run check` runs no scenario test, and the build server needs a quarter of an hour to
 * say that one broke. This builds the app and runs the scenario files picked from the files
 * that differ from the base branch (committed or not, and new files too), after saying
 * which and why. The rules are in scripts/lib/scenarioPick.ts.
 *
 *   npm run test:e2e:changed                    against origin/main
 *   npm run test:e2e:changed -- --list          say what would run, and run nothing
 *   npm run test:e2e:changed -- --base=main     against another branch or commit
 *   npm run test:e2e:changed -- --no-build      the app in out/ is already this code
 *   npm run test:e2e:changed -- --workers=1     anything else goes to Playwright as it is
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describePick, pickScenarioFiles, readWorld } from './lib/scenarioPick';

const root = path.resolve(import.meta.dirname, '..');

function fail(message: string): never {
  console.error(`test:e2e:changed: ${message}`);
  process.exit(1);
}

/** The lines git prints, or undefined when git says no. */
function git(args: string[]): string[] | undefined {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  return result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
}

function run(script: string, args: string[]): void {
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules', script), ...args], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const args = process.argv.slice(2);
const base =
  args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length) ?? 'origin/main';
const passed = args.filter(
  (arg) => arg !== '--list' && arg !== '--no-build' && !arg.startsWith('--base=')
);

// What this branch changed: from where it left the base, to the files as they are now.
const fork = git(['merge-base', base, 'HEAD'])?.[0];
if (!fork) fail(`"${base}" is not a branch or commit git knows here. Name one with --base=.`);
const changed = [
  ...(git(['diff', '--name-only', fork]) ?? fail('git could not list what changed.')),
  ...(git(['ls-files', '--others', '--exclude-standard']) ?? []),
];

const world = readWorld(root);
const picked = pickScenarioFiles(changed, world);
for (const line of describePick(picked, Object.keys(world.specs).length, base)) console.log(line);

if (args.includes('--list') || picked.specs.length === 0) process.exit(0);
if (!args.includes('--no-build')) {
  run(path.join('electron-vite', 'bin', 'electron-vite.js'), ['build']);
}
run(path.join('@playwright', 'test', 'cli.js'), [
  'test',
  // With no file named Playwright runs them all, which is what "all" means.
  ...(picked.all ? [] : picked.specs.map((spec) => spec.file)),
  ...passed,
]);
