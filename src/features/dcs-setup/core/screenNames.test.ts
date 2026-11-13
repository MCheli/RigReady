import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseLuaData } from '../../../core/lua/data';
import type { JournalGroup } from '../../../core/ports';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ScreensPreview, ScreensState } from '../contract';
import { scanViewportNames } from './cockpitDisplays';
import { evaluateMonitorSetup } from './monitorFiles';
import {
  AircraftScreensSchema,
  aircraftLabel,
  aircraftLabelProblem,
  generateSetup,
  NO_CROP,
  typedAircraft,
  unitNameProblem,
  viewportNameProblem,
  type AircraftScreens,
  type ScreenSetup,
} from './screens';

/**
 * Names typed on the Screens tab (a display, an aircraft) end up in RigReady.lua, a file DCS
 * runs. These tests hold the rule: a name is written only when it can be nothing but a name,
 * anything else is refused with a reason before a byte is written, and no text of any kind
 * can add a line to the script.
 */

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/**',
  'AppData/Roaming/SimAppPro/**',
  'AppData/Local/Programs/SimAppPro/**',
];

const rigReadyLua = (): string =>
  path.join(app.ports.folders.savedGames(), 'DCS', 'Config', 'MonitorSetup', 'RigReady.lua');

/** The setup the rig's plan gives, with these aircraft in place of its own. */
async function setupWith(
  aircraft: (small: string[]) => AircraftScreens[]
): Promise<{ setup: ScreenSetup; small: string[] }> {
  const imported = await app.invoke<{ setup: ScreenSetup }>('dcs-setup:importSimAppPro', {
    desktopId: 'current',
  });
  // The monitors the plan puts the Hornet's displays on: three small screens.
  const small = imported.setup.aircraft[0]!.placements.map((p) => p.displayId);
  return { setup: { ...imported.setup, aircraft: aircraft(small) }, small };
}

const NAME_RULE =
  'A display name has only letters, digits and _, starts with a letter or _, and is at most 64 characters long.';
const UNIT_RULE =
  'An aircraft name has only letters, digits, spaces and the signs _ . + -, starts with a letter or a digit, and is at most 64 characters long.';

/** The Unicode line and paragraph separators, by number so that no editor turns them into a line break. */
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);
const NEXT_LINE = String.fromCharCode(0x85);
const NUL = String.fromCharCode(0);

/** Text that would be code, or would end a line, a string or a comment, if it were written as it is. */
const HOSTILE = [
  "x = 1; os.execute('calc')",
  'LEFT_MFCD = nil\nos.exit()',
  'A\r\nos.exit()',
  `A${LINE_SEPARATOR}os.exit()`,
  ']] os.exit() --[[',
  "'] = {}; os.exit() --",
  '"; os.exit() --',
  'A\\',
  'LEFT-MFCD',
  'LEFT MFCD',
  '{}',
];

/** Names that are only letters, but that the file or DCS already uses for something else. */
const TAKEN = ['end', 'function', 'nil', 'Viewports', 'name', 'Description', '_G', 'pairs', 'os'];

describe('the names a display or an aircraft can have', () => {
  it('takes the names DCS aircraft use for their displays', () => {
    for (const name of ['LEFT_MFCD', 'F14_TID', 'Shkval', 'ABRIS', 'EHSI', '_x1', 'a'.repeat(64)])
      expect(viewportNameProblem(name)).toBeUndefined();
  });

  it('refuses any other display name, and says why in plain words', () => {
    expect(viewportNameProblem('')).toBe('Type the name of the display.');
    for (const name of [...HOSTILE, '1ST', 'a.b', 'ЛЕВЫЙ', 'a'.repeat(65)])
      expect(viewportNameProblem(name)).toBe(NAME_RULE);
    for (const name of ['Center', 'center', 'UIMainView', 'GU_MAIN_VIEWPORT'])
      expect(viewportNameProblem(name)).toBe("That is DCS's name for the main view.");
    for (const name of ['end', 'function', 'nil', 'while'])
      expect(viewportNameProblem(name)).toBe(
        "That is a word of the Lua language, which DCS's monitor setup file is written in."
      );
    for (const name of [
      'Viewports',
      'name',
      'Description',
      '_G',
      'pairs',
      'os',
      'screen',
      'shared',
      'by_unit',
      'reconfigure_for_unit',
    ])
      expect(viewportNameProblem(name)).toBe(
        "DCS's monitor setup file already uses that name for something else."
      );
  });

  it('takes the names DCS has for aircraft, and refuses anything else', () => {
    for (const unit of [
      'FA-18C_hornet',
      'F-16C_50',
      'Su-25T',
      'F-86F Sabre',
      'Christen Eagle II',
      'F-14A-135-GR',
      'AH-64D_BLK_II',
      'MiG-29 Fulcrum',
      'F-16C bl.52d',
    ])
      expect(unitNameProblem(unit)).toBeUndefined();
    expect(unitNameProblem('')).toBe('Type the name DCS has for the aircraft.');
    for (const unit of [...HOSTILE.filter((h) => !/^[A-Z -]+$/.test(h)), ' F-16', 'F/A-18C'])
      expect(unitNameProblem(unit)).toBe(UNIT_RULE);
  });

  it('an aircraft typed by a DCS name of up to 64 characters makes a setup that can be sent and saved', () => {
    for (const unit of ['F-16C_50', 'A'.repeat(60), 'A'.repeat(61), `F${'-1'.repeat(31)}A`]) {
      expect(unitNameProblem(unit), unit).toBeUndefined();
      const typed = typedAircraft(unit);
      expect(typed.unit).toBe(unit);
      expect(AircraftScreensSchema.safeParse(typed).success, unit).toBe(true);
      expect(aircraftLabelProblem(typed.label), unit).toBeUndefined();
    }
    expect(typedAircraft('A'.repeat(64)).label).toBe('A'.repeat(60));
    // Out of a file without a name to show, the DCS name stands in, cut to fit too.
    expect(aircraftLabel('', 'B'.repeat(64))).toBe('B'.repeat(60));
    expect(aircraftLabel('\n', 'C'.repeat(59) + ' D')).toBe('C'.repeat(59));
  });

  it('wants the name shown for an aircraft to be one short line', () => {
    expect(aircraftLabelProblem('F/A-18C Hornet')).toBeUndefined();
    expect(aircraftLabelProblem('Mark\'s "Hog" -- [[the old one]]')).toBeUndefined();
    expect(aircraftLabelProblem('  ')).toBe('An aircraft needs a name to show.');
    expect(aircraftLabelProblem('a'.repeat(61))).toBe(
      'The name shown for an aircraft has at most 60 characters.'
    );
    for (const label of ['A\nB', 'A\rB', `A${LINE_SEPARATOR}B`, `A${NUL}B`, 'A\tB'])
      expect(aircraftLabelProblem(label)).toBe(
        'The name shown for an aircraft is one line of plain text.'
      );
  });

  it('does not list a name out of an aircraft file that the setup file could not carry', () => {
    const script = [
      'try_find_assigned_viewport("LEFT_MFCD")',
      'find_viewport("os")',
      'find_viewport("Viewports")',
      'try_find_assigned_viewport("end", "RIGHT_MFCD")',
      'find_viewport("GU_MAIN_VIEWPORT")',
      'find_viewport("F14_TID")',
    ].join('\n');
    expect(scanViewportNames(script).map((v) => v.name)).toEqual(['LEFT_MFCD', 'F14_TID']);
  });
});

describe('a name added on the Screens tab', () => {
  it('is offered for every installed aircraft, with or without displays found in its files', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    const withDisplays = state.catalog.map((c) => c.unit);
    const without = state.noDisplaysFound.map((o) => o.unit);
    expect(withDisplays).toEqual(expect.arrayContaining(['FA-18C_hornet', 'F-16C_50']));
    // Installed on the rig, no display found in their files: offered apart, never as having displays.
    expect(without).toEqual(expect.arrayContaining(['Su-25T', 'UH-1H', 'P-51D']));
    expect(without.filter((unit) => withDisplays.includes(unit))).toEqual([]);
    expect(state.noDisplaysFound.find((o) => o.unit === 'Su-25T')!.label).toBe('Su-25T Frogfoot');
  });

  it('is written as typed, through the file store, when it can only be a name', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const { setup } = await setupWith((small) => [
      // An installed aircraft with no display found, and a display typed for it.
      {
        unit: 'Su-25T',
        label: 'Su-25T',
        placements: [{ name: 'MY_DISPLAY', displayId: small[0]!, crop: NO_CROP }],
      },
      // An aircraft RigReady has never heard of, typed too.
      {
        unit: 'My-Plane 2',
        label: 'My-Plane 2',
        placements: [{ name: 'Radar_1', displayId: small[1]!, crop: NO_CROP }],
      },
    ]);
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.errors).toEqual([]);
    await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true });

    const written = await fs.readFile(rigReadyLua(), 'utf8');
    expect(written).toBe(preview.lua);
    const parsed = parseLuaData(written);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // Nothing but the usual names and the two typed ones is assigned.
    expect(parsed.value.statements.map((s) => s.name)).toEqual([
      'name',
      'Description',
      'Viewports',
      'UIMainView',
      'GU_MAIN_VIEWPORT',
      'MY_DISPLAY',
      'Radar_1',
    ]);
    expect(written).toContain('-- Su-25T\nMY_DISPLAY =');
    expect(written).toContain('-- My-Plane 2\nRadar_1 =');

    // Written through the file store: on the journal, so it can be put back.
    const groups = await app.ports.files.journalGroups();
    const group = (groups.ok ? groups.value : []).find(
      (g: JournalGroup) => g.reason === 'Use the RigReady screen setup in DCS'
    )!;
    expect(group.entries.map((e) => path.basename(e.path))).toContain('RigReady.lua');
    const state = await app.invoke<ScreensState>('dcs-setup:screens');
    expect(state.saved).toEqual(setup);
  });

  it('is refused with the reason, and nothing is written, when it has any other character', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    for (const hostile of HOSTILE) {
      const asDisplay = await setupWith((small) => [
        {
          unit: 'FA-18C_hornet',
          label: 'F/A-18C Hornet',
          placements: [{ name: hostile, displayId: small[0]!, crop: NO_CROP }],
        },
      ]);
      for (const channel of ['dcs-setup:previewScreens', 'dcs-setup:applyScreens'])
        await expect(
          app.invoke(channel, { setup: asDisplay.setup, pairingChecked: true })
        ).rejects.toThrow(/ipc\.input[\s\S]*A display name has only letters, digits and _/);
    }
    for (const hostile of [...HOSTILE.filter((h) => !/^[A-Z -]+$/.test(h)), 'F/A-18C']) {
      const asAircraft = await setupWith((small) => [
        {
          unit: hostile,
          label: 'An aircraft',
          placements: [{ name: 'LEFT_MFCD', displayId: small[0]!, crop: NO_CROP }],
        },
      ]);
      for (const channel of ['dcs-setup:previewScreens', 'dcs-setup:applyScreens'])
        await expect(
          app.invoke(channel, { setup: asAircraft.setup, pairingChecked: true })
        ).rejects.toThrow(/ipc\.input[\s\S]*An aircraft name has only letters, digits, spaces/);
    }
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);
  });

  it('is refused with the reason, and nothing is written, when the file already uses the word', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    const without = await setupWith((small) => [
      {
        unit: 'FA-18C_hornet',
        label: 'F/A-18C Hornet',
        placements: [{ name: 'LEFT_MFCD', displayId: small[0]!, crop: NO_CROP }],
      },
    ]);
    const clean = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', {
      setup: without.setup,
    });
    expect(clean.errors).toEqual([]);
    for (const taken of [...TAKEN, 'Center']) {
      const { setup } = await setupWith((small) => [
        {
          unit: 'FA-18C_hornet',
          label: 'F/A-18C Hornet',
          placements: [
            { name: 'LEFT_MFCD', displayId: small[0]!, crop: NO_CROP },
            { name: taken, displayId: small[1]!, crop: NO_CROP },
          ],
        },
      ]);
      const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
      expect(preview.errors).toEqual([
        `F/A-18C Hornet: "${taken}" cannot be a display name. ${viewportNameProblem(taken)}`,
      ]);
      // What the preview shows is the setup without that name, not a script with it in.
      expect(preview.lua).toBe(clean.lua);
      await expect(
        app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true })
      ).rejects.toThrow(/dcs\.screens\.invalid[\s\S]*cannot be a display name/);
    }
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);
  });

  it('is refused, and nothing is written, when the name shown for the aircraft has a line break', async () => {
    app = await wiredApp('flying-fresh', { files: FILES });
    for (const label of [
      'Hornet\nos.exit()',
      'Hornet\r\nos.exit()',
      `Hornet${LINE_SEPARATOR}os.exit()`,
    ]) {
      const { setup } = await setupWith((small) => [
        {
          unit: 'FA-18C_hornet',
          label,
          placements: [{ name: 'LEFT_MFCD', displayId: small[0]!, crop: NO_CROP }],
        },
      ]);
      await expect(
        app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true })
      ).rejects.toThrow(
        /dcs\.screens\.invalid[\s\S]*The name shown for an aircraft is one line of plain text\./
      );
    }
    expect(await app.ports.files.exists(rigReadyLua())).toBe(false);
  });
});

describe('the script, whatever names reach the generator', () => {
  // The generator is called here directly, past the checks above, as a caller with a bug would.
  const desktop = [
    { id: 'main', name: 'Main', x: 0, y: 0, width: 1920, height: 1080, rotation: 0, primary: true },
    { id: 'a', name: 'Small', x: 1920, y: 0, width: 800, height: 600, rotation: 0, primary: false },
    { id: 'b', name: 'Small', x: 2720, y: 0, width: 800, height: 600, rotation: 0, primary: false },
  ];
  const base = { mainDisplayIds: ['main'], desktop, desktopLabel: 'Test' };
  const left = { name: 'LEFT_MFCD', displayId: 'a', crop: NO_CROP };
  const hornet: AircraftScreens = { unit: 'FA-18C_hornet', label: 'Hornet', placements: [left] };

  /** The lines DCS runs: comments out, and the text inside the description left aside. */
  const code = (lua: string): string[] =>
    lua
      .split('\n')
      .filter((line) => !line.startsWith('-- '))
      .map((line) =>
        line.startsWith('Description = ') ? 'Description' : line.replace(/ = -- .*$/, ' =')
      );
  /** One whole Lua string in single quotes, with nothing after it. */
  const ONE_STRING = /^'(?:[^'\\]|\\.)*'$/;

  it('leaves out a display name that is not only a name', () => {
    const clean = generateSetup({ ...base, aircraft: [hornet] });
    expect(clean.errors).toEqual([]);
    for (const hostile of [...HOSTILE, ...TAKEN, 'Center', '']) {
      const generated = generateSetup({
        ...base,
        aircraft: [
          { ...hornet, placements: [left, { name: hostile, displayId: 'b', crop: NO_CROP }] },
        ],
      });
      // Byte for byte the script of the setup without it, and an error that stops the write.
      expect(generated.lua).toBe(clean.lua);
      expect(generated.errors).toHaveLength(1);
      expect(generated.errors[0]).toContain('cannot be a display name.');
      for (const lineEnd of ['\r', '\n', LINE_SEPARATOR])
        expect(generated.errors[0]).not.toContain(lineEnd);
    }
  });

  it('leaves out an aircraft whose name is not only a name', () => {
    const clean = generateSetup({ ...base, aircraft: [hornet] });
    for (const hostile of [...HOSTILE.filter((h) => !/^[A-Z -]+$/.test(h)), 'F/A-18C', '']) {
      const generated = generateSetup({
        ...base,
        aircraft: [
          hornet,
          // The same display somewhere else: without the check, a section of its own under this name.
          { unit: hostile, label: 'Other', placements: [{ ...left, displayId: 'b' }] },
        ],
      });
      expect(generated.lua).toBe(clean.lua);
      expect(generated.errors).toHaveLength(1);
      expect(generated.errors[0]).toContain('cannot be the name DCS has for an aircraft.');
    }
  });

  it('keeps the name shown for an aircraft inside one comment and one string, whatever it holds', () => {
    const fleet = (first: string, second: string): AircraftScreens[] => [
      { ...hornet, label: first },
      // Placed differently, so the file gets its per-aircraft section and the function with it.
      { unit: 'F-16C_50', label: second, placements: [{ ...left, displayId: 'b' }] },
    ];
    const clean = generateSetup({ ...base, aircraft: fleet('Hornet', 'Viper') });
    expect(clean.lua).toContain('function reconfigure_for_unit(unit_type)');
    for (const hostile of [...HOSTILE, '--[[', "\\'; os.exit() --", NUL, '']) {
      const generated = generateSetup({ ...base, aircraft: fleet(hostile, hostile) });
      const lines = generated.lua.split('\n');
      // No line break of any kind but the generator's own, and no other control character.
      for (const lineEnd of ['\r', LINE_SEPARATOR, PARAGRAPH_SEPARATOR, NEXT_LINE])
        expect(generated.lua).not.toContain(lineEnd);
      expect(generated.lua.replace(/[\n\t]/g, '')).not.toMatch(/\p{Cc}/u);
      // The same lines of code, in the same number, as with harmless names.
      expect(lines).toHaveLength(clean.lua.split('\n').length);
      expect(code(generated.lua)).toEqual(code(clean.lua));
      expect(lines.find((l) => l.startsWith('Description = '))!.slice(14)).toMatch(ONE_STRING);
      // And DCS would get the same rectangles from it.
      for (const unit of ['FA-18C_hornet', 'F-16C_50']) {
        const options = { screen: { width: 3520, height: 1080 }, displays: desktop, unit };
        expect(evaluateMonitorSetup(generated.lua, options).exports).toEqual(
          evaluateMonitorSetup(clean.lua, options).exports
        );
      }
    }
  });

  it('writes a name with quotes in it as text, and the file still reads as plain data', () => {
    const label = 'Mark\'s "Hog" \\ -- [[x]] \'; os.exit()';
    const generated = generateSetup({ ...base, aircraft: [{ ...hornet, label }] });
    expect(generated.errors).toEqual([]);
    const parsed = parseLuaData(generated.lua);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.statements.map((s) => s.name)).toEqual([
      'name',
      'Description',
      'Viewports',
      'UIMainView',
      'GU_MAIN_VIEWPORT',
      'LEFT_MFCD',
    ]);
    expect(parsed.value.get('Description')).toBe(
      `Main view on Main; cockpit displays for ${label}`
    );
  });
});
