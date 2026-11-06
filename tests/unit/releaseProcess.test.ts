import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { SIGNING_NAMES, SIGNING_SECRETS, SIGNING_VARIABLES } from '../../scripts/lib/signing';
import { repoRoot } from '../helpers';

/** How RigReady is built, checked and released: the workflows, the build scripts, the checklist. */

interface Step {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  shell?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}
interface Workflow {
  jobs: Record<
    string,
    { 'runs-on': string; needs?: string; steps: Step[]; 'continue-on-error'?: boolean }
  >;
}

const read = (...parts: string[]): Promise<string> =>
  fs.readFile(path.join(repoRoot, ...parts), 'utf8');
const workflow = async (name: string): Promise<Workflow> =>
  yaml.load(await read('.github', 'workflows', name)) as Workflow;
const runs = (steps: Step[]): string[] => steps.flatMap((step) => (step.run ? [step.run] : []));

describe('continuous integration', () => {
  it('runs the checks, the scenario end-to-end tests and the packaged smoke on Windows, and none of them may fail quietly', async () => {
    const ci = await workflow('ci.yml');
    const commands = new Map<string, string[]>();
    for (const [name, job] of Object.entries(ci.jobs)) {
      expect(job['runs-on'], name).toBe('windows-latest');
      expect(job['continue-on-error'], name).toBeUndefined();
      for (const step of job.steps) expect(step['continue-on-error'], name).toBeUndefined();
      commands.set(name, runs(job.steps));
    }
    const all = [...commands.values()].flat();
    expect(all).toContain('npm run check');
    expect(all).toContain('npm run test:e2e');
    // The packaged smoke needs the sidecar's runtime first, and is a job of its own: when it fails, CI fails.
    const packaged = commands.get('packaged')!;
    expect(packaged.indexOf('npm run setup:python')).toBeGreaterThanOrEqual(0);
    expect(packaged.indexOf('npm run smoke:packaged')).toBeGreaterThan(
      packaged.indexOf('npm run setup:python')
    );
  });

  it('`npm run check` is what the ledger says it is, and the packaged smoke builds what it tests', async () => {
    const pkg = JSON.parse(await read('package.json')) as { scripts: Record<string, string> };
    for (const part of ['typecheck', 'lint', 'format:check', 'test:coverage', 'ledger:check']) {
      expect(pkg.scripts['check']).toContain(`npm run ${part}`);
    }
    expect(pkg.scripts['smoke:packaged']).toMatch(/^npm run pack && playwright test/);
    expect(pkg.scripts['test:e2e']).toMatch(/^npm run build && playwright test/);
    // The installer smoke runs real installers: it is never part of the everyday check.
    expect(pkg.scripts['check']).not.toContain('installer');
    expect(pkg.scripts['smoke:installer']).toContain('scripts/build-test-installer.mjs');
  });
});

describe('releasing', () => {
  it('nothing publishes by itself: every build passes --publish never and the workflow only makes a draft', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      scripts: Record<string, string>;
      build: { publish: { provider: string; owner: string; repo: string }[] };
      repository: { url: string };
    };
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (script.includes('electron-builder')) expect(script, name).toContain('--publish never');
    }
    // The two scripts that run electron-builder themselves pass it as an argument.
    expect(pkg.scripts['dist']).toBe(
      'npm run build && node scripts/check-sidecar.mjs && tsx scripts/dist.ts'
    );
    for (const file of ['dist.ts', 'build-test-installer.mjs']) {
      expect(await read('scripts', file), file).toContain("'--publish', 'never'");
    }
    // The feed the installed app reads is this repository's releases.
    expect(pkg.build.publish).toHaveLength(1);
    const feed = pkg.build.publish[0]!;
    expect(feed.provider).toBe('github');
    expect(pkg.repository.url).toContain(`github.com/${feed.owner}/${feed.repo}`);
    const packagedFeed = yaml.load(await read('build', 'app-update.yml')) as Record<string, string>;
    expect(packagedFeed).toMatchObject({ provider: 'github', owner: feed.owner, repo: feed.repo });

    const release = await workflow('release.yml');
    const steps = release.jobs['release']!.steps;
    const commands = runs(steps);
    // Checked, end-to-end tested and started as a package before the installer is built.
    for (const needed of ['npm run check', 'npm run test:e2e', 'npm run smoke:packaged']) {
      expect(commands.indexOf(needed), needed).toBeGreaterThanOrEqual(0);
      expect(commands.indexOf(needed), needed).toBeLessThan(commands.indexOf('npm run dist'));
    }
    const upload = steps.find((step) => step.uses?.startsWith('softprops/action-gh-release'))!;
    expect(upload.with?.['draft']).toBe(true);
    // The installer, its block map and the update feed file: without latest.yml the updater
    // sees no release (electron-builder writes latest.yml for every version when the publish
    // provider is GitHub, betas included), and a file that is not there fails the step.
    const files = String(upload.with?.['files']);
    for (const file of ['release/*.exe', 'release/latest.yml', 'blockmap']) {
      expect(files).toContain(file);
    }
    expect(files).not.toContain('beta.yml');
    expect(upload.with?.['fail_on_unmatched_files']).toBe(true);
    // A beta tag (x.y.z-beta.n) is a GitHub pre-release; the stable channel never sees it.
    expect(upload.with?.['prerelease']).toBe("${{ contains(github.ref_name, '-') }}");
    // The description is the version's section of CHANGELOG.md, not GitHub's list of pull
    // requests, and it is made before the tests so that an undated changelog fails first.
    expect(upload.with?.['generate_release_notes']).toBeUndefined();
    expect(upload.with?.['body_path']).toBe('artifacts/release-notes.md');
    const notes = commands.findIndex((command) => command.includes('scripts/release-notes.mjs'));
    expect(notes).toBeGreaterThanOrEqual(0);
    expect(notes).toBeLessThan(commands.indexOf('npm run check'));
  });

  it('the release checklist records a smoke run on Windows 10 22H2 and Windows 11, and names every automated check', async () => {
    const doc = await read('docs', 'RELEASING.md');
    expect(doc).toMatch(/\| 11 \| +\|/);
    expect(doc).toMatch(/\| 10 22H2 \| +\|/);
    expect(doc).toContain(
      'Windows 10 22H2 (a second PC or a virtual machine; a standard user account'
    );
    for (const command of [
      'npm run check',
      'npm run test:e2e',
      'npm run rig:smoke',
      'npm run smoke:packaged',
      'npm run smoke:installer',
    ]) {
      expect(doc, command).toContain(command);
    }
    expect(doc).toContain('no UAC prompt');
  });
});

describe('code signing (PLAT-017)', () => {
  it('the repository builds unsigned: no Azure options, no publisher in the feed, and pack and the test installer never sign', async () => {
    const pkg = JSON.parse(await read('package.json')) as {
      scripts: Record<string, string>;
      build: Record<string, unknown> & {
        win: Record<string, unknown>;
        publish: Record<string, unknown>[];
      };
    };
    // What a PC, the packaged smoke and the installer smoke build and install is unsigned, so
    // the feed file they carry must name no publisher: with one, the installed app would
    // refuse every unsigned update (electron-updater, NsisUpdater.verifySignature).
    expect(pkg.build.win).not.toHaveProperty('azureSignOptions');
    expect(pkg.build).not.toHaveProperty('forceCodeSigning');
    expect(pkg.build.publish[0]).not.toHaveProperty('publisherName');
    const packagedFeed = yaml.load(await read('build', 'app-update.yml')) as Record<string, string>;
    expect(packagedFeed).not.toHaveProperty('publisherName');
    // Only the dist script reads the signing configuration; pack and the test installer spread
    // package.json's build as it is, whatever the environment holds.
    const dist = await read('scripts', 'dist.ts');
    expect(dist).toContain('signingFromEnv(process.env)');
    expect(dist).toContain('appUpdateProblem(');
    expect(pkg.scripts['pack']).toContain('electron-builder --dir --publish never');
    for (const text of [pkg.scripts['pack']!, await read('scripts', 'build-test-installer.mjs')]) {
      expect(text).not.toMatch(/RIGREADY_SIGN|AZURE_|azureSignOptions|signing/);
    }
  });

  it('the Release workflow hands the four variables and three secrets to the build step only, and verifies a signed build before the draft is made', async () => {
    const release = await workflow('release.yml');
    const steps = release.jobs['release']!.steps;
    const build = steps.find((step) => step.name === 'Build installer')!;
    expect(build.run).toBe('npm run dist');
    const expectedEnv: Record<string, string> = {};
    for (const name of Object.values(SIGNING_VARIABLES)) expectedEnv[name] = `\${{ vars.${name} }}`;
    for (const name of SIGNING_SECRETS) expectedEnv[name] = `\${{ secrets.${name} }}`;
    expect(build.env).toEqual(expectedEnv);
    expect(Object.keys(expectedEnv)).toEqual([...SIGNING_NAMES]);
    for (const step of steps) {
      if (step === build) continue;
      for (const name of Object.keys(step.env ?? {})) expect(SIGNING_NAMES).not.toContain(name);
    }
    // Verified right after the build, only when a publisher is configured, and before the upload.
    const verify = steps.find((step) => step.name === 'Verify the signatures')!;
    expect(steps.indexOf(verify)).toBe(steps.indexOf(build) + 1);
    expect(verify.if).toBe(`vars.${SIGNING_VARIABLES.publisher} != ''`);
    expect(verify.shell).toBe('pwsh');
    expect(verify.env).toEqual({ PUBLISHER: `\${{ vars.${SIGNING_VARIABLES.publisher} }}` });
    expect(verify.run).toContain('./scripts/verify-signed-installer.ps1');
    expect(verify.run).toContain('-Publisher $env:PUBLISHER');
    const upload = steps.find((step) => step.uses?.startsWith('softprops/action-gh-release'))!;
    expect(steps.indexOf(upload)).toBeGreaterThan(steps.indexOf(verify));
    // The script checks what the installed app will check (a valid signature whose subject is
    // the publisher) on the installer, the installed program and the uninstaller, and the
    // publisher in the installed feed file; then it uninstalls.
    const script = await read('scripts', 'verify-signed-installer.ps1');
    for (const needed of [
      'verify /pa /v',
      'Get-AuthenticodeSignature',
      "-ne 'Valid'",
      "'RigReady.exe'",
      "'Uninstall RigReady.exe'",
      "'resources\\app-update.yml'",
      '-ArgumentList @(\'/S\', "/D=$installDir")',
      "-ArgumentList '/S'",
    ]) {
      expect(script, needed).toContain(needed);
    }
  });
});
