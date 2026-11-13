import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';
import type { ChecklistReport } from '../../../core/checks/engine';
import type { CaptureCandidate } from '../../../core/checks/registry';
import type { Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { CaptureResult, NewProfile } from '../contract';
import { rigKind, suggestGame, withoutDeskLayout, withoutOwnPad } from './capture';
import {
  choiceFor,
  keptByDefault,
  offered,
  stepAction,
  stepDefault,
  stepsFor,
  type CaptureChoice,
} from './captureDefaults';

let app: WiredApp;
afterEach(() => app?.cleanup());

const capture = (): Promise<CaptureResult> => app.invoke<CaptureResult>('profiles:capture');

/** What the capture screen sends when the user changes nothing: the choice and its defaults. */
function clickThrough(
  captured: CaptureResult,
  gameId = captured.suggested.game ?? '',
  answers: Record<string, string> = {}
): NewProfile {
  const game = captured.games.find((g) => g.id === gameId);
  const variants = captured.candidates.filter((c) => c.game === gameId && c.variant);
  const variant = variants[0]?.variant;
  const choice = choiceFor(captured, gameId, variant?.id ?? '');
  // A step with a clear choice is kept; one the person would have to choose is not.
  const steps = stepsFor(captured.steps, choice).flatMap((step, index) => {
    const action = stepAction(step, stepDefault(step), 'a' + (index + 1));
    return action ? [action] : [];
  });
  const launch = game?.installs[0]?.launch;
  return {
    name: variant?.setupName ?? game?.name ?? 'This rig',
    ...(gameId ? { game: gameId } : {}),
    ...(launch ? { launch } : {}),
    checks: captured.candidates
      .filter((c) => keptByDefault(c, choice))
      .map((c) => ({
        ...c.check,
        ...(c.ask && answers[c.key]
          ? { params: { ...c.check.params, [c.ask.param]: answers[c.key] } }
          : {}),
      })) as NewProfile['checks'],
    ...(steps.length > 0 ? { actions: { preLaunch: steps, postLaunch: [], standDown: [] } } : {}),
    tracked: captured.tracked
      .filter((t) => offered(t, choice) && t.selectedByDefault)
      .map(({ label, path: stored, kind, include, exclude, game: of }) => ({
        label,
        path: stored,
        kind,
        include,
        exclude,
        ...(of ? { game: of } : {}),
      })),
  };
}

const savedYaml = async (id: string): Promise<Profile> =>
  yaml.load(await fs.readFile(app.wiring.context.profiles.fileFor(id), 'utf8')) as Profile;

describe('capture: devices', () => {
  it('lists every connected game controller and HID device with name, VID/PID and serial or port; controllers are kept, keyboards and mice are not', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const { candidates } = await capture();
    const devices = candidates.filter((c) => c.key.startsWith('device:'));
    const listed = await app.ports.devices.list();
    if (!listed.ok) throw new Error('list');
    expect(devices).toHaveLength(listed.value.filter((d) => !d.isHub).length);
    for (const candidate of devices) {
      expect(candidate.device, candidate.title).toMatchObject({
        vendorId: expect.stringMatching(/^[0-9A-F]{4}$/),
        productId: expect.stringMatching(/^[0-9A-F]{4}$/),
      });
      expect(candidate.description).toContain(
        `${candidate.device!.vendorId}:${candidate.device!.productId}`
      );
      // Kept by default exactly when a game sees it as a controller.
      expect(candidate.selectedByDefault, candidate.title).toBe(candidate.device!.gameController);
      expect(candidate.tier).toBe(candidate.device!.gameController ? 'main' : 'more');
    }
    const kept = devices.filter((c) => c.selectedByDefault).map((c) => c.title);
    expect(kept).toContain('WINWING MFD1-L');
    expect(kept).toContain('T-Pendular-Rudder');
    expect(kept).not.toContain('SteelSeries Apex Pro');
    expect(kept).not.toContain('Keychron K2 Pro');
    expect(devices.some((c) => /hub/i.test(c.title))).toBe(false);
  });

  it('identical devices are listed separately, each saying which of them it is and how it is told apart', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const { candidates } = await capture();
    const screens = candidates.filter((c) => c.title.startsWith('WINWING USB 3.0 Display1'));
    expect(screens.map((c) => [c.title, c.device!.identifiedBy, c.device!.twin])).toEqual([
      ['WINWING USB 3.0 Display1 (1 of 3)', 'serial', { index: 1, of: 3 }],
      ['WINWING USB 3.0 Display1 (2 of 3)', 'serial', { index: 2, of: 3 }],
      ['WINWING USB 3.0 Display1 (3 of 3)', 'serial', { index: 3, of: 3 }],
    ]);
    const trackballs = candidates.filter((c) => c.title.startsWith('ORBIT WIRELESS TB'));
    expect(trackballs.map((c) => c.device!.identifiedBy)).toEqual(['port', 'port']);
    expect(trackballs[0]!.description).toContain('identified by USB port');
  });

  it('a saved setup identifies devices by VID/PID, plus serial or USB port for identical ones, never by name (read from the written YAML)', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const captured = await capture();
    const pick = captured.candidates.filter(
      (c) =>
        c.title === 'WINWING MFD1-L' ||
        c.title.startsWith('WINWING USB 3.0 Display1') ||
        c.title.startsWith('ORBIT WIRELESS TB')
    );
    await app.invoke('profiles:create', {
      name: 'Identity',
      checks: pick.map((c) => ({ ...c.check, title: `My ${c.title}` })),
    });
    const saved = await savedYaml('identity');
    expect(saved.checks).toHaveLength(6);
    for (const check of saved.checks) {
      expect(check.type).toBe('device.connected');
      expect(check.params).toMatchObject({
        vendorId: expect.stringMatching(/^[0-9A-F]{4}$/),
        productId: expect.stringMatching(/^[0-9A-F]{4}$/),
      });
      expect(Object.keys(check.params)).not.toContain('name');
    }
    const by = (title: string): Record<string, unknown>[] =>
      saved.checks.filter((c) => c.title.includes(title)).map((c) => c.params);
    expect(by('MFD1-L')).toEqual([{ vendorId: '4098', productId: 'BEE1' }]);
    const serials = by('USB 3.0 Display1').map((p) => p['serial']);
    expect(new Set(serials).size).toBe(3);
    expect(serials.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
    const ports = by('ORBIT').map((p) => p['instanceId']);
    expect(new Set(ports).size).toBe(2);
    expect(ports.every((s) => typeof s === 'string' && s.startsWith('USB\\'))).toBe(true);
  });
});

describe('capture: apps', () => {
  it('known sim helpers lead with friendly names and are kept; other known programs are listed; the rest is behind "show all"', async () => {
    app = await wiredApp('flying-fresh');
    const { candidates } = await capture();
    const apps = candidates.filter((c) => c.group === 'apps');
    const main = apps.filter((c) => c.tier !== 'more');
    const more = apps.filter((c) => c.tier === 'more');
    expect(
      main
        .filter((c) => keptByDefault(c, { game: 'dcs', variant: '', family: 'flight' }))
        .map((c) => c.title)
    ).toEqual(['SimAppPro', 'Stream Deck app', 'TrackIR software']);
    const discord = main.find((c) => c.title === 'Discord')!;
    expect(discord).toMatchObject({ selectedByDefault: false, icon: 'mdi-forum-outline' });
    expect(discord.description).toBe('For voice chat · Discord.exe');
    // Background programs are offered by image name and kept out of the main list.
    expect(more.length).toBeGreaterThan(30);
    expect(more.every((c) => !c.selectedByDefault && c.generic)).toBe(true);
    expect(more.map((c) => c.title)).toContain('msedgewebview2');
    expect(apps.some((c) => /^[a-z]:\\windows\\/i.test(c.description ?? ''))).toBe(false);
    // A helper only useful in the sim is closed again by Stand down, and says so.
    const simAppPro = main.find((c) => c.title === 'SimAppPro')!;
    expect(simAppPro).toMatchObject({ kind: 'flight', standDownNote: 'closed at Stand down' });
    expect(simAppPro.check.params).toMatchObject({ stopOnStandDown: true });
  });
});

describe('capture: monitors and audio', () => {
  it('carries the arrangement for the to-scale diagram and offers to save it as a named layout', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const { candidates } = await capture();
    const layout = candidates.find((c) => c.key === 'displays:layout')!;
    expect(layout.ask).toMatchObject({ label: 'Save this arrangement as a layout named' });
    expect(layout.monitors).toEqual([
      expect.objectContaining({ label: 'DELL G3223D', enabled: false }),
      {
        label: 'LC49G95T',
        enabled: true,
        primary: true,
        x: 0,
        y: 0,
        width: 5120,
        height: 1440,
        rotation: 0,
      },
      expect.objectContaining({
        label: 'USB_Monitor (1 of 3)',
        x: 5120,
        width: 768,
        height: 1024,
        rotation: 90,
      }),
      expect.objectContaining({ label: 'USB_Monitor (2 of 3)', x: 5888 }),
      expect.objectContaining({ label: 'USB_Monitor (3 of 3)', x: 6656 }),
    ]);
  });

  it('the flying rig captured with the name "Flying" produces that layout: ultrawide and three MFD screens on, the Dell off', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const captured = await capture();
    const created = await app.invoke<Profile>(
      'profiles:create',
      clickThrough(captured, 'dcs', { 'displays:layout': 'Flying' })
    );
    const layouts = await app.wiring.context.layouts.list();
    if (!layouts.ok) throw new Error('layouts');
    expect(layouts.value.map((l) => l.name)).toEqual(['Flying']);
    const flying = layouts.value[0]!;
    const state = (name: string): boolean[] =>
      flying.displays.filter((d) => d.name === name).map((d) => d.enabled);
    expect(state('LC49G95T')).toEqual([true]);
    expect(state('USB_Monitor')).toEqual([true, true, true]);
    expect(state('DELL G3223D')).toEqual([false]);
    // The setup's monitor check uses the layout by name.
    const check = created.checks.find((c) => c.type === 'display.layout')!;
    expect(check.params).toMatchObject({ layoutId: flying.id, layoutName: 'Flying' });
    // Captured again, the arrangement is recognised as that layout and nothing is asked.
    const again = (await capture()).candidates.find((c) => c.key === 'displays:layout')!;
    expect(again.title).toBe('Monitor layout: Flying');
    expect(again.ask).toBeUndefined();
  });

  it('offers a check for the default playback and the default recording device', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const { candidates } = await capture();
    const audio = candidates.filter((c) => c.group === 'audio' && c.selectedByDefault);
    expect(audio.map((c) => [c.key, c.check.type, c.check.remediation?.type])).toEqual([
      ['audio:playback', 'audio.defaultDevice', 'audio.setDefault'],
      ['audio:recording', 'audio.defaultDevice', 'audio.setDefault'],
    ]);
  });
});

describe('capture: game, launch target and files', () => {
  it('lists the detected games with family, installs and launch target', async () => {
    app = await wiredApp('flying-fresh');
    const { games } = await capture();
    const dcs = games.find((g) => g.id === 'dcs')!;
    expect(dcs).toMatchObject({ name: 'DCS World', kind: 'flight', running: false });
    expect(dcs.installs).toHaveLength(1);
    expect(dcs.installs[0]).toMatchObject({ source: 'steam' });
    expect(dcs.installs[0]!.launch).toMatchObject({ args: ['-applaunch', '223750'] });
    expect(games.find((g) => g.id === 'iracing')).toMatchObject({ kind: 'racing' });
    // A game that is running right now says so.
    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\x\\DCS.exe' }]);
    expect((await capture()).games.find((g) => g.id === 'dcs')!.running).toBe(true);
  });

  it('for DCS with the F/A-18C, suggests the options, the Hornet bindings folder and Export.lua to back up; the whole settings folder is kept', async () => {
    app = await wiredApp('flying-fresh');
    const captured = await capture();
    const choice: CaptureChoice = { game: 'dcs', variant: 'FA-18C_hornet', family: 'flight' };
    const suggested = captured.tracked.filter((t) => offered(t, choice) && t.game === 'dcs');
    const paths = suggested.map((t) => t.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        '{DCS_USER}',
        '{DCS_USER}/Config/options.lua',
        '{DCS_USER}/Config/Input',
        '{DCS_USER}/Config/Input/FA-18C_hornet',
        '{DCS_USER}/Scripts',
        '{DCS_USER}/Scripts/Export.lua',
      ])
    );
    expect(new Set(paths).size).toBe(paths.length);
    expect(suggested.filter((t) => t.selectedByDefault).map((t) => t.path)).toEqual(['{DCS_USER}']);
    // The user's monitor setups are suggested once the folder exists.
    expect(paths).not.toContain('{DCS_USER}/Config/MonitorSetup');
    await fs.mkdir(path.join(app.home, 'Saved Games', 'DCS', 'Config', 'MonitorSetup'));
    expect((await capture()).tracked.map((t) => t.path)).toContain(
      '{DCS_USER}/Config/MonitorSetup'
    );
    // Another aircraft's bindings, and another game's files, are not offered for this setup.
    expect(
      captured.tracked.filter((t) => t.game === 'iracing').some((t) => offered(t, choice))
    ).toBe(false);
    expect(offered({ game: 'dcs', variant: 'UH-1H' }, choice)).toBe(false);
  });

  it('only the chosen game brings its own checks; nothing from another game is offered, ticked or not', async () => {
    app = await wiredApp('flying-fresh');
    const { candidates } = await capture();
    const forGame = (game: string): CaptureCandidate[] =>
      candidates.filter((c) => offered(c, { game, variant: '' }));
    expect(new Set(forGame('').map((c) => c.game))).toEqual(new Set([undefined]));
    expect(new Set(forGame('iracing').map((c) => c.game))).toEqual(new Set([undefined, 'iracing']));
    expect(forGame('iracing').some((c) => /DCS|Le Mans|BeamNG|Assetto/.test(c.title))).toBe(false);
    // Every game-specific candidate says whose it is: files and version checks included.
    const scoped = candidates.filter((c) => /^(file|game|dcs|dcs-bindings):/.test(c.key));
    expect(scoped.length).toBeGreaterThan(20);
    expect(scoped.every((c) => c.game !== undefined)).toBe(true);
  });

  it('a tracked item chosen in the capture is stored with the setup, with ids of its own', async () => {
    app = await wiredApp('flying-fresh');
    const created = await app.invoke<Profile>('profiles:create', {
      name: 'With files',
      game: 'dcs',
      checks: [],
      tracked: [
        { label: 'DCS options', path: '{DCS_USER}/Config/options.lua', kind: 'file', game: 'dcs' },
        { label: 'DCS options', path: '{DCS_USER}/Config/Input', kind: 'folder' },
      ],
    });
    expect(created.extensions['backup']).toEqual({
      items: [
        {
          id: 'dcs-options',
          label: 'DCS options',
          path: '{DCS_USER}/Config/options.lua',
          kind: 'file',
          include: [],
          exclude: [],
          game: 'dcs',
        },
        {
          id: 'dcs-options-2',
          label: 'DCS options',
          path: '{DCS_USER}/Config/Input',
          kind: 'folder',
          include: [],
          exclude: [],
        },
      ],
    });
    // The Backups page sees them as this setup's tracked items.
    const saved = await savedYaml('with-files');
    expect(saved.extensions['backup']).toEqual(created.extensions['backup']);
  });

  it('a setup for a game installed twice remembers the install that was chosen', async () => {
    app = await wiredApp('dcs-two-installs');
    const { games } = await capture();
    const dcs = games.find((g) => g.id === 'dcs')!;
    expect(dcs.installs.length).toBe(2);
    const beta = dcs.installs.find((i) => /OpenBeta/.test(i.installDir))!;
    const created = await app.invoke<Profile>('profiles:create', {
      name: 'Beta',
      game: 'dcs',
      gameInstall: beta.installDir,
      launch: beta.launch,
      checks: [],
    });
    expect(created.gameInstall).toBe(beta.installDir);
  });
});

describe('capture: what the rig says it is for', () => {
  it('flying rig: the flight gear outnumbers the wheel and DCS has the bindings, so DCS F/A-18C is proposed', async () => {
    app = await wiredApp('flying-fresh');
    const captured = await capture();
    expect(rigKind(captured.candidates as CaptureCandidate[])).toBe('flight');
    expect(captured.suggested).toEqual({
      kind: 'flight',
      game: 'dcs',
      reason: 'The flight gear is connected and DCS World has your bindings',
    });
  });

  it('racing rig: the family is racing; with several racing sims installed the user chooses', async () => {
    app = await wiredApp('mark-racing');
    expect((await capture()).suggested).toEqual({ kind: 'racing' });
  });

  it('a game that is running, or the only game there is, is proposed; a PC with nothing proposes nothing', async () => {
    app = await wiredApp('mark-racing');
    await mutate(app, [
      { op: 'startProcess', name: 'iRacingUI.exe', path: 'C:\\x\\iRacingUI.exe' },
    ]);
    expect((await capture()).suggested).toMatchObject({
      game: 'iracing',
      reason: 'iRacing is running now',
    });
    await app.cleanup();
    app = await wiredApp('generic-dcs');
    expect((await capture()).suggested).toMatchObject({ game: 'dcs' });
    await app.cleanup();
    app = await wiredApp('generic-fresh');
    const nothing = await capture();
    expect(nothing.suggested.game).toBeUndefined();
    expect(nothing.games.every((g) => g.installs.length === 0)).toBe(true);
    expect(suggestGame([], [])).toEqual({});
  });
});

describe('capture: one click through', () => {
  const ready = async (id: string): Promise<ChecklistReport> =>
    app.invoke<ChecklistReport>('fly:check', { profileId: id });

  it('on the flying rig the defaults are a correct DCS F/A-18C setup, and it is Ready', async () => {
    app = await wiredApp('flying-fresh');
    const captured = await capture();
    const input = clickThrough(captured);
    expect(input.name).toBe('DCS F/A-18C');
    const created = await app.invoke<Profile>('profiles:create', input);
    expect(created).toMatchObject({ id: 'dcs-f-a-18c', game: 'dcs' });
    expect(created.launch).toMatchObject({ args: ['-applaunch', '223750'] });
    const titles = created.checks.map((c) => c.title);
    // The flight gear, not the wheel that happens to be plugged in.
    expect(titles.filter((t) => /WINWING|T-Pendular|R-VPC/.test(t))).toHaveLength(11);
    expect(titles).not.toContain('FANATEC Podium Wheel Base DD2');
    expect(titles).not.toContain('Wheel base in PC mode');
    expect(titles).not.toContain('Fanatec Service');
    // The flight helpers, the monitors, the audio devices and the Hornet's own checks.
    expect(titles).toEqual(
      expect.arrayContaining([
        'SimAppPro',
        'TrackIR software',
        'Monitor layout',
        'DCS World installed',
        'DCS bindings match devices (F/A-18C)',
        'Export.lua tools',
      ])
    );
    expect(created.checks.filter((c) => c.type === 'audio.defaultDevice')).toHaveLength(2);
    // Nothing of another game.
    expect(titles.some((t) => /iRacing|Le Mans|BeamNG|Assetto|Flight Simulator/.test(t))).toBe(
      false
    );
    expect(created.extensions['backup']).toMatchObject({ items: [{ path: '{DCS_USER}' }] });
    const report = await ready(created.id);
    expect(report.results.filter((r) => r.status !== 'pass').map((r) => r.title)).toEqual([]);
    expect(report.ready).toBe(true);
  });

  it('on the racing rig, choosing iRacing gives a correct racing setup, and it is Ready', async () => {
    app = await wiredApp('mark-racing');
    const created = await app.invoke<Profile>(
      'profiles:create',
      clickThrough(await capture(), 'iracing')
    );
    expect(created).toMatchObject({ name: 'iRacing', game: 'iracing' });
    expect(created.launch!.exe).toMatch(/iRacingUI\.exe$/);
    const titles = created.checks.map((c) => c.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2',
        'Wheel base in PC mode',
        'Fanatec Service',
        'trophi.ai coach',
        'iRacing helper service',
        'iRacing knows the wheel',
        'Monitor layout',
      ])
    );
    expect(titles.some((t) => /DCS|SimAppPro|TrackIR|Le Mans|BeamNG/.test(t))).toBe(false);
    const report = await ready(created.id);
    expect(report.results.filter((r) => r.status !== 'pass').map((r) => r.title)).toEqual([]);
    expect(report.ready).toBe(true);
  });

  it('racing helper apps captured as "app running" checks are closed by Stand down; the driver service is left running', async () => {
    app = await wiredApp('mark-racing');
    const created = await app.invoke<Profile>(
      'profiles:create',
      clickThrough(await capture(), 'iracing')
    );
    const running = async (): Promise<string[]> => {
      const list = await app.ports.processes.list();
      return list.ok ? list.value.map((p) => p.name) : [];
    };
    expect(await running()).toEqual(
      expect.arrayContaining(['trophi.ai.exe', 'FanatecService.exe'])
    );
    const stood = await app.invoke<{ steps: { title: string; ok: boolean; message: string }[] }>(
      'fly:standDown',
      { profileId: created.id }
    );
    expect(stood.steps).toContainEqual(
      expect.objectContaining({
        title: 'trophi.ai coach',
        ok: true,
        message: 'Closed trophi.ai.exe',
      })
    );
    const after = await running();
    expect(after).not.toContain('trophi.ai.exe');
    expect(after).toContain('FanatecService.exe');
  });

  it('on a PC with no sim, the defaults are the stick, the monitor and the audio devices', async () => {
    app = await wiredApp('generic-fresh');
    const captured = await capture();
    const created = await app.invoke<Profile>('profiles:create', clickThrough(captured));
    expect(created.checks.map((c) => c.type).sort()).toEqual([
      'audio.defaultDevice',
      'audio.defaultDevice',
      'device.connected',
      'display.layout',
    ]);
    expect((await ready(created.id)).ready).toBe(true);
  });

  it('every part can be skipped: a setup with only a name is valid and saved', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    const created = await app.invoke<Profile>('profiles:create', { name: 'Bare', checks: [] });
    expect(created).toMatchObject({ id: 'bare', checks: [], extensions: {} });
    expect(await savedYaml('bare')).toMatchObject({ name: 'Bare' });
  });
});

describe('CFG-PROFILE-017: a new setup starts from the game', () => {
  it('a helper that happens to be running is offered, not ticked, for a game that does not use it: TrackIR software and iRacing', async () => {
    app = await wiredApp('mark-racing');
    await mutate(app, [
      {
        op: 'startProcess',
        name: 'TrackIR5.exe',
        path: 'C:\\Program Files (x86)\\TrackIR5\\TrackIR5.exe',
      },
    ]);
    const captured = await capture();
    const trackir = captured.candidates.find((c) => c.title === 'TrackIR software');
    // The rig proposes it because it is running: that alone used to tick it.
    expect(trackir).toMatchObject({ group: 'apps', selectedByDefault: true });
    const iracing = choiceFor(captured, 'iracing');
    expect(offered(trackir!, iracing)).toBe(true);
    expect(keptByDefault(trackir!, iracing)).toBe(false);
    // The racing helpers that are running are still kept.
    const kept = captured.candidates.filter((c) => keptByDefault(c, iracing)).map((c) => c.title);
    expect(kept).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2',
        'trophi.ai coach',
        'Fanatec Service',
      ])
    );
    const created = await app.invoke<Profile>('profiles:create', clickThrough(captured, 'iracing'));
    expect(created.checks.map((c) => c.title)).not.toContain('TrackIR software');
  });

  it('on a rig with both, a racing game keeps the wheel and no flight gear, and a flight sim the other way round', async () => {
    app = await wiredApp('flying-fresh');
    const captured = await capture();
    const devices = captured.candidates.filter((c) => c.key.startsWith('device:'));
    const keptFor = (game: string): string[] =>
      devices.filter((c) => keptByDefault(c, choiceFor(captured, game))).map((c) => c.title);
    const racing = keptFor('iracing');
    expect(racing).toContain('FANATEC Podium Wheel Base DD2');
    expect(racing.filter((t) => /WINWING|T-Pendular|R-VPC|TrackIR/.test(t))).toEqual([]);
    const flight = keptFor('dcs');
    expect(flight).toEqual(expect.arrayContaining(['WINWING MFD1-L', 'T-Pendular-Rudder']));
    expect(flight).not.toContain('FANATEC Podium Wheel Base DD2');
    // Every one of them is still on the page, whichever game is chosen.
    for (const game of ['iracing', 'dcs']) {
      expect(devices.every((c) => offered(c, choiceFor(captured, game)))).toBe(true);
    }
  });

  it('the wheel rotation the driver last recorded is offered and not ticked', async () => {
    app = await wiredApp('mark-racing');
    const captured = await capture();
    const rotation = captured.candidates.find((c) => /^Wheel rotation/.test(c.title));
    expect(rotation).toBeDefined();
    expect(offered(rotation!, choiceFor(captured, 'iracing'))).toBe(true);
    expect(keptByDefault(rotation!, choiceFor(captured, 'iracing'))).toBe(false);
  });

  it('every game says what it is played with; Ace Combat 8 says a gamepad, its own gear and no helpers', async () => {
    app = await wiredApp('virtual-controller-ready', { files: ['Program Files (x86)/Steam/**'] });
    const captured = await capture();
    for (const game of captured.games) {
      expect(game.uses, game.id).toMatchObject({
        helpers: expect.any(Boolean),
        microphone: expect.any(Boolean),
        gamepad: expect.any(Boolean),
      });
    }
    expect(captured.games.find((g) => g.id === 'ace-combat-8')).toMatchObject({
      name: 'Ace Combat 8: Wings of Theve',
      uses: {
        gear: ['stick', 'yoke', 'throttle', 'pedals'],
        helpers: false,
        microphone: false,
        gamepad: true,
      },
    });
    expect(captured.games.find((g) => g.id === 'dcs')!.uses).toMatchObject({ gamepad: false });
  });

  it('the monitor arrangement the desk rests in is offered and not ticked', async () => {
    app = await wiredApp('displays-layouts');
    // The monitors as they are now, saved by name and then chosen as where the desk rests.
    await app.invoke('displays:saveLayout', { name: 'At rest' });
    const first = await capture();
    const layout = first.candidates.find((c) => c.key === 'displays:layout')!;
    const layoutId = layout.check.params['layoutId'] as string;
    expect(layoutId).toBeTruthy();
    expect(layout.selectedByDefault).toBe(true);
    await app.invoke('displays:setDeskLayout', { id: layoutId });
    const second = await capture();
    expect(second.candidates.find((c) => c.key === 'displays:layout')).toMatchObject({
      selectedByDefault: false,
      check: { params: { layoutId } },
    });
    // Any other layout stays as the rig proposed it.
    const other = [{ ...layout, check: { ...layout.check, params: { layoutId: 'another' } } }];
    expect(withoutDeskLayout(other, layoutId)).toEqual(other);
    expect(withoutDeskLayout(other, undefined)).toBe(other);
  });
});

describe('CFG-PROFILE-018: the virtual controller in a new setup', () => {
  const VIRTUAL_PAD = {
    op: 'plugDevice' as const,
    device: {
      instanceId: 'USB\\VID_045E&PID_028E\\01',
      vendorId: '045E',
      productId: '028E',
      name: 'Virtual Xbox 360 Controller',
      isHid: true,
      isGameController: true,
      isHub: false,
      hubChain: [],
    },
    controller: {
      name: 'Controller (XBOX 360 For Windows)',
      guid: '9A0D2F10-B756-11F0-8001-444553540000',
      vendorId: '045E',
      productId: '028E',
    },
  };
  const isPad = (c: CaptureCandidate): boolean =>
    c.device?.vendorId === '045E' && c.device.productId === '028E';
  const pad = (title: string, key: string, ids = ['045e', '028e']): CaptureCandidate =>
    ({
      key,
      group: 'devices',
      title,
      selectedByDefault: true,
      device: { model: title, vendorId: ids[0], productId: ids[1], gameController: true },
      check: { type: 'device.connected', title, required: true, params: {} },
    }) as unknown as CaptureCandidate;

  it("RigReady's own virtual controller is never offered as a connected device", async () => {
    app = await wiredApp('virtual-controller-ready', { files: ['Program Files (x86)/Steam/**'] });
    await mutate(app, [VIRTUAL_PAD]);
    // Not started by RigReady: another program's controller. Offered, and not ticked.
    const foreign = (await capture()).candidates.filter(isPad);
    expect(foreign).toHaveLength(1);
    expect(foreign[0]).toMatchObject({ selectedByDefault: false });
    // Started by RigReady: it is not part of the rig, and is not on the page at all.
    expect((await app.ports.pads.plug('xbox360', 'My Ace Combat stick')).ok).toBe(true);
    const own = await capture();
    expect(own.candidates.filter(isPad)).toEqual([]);
    expect(own.candidates.some((c) => c.title === 'WINWING MFD1-L')).toBe(true);
  });

  it('tells its own controller from real ones that share its ids', () => {
    const real = pad('Xbox 360 Controller', 'a');
    const virtual = pad('Virtual Xbox 360 Controller', 'b');
    const stick = pad('VKB Gladiator NXT', 'c', ['231D', '0200']);
    const on = { plugged: true, kind: 'xbox360' as const };
    // The one that says it is virtual is RigReady's; the real one stays as it was.
    expect(withoutOwnPad([real, virtual, stick], on)).toEqual([real, stick]);
    // The only one of its ids is it.
    expect(withoutOwnPad([real, stick], on)).toEqual([stick]);
    // Two alike and neither says: both stay offered, and neither is ticked.
    const twin = pad('Xbox 360 Controller', 'd');
    expect(withoutOwnPad([real, twin, stick], on).map((c) => [c.key, c.selectedByDefault])).toEqual(
      [
        ['a', false],
        ['d', false],
        ['c', true],
      ]
    );
    // A DualShock 4 is told by its own ids, so an Xbox controller stays.
    expect(withoutOwnPad([real, stick], { plugged: true, kind: 'ds4' })).toEqual([real, stick]);
    // None plugged in by RigReady: nothing is removed, and one that says virtual is not ticked.
    expect(
      withoutOwnPad([real, virtual], { plugged: false }).map((c) => c.selectedByDefault)
    ).toEqual([true, false]);
    expect(withoutOwnPad([real], undefined)).toEqual([real]);
  });

  it('a game that reads a gamepad is offered "Start a virtual controller" with the profiles by name, and the setup starts it before launch', async () => {
    app = await wiredApp('virtual-controller-ready', { files: ['Program Files (x86)/Steam/**'] });
    const captured = await capture();
    expect(captured.steps).toEqual([
      {
        need: 'gamepad',
        type: 'virtual-controller.start',
        label: 'Start a virtual controller',
        picker: expect.objectContaining({
          param: 'profile',
          label: 'Virtual controller',
          fills: ['profileName'],
          choices: [
            expect.objectContaining({
              value: 'my-ace-combat-stick',
              label: 'My Ace Combat stick',
              fill: { profileName: 'My Ace Combat stick' },
            }),
          ],
        }),
      },
    ]);
    // Only for the game that needs it.
    expect(stepsFor(captured.steps, choiceFor(captured, 'ace-combat-8'))).toHaveLength(1);
    expect(stepsFor(captured.steps, choiceFor(captured, 'dcs'))).toEqual([]);

    const input = clickThrough(captured, 'ace-combat-8');
    expect(input.actions?.preLaunch).toEqual([
      {
        id: 'a1',
        title: 'Start a virtual controller',
        type: 'virtual-controller.start',
        params: { profile: 'my-ace-combat-stick', profileName: 'My Ace Combat stick' },
        continueOnError: false,
        delaySeconds: 0,
      },
    ]);
    const created = await app.invoke<Profile>('profiles:create', { ...input, name: 'Ace nights' });
    expect(created.actions?.preLaunch).toEqual([
      expect.objectContaining({
        type: 'virtual-controller.start',
        params: { profile: 'my-ace-combat-stick', profileName: 'My Ace Combat stick' },
      }),
    ]);
    expect((await savedYaml('ace-nights')).actions?.preLaunch).toHaveLength(1);
    // The flight gear the game is fed from is kept; the head tracker and the helpers are not.
    const titles = created.checks.map((c) => c.title);
    expect(titles).toContain('T-Pendular-Rudder');
    expect(titles.some((t) => /TrackIR|SimAppPro|Stream Deck/.test(t))).toBe(false);
    expect(
      created.checks.some(
        (c) => c.type === 'audio.defaultDevice' && c.params['flow'] === 'recording'
      )
    ).toBe(false);
    // And the Play page says so before the click (FLY-029).
    const view = await app.invoke<{ actions: { title: string; phase: string }[] }>('fly:view', {
      profileId: created.id,
    });
    expect(view.actions).toContainEqual(
      expect.objectContaining({ title: 'Start a virtual controller', phase: 'preLaunch' })
    );
  });
});
