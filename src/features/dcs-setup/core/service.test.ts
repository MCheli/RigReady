import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../../core/checks/engine';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ExportState, Overview, ScreensPreview, SimAppProState } from '../contract';
import type { ScreenSetup } from './screens';

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/**',
  'AppData/Roaming/SimAppPro/**',
  'AppData/Local/Programs/SimAppPro/**',
  'AppData/Roaming/Elgato/StreamDeck/Plugins/com.ctytler.dcs.sdPlugin/**',
];

const dcsDir = (): string => path.join(app.ports.folders.savedGames(), 'DCS');
const exportLua = (): string => path.join(dcsDir(), 'Scripts', 'Export.lua');
const optionsLua = (): string => path.join(dcsDir(), 'Config', 'options.lua');

async function saveProfile(
  id: string,
  checks: Omit<CheckItem, 'id'>[],
  extra: Partial<Profile> = {}
): Promise<void> {
  const saved = await app.wiring.context.profiles.save({
    schemaVersion: 1,
    id,
    name: id,
    game: 'dcs',
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    checks: checks.map((c, i) => ({ ...c, id: `c${i + 1}` })),
    extensions: {},
    ...extra,
  });
  if (!saved.ok) throw new Error(saved.error.message);
}

const check = (profileId: string) => app.invoke<ChecklistReport>('fly:check', { profileId });
const result = (report: ChecklistReport, title: string) =>
  report.results.find((r) => r.title === title)!;

describe('DCS overview', () => {
  it('shows the install, version, aircraft, monitor setup, Export.lua and SimAppPro at a glance', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const overview = await app.invoke<Overview>('dcs-setup:overview');
    expect(overview.found).toBe(true);
    expect(overview.installs).toMatchObject([
      { source: 'steam', version: 'Steam build 25625823', updatePending: false },
    ]);
    expect(overview.userFolders).toEqual([
      { label: 'Saved Games\\DCS', path: dcsDir(), orphaned: false },
    ]);
    expect(overview.lastRun).toBe('2.9.28.26283 on 2026-07-26');
    const units = overview.aircraft.map((a) => a.unit);
    expect(units).toEqual(
      expect.arrayContaining(['FA-18C_hornet', 'UH-1H', 'F-16C_50', 'F-14B', 'Su-27', 'A-10A'])
    );
    // Every module folder of the recorded install gives at least one aircraft.
    expect(new Set(overview.aircraft.map((a) => a.module)).size).toBe(20);
    expect(overview.aircraft.find((a) => a.unit === 'FA-18C_hornet')).toEqual({
      unit: 'FA-18C_hornet',
      label: 'F/A-18C',
      module: 'FA-18C',
      hasBindings: true,
    });
    expect(overview.aircraft.find((a) => a.unit === 'UH-1H')!.label).toBe('UH-1H Huey');
    expect(overview.options).toEqual({
      multiMonitorSetup: 'wwtMonitor',
      width: 7424,
      height: 1440,
      aspect: 5.1555555555556,
      fullScreen: false,
      vr: false,
    });
    expect(overview.monitorSetup).toMatchObject({
      option: 'wwtMonitor',
      rigReady: false,
      problems: [],
    });
    expect(overview.monitorSetup.file).toMatchObject({ name: 'winwing', author: 'simapppro' });
    expect(overview.exportLua).toMatchObject({
      exists: true,
      unknown: 0,
      changedOutside: false,
      streamDeckNeedsExportScript: true,
    });
    expect(overview.exportLua.tools.map((t) => t.tool)).toEqual(['wwt', 'dcs-bios']);
    expect(overview.simAppPro).toEqual({
      installed: true,
      version: '1.16.91',
      running: true,
      planFound: true,
    });
    expect(overview.dcsRunning).toBe(false);
  });

  it('marks a Steam update and Saved Games folders without an install', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await fs.mkdir(path.join(app.ports.folders.savedGames(), 'DCS.openbeta', 'Config'), {
      recursive: true,
    });
    await mutate(app, [
      { op: 'setSteamBuild', appId: '223750', stateFlags: 6, targetBuildId: '25700000' },
    ]);
    const overview = await app.invoke<Overview>('dcs-setup:overview');
    expect(overview.installs[0]!.updatePending).toBe(true);
    expect(overview.userFolders.map((f) => [f.label, f.orphaned])).toEqual([
      ['Saved Games\\DCS', false],
      ['Saved Games\\DCS.openbeta', true],
    ]);
    const verified = await app.invoke<{ message: string }>('dcs-setup:markVerified');
    expect(verified.message).toBe('Remembered Steam build 25625823 as working');
    expect((await app.invoke<Overview>('dcs-setup:overview')).verified?.version).toBe(
      'Steam build 25625823'
    );
  });

  it('says so when DCS is not installed', async () => {
    app = await wiredApp('flying-fresh', { files: [] });
    await fs.rm(dcsDir(), { recursive: true, force: true });
    const overview = await app.invoke<Overview>('dcs-setup:overview');
    expect(overview.found).toBe(false);
    expect(overview.problem).toMatch(/DCS World was not found/);
    const exportState = await app.invoke<ExportState>('dcs-setup:exportLua');
    expect(exportState.problem).toMatch(/not found/);
  });
});

describe('DCS checks on the Fly screen', () => {
  it('monitor setup check warns when an MFD screen is rotated and clears after the layout fix', async () => {
    app = await wiredApp('flying-mfd-rotated', { files: FILES });
    const profile = await app.wiring.context.profiles.get('dcs-f-a-18c');
    if (!profile.ok) throw new Error(profile.error.message);
    await app.wiring.context.profiles.save({
      ...profile.value,
      checks: [
        ...profile.value.checks,
        {
          id: 'm1',
          type: 'dcs.monitorSetup',
          title: 'DCS monitor setup',
          required: false,
          params: { setup: 'wwtMonitor' },
        },
      ],
    });
    const before = await check('dcs-f-a-18c');
    expect(result(before, 'Monitor layout').status).toBe('fail');
    const monitor = result(before, 'DCS monitor setup');
    expect(monitor.status).toBe('warn');
    expect(monitor.summary).toBe(
      'LEFT_MFCD (752x762 at 5896,256) is not on the monitors as they are arranged now'
    );
    expect(monitor.fix).toBeUndefined();

    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'dcs-f-a-18c' });
    expect(result(made.report, 'Monitor layout').status).toBe('pass');
    expect(result(made.report, 'DCS monitor setup')).toMatchObject({
      status: 'pass',
      summary: '"winwing" (wwtMonitor.lua) fits the monitors',
    });
  });

  it('monitor setup check names a missing file, the wrong selection and a window that is too small', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveProfile('p', [
      {
        type: 'dcs.monitorSetup',
        title: 'Screens',
        required: true,
        params: { setup: 'rigready', window: { width: 7424, height: 1440 } },
      },
    ]);
    const text = await fs.readFile(optionsLua(), 'utf8');
    await fs.writeFile(optionsLua(), text.replace('["width"] = 7424', '["width"] = 5120'));
    let screens = result(await check('p'), 'Screens');
    expect(screens.status).toBe('fail');
    expect(screens.details).toEqual([
      'DCS uses the monitor setup "wwtMonitor"; this setup expects "rigready"',
      "DCS's window is 5120x1440 (options.lua); the monitors of this setup span 7424x1440",
      "DCS's window is 5120x1440 (options.lua) but the monitor setup draws up to 7416x1440",
    ]);
    await fs.writeFile(optionsLua(), text.replace('"wwtMonitor"', '"gone"'));
    screens = result(await check('p'), 'Screens');
    expect(screens.details).toContain(
      'options.lua selects the monitor setup "gone", but there is no MonitorSetup file with that name'
    );
  });

  it('Export.lua check fails naming the missing tool and Make ready puts the line back', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveProfile('p', [
      {
        type: 'dcs.exportLua',
        title: 'Export.lua tools',
        required: true,
        params: { tools: ['wwt', 'dcs-bios'] },
        remediation: { type: 'dcs.repairExportLua', params: { tools: ['wwt', 'dcs-bios'] } },
      },
    ]);
    expect(result(await check('p'), 'Export.lua tools')).toMatchObject({
      status: 'pass',
      summary: 'Loads WinWing (SimAppPro), DCS-BIOS',
    });
    // What SimAppPro or a DCS-BIOS installer rewriting the file looks like.
    await mutate(app, [
      {
        op: 'writeFile',
        path: 'Saved Games/DCS/Scripts/Export.lua',
        content:
          "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n",
      },
    ]);
    const broken = result(await check('p'), 'Export.lua tools');
    expect(broken).toMatchObject({
      status: 'fail',
      summary: 'DCS-BIOS is missing from Export.lua',
      details: ['DCS-BIOS: no line loads Scripts/DCS-BIOS/BIOS.lua'],
      fix: 'Put back the missing Export.lua lines',
    });
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(made.steps).toEqual([
      {
        itemId: 'c1',
        title: 'Export.lua tools',
        ok: true,
        message: 'Added DCS-BIOS to Export.lua',
      },
    ]);
    expect(result(made.report, 'Export.lua tools').status).toBe('pass');
    expect(await fs.readFile(exportLua(), 'utf8')).toBe(
      "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\ndofile(lfs.writedir()..[[Scripts\\DCS-BIOS\\BIOS.lua]])\r\n"
    );
  });

  it('Export.lua fix refuses a tool that is not installed, and while DCS runs', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveProfile('p', [
      {
        type: 'dcs.exportLua',
        title: 'Export.lua tools',
        required: true,
        params: { tools: ['export-script'] },
        remediation: { type: 'dcs.repairExportLua', params: { tools: ['export-script'] } },
      },
    ]);
    const report = await check('p');
    expect(result(report, 'Export.lua tools').details).toEqual([
      'DCS-ExportScript: not installed (Scripts/DCS-ExportScript/ExportScript.lua is missing), so its line cannot be added',
    ]);
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(made.steps[0]).toMatchObject({
      ok: false,
      message: 'DCS-ExportScript is not installed in Saved Games; install it first.',
    });
    await mutate(app, [{ op: 'startProcess', name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' }]);
    const running = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(running.steps[0]!.message).toMatch(/DCS is running/);
  });

  it('options check compares VR, resolution and full screen, and its fix sets only those keys', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveProfile('p', [
      {
        type: 'dcs.options',
        title: 'DCS graphics',
        required: false,
        params: { width: 7424, height: 1440, fullScreen: false, vr: false },
        remediation: {
          type: 'dcs.setOptions',
          params: { width: 7424, height: 1440, fullScreen: false, vr: false },
        },
      },
    ]);
    expect(result(await check('p'), 'DCS graphics')).toMatchObject({
      status: 'pass',
      summary: '7424x1440, windowed, VR off',
    });
    const original = await fs.readFile(optionsLua(), 'utf8');
    // VR.enable is the first "enable" in the file, two tabs deep.
    const changed = original
      .replace('\n\t\t["enable"] = false,', '\n\t\t["enable"] = true,')
      .replace('["height"] = 1440', '["height"] = 1080');
    expect(changed).not.toBe(original);
    await fs.writeFile(optionsLua(), changed);
    const warned = result(await check('p'), 'DCS graphics');
    expect(warned).toMatchObject({
      status: 'warn',
      summary: '2 options differ',
      details: ['height is 1080, expected 1440', 'VR is on, expected off'],
    });
    expect(warned.fix).toBe('Set width, height, full screen, VR in options.lua');
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(made.steps[0]).toMatchObject({
      ok: true,
      message: 'options.lua: height 1080 → 1440; VR on → off',
    });
    expect(await fs.readFile(optionsLua(), 'utf8')).toBe(original);
  });

  it('install check reports a DCS install that disappeared', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const installDir = path.join(
      app.home,
      'Program Files (x86)',
      'Steam',
      'steamapps',
      'common',
      'DCSWorld'
    );
    await saveProfile('p', [
      { type: 'dcs.install', title: 'DCS World installed', required: true, params: { installDir } },
    ]);
    expect(result(await check('p'), 'DCS World installed')).toMatchObject({
      status: 'pass',
      summary: `Steam edition at ${installDir}`,
    });
    await mutate(app, [
      { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/common/DCSWorld/bin/DCS.exe' },
    ]);
    expect(result(await check('p'), 'DCS World installed')).toMatchObject({
      status: 'fail',
      summary: 'DCS install not found',
    });
  });

  it('capture proposes the DCS checks, and a setup made from them is ready', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const capture = await app.invoke<{
      candidates: { key: string; check: Omit<CheckItem, 'id'> }[];
    }>('profiles:capture');
    const dcs = capture.candidates.filter((c) => c.key.startsWith('dcs:'));
    expect(dcs.map((c) => [c.key, c.check.type, c.check.params])).toEqual([
      [
        'dcs:install',
        'dcs.install',
        {
          installDir: path.join(
            app.home,
            'Program Files (x86)',
            'Steam',
            'steamapps',
            'common',
            'DCSWorld'
          ),
        },
      ],
      ['dcs:export', 'dcs.exportLua', { tools: ['wwt', 'dcs-bios'] }],
      [
        'dcs:monitor',
        'dcs.monitorSetup',
        { setup: 'wwtMonitor', window: { width: 7424, height: 1440 } },
      ],
      ['dcs:options', 'dcs.options', { width: 7424, height: 1440, fullScreen: false, vr: false }],
    ]);
    await saveProfile(
      'p',
      dcs.map((c) => c.check)
    );
    expect((await check('p')).ready).toBe(true);
    expect((await check('p')).warnings).toBe(0);
  });
});

describe('Export.lua page', () => {
  it('lists each tool, says which are installed, and finds what the Stream Deck plugin needs', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const state = await app.invoke<ExportState>('dcs-setup:exportLua');
    expect(state.lines.map((l) => [l.tool ?? null, l.helper, l.eol])).toEqual([
      ['wwt', true, '\r\n'],
      ['wwt', false, '\r\n'],
      [null, false, '\r\n'],
      ['dcs-bios', false, '\n'],
    ]);
    expect(state.tools.map((t) => [t.tool, t.active, t.installed])).toEqual([
      ['wwt', 1, true],
      ['dcs-bios', 1, true],
      ['export-script', 0, false],
      ['srs', 0, false],
      ['tacview', 0, false],
      ['helios', 0, false],
    ]);
    expect(state.streamDeckDcsPlugin).toBe(true);
    expect(state.simAppProRunning).toBe(true);
  });

  it('adds and removes one tool with a preview, and notices when another program rewrites the file', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const original = await fs.readFile(exportLua(), 'utf8');
    await expect(
      app.invoke('dcs-setup:previewExport', { kind: 'add', tool: 'export-script' })
    ).rejects.toThrow(/notInstalled/);
    const script = path.join(dcsDir(), 'Scripts', 'DCS-ExportScript', 'ExportScript.lua');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '-- ExportScript');

    const preview = await app.invoke<{ diff: { kind: string; text: string }[]; changed: boolean }>(
      'dcs-setup:previewExport',
      { kind: 'add', tool: 'export-script' }
    );
    expect(preview.changed).toBe(true);
    expect(preview.diff.filter((d) => d.kind !== 'same')).toEqual([
      {
        kind: 'added',
        text: 'dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])',
      },
    ]);
    const added = await app.invoke<{ message: string }>('dcs-setup:applyExport', {
      kind: 'add',
      tool: 'export-script',
    });
    expect(added.message).toBe('Export.lua: Add DCS-ExportScript');
    const withScript = await fs.readFile(exportLua(), 'utf8');
    expect(withScript.startsWith(original)).toBe(true);
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value[0]!.reason).toBe('Export.lua: Add DCS-ExportScript');

    // SimAppPro moving its own line to the top is not a change worth reporting.
    const lines = withScript.split(/(?<=\n)/);
    await fs.writeFile(
      exportLua(),
      [lines[3]!, lines[0]!, lines[1]!, lines[2]!, lines[4]!].join('')
    );
    expect((await app.invoke<ExportState>('dcs-setup:exportLua')).changedOutside).toBeUndefined();

    // Losing a line is.
    await fs.writeFile(exportLua(), original);
    const changed = await app.invoke<ExportState>('dcs-setup:exportLua');
    expect(changed.changedOutside).toMatchObject({
      added: [],
      removed: ['dofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])'],
    });
    const restored = await app.invoke<{ message: string }>('dcs-setup:applyExport', {
      kind: 'restore',
    });
    expect(restored.message).toBe('Export.lua: Put back DCS-ExportScript');
    expect((await app.invoke<ExportState>('dcs-setup:exportLua')).changedOutside).toBeUndefined();

    const removed = await app.invoke<{ message: string }>('dcs-setup:applyExport', {
      kind: 'remove',
      tool: 'wwt',
    });
    expect(removed.message).toBe('Export.lua: Remove WinWing (SimAppPro)');
    expect(await fs.readFile(exportLua(), 'utf8')).toBe(
      '\r\ndofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\ndofile(lfs.writedir()..[[Scripts\\DCS-ExportScript\\ExportScript.lua]])\r\n'
    );

    // Someone else adds a line; keeping it makes it the expected version.
    await fs.appendFile(exportLua(), 'dofile(lfs.writedir()..[[Scripts\\Mine.lua]])\r\n');
    expect((await app.invoke<ExportState>('dcs-setup:exportLua')).changedOutside?.added).toEqual([
      'dofile(lfs.writedir()..[[Scripts\\Mine.lua]])',
    ]);
    await app.invoke('dcs-setup:acceptExport');
    expect((await app.invoke<ExportState>('dcs-setup:exportLua')).changedOutside).toBeUndefined();
    const noop = await app.invoke<{ message: string }>('dcs-setup:applyExport', {
      kind: 'dedupe',
      tool: 'dcs-bios',
    });
    expect(noop.message).toBe('Export.lua already had what was asked; nothing changed');
  });
});

describe('without SimAppPro', () => {
  it('lists aircraft that only have bindings in Saved Games', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await fs.mkdir(path.join(dcsDir(), 'Config', 'Input', 'F-5E-3', 'joystick'), {
      recursive: true,
    });
    const overview = await app.invoke<Overview>('dcs-setup:overview');
    expect(overview.aircraft.find((a) => a.unit === 'F-5E-3')).toEqual({
      unit: 'F-5E-3',
      label: 'F-5E-3',
      hasBindings: true,
    });
  });

  it('manages the WinWing Export.lua line when SimAppPro is not installed', async () => {
    app = await wiredApp('flying-fresh', {
      files: ['Saved Games/DCS/**', 'Program Files (x86)/Steam/**'],
    });
    await mutate(app, [
      {
        op: 'removeRegistryKey',
        hive: 'HKCU',
        key: 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\2873a9d6-0e65-5078-b232-daee9dce2239',
      },
      { op: 'stopProcess', name: 'SimAppPro.exe' },
    ]);
    const sap = await app.invoke<SimAppProState>('dcs-setup:simAppPro');
    expect(sap).toMatchObject({ installed: false, running: false, planFound: false });
    const original = await fs.readFile(exportLua(), 'utf8');
    await app.invoke('dcs-setup:applyExport', { kind: 'remove', tool: 'wwt' });
    expect(await fs.readFile(exportLua(), 'utf8')).toBe(
      '\r\ndofile(lfs.writedir() .. [[Scripts\\DCS-BIOS\\BIOS.lua]])\n'
    );
    await app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'wwt' });
    const state = await app.invoke<ExportState>('dcs-setup:exportLua');
    expect(state.tools.find((t) => t.tool === 'wwt')).toMatchObject({ active: 1, installed: true });
    expect(await fs.readFile(exportLua(), 'utf8')).not.toBe(original);
  });
});

describe('SimAppPro', () => {
  it('adds a required "SimAppPro running" check only to a setup that uses WinWing runtime features', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await saveProfile('hornet', []);
    await saveProfile('huey', []);
    const set = await app.invoke<{ message: string }>('dcs-setup:setRuntimeFeatures', {
      profileId: 'hornet',
      features: ['displays', 'backlight'],
    });
    expect(set.message).toBe('"hornet" now checks that SimAppPro is running');
    const state = await app.invoke<SimAppProState>('dcs-setup:simAppPro');
    expect(state.profiles).toEqual([
      { id: 'hornet', name: 'hornet', features: ['displays', 'backlight'] },
      { id: 'huey', name: 'huey', features: [] },
    ]);
    expect((await check('huey')).results).toEqual([]);
    expect(result(await check('hornet'), 'SimAppPro running')).toMatchObject({
      status: 'pass',
      required: true,
    });

    await mutate(app, [{ op: 'stopProcess', name: 'SimAppPro.exe' }]);
    const failing = result(await check('hornet'), 'SimAppPro running');
    expect(failing).toMatchObject({
      status: 'fail',
      summary: 'Not running; needed for UFC/ICP displays and backlight sync',
      fix: 'Start SimAppPro',
    });
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'hornet' });
    expect(made.steps).toEqual([
      {
        itemId: 'dcs-simapppro',
        title: 'SimAppPro running',
        ok: true,
        message: 'Started SimAppPro',
      },
    ]);
    expect(app.ports.processes.started.at(-1)!.exe).toBe(
      path.join(app.ports.folders.localAppData(), 'Programs', 'SimAppPro', 'SimAppPro.exe')
    );
    expect(made.report.ready).toBe(true);

    // Declaring none removes the check again.
    const cleared = await app.invoke<{ message: string }>('dcs-setup:setRuntimeFeatures', {
      profileId: 'hornet',
      features: [],
    });
    expect(cleared.message).toBe('"hornet" no longer checks for SimAppPro');
    expect((await check('hornet')).results).toEqual([]);
  });

  it("notices SimAppPro rewriting the monitor setup choice, and restores RigReady's version", async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const { setup } = await app.invoke<{ setup: ScreenSetup }>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    await app.invoke('dcs-setup:applyScreens', { setup });
    await app.invoke('dcs-setup:applyExport', { kind: 'add', tool: 'dcs-bios' });
    await saveProfile('p', [
      {
        type: 'dcs.managedFiles',
        title: 'DCS files',
        required: false,
        params: {},
        remediation: { type: 'dcs.restoreManaged', params: {} },
      },
      {
        type: 'dcs.monitorSetup',
        title: 'Screens',
        required: false,
        params: { setup: 'rigready' },
        remediation: { type: 'dcs.writeScreenSetup', params: {} },
      },
    ]);
    expect(result(await check('p'), 'DCS files')).toMatchObject({
      status: 'pass',
      summary: 'RigReady.lua, options.lua, Export.lua as RigReady left them',
    });

    // What applying SimAppPro's MFD wizard does: its own file name back into options.lua.
    const options = await fs.readFile(optionsLua(), 'utf8');
    await mutate(app, [
      {
        op: 'writeFile',
        path: 'Saved Games/DCS/Config/options.lua',
        content: options.replace('"rigready"', '"wwtMonitor"'),
      },
      {
        op: 'writeFile',
        path: 'Saved Games/DCS/Scripts/Export.lua',
        content:
          "local wwtlfs=require('lfs')\r\ndofile(wwtlfs.writedir()..'Scripts/wwt/wwtExport.lua')\r\n",
      },
    ]);
    const report = await check('p');
    expect(result(report, 'DCS files')).toMatchObject({
      status: 'warn',
      summary: 'options.lua, Export.lua changed outside RigReady',
      details: [
        'options.lua: Monitor setup is "wwtMonitor"; RigReady set "rigready"',
        'Export.lua: DCS-BIOS is no longer loaded',
        'SimAppPro rewrites Export.lua every time it starts.',
        "SimAppPro's MFD wizard rewrites options.lua when it is applied.",
      ],
      fix: "Restore RigReady's version",
    });
    const sap = await app.invoke<SimAppProState>('dcs-setup:simAppPro');
    expect(sap.managed.map((m) => [m.label, m.status])).toEqual([
      ['RigReady.lua', 'unchanged'],
      ['options.lua', 'changed'],
      ['Export.lua', 'changed'],
    ]);
    const overview = await app.invoke<Overview>('dcs-setup:overview');
    expect(overview.managedChanged).toEqual(['options.lua', 'Export.lua']);

    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(made.steps.map((s) => s.message)).toEqual([
      "Restored RigReady's version of options.lua, Export.lua",
      'The RigReady screen setup was already in place',
    ]);
    expect(result(made.report, 'DCS files').status).toBe('pass');
    expect(result(made.report, 'Screens').status).toBe('pass');
  });

  it('puts back a deleted RigReady.lua', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const { setup } = await app.invoke<{ setup: ScreenSetup }>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    await app.invoke('dcs-setup:applyScreens', { setup });
    const file = path.join(dcsDir(), 'Config', 'MonitorSetup', 'RigReady.lua');
    await fs.rm(file);
    await saveProfile('p', [
      {
        type: 'dcs.monitorSetup',
        title: 'Screens',
        required: false,
        params: { setup: 'rigready' },
        remediation: { type: 'dcs.writeScreenSetup', params: {} },
      },
    ]);
    expect(result(await check('p'), 'Screens').summary).toMatch(
      /no MonitorSetup file with that name/
    );
    const made = await app.invoke<ActionReport>('fly:makeReady', { profileId: 'p' });
    expect(made.steps[0]!.message).toBe('Put the RigReady screen setup back in DCS');
    expect(await fs.readFile(file, 'utf8')).toBe(preview.lua);
  });
});
