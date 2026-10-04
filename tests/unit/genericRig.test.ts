import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChecklistReport } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import { readZip } from '../../src/core/files/zip';
import type { Profile } from '../../src/core/profile/schema';
import { loadRig } from '../../src/platform/fake';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../helpers';

/**
 * generic-rig is a PC that is not the owner's: one Logitech stick, a keyboard and a mouse,
 * one 1920x1080 monitor, onboard audio, no sim, no HidHide, no Stream Deck, no TrackIR, no
 * wheel. Everything here runs the whole app on it.
 */

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'generic-fresh'): Promise<WiredApp> {
  const app = await wiredApp(scenario);
  apps.push(app);
  return app;
}

const rigDir = (name: string): string => path.join(fixturesDir, 'rigs', name);

async function fileCount(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    total += entry.isDirectory() ? await fileCount(path.join(dir, entry.name)) : 1;
  }
  return total;
}

/** What the capture screen saves when the user changes nothing but the name (and the game). */
async function captureSetup(
  app: WiredApp,
  setup: {
    name: string;
    game?: string;
    gameName?: string;
    launch?: { exe: string; args: string[] };
    extra?: Profile['checks'][number][];
  }
): Promise<Profile> {
  const { candidates, problems } = await app.invoke<{
    candidates: CaptureCandidate[];
    problems: string[];
  }>('profiles:capture');
  expect(problems).toEqual([]);
  const chosen = candidates.filter(
    (c) => c.selectedByDefault && (!c.game || c.game === setup.game)
  );
  return app.invoke<Profile>('profiles:create', {
    name: setup.name,
    ...(setup.game ? { game: setup.game } : {}),
    ...(setup.gameName ? { gameName: setup.gameName } : {}),
    ...(setup.launch ? { launch: setup.launch } : {}),
    checks: [...chosen.map((c) => c.check), ...(setup.extra ?? []).map(({ id: _id, ...c }) => c)],
  });
}

describe('the generic rig fixture', () => {
  it('has the file set of a recorded rig and loads through the same loader', async () => {
    const files = async (name: string): Promise<string[]> =>
      (await fs.readdir(rigDir(name))).filter((f) => f !== 'files').sort();
    expect(await files('generic-rig')).toEqual(await files('mark-full'));
    const meta = JSON.parse(
      await fs.readFile(path.join(rigDir('generic-rig'), 'meta.json'), 'utf8')
    );
    expect(meta.synthetic).toBe(true);
    expect(await fileCount(path.join(rigDir('generic-rig'), 'files'))).toBe(meta.counts.files);

    const rig = await loadRig(rigDir('generic-rig'));
    expect(rig.devices).toHaveLength(meta.counts.devices);
    expect(rig.displays).toHaveLength(1);
    expect(rig.displays[0]).toMatchObject({ width: 1920, height: 1080, primary: true });
    expect(rig.input.map((i) => `${i.vendorId}:${i.productId}`)).toEqual(['046D:C215']);
    expect(rig.audio.devices.map((d) => d.flow).sort()).toEqual(['playback', 'recording']);
    expect(rig.hidHide.installed).toBe(false);
  });

  it("shares nothing with the owner's rig: no device, monitor, audio endpoint, GUID or sim key", async () => {
    const generic = await loadRig(rigDir('generic-rig'));
    const mark = await loadRig(rigDir('mark-full'));
    const ids = (rig: typeof mark): string[] => [
      ...rig.devices.map((d) => d.instanceId.toLowerCase()),
      ...rig.devices.filter((d) => !d.isHub).map((d) => `${d.vendorId}:${d.productId}`),
      ...rig.displays.flatMap((d) => [d.id, d.edid ?? d.id, d.serial ?? d.id]),
      ...rig.audio.devices.map((d) => d.id),
      ...rig.input.map((i) => i.guid),
    ];
    const owners = new Set(ids(mark));
    expect(ids(generic).filter((id) => owners.has(id))).toEqual([]);
    const keys = Object.keys(generic.registry).join('\n');
    expect(keys).not.toMatch(/Valve|Steam|Eagle Dynamics|Fanatec|Endor|iRacing|NaturalPoint/i);
    expect(generic.processes.map((p) => p.name).join(' ')).not.toMatch(
      /DCS|TrackIR|SimAppPro|StreamDeck|Fanatec|iRacing|steam/i
    );
  });
});

describe('the whole app on a PC that is not the owner’s', () => {
  it('wires every feature, and the Play screen with no setups has nothing active', async () => {
    const app = await start();
    expect(app.wiring.handlers.size).toBeGreaterThan(150);
    expect(await app.invoke('fly:state')).toEqual({ profiles: [], invalid: [] });
    expect(await app.invoke('profiles:overview')).toEqual({ profiles: [], invalid: [] });
    expect(app.events.filter((e) => /error/i.test(e.channel))).toEqual([]);
  });

  it('every Configure page gets an answer it can draw as an empty state, never an error', async () => {
    const app = await start();
    // The first read of every Configure page.
    const reads = [
      'profiles:overview',
      'profiles:games',
      'profiles:types',
      'profiles:pickers',
      'games:list',
      'backup:overview',
      'backup:suggestions',
      'backup:snapshots',
      'sharing:profiles',
      'dcs-setup:overview',
      'dcs-setup:screens',
      'dcs-setup:exportLua',
      'dcs-setup:simAppPro',
      'dcs-bindings:overview',
      'dcs-bindings:snapshots',
      'dcs-bindings:migrationScan',
      'racing:overview',
      'racing:iracing',
      'racing:lmu',
      'racing:beamng',
      'racing:assettoCorsa',
      'racing:wheel',
      'devices:overview',
      'devices:usbMap',
      'devices:inputDevices',
      'displays:view',
      'audio:view',
      'stream-deck:overview',
      'trackir:overview',
      'settings:get',
      'safety:journal',
    ];
    const failed: string[] = [];
    for (const channel of reads) {
      const envelope = await app.wiring.handlers.get(channel)!(undefined);
      if (!envelope.ok) failed.push(`${channel}: ${envelope.error.code} ${envelope.error.message}`);
    }
    expect(failed).toEqual([]);

    // No game is installed, and each game says so rather than failing.
    const games =
      await app.invoke<
        { id: string; installs: unknown[]; problems: string[]; manualFolder?: { label: string } }[]
      >('games:list');
    expect(games.length).toBeGreaterThanOrEqual(8);
    expect(games.filter((g) => g.installs.length > 0 || g.problems.length > 0)).toEqual([]);
    // iRacing is not installed here, and its folder can be chosen by hand.
    expect(games.find((g) => g.id === 'iracing')).toMatchObject({
      installs: [],
      manualFolder: { label: expect.stringContaining('iRacing folder') },
    });

    const dcs = await app.invoke<{ found: boolean; problem?: string }>('dcs-setup:overview');
    expect(dcs).toMatchObject({ found: false, problem: expect.stringContaining('was not found') });
    expect(await app.invoke('dcs-bindings:overview')).toMatchObject({ found: false, aircraft: [] });

    const racing = await app.invoke<{
      wheel: { connected: boolean };
      games: { installed: boolean; bindings: string }[];
    }>('racing:overview');
    expect(racing.wheel.connected).toBe(false);
    expect(racing.games.map((g) => [g.installed, g.bindings])).toEqual(
      racing.games.map(() => [false, 'Not installed'])
    );
    expect(await app.invoke('racing:iracing')).toMatchObject({ installed: false, problems: [] });

    expect(await app.invoke('stream-deck:overview')).toMatchObject({
      status: { installed: false, running: false, devices: [] },
      inventory: { profiles: [], problems: [] },
    });
    expect(await app.invoke('trackir:overview')).toMatchObject({
      status: { installed: false, running: false, devices: [] },
    });

    // What is on this PC is there: the stick as a controller, the hub, one monitor, two endpoints.
    const devices = await app.invoke<{ devices: { name: string; kind: string }[] }>(
      'devices:overview'
    );
    expect(devices.devices.filter((d) => d.kind === 'controller').map((d) => d.name)).toEqual([
      'Logitech Extreme 3D',
    ]);
    const displays = await app.invoke<{ monitors: { name: string }[]; layouts: unknown[] }>(
      'displays:view'
    );
    expect(displays.monitors.map((m) => m.name)).toEqual(['BenQ GW2480']);
    expect(displays.layouts).toEqual([]);
    const audio = await app.invoke<{ playback: unknown[]; recording: unknown[] }>('audio:view');
    expect([audio.playback.length, audio.recording.length]).toEqual([1, 1]);
  });

  it('capture proposes the stick, the monitor and the audio devices, and nothing of a sim', async () => {
    const app = await start();
    const { candidates, problems } = await app.invoke<{
      candidates: CaptureCandidate[];
      problems: string[];
    }>('profiles:capture');
    expect(problems).toEqual([]);
    const chosen = candidates.filter((c) => c.selectedByDefault);
    expect(chosen.map((c) => [c.group, c.check.type, c.title]).sort()).toEqual([
      ['audio', 'audio.defaultDevice', 'Microphone: Microphone (Realtek(R) Audio)'],
      ['audio', 'audio.defaultDevice', 'Sound output: Speakers (Realtek(R) Audio)'],
      ['devices', 'device.connected', 'Logitech Extreme 3D'],
      ['displays', 'display.layout', 'Monitor layout'],
    ]);
    expect(chosen.find((c) => c.group === 'displays')!.description).toBe(
      'BenQ GW2480: 1920x1080 at 0,0, main'
    );
    // The keyboard, the mouse and the running programs are offered, not chosen.
    const offered = candidates.filter((c) => !c.selectedByDefault).map((c) => c.title);
    expect(offered).toEqual(
      expect.arrayContaining(['USB Keyboard', 'USB Optical Mouse', 'Discord'])
    );
    // Nothing that belongs to a game, a wheel, a Stream Deck or TrackIR.
    expect(candidates.filter((c) => c.game !== undefined)).toEqual([]);
    expect(
      candidates.filter((c) => /^(dcs|racing|stream-deck|trackir|file:|game:)/.test(c.key))
    ).toEqual([]);
  });

  it('the captured setup is Ready; unplugging the stick makes it Not ready, plugging it back Ready', async () => {
    const app = await start();
    const profile = await captureSetup(app, { name: 'Space sim' });
    expect(profile.checks).toHaveLength(4);
    const check = (): Promise<ChecklistReport> =>
      app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    const report = await check();
    expect(report.results.filter((r) => r.status !== 'pass')).toEqual([]);
    expect(report).toMatchObject({ ready: true, failed: 0, warnings: 0, errors: 0 });
    expect(await app.invoke('fly:state')).toMatchObject({ activeProfileId: profile.id });

    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '046D', productId: 'C215' } }]);
    const unplugged = await check();
    expect(unplugged.ready).toBe(false);
    expect(unplugged.results.filter((r) => r.status === 'fail').map((r) => r.title)).toEqual([
      'Logitech Extreme 3D',
    ]);
    await mutate(app, [{ op: 'plugDevice', match: { vendorId: '046D', productId: 'C215' } }]);
    expect((await check()).ready).toBe(true);

    // Stand down on a PC with no desk layout and nothing started has nothing to undo.
    const stoodDown = await app.invoke<{ steps: { ok: boolean }[] }>('fly:standDown', {
      profileId: profile.id,
    });
    expect(stoodDown.steps.filter((s) => !s.ok)).toEqual([]);
  });
});

describe('a game RigReady has no module for', () => {
  it('"Other" with a name, a program, checks, launch, tracked files and a backup', async () => {
    const app = await start('generic-custom-game');
    const exe = path.join(app.home, 'Games', 'Star Hauler', 'StarHauler.exe');
    const profile = await captureSetup(app, {
      name: 'Star Hauler',
      game: 'other',
      gameName: 'Star Hauler',
      launch: { exe, args: ['-fullscreen'] },
      extra: [
        {
          id: 'x',
          type: 'file.exists',
          title: 'Star Hauler controls',
          required: true,
          params: { path: '{DOCUMENTS}/Star Hauler/controls.cfg' },
        },
      ],
    });
    expect(profile).toMatchObject({ game: 'other', gameName: 'Star Hauler' });

    // The name the user gave is what the setup lists show.
    const overview = await app.invoke<{ profiles: { gameName?: string }[] }>('profiles:overview');
    expect(overview.profiles[0]!.gameName).toBe('Star Hauler');
    const state = await app.invoke<{
      profiles: { canLaunch: boolean }[];
      active?: { launchLabel?: string };
    }>('fly:state');
    expect(state.profiles[0]!.canLaunch).toBe(true);

    // Checklist.
    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(report.results.filter((r) => r.status !== 'pass')).toEqual([]);
    expect(report.results.map((r) => r.title)).toContain('Star Hauler controls');
    expect(report.ready).toBe(true);
    await fs.rename(
      path.join(app.home, 'Documents', 'Star Hauler', 'controls.cfg'),
      path.join(app.home, 'Documents', 'Star Hauler', 'controls.old')
    );
    const missing = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(missing.ready).toBe(false);
    expect(missing.results.find((r) => r.title === 'Star Hauler controls')!.status).toBe('fail');
    await fs.rename(
      path.join(app.home, 'Documents', 'Star Hauler', 'controls.old'),
      path.join(app.home, 'Documents', 'Star Hauler', 'controls.cfg')
    );

    // Launch starts the program the user named, with its arguments.
    const launched = await app.invoke<{ outcome: string }>('fly:launch', {
      profileId: profile.id,
    });
    expect(launched.outcome).toBe('launched');
    expect(app.ports.processes.started).toEqual([
      expect.objectContaining({ exe, args: ['-fullscreen'] }),
    ]);
    expect(await app.invoke('fly:gameStatus', { profileId: profile.id })).toMatchObject({
      running: true,
    });

    // Tracked files the user chose, and a backup of them.
    const tracked = await app.invoke<{
      scopes: { id: string; items: { item: { label: string }; fileCount: number }[] }[];
    }>('backup:saveItem', {
      scope: profile.id,
      item: { label: 'Star Hauler settings', path: '{DOCUMENTS}/Star Hauler', kind: 'folder' },
    });
    expect(
      tracked.scopes.find((s) => s.id === profile.id)!.items.map((i) => [i.item.label, i.fileCount])
    ).toEqual([['Star Hauler settings', 3]]);
    const outcome = await app.invoke<{
      backup: { id: string; fileCount: number; items: { label: string; fileCount: number }[] };
      skipped: unknown[];
    }>('backup:backUp', { scope: { kind: 'profile', profileId: profile.id } });
    expect(outcome.skipped).toEqual([]);
    expect(outcome.backup.items).toEqual([
      expect.objectContaining({ label: 'Star Hauler settings', fileCount: 3 }),
    ]);
    const folder = path.join(app.ports.folders.dataRoot(), 'backups');
    const [zip] = (await fs.readdir(folder)).filter((f) => f.endsWith('.zip'));
    const entries = readZip(new Uint8Array(await fs.readFile(path.join(folder, zip!))));
    if (!entries.ok) throw new Error(entries.error.message);
    const names = entries.value.map((e) => e.path);
    for (const file of ['settings.ini', 'controls.cfg', 'saves/slot1.sav']) {
      expect(names.some((n) => n.endsWith(`/${file}`))).toBe(true);
    }
    expect(names).toContain(`rigready/profiles/${profile.id}.yaml`);

    // Restoring puts a changed file back.
    const settings = path.join(app.home, 'Documents', 'Star Hauler', 'settings.ini');
    const before = await fs.readFile(settings, 'utf8');
    await fs.writeFile(settings, '[video]\nwidth=640\n');
    const preview = await app.invoke<{
      items: { files: { ref: string; relativePath: string; status: string }[] }[];
    }>('backup:previewRestore', {
      id: outcome.backup.id,
    });
    const changed = preview.items.flatMap((i) => i.files).filter((f) => f.status === 'different');
    expect(changed.map((f) => f.relativePath)).toEqual(['settings.ini']);
    await app.invoke('backup:restore', {
      id: outcome.backup.id,
      choices: Object.fromEntries(changed.map((f) => [f.ref, 'overwrite'])),
    });
    expect(await fs.readFile(settings, 'utf8')).toBe(before);
  });
});
