/**
 * PLAT-015: features register themselves. A feature is a folder; nothing lists them.
 *
 * tests/fixtures/features/zz-example is a complete feature that is not in src/features.
 * Handing its folder to the same two discovery functions the app uses (the glob result is
 * their only input) makes its IPC channels, its check and fix types, its capture, its
 * stand-down step, its routes and its navigation entry appear, without one edit to a
 * shared file. The second half proves there is no other registry to forget: no shared
 * source names a feature folder.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import type { FeatureMain } from '../../src/core/feature';
import { nullLogger } from '../../src/core/logger';
import { discoverFeatures, wireFeatures, type Wiring } from '../../src/main/bootstrap';
import { collectManifests, navSectionsOf, type FeatureManifest } from '../../src/shared/feature';
import { disposedTimes } from '../fixtures/features/zz-example/main';
import { repoRoot, scenarioRig, type TestRig } from '../helpers';

const fixtureMains = import.meta.glob<{ default: FeatureMain }>('../fixtures/features/*/main.ts', {
  eager: true,
});
const fixtureManifests = import.meta.glob<{ default: FeatureManifest }>(
  '../fixtures/features/*/index.ts',
  { eager: true }
);

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

async function wire(features: FeatureMain[]): Promise<{
  wiring: Wiring;
  events: { channel: string; payload: unknown }[];
  call: (channel: string, input?: unknown) => Promise<unknown>;
}> {
  rig = await scenarioRig('generic-fresh', { files: [] });
  const events: { channel: string; payload: unknown }[] = [];
  const wiring = wireFeatures({
    features,
    ports: rig.ports,
    log: nullLogger,
    send: (channel, payload) => events.push({ channel, payload }),
  });
  const call = async (channel: string, input?: unknown): Promise<unknown> => {
    const handler = wiring.handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    const envelope = await handler(input);
    if (!envelope.ok)
      throw new Error(`${channel}: ${envelope.error.code} ${envelope.error.message}`);
    return envelope.value;
  };
  return { wiring, events, call };
}

describe('PLAT-015 a feature folder is all it takes: main side', () => {
  it('the real features are found by glob, each with the id of its folder', async () => {
    const found = discoverFeatures();
    const folders = (
      await fs.readdir(path.join(repoRoot, 'src', 'features'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const withMain: string[] = [];
    for (const folder of folders) {
      const exists = await fs
        .access(path.join(repoRoot, 'src', 'features', folder, 'main.ts'))
        .then(
          () => true,
          () => false
        );
      if (exists) withMain.push(folder);
    }
    expect(found.map((f) => f.id).sort()).toEqual(withMain.sort());
    expect(found.length).toBeGreaterThan(10);
  });

  it('adding the example feature adds its IPC handlers, check, fix, capture and stand-down step', async () => {
    const without = discoverFeatures();
    const all = [...without, ...discoverFeatures(fixtureMains)];
    expect(all.map((f) => f.id)).toContain('zz-example');
    const { wiring, events, call } = await wire(all);
    const registry = wiring.context.checks;

    // IPC: its channels exist next to everyone else's, validated like everyone else's.
    expect([...wiring.handlers.keys()].filter((c) => c.startsWith('zz-example:'))).toEqual([
      'zz-example:ping',
      'zz-example:count',
    ]);
    expect(await call('zz-example:ping', { text: 'hello' })).toEqual({ echo: 'hello' });
    expect(await call('zz-example:count')).toEqual({ pings: 1 });
    expect(events).toContainEqual({
      channel: 'zz-example:event:pinged',
      payload: { text: 'hello' },
    });
    expect(await wiring.handlers.get('zz-example:ping')!({ text: 42 })).toMatchObject({
      ok: false,
      error: { code: 'ipc.input' },
    });

    // Check, fix, capture and stand-down types: in the registry, and usable from a setup.
    expect(registry.checkTypes()).toContain('zz-example.lamp');
    expect(registry.remediationTypes()).toContain('zz-example.switchOn');
    expect(registry.standDownSteps().map((s) => s.id)).toContain('zz-example.goodbye');
    const captured = (await call('profiles:capture')) as { candidates: CaptureCandidate[] };
    const lamp = captured.candidates.find((c) => c.key === 'zz-example.lamp')!;
    expect(lamp.check.type).toBe('zz-example.lamp');
    // The setup editor lists the new types without knowing them.
    const types = (await call('profiles:types')) as {
      checks: { type: string }[];
      remediations: { type: string }[];
    };
    expect(types.checks.map((t) => t.type)).toContain('zz-example.lamp');
    expect(types.remediations.map((t) => t.type)).toContain('zz-example.switchOn');

    const profile = (await call('profiles:create', {
      name: 'Example setup',
      checks: [lamp.check],
    })) as { id: string };
    const before = (await call('fly:check', { profileId: profile.id })) as ChecklistReport;
    expect(before.results).toMatchObject([
      { type: 'zz-example.lamp', status: 'fail', summary: 'Off', fix: 'Switch the lamp on' },
    ]);
    const made = (await call('fly:makeReady', { profileId: profile.id })) as ActionReport;
    expect(made.steps).toMatchObject([{ ok: true, message: 'Switched the lamp on' }]);
    expect(made.report.ready).toBe(true);
    const down = (await call('fly:standDown', { profileId: profile.id })) as ActionReport;
    expect(down.steps.map((s) => s.message)).toContain('Switched the example lamp off');

    // Without the folder, none of it is there: the same wiring, minus one feature.
    await rig!.cleanup();
    const plain = await wire(without);
    expect([...plain.wiring.handlers.keys()].some((c) => c.startsWith('zz-example:'))).toBe(false);
    expect(plain.wiring.context.checks.checkTypes()).not.toContain('zz-example.lamp');
    // dispose() is the feature's own too.
    for (const feature of all) await feature.dispose?.();
    expect(disposedTimes()).toBe(1);
  });

  it('two features with one id, or one channel registered twice, stop the app at startup', async () => {
    const example = discoverFeatures(fixtureMains);
    rig = await scenarioRig('generic-fresh', { files: [] });
    expect(() =>
      wireFeatures({
        features: [...example, ...example],
        ports: rig!.ports,
        log: nullLogger,
        send: () => {},
      })
    ).toThrow(/Feature id used twice: zz-example/);
    expect(() => discoverFeatures({ './broken/main.ts': {} })).toThrow(
      /must default-export defineFeatureMain/
    );
  });
});

describe('PLAT-015 a feature folder is all it takes: renderer side', () => {
  it('its routes and its navigation entry appear, sorted into the section it names', () => {
    const example = collectManifests(fixtureManifests);
    expect(example.map((m) => m.id)).toEqual(['zz-example']);
    const others: FeatureManifest[] = [
      {
        id: 'profiles',
        nav: [
          {
            title: 'Setups',
            icon: 'mdi-x',
            to: '/configure/profiles',
            order: 100,
            section: 'Setup',
          },
        ],
        routes: [{ path: '/configure/profiles', component: { render: () => null } }],
      },
      {
        id: 'settings',
        nav: [
          {
            title: 'Settings',
            icon: 'mdi-x',
            to: '/configure/settings',
            order: 910,
            section: 'App',
          },
        ],
      },
    ];
    const manifests = [...others, ...example];
    expect(navSectionsOf(manifests)).toEqual([
      {
        section: 'Setup',
        entries: [
          expect.objectContaining({ title: 'Setups', order: 100 }),
          expect.objectContaining({ title: 'Example', to: '/configure/zz-example', order: 150 }),
        ],
      },
      { section: 'App', entries: [expect.objectContaining({ title: 'Settings' })] },
    ]);
    expect(manifests.flatMap((m) => m.routes ?? []).map((r) => r.path)).toEqual([
      '/configure/profiles',
      '/configure/zz-example',
      '/configure/zz-example/:id',
    ]);
    expect(example[0]!.checkTypes).toEqual([
      { type: 'zz-example.lamp', label: 'Example lamp is on', group: 'other' },
    ]);
    expect(() => collectManifests({ './broken/index.ts': {} })).toThrow(
      /must default-export defineFeature/
    );
  });
});

describe('PLAT-015 there is no registry to edit', () => {
  const shared = ['core', 'main', 'renderer', 'shared', 'platform'];

  async function sources(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await sources(full)));
      else if (/\.(ts|vue)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('the app finds features in exactly two places, both globs over the features folder', async () => {
    const globs: string[] = [];
    for (const layer of shared) {
      for (const file of await sources(path.join(repoRoot, 'src', layer))) {
        const text = await fs.readFile(file, 'utf8');
        for (const match of text.matchAll(/import\.meta\.glob[^(]*\(\s*['"]([^'"]+)['"]/g)) {
          globs.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}: ${match[1]}`);
        }
      }
    }
    expect(globs.sort()).toEqual([
      'src/main/bootstrap.ts: ../features/*/main.ts',
      'src/renderer/features.ts: ../features/*/index.ts',
    ]);
  });

  it('no shared source imports a feature by name: core, main, renderer, shared and platform never mention a feature folder', async () => {
    const offenders: string[] = [];
    for (const layer of shared) {
      for (const file of await sources(path.join(repoRoot, 'src', layer))) {
        const text = await fs.readFile(file, 'utf8');
        for (const match of text.matchAll(
          /(?:from|import\()\s*['"]([^'"]*\/features\/[^'"]+)['"]/g
        )) {
          offenders.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')} -> ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a feature that imports another feature’s internals is caught', async () => {
    // The scan tests/unit/architecture.test.ts runs over src/features, on a planted offender.
    const crossing = (file: string, source: string): boolean => {
      const feature = file.split('/')[1]!;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), source));
      const other = /^features\/([^/]+)\//.exec(target)?.[1];
      return (other !== undefined && other !== feature) || /^(main|platform|legacy)\//.test(target);
    };
    expect(crossing('features/audio/core/a.ts', '../../displays/core/plan')).toBe(true);
    expect(crossing('features/audio/main.ts', '../../main/bootstrap')).toBe(true);
    expect(crossing('features/audio/main.ts', '../../platform/fake')).toBe(true);
    expect(crossing('features/audio/core/a.ts', './b')).toBe(false);
    expect(crossing('features/audio/core/a.ts', '../../../core/result')).toBe(false);
    expect(crossing('features/games/dcs/module.ts', '../core/helpers')).toBe(false);
  });
});
