/**
 * NFR-009: the core flows on a second PC that is not the owner's
 * (fixtures/scenarios/generic-second-pc.yaml): two monitors, two sticks of other makes,
 * DCS World in a Steam library that is not Steam's own folder, and Saved Games moved out
 * of its default place. Capture, Ready, Make ready, Launch, Stand down, backup and
 * restore, share and import, and the bindings of that PC, all through IPC.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import { isWithin } from '../../src/core/paths';
import { allPathVariables } from '../../src/core/pathVariables';
import type { Profile } from '../../src/core/profile/schema';
import { loadRig } from '../../src/platform/fake';
import { fixturesDir, mutate, wiredApp, type WiredApp } from '../helpers';

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario = 'generic-second-pc'): Promise<WiredApp> {
  const app = await wiredApp(scenario);
  apps.push(app);
  return app;
}

/** What the capture screen saves for a DCS setup when the user keeps what is ticked. */
async function captureDcsSetup(app: WiredApp): Promise<Profile> {
  const { candidates, problems } = await app.invoke<{
    candidates: CaptureCandidate[];
    problems: string[];
  }>('profiles:capture');
  expect(problems).toEqual([]);
  const chosen = candidates.filter((c) => c.selectedByDefault && (!c.game || c.game === 'dcs'));
  const discord = candidates.find((c) => c.program?.toLowerCase() === 'discord.exe');
  expect(discord, 'Discord is offered as a running app').toBeDefined();
  const checks = [...new Set([...chosen, discord!])].map((c) =>
    c === discord ? { ...c.check, params: { ...c.check.params, stopOnStandDown: true } } : c.check
  );
  return app.invoke<Profile>('profiles:create', {
    name: 'DCS on the second PC',
    game: 'dcs',
    launch: { exe: '{DCS_INSTALL}/bin/DCS.exe', args: [] },
    checks,
  });
}

describe('the second generic PC as a machine', () => {
  it('shares no device, monitor, controller or audio endpoint with the owner’s rig', async () => {
    const app = await start();
    const owner = await loadRig(path.join(fixturesDir, 'rigs', 'mark-full'));
    const { state } = app.ports;
    expect(state.devices.map((d) => d.name)).toEqual(
      expect.arrayContaining(['Logitech Extreme 3D', 'T.16000M'])
    );
    expect(state.displays.map((d) => d.name)).toEqual(['BenQ GW2480', 'AOC Q27G2']);
    const ownerIds = new Set([
      ...owner.devices.map((d) => d.instanceId.toLowerCase()),
      ...owner.devices.map((d) => `${d.vendorId}:${d.productId}`),
      ...owner.displays.map((d) => d.id),
      ...owner.input.map((c) => c.guid.toLowerCase()),
      ...owner.audio.devices.map((d) => d.id),
    ]);
    for (const id of [
      ...state.devices.map((d) => d.instanceId.toLowerCase()),
      ...state.devices.map((d) => `${d.vendorId}:${d.productId}`),
      ...state.displays.map((d) => d.id),
      ...state.input.map((c) => c.guid.toLowerCase()),
      ...state.audio.devices.map((d) => d.id),
    ]) {
      expect(ownerIds.has(id), id).toBe(false);
    }
  });

  it('Saved Games is the moved folder, and DCS is found in the second Steam library', async () => {
    const app = await start();
    const { folders } = app.ports;
    const savedGames = path.join(app.home, 'Data', 'Saved Games');
    expect(folders.savedGames()).toBe(savedGames);
    expect(folders.documents()).toBe(path.join(app.home, 'Documents'));
    const libraries = await folders.steamLibraries();
    expect(libraries).toEqual({
      ok: true,
      value: [
        path.join(app.home, 'Program Files (x86)', 'Steam'),
        path.join(app.home, 'Games', 'SteamLibrary'),
      ],
    });
    const install = path.join(app.home, 'Games', 'SteamLibrary', 'steamapps', 'common', 'DCSWorld');
    const variables = await allPathVariables(app.wiring.context, app.wiring.context.games);
    expect(variables['DCS_INSTALL']).toBe(install);
    expect(variables['DCS_USER']).toBe(path.join(savedGames, 'DCS'));
    expect(variables['SAVED_GAMES']).toBe(savedGames);
    // Nothing ended up in the default place.
    await expect(fs.access(path.join(app.home, 'Saved Games'))).rejects.toThrow();

    const game = await app.invoke<{
      installs: { installDir: string; source: string }[];
    }>('games:get', { gameId: 'dcs' });
    expect(game.installs).toEqual([
      expect.objectContaining({ installDir: install, source: 'steam' }),
    ]);
  });
});

describe('the core flows on the second generic PC', () => {
  it('capture → Ready → something breaks → Make ready → Launch → Stand down', async () => {
    const app = await start();
    const profile = await captureDcsSetup(app);
    const titles = profile.checks.map((c) => c.title);
    expect(titles).toEqual(expect.arrayContaining(['Logitech Extreme 3D', 'T.16000M']));
    // The monitor check holds both monitors, by id.
    const layout = profile.checks.find((c) => c.type === 'display.layout')!;
    expect((layout.params['displays'] as { name: string }[]).map((d) => d.name)).toEqual([
      'BenQ GW2480',
      'AOC Q27G2',
    ]);
    const saved = await fs.readFile(
      path.join(app.ports.folders.dataRoot(), 'profiles', `${profile.id}.yaml`),
      'utf8'
    );
    expect(saved).not.toMatch(/WINWING|4098|USB_Monitor|LC49G95T|TrackIR/);

    const ready = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(ready.results.filter((r) => r.status !== 'pass')).toEqual([]);
    expect(ready.ready).toBe(true);

    // Discord is closed and the second monitor is moved below the first.
    await mutate(app, [
      { op: 'stopProcess', name: 'Discord.exe' },
      { op: 'setDisplay', match: { name: 'AOC Q27G2' }, set: { x: 0, y: 1080 } },
    ]);
    const broken = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(broken.ready).toBe(false);
    expect(
      broken.results
        .filter((r) => r.status !== 'pass')
        .map((r) => r.type)
        .sort()
    ).toEqual(['display.layout', 'process.running']);
    expect(broken.fixable).toBe(2);

    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: profile.id });
    expect(made.steps.map((s) => [s.title, s.ok])).toEqual([
      ['Monitor layout', true],
      [expect.stringContaining('Discord'), true],
    ]);
    expect(made.report.ready).toBe(true);
    expect(app.ports.state.displays.find((d) => d.name === 'AOC Q27G2')).toMatchObject({
      x: 1920,
      y: 0,
    });

    // Launch starts DCS from the second library.
    const launched = await app.invoke<{ outcome: string; message: string }>('fly:launch', {
      profileId: profile.id,
    });
    expect(launched).toMatchObject({ outcome: 'launched', message: 'Launched DCS.exe' });
    const exe = app.ports.processes.started.at(-1)!.exe;
    expect(exe).toBe(
      path.join(
        app.home,
        'Games',
        'SteamLibrary',
        'steamapps',
        'common',
        'DCSWorld',
        'bin',
        'DCS.exe'
      )
    );

    const down = await app.invoke<ActionReport & { headline: string }>('fly:standDown', {
      profileId: profile.id,
      closeGame: true,
    });
    expect(down.steps.filter((s) => !s.ok)).toEqual([]);
    expect(down.steps.map((s) => s.message)).toEqual(
      expect.arrayContaining(['Closed Discord.exe', 'Closed DCS.exe'])
    );
    expect(app.ports.state.processes.some((p) => /discord|dcs/i.test(p.name))).toBe(false);
  });

  it('backup and restore work on the moved Saved Games folder', async () => {
    const app = await start();
    const profile = await captureDcsSetup(app);
    const dcsUser = path.join(app.home, 'Data', 'Saved Games', 'DCS');
    const suggestions =
      await app.invoke<{ label: string; path: string; fileCount: number }[]>('backup:suggestions');
    // What is offered is this PC's DCS folder, with a variable, never a fixed path.
    const offered = suggestions.filter((s) => s.path.startsWith('{DCS_USER}'));
    expect(offered.length).toBeGreaterThan(0);
    expect(JSON.stringify(suggestions)).not.toMatch(/Users\\\\Owner|Users\/Owner/);

    await app.invoke('backup:saveItem', {
      scope: profile.id,
      item: { label: 'DCS settings and bindings', path: '{DCS_USER}/Config', kind: 'folder' },
    });
    const outcome = await app.invoke<{
      backup: { id: string; items: { label: string; fileCount: number }[] };
      skipped: unknown[];
    }>('backup:backUp', { scope: { kind: 'profile', profileId: profile.id } });
    expect(outcome.skipped).toEqual([]);
    expect(outcome.backup.items).toEqual([
      expect.objectContaining({ label: 'DCS settings and bindings', fileCount: 2 }),
    ]);

    const options = path.join(dcsUser, 'Config', 'options.lua');
    const before = await fs.readFile(options, 'utf8');
    await fs.writeFile(options, 'options = {}\n');
    const preview = await app.invoke<{
      items: { files: { ref: string; relativePath: string; status: string; target?: string }[] }[];
    }>('backup:previewRestore', { id: outcome.backup.id });
    const changed = preview.items.flatMap((i) => i.files).filter((f) => f.status === 'different');
    expect(changed.map((f) => f.relativePath)).toEqual(['options.lua']);
    await app.invoke('backup:restore', {
      id: outcome.backup.id,
      choices: Object.fromEntries(changed.map((f) => [f.ref, 'overwrite'])),
    });
    expect(await fs.readFile(options, 'utf8')).toBe(before);
    // The restore wrote into the moved folder and nowhere else outside the data root.
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value.length).toBeGreaterThan(0);
    for (const entry of journal.ok ? journal.value : []) {
      expect(isWithin(dcsUser, entry.path), entry.path).toBe(true);
    }
  });

  it('a setup shared from this PC is imported on another generic PC, bindings into its own DCS folder', async () => {
    const app = await start();
    const profile = await captureDcsSetup(app);
    await app.invoke('backup:saveItem', {
      scope: profile.id,
      item: { label: 'DCS bindings', path: '{DCS_USER}/Config/Input', kind: 'folder' },
    });
    const review = await app.invoke<{ items: { id: string }[] }>('sharing:prepare', {
      profileId: profile.id,
      includeItems: ['dcs-bindings'],
    });
    expect(review.items.length).toBeGreaterThan(0);
    const target = path.join(app.home, 'Documents', 'second-pc.rigready');
    app.ports.dialogs.script.save.push(target);
    const exported = await app.invoke<{ path: string; size: number } | null>('sharing:export', {
      profileId: profile.id,
      includeItems: ['dcs-bindings'],
      notes: 'From the second PC',
      reviewed: true,
    });
    expect(exported?.path).toBe(target);
    // Nothing of this PC's folders is in the file.
    const bytes = await fs.readFile(target);
    expect(bytes.includes(Buffer.from(path.basename(app.home)))).toBe(false);

    // The friend's PC: standalone DCS, Saved Games in the default place, one monitor.
    const friend = await start('generic-dcs');
    friend.ports.dialogs.script.open.push([target]);
    const report = await friend.invoke<{
      importId: string;
      parts: { id: string; importable: boolean }[];
    }>('sharing:openImport');
    expect(report.parts.find((p) => p.id === 'profile')).toMatchObject({ importable: true });
    const result = await friend.invoke<{ profileId?: string }>('sharing:import', {
      importId: report.importId,
      parts: report.parts.filter((p) => p.importable).map((p) => p.id),
    });
    const imported = await friend.wiring.context.profiles.list();
    expect(imported.ok && imported.value.map((p) => p.name)).toEqual(['DCS on the second PC']);
    expect(result).toBeDefined();
    const binding = path.join(
      friend.home,
      'Saved Games',
      'DCS',
      'Config',
      'Input',
      'FA-18C_hornet',
      'joystick'
    );
    expect((await fs.readdir(binding)).some((f) => f.startsWith('T.16000M'))).toBe(true);
  });

  it('the DCS bindings page finds this PC’s own folders and has an honest empty state for an install without aircraft files', async () => {
    const app = await start();
    const reader = app.wiring.context.bindings.get('dcs')!;
    expect(await reader.available()).toBe(true);
    const overview = await app.invoke<{
      found: boolean;
      inputDir?: string;
      installDir?: string;
      aircraft: unknown[];
      staleDeviceIds: number;
    }>('dcs-bindings:overview');
    // The moved Saved Games folder and the second Steam library, not a default path.
    expect(overview).toMatchObject({
      found: true,
      inputDir: path.join(app.home, 'Data', 'Saved Games', 'DCS', 'Config', 'Input'),
      installDir: path.join(app.home, 'Games', 'SteamLibrary', 'steamapps', 'common', 'DCSWorld'),
      staleDeviceIds: 0,
    });
    // This fixture's DCS folder holds only the program: no aircraft module, so none is listed
    // (and none of the owner's is invented).
    expect(overview.aircraft).toEqual([]);
    expect(await reader.aircraft()).toEqual({ ok: true, value: [] });
  });
});
