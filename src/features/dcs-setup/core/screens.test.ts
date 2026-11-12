import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLuaData } from '../../../core/lua/data';
import type { JournalGroup } from '../../../core/ports';
import { err } from '../../../core/result';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { PlanPairing, ScreensPreview, ScreensState } from '../contract';
import { evaluateMonitorSetup } from './monitorFiles';
import { generateSetup, kneeboardPlace, moveCrop, NO_CROP, type ScreenSetup } from './screens';

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

interface Imported {
  setup: ScreenSetup;
  unmatched: string[];
  pairing: PlanPairing;
}

async function importedSetup(): Promise<ScreenSetup> {
  const imported = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
    desktopId: 'current',
  });
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
      { setup, pairingChecked: true }
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
    const again = await app.invoke<{ changes: string[] }>('dcs-setup:applyScreens', {
      setup,
      pairingChecked: true,
    });
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
    await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true });
    setup.aircraft[0]!.placements[0]!.crop.top = 300;
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.file.status).toBe('update');
    const applied = await app.invoke<{ changes: string[] }>('dcs-setup:applyScreens', {
      setup,
      pairingChecked: true,
    });
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
    await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true });
    const edited = (await fs.readFile(rigReadyLua(), 'utf8')).replace('x = 5896;', 'x = 5900;');
    await fs.writeFile(rigReadyLua(), edited);

    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.file.status).toBe('editedOutside');
    expect(preview.file.diff.filter((d) => d.kind !== 'same')).toEqual([
      { kind: 'removed', text: '\tx = 5900;' },
      { kind: 'added', text: '\tx = 5896;' },
    ]);
    await expect(
      app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true })
    ).rejects.toThrow(/dcs.screens.edited/);
    expect(await fs.readFile(rigReadyLua(), 'utf8')).toBe(edited);

    const journalBefore = await app.ports.files.journal();
    await app.invoke('dcs-setup:applyScreens', {
      setup,
      pairingChecked: true,
      overwriteEdited: true,
    });
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
    await expect(
      app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true })
    ).rejects.toThrow(/dcs.running/);
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
    await expect(
      app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true })
    ).rejects.toThrow(/dcs.screens.invalid/);
  });

  it('matches SimAppPro screens only in a layout that has them', async () => {
    app = await wiredApp('desk-mfds-wrong', { files: FILES });
    const imported = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    // The small screens lie on their sides at the desk: none of them is a screen of the plan.
    expect(imported.unmatched.length).toBe(3);
    expect(imported.unmatched[0]).toMatch(
      /F\/A-18C Hornet LEFT_MFCD: SimAppPro's screen 002 \(768x1024 at 5888,0\) is not in this monitor layout/
    );
    expect(imported.setup.aircraft).toEqual([]);
    // The ultrawide is here, though not where the plan has it: paired, and the user is asked.
    const main = imported.pairing.screens.find((s) => s.main)!;
    const ultrawide = imported.setup.desktop.find((d) => d.name === 'LC49G95T')!;
    expect(main).toMatchObject({ displayId: ultrawide.id, how: 'left', certain: false });
    expect(imported.setup.mainDisplayIds).toEqual([ultrawide.id]);
    expect(imported.pairing.certain).toBe(false);
    await expect(app.invoke('dcs-setup:importSimAppPro', { desktopId: 'nope' })).rejects.toThrow(
      /dcs.screens.layout/
    );
  });
});

/** Names the three small screens on the Monitors page, left to right; their ids as the Screens tab has them. */
async function nameSmallScreens(names: [string, string, string]): Promise<string[]> {
  const small = app.ports.state.displays
    .filter((d) => d.enabled && d.name === 'USB_Monitor')
    .sort((a, b) => a.x - b.x);
  expect(small).toHaveLength(3);
  for (const [at, d] of small.entries()) {
    await app.invoke('displays:setName', { id: d.id, name: names[at]! });
  }
  return small.map((d) => d.id.toLowerCase());
}

describe("the user's names for the monitors", () => {
  it('are used for the layout as it is now, for a setup saved before they were given, and in the file', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    // Saved while the screens still had Windows' names.
    const setup = await importedSetup();
    await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true });
    expect(setup.desktop.filter((d) => d.name === 'USB_Monitor')).toHaveLength(3);

    const ids = await nameSmallScreens(['MFD left', 'MFD centre', 'MFD right']);
    const names = (displays: ScreenSetup['desktop']): (string | undefined)[] =>
      ids.map((id) => displays.find((d) => d.id === id)?.name);
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    expect(names(state.desktops[0]!.displays)).toEqual(['MFD left', 'MFD centre', 'MFD right']);
    expect(names(state.saved!.desktop)).toEqual(['MFD left', 'MFD centre', 'MFD right']);
    expect(state.saved!.desktop.map((d) => d.name)).not.toContain('USB_Monitor');
    // The placements of the saved setup are untouched: only what the monitors are called changed.
    expect(state.saved!.aircraft).toEqual(setup.aircraft);

    const imported = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    expect(names(imported.setup.desktop)).toEqual(['MFD left', 'MFD centre', 'MFD right']);
  });

  it('are used for a layout saved with a setup, whatever the monitors are doing now', async () => {
    // At the desk: the small screens lie on their sides, and the setup holds the flying layout.
    app = await wiredApp('desk-mfds-wrong', { files: FILES });
    const ids = await nameSmallScreens(['MFD left', 'MFD centre', 'MFD right']);
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    const ofSetup = state.desktops.find((d) => d.id.startsWith('profile:'))!;
    expect(
      ofSetup.displays
        .filter((d) => ids.includes(d.id))
        .map((d) => d.name)
        .sort()
    ).toEqual(['MFD centre', 'MFD left', 'MFD right']);
    expect(ofSetup.displays.map((d) => d.name)).not.toContain('USB_Monitor');
  });
});

describe("which of SimAppPro's screens is which monitor", () => {
  it('goes by the names when the screens were put in another order since the plan was saved', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const [left, centre, right] = await nameSmallScreens(['MFD left', 'MFD centre', 'MFD right']);
    const imported = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    const placed = (i: Imported): Record<string, string> =>
      Object.fromEntries(i.setup.aircraft[0]!.placements.map((p) => [p.name, p.displayId]));
    // SimAppPro's plan has the left display on the middle screen. The names say otherwise.
    expect(placed(imported)).toEqual({
      LEFT_MFCD: left,
      CENTER_MFCD: centre,
      RIGHT_MFCD: right,
    });
    expect(imported.unmatched).toEqual([]);
    // Not certain: the plan and the names disagree, so the user is shown the pairing.
    expect(imported.pairing.certain).toBe(false);
    const leftDdi = imported.pairing.screens.find((s) => s.shows.includes('Left DDI'))!;
    expect(leftDdi).toMatchObject({
      planId: '002',
      displayId: left,
      how: 'name',
      certain: false,
      note: "Matched by the name you gave the screen. SimAppPro's plan has it where MFD centre is now, so the plan is from before the screens were put in this order.",
    });
    const generated = generateSetup(imported.setup);
    expect(generated.errors).toEqual([]);
    expect(Object.fromEntries(generated.viewports.map((v) => [v.name, v.file.x]))).toEqual({
      LEFT_MFCD: 5128,
      CENTER_MFCD: 5896,
      RIGHT_MFCD: 6664,
    });

    // The user's own answer wins: they say the plan's 002 is the right screen after all.
    const corrected = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
      pairs: { '002': right!, '004': left! },
    });
    expect(placed(corrected)).toEqual({
      LEFT_MFCD: right,
      CENTER_MFCD: centre,
      RIGHT_MFCD: left,
    });
    expect(corrected.pairing.screens.find((s) => s.planId === '002')).toMatchObject({
      how: 'chosen',
      certain: true,
      note: 'You chose this screen.',
    });
    // Nothing was written by any of this.
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);
  });

  it('says it is not certain when the screens have no names and look alike', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const imported = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    expect(imported.pairing.certain).toBe(false);
    expect(imported.pairing.screens.map((s) => [s.planId, s.how, s.certain]).sort()).toEqual([
      ['002', 'position', false],
      ['003', 'position', false],
      ['004', 'position', false],
      ['005', 'position', true],
    ]);
  });
});

describe('Identify screens', () => {
  it("shows each monitor's number, its name and what the setup puts on it", async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    await nameSmallScreens(['MFD left', 'MFD centre', 'MFD right']);
    const { setup } = await app.invoke<Imported>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    expect(await app.invoke('dcs-setup:identifyScreens', { setup })).toEqual({ shown: 4, off: 1 });
    expect(app.ports.overlays.shown).toHaveLength(1);
    const { labels, durationMs } = app.ports.overlays.shown[0]!;
    expect(durationMs).toBe(5000);
    // The same numbers as on the Monitors page: left to right.
    expect(labels.map((l) => [l.text, l.caption, l.x, l.width, l.height])).toEqual([
      ['1', 'LC49G95T · Main view', 0, 5120, 1440],
      ['2', 'MFD left · Left DDI', 5120, 768, 1024],
      ['3', 'MFD centre · AMPCD', 5888, 768, 1024],
      ['4', 'MFD right · Right DDI', 6656, 768, 1024],
    ]);
    // It changes nothing.
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);

    app.ports.overlays.showLabels = async () => err('overlay.show', 'Could not show the labels.');
    await expect(app.invoke('dcs-setup:identifyScreens', { setup })).rejects.toThrow(
      /overlay\.show/
    );
    app.ports.state.displays = app.ports.state.displays.map((d) => ({ ...d, enabled: false }));
    await expect(app.invoke('dcs-setup:identifyScreens', { setup })).rejects.toThrow(
      /No monitor is on/
    );
  });
});

describe('moving a display to another monitor', () => {
  const crop = { left: 8, top: 256, right: 8, bottom: 6 };

  it('keeps the crop when the new monitor is the same size', () => {
    expect(moveCrop({ width: 768, height: 1024 }, { width: 768, height: 1024 }, crop)).toEqual({
      crop,
      kept: true,
    });
  });

  it('drops the crop, and says so, when the new monitor is another size', () => {
    expect(moveCrop({ width: 768, height: 1024 }, { width: 1024, height: 768 }, crop)).toEqual({
      crop: NO_CROP,
      kept: false,
    });
    // The monitor it was set for is gone from the layout: its size is not known.
    expect(moveCrop(undefined, { width: 768, height: 1024 }, crop)).toEqual({
      crop: NO_CROP,
      kept: false,
    });
  });

  it('has nothing to keep, and nothing to say, when there was no crop', () => {
    expect(moveCrop({ width: 768, height: 1024 }, { width: 1024, height: 768 }, NO_CROP)).toEqual({
      crop: NO_CROP,
      kept: true,
    });
    expect(moveCrop(undefined, { width: 1024, height: 768 }, undefined)).toEqual({
      crop: NO_CROP,
      kept: true,
    });
  });
});

describe('where DCS shows the kneeboard', () => {
  const wide = { id: 'wide', x: 0, y: 0, width: 5120, height: 1440 };
  const mfds = [
    { id: 'left', x: 5120, y: 0, width: 768, height: 1024 },
    { id: 'centre', x: 5888, y: 0, width: 768, height: 1024 },
    { id: 'right', x: 6656, y: 0, width: 768, height: 1024 },
  ];

  it('is the bottom right of the whole window: on the rig of the sitting, the right small screen', () => {
    const place = kneeboardPlace({ x: 0, y: 0, width: 7424, height: 1440 }, [wide, ...mfds]);
    // Half the window's height wide, at the kneeboard's own shape (ViewportHandling.lua).
    expect(place.rect).toEqual({ x: 6704, y: 355, width: 720, height: 1085 });
    expect(place.displayId).toBe('right');
    expect(place.whole).toBe(false);
    // 720 x 669 of its 720 x 1085 are on the screen: the rest is below the screen's lower edge.
    expect(place.shown).toBeCloseTo(669 / 1085, 3);
  });

  it('is all on the main screen when the window is that screen alone', () => {
    const place = kneeboardPlace({ x: 0, y: 0, width: 5120, height: 1440 }, [wide]);
    expect(place.rect).toEqual({ x: 4400, y: 355, width: 720, height: 1085 });
    expect(place).toMatchObject({ displayId: 'wide', whole: true, shown: 1 });
  });

  it('is never wider than half the window', () => {
    const place = kneeboardPlace({ x: 0, y: 0, width: 1000, height: 1440 }, [
      { id: 'tall', x: 0, y: 0, width: 1000, height: 1440 },
    ]);
    expect(place.rect.width).toBe(500);
    expect(place.rect.x + place.rect.width).toBe(1000);
    expect(place.rect.y + place.rect.height).toBe(1440);
    expect(place.whole).toBe(true);
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

  it('names the aircraft once above the displays it uses, not before every one', () => {
    const three = [
      ...desktop,
      { ...desktop[1]!, id: 'mid', x: 2720 },
      { ...desktop[1]!, id: 'right', x: 3520 },
    ];
    const on = (name: string, displayId: string): ScreenSetup['aircraft'][0]['placements'][0] => ({
      name,
      displayId,
      crop: NO_CROP,
    });
    const generated = generateSetup({
      mainDisplayIds: ['main'],
      desktop: three,
      desktopLabel: 'Test',
      aircraft: [
        {
          unit: 'FA-18C_hornet',
          label: 'F/A-18C Hornet',
          placements: [
            on('LEFT_MFCD', 'left'),
            on('CENTER_MFCD', 'mid'),
            on('RIGHT_MFCD', 'right'),
          ],
        },
        // The Viper shares the two side displays and has no centre one.
        {
          unit: 'F-16C_50',
          label: 'F-16C Viper',
          placements: [on('LEFT_MFCD', 'left'), on('RIGHT_MFCD', 'right')],
        },
      ],
    });
    expect(generated.errors).toEqual([]);
    const comments = generated.lua.split('\n').filter((line) => /^-- F/.test(line));
    // One line for the two displays both aircraft use, one for the Hornet's own.
    expect(comments.sort()).toEqual(['-- F/A-18C Hornet', '-- F/A-18C Hornet, F-16C Viper']);
    // Still plain data DCS reads back the same.
    expect(parseLuaData(generated.lua).ok).toBe(true);
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
