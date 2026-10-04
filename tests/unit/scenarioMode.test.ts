/**
 * PLAT-013: scenario mode. The fixtures the ledger names exist and load, every scenario
 * file starts (its mutations all match something and its files are there), every mutation
 * the ledger names is a scenario file with that effect, mutations can be applied while the
 * app runs, and the fake platform's knobs for moved folders and slow files work.
 * (The "Scenario: <name>" badge is asserted in the running app: tests/e2e/nfr.e2e.ts.)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChecklistReport } from '../../src/core/checks/engine';
import { loadRig, loadScenario, rehomePaths } from '../../src/platform/fake';
import { applyMutations, MutationSchema, type RigState } from '../../src/platform/fake/scenario';
import { fixturesDir, mutate, repoRoot, scenarioRig, wiredApp, type TestRig } from '../helpers';

const scenariosDir = path.join(fixturesDir, 'scenarios');
const scenarioFile = (name: string): string => path.join(scenariosDir, `${name}.yaml`);

let rigs: TestRig[] = [];
afterEach(async () => {
  for (const rig of rigs) await rig.cleanup();
  rigs = [];
});
const keep = <T extends TestRig>(rig: T): T => {
  rigs.push(rig);
  return rig;
};

const running = (state: RigState, name: string): boolean =>
  state.processes.some((p) => p.name.toLowerCase() === name.toLowerCase());

/**
 * Every mutation the ledger names after "mark-flight +" / "mark-full +", the scenario file
 * that is that mutation, and what must be true of the fake machine when it has started.
 */
const LEDGER_MUTATIONS: Record<
  string,
  { scenario: string; holds: (rig: TestRig) => Promise<boolean> | boolean }
> = {
  'pedals-unplugged': {
    scenario: 'flying-pedals-unplugged',
    holds: (rig) => !rig.ports.state.devices.some((d) => d.productId === 'B68F'),
  },
  'trackir-not-running': {
    scenario: 'flying-trackir-not-running',
    holds: (rig) => !running(rig.ports.state, 'TrackIR5.exe'),
  },
  'streamdeck-not-running': {
    scenario: 'flying-streamdeck-not-running',
    holds: (rig) =>
      !running(rig.ports.state, 'StreamDeck.exe') &&
      rig.ports.state.devices.some((d) => d.vendorId === '0FD9'),
  },
  'simapppro-not-running': {
    scenario: 'dcs-setup-simapppro-not-running',
    holds: (rig) => !running(rig.ports.state, 'SimAppPro.exe'),
  },
  'options-lua-missing': {
    scenario: 'flying-options-lua-missing',
    holds: async (rig) =>
      !(await rig.ports.files.exists(
        path.join(rig.ports.folders.savedGames(), 'DCS', 'Config', 'options.lua')
      )),
  },
  'mic-default-webcam': {
    // The recorded rig has no webcam; the "wrong microphone" is the other one it has.
    scenario: 'audio-mic-wrong',
    holds: (rig) => !/arctis/i.test(rig.ports.state.audio.defaultRecording?.name ?? ''),
  },
  'mfd2-rotated': {
    scenario: 'flying-mfd-rotated',
    holds: (rig) =>
      rig.ports.state.displays.filter((d) => d.name === 'USB_Monitor').map((d) => d.rotation)[1] ===
      0,
  },
  'export-lua-overwritten': {
    scenario: 'dcs-setup-export-overwritten',
    holds: async (rig) => {
      const text = await rig.ports.files.readText(
        path.join(rig.ports.folders.savedGames(), 'DCS', 'Scripts', 'Export.lua')
      );
      return text.ok && !/BIOS/i.test(text.value);
    },
  },
  'audio-default-speakers': {
    scenario: 'audio-default-speakers',
    holds: (rig) => /speakers/i.test(rig.ports.state.audio.defaultPlayback?.name ?? ''),
  },
  // "mfd2-rotated + trackir-not-running + options-lua-missing": all three at once.
  'mfd2-rotated + trackir-not-running + options-lua-missing': {
    scenario: 'fly-make-ready-all',
    holds: async (rig) =>
      !running(rig.ports.state, 'TrackIR5.exe') &&
      rig.ports.state.displays.filter((d) => d.name === 'USB_Monitor')[1]!.rotation === 0 &&
      !(await rig.ports.files.exists(
        path.join(rig.ports.folders.savedGames(), 'DCS', 'Config', 'options.lua')
      )),
  },
  // Written in words rather than as a name (FLY-005).
  'pedals unplugged': {
    scenario: 'flying-pedals-unplugged',
    holds: (rig) => !rig.ports.state.devices.some((d) => d.productId === 'B68F'),
  },
};

/** The mutation names in the ledger's text: "mark-flight + mfd2-rotated + trackir-not-running". */
async function mutationsNamedInLedger(): Promise<string[]> {
  const ledger = await fs.readFile(
    path.join(repoRoot, 'docs', 'requirements', 'ledger.yaml'),
    'utf8'
  );
  const names = new Set<string>();
  for (const match of ledger.matchAll(
    /\b(?:mark-flight|mark-full|mark-racing|generic-rig) \+ ((?:[a-z0-9]+(?:-[a-z0-9]+)+)(?: \+ [a-z0-9]+(?:-[a-z0-9]+)+)*|pedals unplugged)/g
  )) {
    names.add(match[1]!);
    for (const part of match[1]!.split(' + ')) names.add(part);
  }
  return [...names].sort();
}

describe('PLAT-013 fixtures and scenario files', () => {
  it('the recorded rig and the generic rig load, and the scenarios the ledger calls mark-flight, mark-racing and generic-rig exist', async () => {
    const owner = await loadRig(path.join(fixturesDir, 'rigs', 'mark-full'));
    const generic = await loadRig(path.join(fixturesDir, 'rigs', 'generic-rig'));
    expect(owner.devices.length).toBeGreaterThan(50);
    expect(generic.devices.length).toBe(4);
    for (const [fixture, scenario] of [
      // mark-flight is mark-full with the flying layout; mark-racing is the wheel rig.
      ['mark-flight', 'flying-fresh'],
      ['mark-flight', 'flying-all-good'],
      ['mark-racing', 'mark-racing'],
      ['mark-racing', 'mark-racing-tv'],
      ['generic-rig', 'generic-fresh'],
      ['generic-rig', 'generic-custom-game'],
      ['generic-rig', 'generic-dcs'],
      ['generic-rig', 'generic-second-pc'],
    ] as const) {
      const loaded = await loadScenario(scenarioFile(scenario), fixturesDir);
      expect(loaded.scenario.rig, fixture).toBe(
        fixture === 'generic-rig' ? 'generic-rig' : 'mark-full'
      );
      expect(loaded.scenario.description.length).toBeGreaterThan(10);
    }
    // mark-racing really is the wheel rig: no flight gear, the wheel base is there.
    const racing = await loadScenario(scenarioFile('mark-racing'), fixturesDir);
    expect(racing.state.devices.some((d) => d.vendorId === '4098')).toBe(false);
    expect(racing.state.devices.some((d) => d.vendorId === '0EB7')).toBe(true);
  });

  it('every scenario file starts: its rig exists, every mutation matches something, every profile and data file is there', async () => {
    const names = (await fs.readdir(scenariosDir))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''));
    expect(names.length).toBeGreaterThan(50);
    const problems: string[] = [];
    for (const name of names) {
      try {
        // Loads the whole extends chain, applies state mutations, then seeds files and
        // applies file mutations into a temp folder, exactly as the app does at startup.
        const rig = keep(await scenarioRig(name));
        const loaded = await loadScenario(scenarioFile(name), fixturesDir);
        for (const file of loaded.profileFiles) {
          const target = path.join(rig.ports.folders.dataRoot(), 'profiles', path.basename(file));
          if (!(await rig.ports.files.exists(target))) problems.push(`${name}: ${file} not seeded`);
        }
        await rig.cleanup();
        rigs = rigs.filter((r) => r !== rig);
      } catch (e) {
        problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(problems).toEqual([]);
  }, 300_000);

  it('every mutation the ledger names is a scenario file, and that scenario has the effect', async () => {
    const named = await mutationsNamedInLedger();
    // The ledger names at least these; the list is read from it, not written here.
    expect(named).toEqual(expect.arrayContaining(['pedals-unplugged', 'mfd2-rotated']));
    expect(named.filter((name) => !(name in LEDGER_MUTATIONS))).toEqual([]);
    for (const name of named) {
      const { scenario, holds } = LEDGER_MUTATIONS[name]!;
      await expect(fs.access(scenarioFile(scenario)), `${name} -> ${scenario}`).resolves.toBe(
        undefined
      );
      const rig = keep(await scenarioRig(scenario));
      expect(await holds(rig), `${name} -> ${scenario}`).toBe(true);
    }
  }, 120_000);
});

describe('PLAT-013 mutations while the app runs', () => {
  it('a live mutation changes the fake machine, notifies device subscribers and the next check sees it', async () => {
    const app = keep(await wiredApp('flying-all-good', { files: [] }));
    let notified = 0;
    app.ports.devices.subscribe(() => notified++);
    const before = await app.invoke<ChecklistReport>('fly:check', { profileId: 'dcs-f-a-18c' });
    expect(before.ready).toBe(true);

    await mutate(app, [
      { op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } },
      { op: 'stopProcess', name: 'TrackIR5.exe' },
    ]);
    expect(notified).toBe(1);
    const after = await app.invoke<ChecklistReport>('fly:check', { profileId: 'dcs-f-a-18c' });
    expect(after.ready).toBe(false);
    expect(after.results.filter((r) => r.status === 'fail').map((r) => r.title)).toEqual([
      'T-Pendular-Rudder',
      'TrackIR5',
    ]);

    await mutate(app, [
      { op: 'plugDevice', match: { productId: 'B68F' } },
      {
        op: 'startProcess',
        name: 'TrackIR5.exe',
        path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
      },
    ]);
    const again = await app.invoke<ChecklistReport>('fly:check', { profileId: 'dcs-f-a-18c' });
    expect(again.ready).toBe(true);
    // A mutation that matches nothing is an error, live as in a file.
    await expect(mutate(app, [{ op: 'stopProcess', name: 'NoSuchProgram.exe' }])).rejects.toThrow(
      /matched no process/
    );
  });
});

describe('fake platform knobs: moved folders, slow files, re-pointed paths', () => {
  it('setKnownFolder moves Documents or Saved Games below the fake user folder', async () => {
    const rig = keep(await scenarioRig('generic-fresh', { files: [] }));
    expect(rig.ports.folders.savedGames()).toBe(path.join(rig.home, 'Saved Games'));
    await mutate(rig, [
      { op: 'setKnownFolder', folder: 'savedGames', path: 'Data/Saved Games' },
      { op: 'setKnownFolder', folder: 'documents', path: 'OneDrive/Documents' },
    ]);
    expect(rig.ports.folders.savedGames()).toBe(path.join(rig.home, 'Data', 'Saved Games'));
    expect(rig.ports.folders.documents()).toBe(path.join(rig.home, 'OneDrive', 'Documents'));
    // Never out of the fake user folder.
    for (const bad of ['C:/Windows', '../outside', '/abs']) {
      expect(
        MutationSchema.safeParse({ op: 'setKnownFolder', folder: 'documents', path: bad }).success
      ).toBe(false);
    }
    const state = applyMutations(rig.ports.state, [
      MutationSchema.parse({ op: 'setKnownFolder', folder: 'documents', path: 'Docs' }),
    ]);
    expect(state.folders).toEqual({ savedGames: 'Data/Saved Games', documents: 'Docs' });
  });

  it('writeFile with rehome points recorded paths in its content at the fake user folder', async () => {
    const rig = keep(await scenarioRig('generic-fresh', { files: [] }));
    await mutate(rig, [
      {
        op: 'writeFile',
        path: 'Documents/library.vdf',
        rehome: true,
        content: '"path"\t\t"C:\\\\Users\\\\User\\\\Games\\\\SteamLibrary"\n',
      },
      { op: 'writeFile', path: 'Documents/plain.txt', content: 'C:\\Users\\User\\Games' },
    ]);
    const escaped = rig.home.replace(/\\/g, '\\\\');
    expect(await fs.readFile(path.join(rig.home, 'Documents', 'library.vdf'), 'utf8')).toBe(
      `"path"\t\t"${escaped}\\\\Games\\\\SteamLibrary"\n`
    );
    // Without the switch the content is written as it is.
    expect(await fs.readFile(path.join(rig.home, 'Documents', 'plain.txt'), 'utf8')).toBe(
      'C:\\Users\\User\\Games'
    );
    expect(rehomePaths('C:\\Users\\User\\x', 'D:\\home')).toBe('D:\\home\\x');
  });

  it('slowFiles delays every read and write of a file’s content, and 0 ends it', async () => {
    const rig = keep(await scenarioRig('generic-fresh', { files: [] }));
    const file = path.join(rig.ports.folders.documents(), 'slow.txt');
    const timed = async (work: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await work();
      return performance.now() - started;
    };
    await rig.ports.files.write(file, 'x', { reason: 'test' });
    expect(await timed(() => rig.ports.files.readText(file))).toBeLessThan(100);

    await mutate(rig, [{ op: 'slowFiles', ms: 120 }]);
    expect(await timed(() => rig.ports.files.readText(file))).toBeGreaterThanOrEqual(110);
    expect(await timed(() => rig.ports.files.readBytes(file))).toBeGreaterThanOrEqual(110);
    expect(
      await timed(() => rig.ports.files.write(file, 'y', { reason: 'test' }))
    ).toBeGreaterThanOrEqual(110);
    expect(
      await timed(() => rig.ports.files.copy(file, `${file}.copy`, { reason: 'test' }))
    ).toBeGreaterThanOrEqual(110);
    // What was written is what a fast disk would hold.
    await mutate(rig, [{ op: 'slowFiles', ms: 0 }]);
    expect(await rig.ports.files.readText(file)).toEqual({ ok: true, value: 'y' });
    expect(await timed(() => rig.ports.files.readText(`${file}.copy`))).toBeLessThan(100);
  });
});
