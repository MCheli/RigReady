import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../helpers';

/** How RigReady is built, checked and released: the workflows, the build scripts, the checklist. */

interface Step {
  run?: string;
  uses?: string;
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
    const testInstaller = await read('scripts', 'build-test-installer.mjs');
    expect(testInstaller).toContain("'--publish', 'never'");
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
    // The installer and the update feed files: without the .yml the updater sees no release.
    const files = String(upload.with?.['files']);
    for (const file of ['release/*.exe', 'release/latest.yml', 'release/beta.yml', 'blockmap']) {
      expect(files).toContain(file);
    }
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
