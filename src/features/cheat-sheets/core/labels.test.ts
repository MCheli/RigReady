import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { kindsOn, kneeboardDevicePage, kneeboardListPage, printDocument } from './pages';
import { fitText, renderDeviceSvg, textWidth, wrappedRows } from './render';
import {
  actionIndex,
  deviceFingerprint,
  physicalLabels,
  sheetTitle,
  summaryActions,
  type Sheet,
  type SheetDevice,
} from './sheet';

/**
 * What a label says and how it fits: the binding guide's plain names on every form of a
 * sheet (AI-001), text that is too long for its card, the racing games' sheets on the
 * racing rig, and a sheet that follows the bindings while it is open.
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const DCS_FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
const RACING_FILES = [
  'Documents/iRacing/**',
  'Documents/Assetto Corsa/**',
  'AppData/Local/BeamNG/**',
  'Program Files (x86)/Steam/steamapps/**',
];

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function hornet(): Promise<WiredApp> {
  app = await wiredApp('cheat-sheets-hornet', { files: DCS_FILES });
  return app;
}
async function racing(scenario = 'mark-racing'): Promise<WiredApp> {
  app = await wiredApp(scenario, { files: RACING_FILES });
  return app;
}

const byTitle = (sheet: Sheet, title: string): SheetDevice => {
  const device = sheet.devices.find((d) => d.title === title);
  if (!device) throw new Error(`No device ${title} in ${sheet.devices.map((d) => d.title)}`);
  return device;
};
const control = (device: SheetDevice, id: string) => device.controls.find((c) => c.id === id);

describe('plain-language names from the binding guide (AI-001)', () => {
  it('are what a label, the action list, the printout and the kneeboard pages say, with the game’s own name kept beside them', async () => {
    const running = await hornet();
    const labels = await running.wiring.context.bindings.labels('dcs', HORNET.aircraftId);
    expect(labels['Sensor Control Switch - Fwd']).toBe('Sensor select: HUD');

    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    const all = stick.controls.flatMap((c) => c.bindings);
    const select = all.find((b) => b.action === 'Sensor Control Switch - Fwd')!;
    // The game's name stays the identity; the plain one is for reading.
    expect(select).toMatchObject({ plain: 'Sensor select: HUD', short: 'Sensor select: HUD' });
    // Kinds are still decided from the game's own name and category.
    expect(select.kind).toBe('sensors');
    // An action the guide does not name keeps the game's wording, shortened.
    const unnamed = all.find((b) => labels[b.action] === undefined)!;
    expect(unnamed.plain).toBeUndefined();
    expect(unnamed.short.length).toBeLessThanOrEqual(unnamed.action.length);

    // The sheet view: the card says it plainly, the tooltip has both names.
    const svg = renderDeviceSvg(stick, { theme: 'dark' });
    expect(svg).toContain('>Sensor select: HUD</div>');
    expect(svg).toContain('Sensor select: HUD (Sensor Control Switch - Fwd)');

    // "Which control does X": the entry carries both names.
    const entry = actionIndex(sheet).find((e) => e.action === 'Sensor Control Switch - Fwd')!;
    expect(entry.plain).toBe('Sensor select: HUD');

    // Print / PDF and the kneeboard pages (device page and list page).
    const print = printDocument(sheet, [stick], { paper: 'A4', summary: true, stamp: 's' });
    expect(print.html).toContain('>Sensor select: HUD</div>');
    expect(print.html).toContain('<span class="what">Pickle: release weapon</span>');
    const page = kneeboardDevicePage(sheet, stick, { style: 'night', stamp: 's' });
    expect(page).toContain('>Sensor select: HUD</div>');
    const list = kneeboardListPage(sheet, 'Stick', actionIndex(sheet, [stick.key]), {
      style: 'light',
      stamp: 's',
    });
    expect(list).toContain('<span class="what">Sensor select: HUD</span>');
    expect(list).not.toContain('<span class="what">Sensor Control Switch - Fwd</span>');
  });

  it('change what a page shows, so exported pages are known to be out of date', async () => {
    const sheet = await (await hornet()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    const without: SheetDevice = {
      ...stick,
      controls: stick.controls.map((c) => ({
        ...c,
        bindings: c.bindings.map(({ plain: _plain, ...b }) => b),
      })),
    };
    expect(deviceFingerprint(without)).not.toBe(deviceFingerprint(stick));
  });

  it('are left out when a game has no guide: the racing games name their actions plainly already', async () => {
    const running = await racing();
    expect(await running.wiring.context.bindings.labels('iracing', 'all')).toEqual({});
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', {
      game: 'iracing',
      aircraftId: 'all',
    });
    const bindings = sheet.devices[0]!.controls.flatMap((c) => c.bindings);
    expect(bindings.every((b) => b.plain === undefined)).toBe(true);
    expect(bindings.map((b) => b.short)).toContain('Shift up');
  });
});

describe('label text that is too long for its card', () => {
  const LONG = [
    'Hydraulic/Electrical Countermeasures-Dispenser Programme Selector Supercalifragilistic',
    'LCtrl+LWin: Autopilot/Nosewheel Steering Disengage (Paddle)',
  ];

  it('is measured per character, so wide and narrow letters are not counted alike', () => {
    expect(textWidth('WWWW', 10)).toBeGreaterThan(textWidth('iiii', 10) * 3);
    expect(textWidth('Roll', 20)).toBeCloseTo(textWidth('Roll', 10) * 2);
    expect(wrappedRows('Roll', 200, 12)).toBe(1);
    expect(wrappedRows('Sensor select: HUD', 60, 12)).toBeGreaterThanOrEqual(2);
    // One word wider than the box runs over as many rows as it needs: it is broken, not clipped.
    const word = 'Supercalifragilisticexpialidocious';
    expect(wrappedRows(word, 60, 12)).toBe(Math.ceil(textWidth(word, 12) / 60));
    expect(wrappedRows(`a ${word}`, 60, 12)).toBeGreaterThanOrEqual(wrappedRows(word, 60, 12));
  });

  it('steps the size down while that helps, then shows whole rows and an ellipsis: never a clipped row', () => {
    for (const [w, h] of [
      [120, 54],
      [176, 62],
      [100, 46],
      [60, 30],
      [234, 60],
    ] as const) {
      for (const scale of [1, 1.12]) {
        const fitted = fitText(LONG, w - 13, h - 4, scale, true);
        const rows = fitted.lines.reduce(
          (n, line) => n + wrappedRows(line, w - 13, fitted.size),
          0
        );
        // Head row plus the text rows fit inside the box at the chosen size.
        const needed = fitted.size * 0.82 * 1.16 + rows * fitted.size * 1.16;
        if (rows > 1) expect(needed, `${w}x${h} at ${scale}`).toBeLessThanOrEqual(h - 4);
        expect(fitted.shortened).toBe(true);
        expect(fitted.lines.at(-1)!.endsWith('…')).toBe(true);
        expect(fitted.lines.length).toBeGreaterThan(0);
      }
    }
    // Text that fits is left alone, at the largest size that holds it.
    expect(fitText(['Roll'], 200, 40)).toEqual({ size: 14, lines: ['Roll'], shortened: false });
    const snug = fitText(['Sensor select: HUD', 'Gear up'], 107, 50, 1, true);
    expect(snug.shortened).toBe(false);
    expect(snug.size).toBeLessThan(14);
    expect(snug.lines).toEqual(['Sensor select: HUD', 'Gear up']);
  });

  it('is drawn in a card whose style breaks a long word instead of letting it stick out', async () => {
    const sheet = await (await hornet()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    // One word that is wider than the card, after an action that already takes two rows.
    const note = 'Supercalifragilisticexpialidocious-and-then-some-more-than-a-card-holds';
    const long: SheetDevice = {
      ...stick,
      controls: stick.controls.map((c) =>
        c.id === 'button:20'
          ? { ...c, note, bindings: c.bindings.map((b) => ({ ...b, short: LONG[0]! })) }
          : c
      ),
    };
    for (const theme of ['dark', 'light', 'night'] as const) {
      const svg = renderDeviceSvg(long, { theme, fontScale: 1.12 });
      expect(svg).toContain('overflow-wrap:anywhere');
      const card = /data-control="button:20".*?<\/foreignObject>/s.exec(svg)![0];
      // The card says it was shortened, ends in an ellipsis, and the tooltip has it all.
      expect(card).toContain('data-shortened="true"');
      expect(card).toContain('…</div>');
      expect(card).toContain(`${note})</title>`);
      // The action is whole; it is the note that gives way, at a size that still reads.
      expect(card).toContain(`<div class="cs-act">${LONG[0]}</div>`);
      expect(card).toMatch(/<div class="cs-note">✎ Supercalifragilistic[^<]*…<\/div>/);
      expect(card).toContain('style="font-size:11.4px"');
    }
  });

  it('never shortens a label of the recorded rig, on screen, on paper or on a kneeboard page', async () => {
    const check = (sheet: Sheet): void => {
      // 1 is the sheet in the app and in print, 1.12 the kneeboard page.
      for (const fontScale of [1, 1.12]) {
        for (const device of sheet.devices) {
          const svg = renderDeviceSvg(device, { theme: 'light', fontScale });
          expect(svg, `${sheet.gameName} ${device.title} at ${fontScale}`).not.toContain(
            'data-shortened'
          );
          // Nothing is smaller than the smallest label size (10.2, scaled).
          const sizes = [...svg.matchAll(/class="cs-t" style="font-size:([\d.]+)px"/g)].map((m) =>
            Number(m[1])
          );
          expect(Math.min(...sizes), device.title).toBeGreaterThanOrEqual(
            Math.round(10.2 * fontScale * 10) / 10
          );
        }
      }
    };
    check(await (await hornet()).invoke<Sheet>('cheat-sheets:sheet', HORNET));
    await app?.cleanup();
    const onRacingRig = await racing();
    for (const game of ['iracing', 'lmu', 'beamng', 'assetto-corsa']) {
      check(await onRacingRig.invoke<Sheet>('cheat-sheets:sheet', { game, aircraftId: 'all' }));
    }
  });
});

describe('cheat sheets for the racing games, on the racing rig', () => {
  interface Overview {
    games: { game: string; gameName: string; kneeboard: boolean; aircraft: { id: string }[] }[];
  }

  it('offers every racing game with bindings, each with one set for all cars', async () => {
    const running = await racing();
    const overview = await running.invoke<Overview>('cheat-sheets:overview');
    // DCS World is installed on the racing rig too, so it is offered beside the racing games.
    expect(overview.games.map((g) => g.game)).toEqual([
      'assetto-corsa',
      'beamng',
      'dcs',
      'iracing',
      'lmu',
    ]);
    for (const game of overview.games.filter((g) => g.game !== 'dcs')) {
      expect(game.aircraft[0]).toMatchObject({ id: 'all', general: true });
      // Kneeboard pages are a DCS thing.
      expect(game.kneeboard).toBe(false);
    }
    const dcs = overview.games.find((g) => g.game === 'dcs')!;
    expect(dcs.kneeboard).toBe(true);
    expect(dcs.aircraft.some((a) => a.id === 'all')).toBe(false);
  });

  it('draws the wheel with the shipped Fanatec layout and what iRacing has on each control', async () => {
    const running = await racing();
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', {
      game: 'iracing',
      aircraftId: 'all',
    });
    expect(sheet).toMatchObject({ game: 'iracing', gameName: 'iRacing' });
    expect(sheetTitle(sheet)).toBe('iRacing');
    expect(sheet.devices).toHaveLength(1);
    const wheel = sheet.devices[0]!;
    expect(wheel).toMatchObject({
      key: '0EB7:0007',
      name: 'FANATEC Podium Wheel Base DD2',
      connected: true,
      layoutSource: 'builtin',
      reports: { buttons: 108, hats: 1 },
      route: '/configure/racing/iracing',
    });
    expect(wheel.layout.name).toBe('Fanatec wheel base (Podium, ClubSport)');
    expect(control(wheel, 'axis:X')?.bindings.map((b) => b.action)).toEqual(['Steering']);
    expect(control(wheel, 'axis:Z')?.bindings[0]).toMatchObject({
      action: 'Throttle',
      kind: 'driving',
      source: 'user',
    });
    expect(control(wheel, 'button:5')?.bindings[0]?.action).toBe('Shift up');
    expect(control(wheel, 'button:6')?.bindings[0]?.action).toBe('Shift down');
    // The two halves of the wheel axis are one action, not a conflict.
    expect(wheel.counts.conflicts).toBe(0);
    // A control is named with the frame it is in, once: no "Right side Right paddle".
    expect(physicalLabels(wheel.layout).get('button:5')).toBe('Right side Paddle');
    expect(physicalLabels(wheel.layout).get('button:6')).toBe('Left side Paddle');
    expect(physicalLabels(wheel.layout).get('axis:RZ')).toBe('Brake pedal');
    expect(physicalLabels(wheel.layout).get('button:14')).toBe('Shifter');
    // A bound button the layout does not place is added below it, never left out.
    expect(control(wheel, 'button:26')?.bindings[0]?.action).toBe('Reset car');
    expect(wheel.layout.groups.some((g) => g.label === 'More controls')).toBe(true);
    expect(kindsOn(wheel)).toEqual(['driving', 'view']);
    expect(renderDeviceSvg(wheel, { theme: 'dark' })).toContain('>Shift up</div>');

    // The summary of a racing sheet leads with driving, and prints under the game's name.
    expect(summaryActions(sheet, 20)[0]!.kind).toBe('driving');
    const print = printDocument(sheet, [wheel], { paper: 'A4', summary: true, stamp: 's' });
    expect(print.html).toContain('<div class="ac">iRacing</div>');
  });

  it('puts Le Mans Ultimate’s D-pad on the hat and its second bindings on the far buttons', async () => {
    const running = await racing();
    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', {
      game: 'lmu',
      aircraftId: 'all',
    });
    const wheel = sheet.devices[0]!;
    expect(control(wheel, 'hat:1:U')?.bindings[0]).toMatchObject({
      action: 'Pit Menu Up',
      kind: 'pit',
    });
    const bias = control(wheel, 'button:33')!.bindings[0]!;
    expect(bias).toMatchObject({ action: 'Bias Forward', kind: 'car', alsoOn: ['Button 104'] });
    expect(control(wheel, 'axis:RX')?.conflict).toBe(false);
    expect(wheel.route).toBe('/configure/racing/lmu');
  });

  it('saves the printout of a racing sheet under the game’s name', async () => {
    const running = await racing();
    const target = path.join(running.ports.folders.documents(), 'wheel.pdf');
    running.ports.dialogs.script.save.push(target);
    const saved = await running.invoke<{ path: string; pages: number }>('cheat-sheets:savePdf', {
      game: 'assetto-corsa',
      aircraftId: 'all',
      devices: ['0EB7:0007'],
    });
    expect(saved).toEqual({ path: target, pages: 2 });
    expect(JSON.stringify(running.ports.dialogs.calls.at(-1))).toContain(
      'Assetto Corsa cheat sheet.pdf'
    );
  });
});

describe('where a sheet opens when nothing was chosen yet', () => {
  const suggest = async (scenario: string): Promise<unknown> => {
    await app?.cleanup();
    app = await wiredApp(scenario, { files: [...DCS_FILES, ...RACING_FILES] });
    return app.invoke('cheat-sheets:suggest');
  };

  it('is the game of the setup in use, not the first game in the alphabet', async () => {
    // The flying rig has the wheel plugged in and bindings in five games; its setup is for DCS.
    expect(await suggest('cheat-sheets-hornet')).toEqual({
      game: 'dcs',
      aircraftId: 'FA-18C_hornet',
    });
    // The racing rig with an iRacing setup.
    expect(await suggest('tour-racing')).toEqual({ game: 'iracing', aircraftId: 'all' });
  });

  it('is, without a setup, the game most of the connected controllers are bound in', async () => {
    // Stick, throttle and panels connected: nearly everything of the user's own is in DCS.
    expect(await suggest('flying-fresh')).toEqual({ game: 'dcs', aircraftId: 'FA-18C_hornet' });
    // Only the wheel: DCS has nothing of the user's on it, Le Mans Ultimate has the most.
    expect(await suggest('mark-racing')).toEqual({ game: 'lmu', aircraftId: 'all' });
    // No game at all.
    await app?.cleanup();
    app = await wiredApp('generic-fresh');
    expect(await app.invoke('cheat-sheets:suggest')).toBeNull();
  });
});

describe('a sheet follows the bindings while it is open', () => {
  it('tells every window when the bindings page changed a binding, with the game it was', async () => {
    const running = await hornet();
    const changes = () => running.events.filter((e) => e.channel === 'cheat-sheets:event:changed');
    expect(changes()).toHaveLength(0);
    const before = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(before, 'Stick');
    expect(control(stick, 'button:1')).toBeUndefined();

    // What the bindings page does: one edit, applied through the DCS bindings feature.
    const view = await running.invoke<{
      devices: { id: string; guid?: string }[];
      commands: { id: string; name: string }[];
    }>('dcs-bindings:aircraft', { id: HORNET.aircraftId });
    const device = view.devices.find((d) => d.guid?.toUpperCase() === stick.guid)!;
    const command = view.commands.find((c) => c.name === 'Canopy Control Switch - OPEN')!;
    const applied = await running.invoke<{ groupId: string }>('dcs-bindings:apply', {
      ops: [
        {
          op: 'bind',
          aircraft: HORNET.aircraftId,
          deviceId: device.id,
          commandId: command.id,
          combo: { key: 'JOY_BTN1', reformers: [] },
        },
      ],
    });
    expect(changes().map((e) => e.payload)).toEqual([{ game: 'dcs' }]);
    const after = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    expect(control(byTitle(after, 'Stick'), 'button:1')?.bindings[0]).toMatchObject({
      action: 'Canopy Control Switch - OPEN',
      short: 'Canopy: OPEN',
    });

    // Undo on the bindings page is a change of the files too: the sheet goes back.
    await running.invoke('dcs-bindings:undo', { groupId: applied.groupId });
    expect(changes().map((e) => e.payload)).toEqual([{ game: 'dcs' }, { game: 'dcs' }]);
    const undone = await running.invoke<Sheet>('cheat-sheets:sheet', HORNET);
    expect(control(byTitle(undone, 'Stick'), 'button:1')).toBeUndefined();
  });

  it('hears a racing page too: repairing iRacing’s device id redraws the iRacing sheet', async () => {
    const running = await racing('racing-iracing-moved-wheel');
    const ref = { game: 'iracing', aircraftId: 'all' };
    const before = await running.invoke<Sheet>('cheat-sheets:sheet', ref);
    // The wheel iRacing knows is not the one that is connected: two devices, one unbound.
    expect(before.devices.map((d) => [d.connected, d.counts.bound > 0])).toEqual([
      [false, true],
      [true, false],
    ]);
    const live = running.ports.input.devices().find((d) => d.vendorId === '0EB7')!;
    await running.invoke('racing:iracingRepair', {
      mapping: [{ from: before.devices[0]!.guid, to: live.guid }],
    });
    expect(
      running.events.filter((e) => e.channel === 'cheat-sheets:event:changed').map((e) => e.payload)
    ).toEqual([{ game: 'iracing' }]);
    const after = await running.invoke<Sheet>('cheat-sheets:sheet', ref);
    expect(after.devices.map((d) => [d.connected, d.counts.bound > 0])).toEqual([[true, true]]);
  });

  it('hears Le Mans Ultimate’s repair of a renamed wheel base', async () => {
    const running = await wiredApp('racing-lmu-renamed-wheel', {
      files: ['Program Files (x86)/Steam/steamapps/**'],
    });
    app = running;
    const ref = { game: 'lmu', aircraftId: 'all' };
    const before = await running.invoke<Sheet>('cheat-sheets:sheet', ref);
    // The game still has the name the base had before the driver update.
    expect(before.devices.map((d) => d.name)).toEqual(['Fanatec Podium DD2 Wheel Base']);
    await running.invoke('racing:lmuRepair');
    expect(
      running.events.filter((e) => e.channel === 'cheat-sheets:event:changed').map((e) => e.payload)
    ).toEqual([{ game: 'lmu' }]);
    const after = await running.invoke<Sheet>('cheat-sheets:sheet', ref);
    expect(after.devices.map((d) => d.name)).toEqual(['FANATEC Podium Wheel Base DD2']);
    expect(after.devices[0]!.counts.bound).toBe(before.devices[0]!.counts.bound);
  });
});
