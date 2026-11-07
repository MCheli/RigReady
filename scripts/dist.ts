/**
 * npm run dist: builds the installer in release/ with electron-builder, signed when the
 * signing configuration is in the environment and unsigned when none of it is
 * (scripts/lib/signing.ts; docs/RELEASING.md, "Code signing"). Nothing is published:
 * electron-builder runs with --publish never, and only the Release workflow uploads files.
 *
 * The configuration electron-builder is given is package.json's `build` with the signing
 * decision applied, written to release/electron-builder.config.json so a build can be read
 * back. After the build, the feed file inside the package is checked: a signed build names
 * the publisher the installed app will verify updates against, an unsigned build names none.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import {
  appUpdateProblem,
  applySigning,
  describeSigning,
  signingFromEnv,
  type BuildConfig,
  type SigningDecision,
} from './lib/signing';

const root = path.resolve(import.meta.dirname, '..');

const fail = (message: string): never => {
  console.error(`dist: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  build: BuildConfig & { productName: string };
};

let decision: SigningDecision;
try {
  decision = signingFromEnv(process.env);
} catch (e) {
  decision = fail(e instanceof Error ? e.message : String(e));
}
console.log(describeSigning(decision));

const outDir = path.join(root, 'release');
mkdirSync(outDir, { recursive: true });
const configFile = path.join(outDir, 'electron-builder.config.json');
writeFileSync(configFile, `${JSON.stringify(applySigning(pkg.build, decision), null, 2)}\n`);

const cli = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const result = spawnSync(
  process.execPath,
  [cli, '--win', '--publish', 'never', '--config', configFile],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0) fail(`electron-builder exited with ${result.status ?? result.signal}`);

const installer = path.join(outDir, `${pkg.build.productName}-Setup-${pkg.version}.exe`);
if (!existsSync(installer)) fail(`${installer} was not produced`);

const feedFile = path.join(outDir, 'win-unpacked', 'resources', 'app-update.yml');
if (!existsSync(feedFile)) fail(`${feedFile} was not produced`);
const problem = appUpdateProblem(yaml.load(readFileSync(feedFile, 'utf8')), decision);
if (problem) fail(problem);

console.log(`dist: ${path.relative(root, installer)}, ${describeSigning(decision)}`);
