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
import { listDynamic, pageCommands, staticCommands } from '../../src/renderer/shell/registry';
import {
  collectCommands,
  collectManifests,
  commandFailed,
  commandProblem,
  defineCommands,
  navSectionsOf,
  type CommandShell,
  type FeatureCommands,
  type FeatureManifest,
} from '../../src/shared/feature';
import { createClient, type Bridge } from '../../src/shared/ipc';
import { disposedTimes } from '../fixtures/features/zz-example/main';
import { repoRoot, scenarioRig, type TestRig } from '../helpers';

const fixtureMains = import.meta.glob<{ default: FeatureMain }>('../fixtures/features/*/main.ts', {
  eager: true,
});
const fixtureManifests = import.meta.glob<{ default: FeatureManifest }>(
  '../fixtures/features/*/index.ts',
  { eager: true }
);
const fixtureCommands = import.meta.glob<{ default: FeatureCommands }>(
  '../fixtures/features/*/commands.ts',
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
            section: 'Setups',
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
            section: 'RigReady',
          },
        ],
      },
    ];
    const manifests = [...others, ...example];
    expect(navSectionsOf(manifests)).toEqual([
      {
        section: 'Setups',
        entries: [
          expect.objectContaining({ title: 'Setups', order: 100 }),
          expect.objectContaining({ title: 'Example', to: '/configure/zz-example', order: 150 }),
        ],
      },
      { section: 'RigReady', entries: [expect.objectContaining({ title: 'Settings' })] },
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

describe('WOW-UI-001 a feature folder is all it takes: the command palette', () => {
  const run = async (): Promise<void> => undefined;

  it('adding the example feature adds its page, its words for the page, its action and its listed command', async () => {
    const manifests = collectManifests(fixtureManifests);
    const modules = collectCommands(fixtureCommands);
    expect(modules.map((m) => m.feature)).toEqual(['zz-example']);

    // Without its commands.ts the page is still there, from the manifest alone.
    expect(pageCommands(manifests).map((c) => [c.title, c.to])).toEqual([
      ['Example', '/configure/zz-example'],
    ]);

    const all = staticCommands(manifests, modules);
    expect(all.map((c) => [c.group, c.title, c.kind])).toEqual([
      ['Example', 'Ping the example', 'action'],
      ['Go to', 'Example', 'page'],
    ]);
    // The navigation entry keeps its name and is found by the feature's own words too.
    expect(all[1]!.keywords).toEqual(['Lamp', 'bulb']);

    // The action goes through the feature's own channel, validated like any other call.
    const { wiring, events } = await wire(discoverFeatures(fixtureMains));
    const bridge: Bridge = {
      invoke: async (channel, input) => wiring.handlers.get(channel)!(input),
      on: () => () => undefined,
    };
    let refreshed = 0;
    const shell: CommandShell = {
      client: (contract) => createClient(contract, bridge),
      go: async () => undefined,
      route: () => '/fly',
      machineChanged: () => {
        refreshed++;
      },
      progress: () => undefined,
    };
    expect(await all[0]!.run!(shell)).toEqual({
      tone: 'ok',
      text: 'The example answered "from the palette"',
    });
    expect(events).toContainEqual({
      channel: 'zz-example:event:pinged',
      payload: { text: 'from the palette' },
    });
    expect(refreshed).toBe(1);

    // And the command that depends on its state says what that state is now.
    const listing = await listDynamic(modules[0]!, manifests[0], shell);
    expect(listing.problem).toBeUndefined();
    expect(listing.commands.map((c) => [c.group, c.title, c.hint])).toEqual([
      ['Example', 'Ping the example again', 'Pinged 1 times'],
    ]);
    for (const feature of wiring.features) await feature.dispose?.();
  });

  it('a commands.ts that is not one, names another folder, repeats an id or holds a command that does nothing is refused by name', () => {
    expect(() => collectCommands({ './broken/commands.ts': {} })).toThrow(
      /broken\/commands\.ts must default-export defineCommands/
    );
    expect(() =>
      collectCommands({ '../features/audio/commands.ts': { default: { feature: 'displays' } } })
    ).toThrow(/names the feature "displays", not its folder/);
    const stub = { id: 'audio.stub', title: 'Does nothing' };
    expect(() =>
      collectCommands({
        '../features/audio/commands.ts': { default: { feature: 'audio', commands: [stub] } },
      })
    ).toThrow(/command "audio\.stub": it must either open a page \(to\) or do something \(run\)/);
    const once = { id: 'audio.x', title: 'X', run };
    expect(() =>
      collectCommands({
        '../features/audio/commands.ts': { default: { feature: 'audio', commands: [once, once] } },
      })
    ).toThrow(/Command id used twice: audio\.x/);
    // In a stable order, whatever order the files were found in.
    expect(
      collectCommands({
        '../features/trackir/commands.ts': { default: { feature: 'trackir' } },
        '../features/audio/commands.ts': { default: { feature: 'audio', commands: [once] } },
      }).map((m) => m.feature)
    ).toEqual(['audio', 'trackir']);
  });

  it('says what is wrong with a command, and nothing when it is sound', () => {
    expect(commandProblem('audio', { id: 'audio.a', title: 'A', run })).toBeUndefined();
    expect(
      commandProblem('audio', { id: 'audio.a', title: 'A', to: '/configure/audio' })
    ).toBeUndefined();
    expect(commandProblem('audio', { id: 'other.a', title: 'A', run })).toBe(
      'its id must start with "audio."'
    );
    expect(commandProblem('audio', { id: 'audio.a', title: '  ', run })).toBe('it has no title');
    expect(
      commandProblem('audio', { id: 'audio.a', title: 'A', run, to: '/configure/audio' })
    ).toBe('it must either open a page (to) or do something (run)');
    expect(commandProblem('audio', { id: 'audio.a', title: 'A', to: 'https://example.com' })).toBe(
      'the page it opens must be an in-app route'
    );
  });

  it('turns an error result into an outcome that says it did not happen', () => {
    expect(commandFailed({ code: 'x', message: 'The monitors could not be read.' })).toEqual({
      tone: 'bad',
      text: 'The monitors could not be read.',
    });
    expect(
      commandFailed(
        { code: 'x', message: 'Not applied.', detail: 'TV is not connected.' },
        { label: 'Open Monitors', to: '/configure/displays' }
      )
    ).toEqual({
      tone: 'bad',
      text: 'Not applied.',
      detail: 'TV is not connected.',
      action: { label: 'Open Monitors', to: '/configure/displays' },
    });
    expect(defineCommands({ feature: 'audio' })).toEqual({ feature: 'audio' });
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

  /** Every import.meta.glob in shared code, as "file: pattern". */
  async function globsOfSharedCode(): Promise<string[]> {
    const globs: string[] = [];
    for (const layer of shared) {
      for (const file of await sources(path.join(repoRoot, 'src', layer))) {
        const text = await fs.readFile(file, 'utf8');
        for (const match of text.matchAll(/import\.meta\.glob[^(]*\(\s*['"]([^'"]+)['"]/g)) {
          globs.push(`${path.relative(repoRoot, file).replace(/\\/g, '/')}: ${match[1]}`);
        }
      }
    }
    return globs.sort();
  }

  it('the app finds features in exactly two places, both globs over the features folder', async () => {
    // What makes a folder a feature: its main side and its manifest.
    const globs = await globsOfSharedCode();
    expect(globs.filter((glob) => !glob.endsWith('/commands.ts'))).toEqual([
      'src/main/bootstrap.ts: ../features/*/main.ts',
      'src/renderer/features.ts: ../features/*/index.ts',
    ]);
  });

  it('what a feature offers the command palette is found by one more glob over the features folder, and there is no other', async () => {
    expect(await globsOfSharedCode()).toEqual([
      'src/main/bootstrap.ts: ../features/*/main.ts',
      'src/renderer/features.ts: ../features/*/commands.ts',
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
