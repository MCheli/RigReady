import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLuaData } from '../../../core/lua/data';
import type { JournalGroup } from '../../../core/ports';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ScreensPreview, ScreensState } from '../contract';
import { evaluateMonitorSetup } from './monitorFiles';
import { generateSetup, type ScreenSetup } from './screens';

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/**',
  'AppData/Roaming/SimAppPro/**',
  'AppData/Local/Programs/SimAppPro/**',
];

const dcsDir = (): string => path.join(app.ports.folders.savedGames(), 'DCS');
const rigReadyLua = (): string => path.join(dcsDir(), 'Config', 'MonitorSetup', 'RigReady.lua');
const optionsLua = (): string => path.join(dcsDir(), 'Config', 'options.lua');

async function importedSetup(): Promise<ScreenSetup> {
  const imported = await app.invoke<{ setup: ScreenSetup; unmatched: string[] }>(
    'dcs-setup:importSimAppPro',
    { desktopId: 'current' }
  );
  expect(imported.unmatched).toEqual([]);
  return imported.setup;
}

describe('DCS screen setup', () => {
  it("imports SimAppPro's plan for the flying layout and generates the same viewports", async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    const ultrawide = setup.desktop.find((d) => d.name === 'LC49G95T')!;
    expect(setup.mainDisplayIds).toEqual([ultrawide.id]);
    expect(setup.aircraft.map((a) => [a.unit, a.placements.map((p) => [p.name, p.crop])])).toEqual([
      [
        'FA-18C_hornet',
        [
          ['LEFT_MFCD', { left: 8, top: 256, right: 8, bottom: 6 }],
          ['RIGHT_MFCD', { left: 8, top: 256, right: 8, bottom: 6 }],
          ['CENTER_MFCD', { left: 8, top: 256, right: 8, bottom: 6 }],
        ],
      ],
    ]);
    const generated = generateSetup(setup);
    expect(generated.errors).toEqual([]);
    expect(generated.warnings).toEqual([]);
    expect(generated.window).toEqual({ x: 0, y: 0, width: 7424, height: 1440 });
    expect(generated.center.file).toEqual({ x: 0, y: 0, width: 5120, height: 1440 });
    // The coordinates SimAppPro wrote into wwtMonitor.lua for the owner's rig.
    const byName = Object.fromEntries(generated.viewports.map((v) => [v.name, v.file]));
    expect(byName).toEqual({
      LEFT_MFCD: { x: 5896, y: 256, width: 752, height: 762 },
      RIGHT_MFCD: { x: 5128, y: 256, width: 752, height: 762 },
      CENTER_MFCD: { x: 6664, y: 256, width: 752, height: 762 },
    });
    // Each lands on one of the three MFD screens.
    const mfds = setup.desktop.filter((d) => d.name === 'USB_Monitor').map((d) => d.id);
    expect(new Set(generated.viewports.map((v) => v.displayId))).toEqual(new Set(mfds));

    // The file is plain Lua data, and DCS's own evaluation reads the same rectangles back.
    const parsed = parseLuaData(generated.lua);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.table('LEFT_MFCD')?.toJs()).toEqual({
      x: 5896,
      y: 256,
      width: 752,
      height: 762,
    });
    expect(parsed.value.get('name')).toBe('RigReady');
    const evaluated = evaluateMonitorSetup(generated.lua, {
      screen: { width: 7424, height: 1440 },
      displays: setup.desktop,
    });
    expect(evaluated.exports.map((e) => e.name)).toEqual([
      'CENTER_MFCD',
      'LEFT_MFCD',
      'RIGHT_MFCD',
    ]);
    expect(evaluated.cameras).toEqual([
      { name: 'Center', rect: { x: 0, y: 0, width: 5120, height: 1440 } },
    ]);
  });

  it('lists every MonitorSetup file and reads the SimAppPro one', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    const wwt = state.files.find((f) => f.stem === 'wwtMonitor')!;
    expect(wwt).toMatchObject({ folder: 'install', name: 'winwing', author: 'simapppro' });
    expect(wwt.exports.map((e) => [e.name, e.rect])).toEqual([
      ['CENTER_MFCD', { x: 6664, y: 256, width: 752, height: 762 }],
      ['LEFT_MFCD', { x: 5896, y: 256, width: 752, height: 762 }],
      ['RIGHT_MFCD', { x: 5128, y: 256, width: 752, height: 762 }],
    ]);
    // ED's own automatic placement sample runs with the monitors DCS would hand it.
    const auto = state.files.find((f) => f.stem === 'Camera+LMFCD_auto_placement')!;
    expect(auto.error).toBeUndefined();
    expect(auto.exports.find((e) => e.name === 'LEFT_MFCD')!.rect.width).toBeGreaterThan(0);
    expect(state.files.filter((f) => f.error)).toEqual([]);
    expect(state.files.length).toBe(12);
    expect(state.rigReady).toMatchObject({ exists: false, selected: false, editedOutside: false });
    expect(state.simAppProPlan).toBe(true);
    expect(state.catalog.map((c) => c.unit)).toContain('FA-18C_hornet');
    expect(state.desktops[0]!.id).toBe('current');
  });

  it('writes RigReady.lua and changes only the monitor setup key of options.lua, as one undoable action', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    const before = await fs.readFile(optionsLua(), 'utf8');

    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.file.status).toBe('new');
    expect(preview.errors).toEqual([]);
    expect(preview.optionChanges).toEqual(['monitor setup "wwtMonitor" → "rigready"']);

    const applied = await app.invoke<{ message: string; changes: string[] }>(
      'dcs-setup:applyScreens',
      { setup }
    );
    expect(applied.changes).toEqual([
      'Created RigReady.lua',
      'options.lua monitor setup "wwtMonitor" → "rigready"',
    ]);
    expect(await fs.readFile(rigReadyLua(), 'utf8')).toBe(preview.lua);
    const after = await fs.readFile(optionsLua(), 'utf8');
    // Every other byte of options.lua is as DCS wrote it.
    expect(after).toBe(
      before.replace('["multiMonitorSetup"] = "wwtMonitor"', '["multiMonitorSetup"] = "rigready"')
    );
    expect(after).not.toBe(before);

    const groups = await app.ports.files.journalGroups();
    const group = (groups.ok ? groups.value : []).find(
      (g: JournalGroup) => g.reason === 'Use the RigReady screen setup in DCS'
    )!;
    expect(group.entries.map((e) => path.basename(e.path)).sort()).toEqual([
      'RigReady.lua',
      'options.lua',
    ]);
    expect(group.entries.find((e) => e.path.endsWith('options.lua'))!.reason).toBe(
      'options.lua: monitor setup "wwtMonitor" → "rigready"'
    );

    // The same again changes nothing.
    const again = await app.invoke<{ changes: string[] }>('dcs-setup:applyScreens', { setup });
    expect(again.changes).toEqual([]);
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    expect(state.rigReady).toMatchObject({ exists: true, selected: true, editedOutside: false });
    expect(state.saved).toEqual(setup);
  });

  it('sets the resolution to the window the setup needs, and full screen off', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    // Only the Hornet's left DDI: the window shrinks to the ultrawide plus the middle MFD.
    setup.aircraft[0]!.placements = setup.aircraft[0]!.placements.filter(
      (p) => p.name !== 'CENTER_MFCD'
    );
    const text = await fs.readFile(optionsLua(), 'utf8');
    await fs.writeFile(
      optionsLua(),
      text.replace('["fullScreen"] = false', '["fullScreen"] = true')
    );
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup,
      setResolution: true,
    });
    expect(preview.window).toEqual({ x: 0, y: 0, width: 6656, height: 1440 });
    expect(preview.optionChanges).toEqual([
      'monitor setup "wwtMonitor" → "rigready"',
      'width 7424 → 6656',
      'aspect ratio 5.1555555555556 → 4.6222222222222',
      'full screen on → off',
    ]);
    const unticked = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup,
      setResolution: false,
    });
    expect(unticked.optionChanges).toEqual(['monitor setup "wwtMonitor" → "rigready"']);
  });

  it('updates its own unmodified RigReady.lua without asking, with a journal entry', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    await app.invoke('dcs-setup:applyScreens', { setup });
    setup.aircraft[0]!.placements[0]!.crop.top = 300;
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.file.status).toBe('update');
    const applied = await app.invoke<{ changes: string[] }>('dcs-setup:applyScreens', { setup });
    expect(applied.changes).toEqual(['Updated RigReady.lua']);
    const journal = await app.ports.files.journal();
    expect(journal.ok && journal.value[0]).toMatchObject({
      path: rigReadyLua(),
      reason: 'Write RigReady.lua (main view and cockpit displays)',
      action: 'write',
    });
    expect(await fs.readFile(rigReadyLua(), 'utf8')).toContain('y = 300;');
  });

  it('asks before replacing a RigReady.lua edited outside RigReady', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    await app.invoke('dcs-setup:applyScreens', { setup });
    const edited = (await fs.readFile(rigReadyLua(), 'utf8')).replace('x = 5896;', 'x = 5900;');
    await fs.writeFile(rigReadyLua(), edited);

    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.file.status).toBe('editedOutside');
    expect(preview.file.diff.filter((d) => d.kind !== 'same')).toEqual([
      { kind: 'removed', text: '\tx = 5900;' },
      { kind: 'added', text: '\tx = 5896;' },
    ]);
    await expect(app.invoke('dcs-setup:applyScreens', { setup })).rejects.toThrow(
      /dcs.screens.edited/
    );
    expect(await fs.readFile(rigReadyLua(), 'utf8')).toBe(edited);

    const journalBefore = await app.ports.files.journal();
    await app.invoke('dcs-setup:applyScreens', { setup, overwriteEdited: true });
    expect(await fs.readFile(rigReadyLua(), 'utf8')).toBe(preview.lua);
    const journalAfter = await app.ports.files.journal();
    expect(
      (journalAfter.ok ? journalAfter.value.length : 0) -
        (journalBefore.ok ? journalBefore.value.length : 0)
    ).toBe(1);
  });

  it('refuses to write while DCS is running', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    app.ports.state.processes.push({ pid: 4242, name: 'DCS.exe', path: 'C:\\DCS\\bin\\DCS.exe' });
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.dcsRunning).toBe(true);
    await expect(app.invoke('dcs-setup:applyScreens', { setup })).rejects.toThrow(/dcs.running/);
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);
  });

  it('refuses a setup with a monitor that is not in the layout', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const setup = await importedSetup();
    setup.aircraft[0]!.placements[0]!.displayId = 'gone';
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.errors).toEqual([
      'F/A-18C Hornet: the monitor for Left DDI is not part of this monitor layout.',
    ]);
    await expect(app.invoke('dcs-setup:applyScreens', { setup })).rejects.toThrow(
      /dcs.screens.invalid/
    );
  });

  it('matches SimAppPro screens only in a layout that has them', async () => {
    app = await wiredApp('desk-mfds-wrong', { files: FILES });
    const imported = await app.invoke<{ setup: ScreenSetup; unmatched: string[] }>(
      'dcs-setup:importSimAppPro',
      {
        desktopId: 'current',
      }
    );
    expect(imported.unmatched.length).toBe(4);
    expect(imported.unmatched[0]).toMatch(
      /Main view: SimAppPro's screen 005 \(5120x1440 at 0,0\) is not in this monitor layout/
    );
    expect(imported.setup.aircraft).toEqual([]);
    await expect(app.invoke('dcs-setup:importSimAppPro', { desktopId: 'nope' })).rejects.toThrow(
      /dcs.screens.layout/
    );
  });
});

describe('screen setup generation', () => {
  const desktop = [
    { id: 'main', name: 'Main', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, primary: true },
    {
      id: 'left',
      name: 'Small',
      x: 1920,
      y: 0,
      width: 800,
      height: 600,
      rotation: 0,
      primary: false,
    },
  ];

  it('writes per-aircraft overrides when two aircraft place the same display differently', () => {
    const generated = generateSetup({
      mainDisplayIds: ['main'],
      desktop,
      desktopLabel: 'Test',
      aircraft: [
        {
          unit: 'FA-18C_hornet',
          label: 'Hornet',
          placements: [
            {
              name: 'LEFT_MFCD',
              displayId: 'left',
              crop: { left: 0, top: 0, right: 400, bottom: 0 },
            },
          ],
        },
        {
          unit: 'F-16C_50',
          label: 'Viper',
          placements: [
            {
              name: 'LEFT_MFCD',
              displayId: 'left',
              crop: { left: 400, top: 0, right: 0, bottom: 0 },
            },
          ],
        },
        {
          unit: 'A-10C_2',
          label: 'Hog',
          placements: [
            {
              name: 'LEFT_MFCD',
              displayId: 'left',
              crop: { left: 0, top: 0, right: 400, bottom: 0 },
            },
          ],
        },
      ],
    });
    expect(generated.viewports.map((v) => [v.name, v.aircraft])).toEqual([
      ['LEFT_MFCD', ['Hornet', 'Hog']],
    ]);
    expect(generated.overrides.map((o) => [o.unit, o.viewports[0]!.file])).toEqual([
      ['F-16C_50', { x: 2320, y: 0, width: 400, height: 600 }],
    ]);
    const viper = evaluateMonitorSetup(generated.lua, {
      screen: { width: 2720, height: 1080 },
      displays: desktop,
      unit: 'F-16C_50',
    });
    expect(viper.exports).toEqual([
      { name: 'LEFT_MFCD', rect: { x: 2320, y: 0, width: 400, height: 600 } },
    ]);
    const hornet = evaluateMonitorSetup(generated.lua, {
      screen: { width: 2720, height: 1080 },
      displays: desktop,
      unit: 'FA-18C_hornet',
    });
    expect(hornet.exports).toEqual([
      { name: 'LEFT_MFCD', rect: { x: 1920, y: 0, width: 400, height: 600 } },
    ]);
  });

  it('reports what makes a setup unusable or odd', () => {
    const generated = generateSetup({
      mainDisplayIds: ['main', 'missing'],
      desktop: [
        ...desktop,
        {
          id: 'above',
          name: 'Above',
          x: 0,
          y: -600,
          width: 800,
          height: 600,
          rotation: 0,
          primary: false,
        },
      ],
      desktopLabel: 'Test',
      aircraft: [
        {
          unit: 'FA-18C_hornet',
          label: 'Hornet',
          placements: [
            {
              name: 'LEFT_MFCD',
              displayId: 'above',
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
            },
            {
              name: 'LEFT_MFCD',
              displayId: 'left',
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
            },
            {
              name: 'RIGHT_MFCD',
              displayId: 'left',
              crop: { left: 790, top: 0, right: 0, bottom: 0 },
            },
            {
              name: 'CENTER_MFCD',
              displayId: 'main',
              crop: { left: 0, top: 0, right: 0, bottom: 0 },
            },
          ],
        },
      ],
    });
    expect(generated.errors).toEqual([
      'A monitor chosen for the main view is not part of this monitor layout.',
      'Hornet: LEFT_MFCD is placed twice.',
      'Hornet: the crop leaves almost nothing of Right DDI on Small.',
    ]);
    expect(generated.warnings).toEqual([
      'Hornet: AMPCD is drawn over the main view on Main.',
      expect.stringMatching(/start at 0,-600/),
    ]);
  });
});
