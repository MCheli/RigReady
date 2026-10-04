import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { FakeRender } from '../../../platform/fake';
import { pngSize } from '../../../platform/fake/png';
import type { InputState } from '../../../shared/models';
import { builtinLayoutFor } from './builtin';
import { serializeLayout, type DeviceLayout } from './layout';
import { kindsOn, kneeboardDevicePage, kneeboardListPage, printDocument } from './pages';
import { fitFont, renderDeviceSvg, THEMES } from './render';
import {
  actionIndex,
  deviceFingerprint,
  physicalLabels,
  summaryActions,
  type Sheet,
  type SheetDevice,
} from './sheet';

/**
 * Cheat sheets on the recorded rig: the owner's F/A-18C bindings first, then the UH-1H
 * (game defaults only), through the same IPC the window uses.
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const HUEY = { game: 'dcs', aircraftId: 'UH-1H' };
/** What the binding reader needs from the recorded rig. */
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(scenario = 'cheat-sheets-hornet'): Promise<WiredApp> {
  app = await wiredApp(scenario, { files: FILES });
  return app;
}

const byTitle = (sheet: Sheet, title: string): SheetDevice => {
  const device = sheet.devices.find((d) => d.title === title);
  if (!device) throw new Error(`No device ${title} in ${sheet.devices.map((d) => d.title)}`);
  return device;
};
const control = (device: SheetDevice, id: string) => device.controls.find((c) => c.id === id);

describe('the F/A-18C sheet from the recorded bindings', () => {
  it('has every controller of the rig, named as the owner named them, hands-on devices first', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    expect(sheet.aircraft).toEqual({ id: 'FA-18C_hornet', name: 'F/A-18C', hasUserBindings: true });
    expect(sheet.devices).toHaveLength(12);
    expect(sheet.devices.slice(0, 3).map((d) => d.title)).toEqual(['Stick', 'Throttle', 'Pedals']);
    const stick = byTitle(sheet, 'Stick');
    expect(stick).toMatchObject({
      key: '4098:BEA8',
      name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
      givenName: 'Stick',
      connected: true,
      layoutSource: 'builtin',
      reports: { buttons: 42, hats: 1 },
    });
    expect(stick.route).toContain('/configure/dcs-bindings/devices?aircraft=FA-18C_hornet&guid=');
    // The three MFD frames are three devices with three names.
    expect(['Left MFD', 'Centre MFD', 'Right MFD'].map((t) => byTitle(sheet, t).key)).toEqual([
      '4098:BEE1',
      '4098:BEE0',
      '4098:BEE2',
    ]);
    // A device nobody named keeps its own name, tidied.
    expect(byTitle(sheet, 'WinWing UFC1 + HUD1').givenName).toBeUndefined();
    // The ICP has nothing bound in the Hornet and still has a sheet, last.
    expect(sheet.devices.at(-1)).toMatchObject({ title: 'WinWing ICP', counts: { bound: 0 } });
  });

  it('says what every control does in plain language, and which controls are empty', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    expect(control(stick, 'button:20')?.bindings[0]).toMatchObject({
      action: 'Weapon Release Button',
      // The binding guide's plain name is what the label says (AI-001).
      plain: 'Pickle: release weapon',
      short: 'Pickle: release weapon',
      kind: 'weapons',
      source: 'user',
      modifiers: [],
    });
    expect(control(stick, 'hat:1:U')?.bindings[0]?.action).toBe('Trimmer Switch - PUSH(DESCEND)');
    // A diagonal of the hat still carries the game's default.
    expect(control(stick, 'hat:1:UL')?.bindings[0]).toMatchObject({
      source: 'default',
      kind: 'view',
    });
    expect(control(stick, 'axis:SLIDER1')?.bindings[0]?.action).toBe('Wheel Brake');
    // Nothing is bound to button 1: it has no entry, and the picture shows it empty.
    expect(control(stick, 'button:1')).toBeUndefined();
    expect(stick.counts).toMatchObject({ bound: 30, conflicts: 0, hidden: 0 });
    expect(stick.counts.placed).toBe(stick.counts.bound + stick.counts.empty);
    expect(renderDeviceSvg(stick, { theme: 'dark' })).toContain('data-control="button:1"');

    // Modifier variants are a second line: the Virpil panel's button 34 with LCtrl+LWin held.
    const panel = byTitle(sheet, 'R-VPC Panel #1');
    expect(control(panel, 'button:34')?.bindings.map((b) => [b.modifiers, b.short])).toEqual([
      [[], 'RADAR: CCW'],
      [['LCtrl', 'LWin'], 'ALR-67 DIS TYPE: CCW'],
    ]);
    expect(control(panel, 'button:34')?.conflict).toBe(false);
    expect(renderDeviceSvg(panel, { theme: 'light' })).toContain(
      '<b>LCtrl+LWin:</b> ALR-67 DIS TYPE: CCW'
    );
  });

  it('points out the same action on another control or device', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    expect(control(stick, 'button:19')?.bindings[0]?.alsoOn).toEqual(['Button 36']);
    expect(control(stick, 'button:26')?.bindings[0]?.alsoOn).toEqual(['Throttle: Button 35']);
    expect(control(stick, 'button:20')?.bindings[0]?.alsoOn).toEqual([]);
  });

  it('flags a control that fires two actions on one press', async () => {
    const sheet = await (
      await start('dcs-bindings-conflict')
    ).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const mfd = byTitle(sheet, 'WinWing MFD1-L');
    const knob = control(mfd, 'axis:SLIDER1')!;
    expect(knob.bindings).toHaveLength(2);
    expect(knob.conflict).toBe(true);
    expect(mfd.counts.conflicts).toBe(1);
    const svg = renderDeviceSvg(mfd, { theme: 'dark' });
    expect(svg).toMatch(/class="cs-ctl cs-bound cs-conflict" data-control="axis:SLIDER1"/);
    expect(svg).toContain('cs-flag-warn');
  });

  it('answers "which control does X" and picks the most important actions for a summary', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const index = actionIndex(sheet);
    const release = index.find((e) => e.action === 'Weapon Release Button')!;
    expect(release.places).toEqual([
      {
        deviceKey: '4098:BEA8',
        device: 'Stick',
        control: 'button:20',
        controlName: 'Button 20',
        physical: 'Weapon release',
        modifiers: [],
      },
    ]);
    const tdc = index.find((e) => e.action === 'Throttle Designator Controller - Depress')!;
    expect(tdc.places.map((p) => p.device)).toEqual(['Stick', 'Throttle']);
    expect(
      actionIndex(sheet, ['044F:B68F'])
        .map((e) => e.action)
        .sort()
    ).toEqual(['Rudder', 'Wheel Brake Left', 'Wheel Brake Right']);

    const summary = summaryActions(sheet, 32);
    const names = summary.map((e) => e.action);
    expect(names).toEqual(expect.arrayContaining(['Weapon Release Button', 'Select Sidewinder']));
    // Only the user's own bindings, no display pushbuttons, no view controls, and it fits the page.
    expect(summary.every((e) => e.source === 'user')).toBe(true);
    expect(summary.some((e) => e.kind === 'displays' || e.kind === 'view')).toBe(false);
    expect(summary.reduce((n, e) => n + e.places.length, 0)).toBeLessThanOrEqual(32);
    expect(summary[0]!.kind).toBe('weapons');
  });

  it('carries the names printed on the device from the layout', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const labels = physicalLabels(byTitle(sheet, 'Left MFD').layout);
    expect(labels.get('button:42')).toBe('OSB 1');
    const takeoff = physicalLabels(byTitle(sheet, 'WinWing F18 TAKEOFF PANEL 2').layout);
    expect(takeoff.get('button:5')).toBe('FLAP AUTO');
    expect(physicalLabels(byTitle(sheet, 'Stick').layout).get('hat:1:U')).toBe('TRIM hat ↑');
  });

  it('keeps a note on a control, shows it on the sheet and forgets it when cleared', async () => {
    const running = await start();
    const note = { ...HORNET, deviceKey: '4098:BEA8', control: 'button:20' };
    await running.invoke('cheat-sheets:setNote', { ...note, note: '  weapon release - hold ' });
    let stick = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    expect(control(stick, 'button:20')?.note).toBe('weapon release - hold');
    expect(renderDeviceSvg(stick, { theme: 'dark' })).toContain('✎ weapon release - hold');
    const before = deviceFingerprint(stick);
    // A note on an empty control makes it worth showing.
    await running.invoke('cheat-sheets:setNote', { ...note, control: 'button:1', note: 'spare' });
    stick = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    expect(control(stick, 'button:1')).toMatchObject({ bindings: [], note: 'spare' });
    expect(deviceFingerprint(stick)).not.toBe(before);
    // Notes belong to one aircraft.
    const huey = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HUEY), 'Stick');
    expect(control(huey, 'button:20')?.note).toBeUndefined();
    await running.invoke('cheat-sheets:setNote', { ...note, note: '' });
    await running.invoke('cheat-sheets:setNote', { ...note, control: 'button:1', note: ' ' });
    stick = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    expect(control(stick, 'button:20')?.note).toBeUndefined();
    expect(control(stick, 'button:1')).toBeUndefined();
    const stored = JSON.parse(
      await fs.readFile(
        path.join(running.ports.folders.dataRoot(), 'cheat-sheets', 'notes.json'),
        'utf8'
      )
    );
    expect(stored.notes).toEqual({});
  });

  it('follows the bindings: after a binding is edited the sheet shows it on its new control', async () => {
    const running = await start();
    const dir = path.join(running.home, 'Saved Games/DCS/Config/Input/FA-18C_hornet/joystick');
    const file = (await fs.readdir(dir)).find((n) => n.startsWith('WINWING Orion Joystick'))!;
    const text = await fs.readFile(path.join(dir, file), 'utf8');
    await fs.writeFile(path.join(dir, file), text.replaceAll('JOY_BTN20', 'JOY_BTN21'));
    const stick = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    expect(control(stick, 'button:20')).toBeUndefined();
    expect(control(stick, 'button:21')?.bindings[0]?.action).toBe('Weapon Release Button');
    const svg = renderDeviceSvg(stick, { theme: 'dark' });
    expect(svg).toMatch(/class="cs-ctl cs-empty" data-control="button:20"/);
    expect(svg).toMatch(/class="cs-ctl cs-bound" data-control="button:21"/);
  });
});

describe('the UH-1H sheet', () => {
  it('is drawn from the game defaults when the user has bound nothing', async () => {
    const running = await start();
    const overview = await running.invoke<{
      games: {
        game: string;
        kneeboard: boolean;
        aircraft: { id: string; hasUserBindings: boolean }[];
      }[];
    }>('cheat-sheets:overview');
    expect(overview.games).toHaveLength(1);
    expect(overview.games[0]).toMatchObject({ game: 'dcs', kneeboard: true });
    expect(overview.games[0]!.aircraft.find((a) => a.id === 'UH-1H')?.hasUserBindings).toBe(false);

    const sheet = await running.invoke<Sheet>('cheat-sheets:sheet', HUEY);
    expect(sheet.aircraft.hasUserBindings).toBe(false);
    const stick = byTitle(sheet, 'Stick');
    expect(stick.controls.length).toBeGreaterThan(5);
    expect(stick.controls.every((c) => c.bindings.every((b) => b.source === 'default'))).toBe(true);
    expect(control(stick, 'axis:X')?.bindings[0]?.kind).toBe('flight');
    // Defaults are told apart on the picture.
    expect(renderDeviceSvg(stick, { theme: 'light' })).toContain('cs-default');
    // Nothing of the user's own: the summary is empty and says so.
    expect(summaryActions(sheet)).toEqual([]);
    const printed = printDocument(sheet, [], { paper: 'A4', summary: true, stamp: '2026-10-03' });
    expect(printed.html).toContain('Nothing of your own is bound yet');
  });

  it('fails in words for an aircraft or a game that is not there', async () => {
    const running = await start();
    await expect(
      running.invoke('cheat-sheets:sheet', { game: 'nope', aircraftId: 'x' })
    ).rejects.toThrow(/cannot read the bindings of nope/);
  });
});

describe('layouts: the user’s own, shipped, generated', () => {
  const layoutFile = (running: WiredApp, name: string): string =>
    path.join(running.ports.folders.dataRoot(), 'cheat-sheets', 'layouts', name);

  it('uses the user’s layout for a device model, and the shipped one again after a reset', async () => {
    const running = await start();
    const mine: DeviceLayout = {
      ...builtinLayoutFor('044F', 'B68F')!,
      name: 'My pedals',
      groups: [{ label: 'Feet', x: 100, y: 20, w: 800, h: 500 }],
    };
    const saved = await running.invoke<{ file: string }>('cheat-sheets:saveLayout', {
      vendorId: '044f',
      productId: 'b68f',
      layout: mine,
    });
    expect(saved.file).toBe(layoutFile(running, '044F-B68F.rrlayout.json'));
    let pedals = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Pedals');
    expect(pedals.layoutSource).toBe('user');
    expect(pedals.layout.name).toBe('My pedals');
    expect(physicalLabels(pedals.layout).get('axis:Z')).toBe('Feet Rudder');
    // A layout cannot be saved for a device it is not for.
    await expect(
      running.invoke('cheat-sheets:saveLayout', {
        vendorId: '4098',
        productId: 'BEA8',
        layout: mine,
      })
    ).rejects.toThrow(/another device model/);

    expect(
      await running.invoke('cheat-sheets:resetLayout', { vendorId: '044F', productId: 'B68F' })
    ).toEqual({ removed: 1 });
    pedals = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Pedals');
    expect(pedals.layoutSource).toBe('builtin');
  });

  it('falls back to the shipped layout when the user’s file is broken, and says why', async () => {
    const running = await start();
    await fs.mkdir(path.dirname(layoutFile(running, 'x')), { recursive: true });
    await fs.writeFile(
      layoutFile(running, '044F-B68F.rrlayout.json'),
      '{ "format": "rigready-device-layout", '
    );
    const pedals = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Pedals');
    expect(pedals.layoutSource).toBe('builtin');
    expect(pedals.layoutProblem).toMatch(
      /could not be read, so the shipped layout is shown.*not valid JSON/
    );
    expect(pedals.layout.name).toBe('Thrustmaster TPR pedals');
  });

  it('generates a layout for a device without one, and keeps every binding on the picture', async () => {
    // A joystick nobody has drawn is plugged in: its sheet is a picture made from what it reports.
    const rig = await start();
    await mutate(rig, [
      {
        op: 'plugDevice',
        device: {
          instanceId: 'USB\\VID_046D&PID_C215\\5&1A2B3C4D&0&3',
          vendorId: '046D',
          productId: 'C215',
          name: 'Logitech Extreme 3D',
          isHid: true,
          isGameController: true,
          isHub: false,
          hubChain: [],
        },
        controller: {
          name: 'Logitech Extreme 3D',
          guid: 'AAAAAAAA-0000-0000-0000-444553540000',
          productGuid: '',
          vendorId: '046D',
          productId: 'C215',
          numAxes: 4,
          numButtons: 12,
          numHats: 1,
          axisNames: ['X', 'Y', 'RZ', 'SLIDER1'],
        },
      },
    ]);
    const logitech = byTitle(
      await rig.invoke<Sheet>('cheat-sheets:sheet', HORNET),
      'Logitech Extreme 3D'
    );
    expect(logitech.layoutSource).toBe('generated');
    expect(logitech.layout.groups.map((g) => g.label)).toEqual(['Axes', 'Hat', 'Buttons']);
    expect(logitech.counts.placed).toBe(4 + 8 + 12);
    expect(logitech.counts.hidden).toBe(0);
    expect(renderDeviceSvg(logitech, { theme: 'dark' })).toContain('data-control="button:12"');

    // A layout that leaves out bound controls gets them appended.
    const tiny: DeviceLayout = {
      ...builtinLayoutFor('4098', 'BEA8')!,
      controls: builtinLayoutFor('4098', 'BEA8')!.controls.slice(0, 1),
      groups: [],
    };
    await rig.invoke('cheat-sheets:saveLayout', {
      vendorId: '4098',
      productId: 'BEA8',
      layout: tiny,
    });
    const stick = byTitle(await rig.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    expect(stick.layoutSource).toBe('user');
    expect(stick.layout.groups.map((g) => g.label)).toEqual(['More controls']);
    expect(stick.counts.bound).toBe(30);
    expect(stick.counts.hidden).toBeGreaterThan(0);
  });

  it('shares a layout as a file and imports one, refusing a file for another device', async () => {
    const running = await start();
    const docs = path.join(running.home, 'Documents');
    await fs.mkdir(docs, { recursive: true });
    const pedals = builtinLayoutFor('044F', 'B68F')!;
    running.ports.dialogs.script.save.push('Documents/pedals.rrlayout.json', null);
    expect(await running.invoke('cheat-sheets:exportLayout', { layout: pedals })).toEqual({
      path: path.join(docs, 'pedals.rrlayout.json'),
    });
    expect(await fs.readFile(path.join(docs, 'pedals.rrlayout.json'), 'utf8')).toBe(
      serializeLayout(pedals)
    );
    expect(await running.invoke('cheat-sheets:exportLayout', { layout: pedals })).toEqual({
      path: null,
    });

    await fs.writeFile(path.join(docs, 'not-a-layout.json'), '{"hello":1}');
    await fs.writeFile(
      path.join(docs, 'template.svg'),
      '<svg viewBox="0 0 100 100"><text x="10" y="10">BUTTON_3</text></svg>'
    );
    await fs.writeFile(path.join(docs, 'drawing.svg'), '<svg viewBox="0 0 1 1"></svg>');
    const device = { vendorId: '044F', productId: 'B68F', name: 'Pedals' };
    running.ports.dialogs.script.open.push(
      ['Documents/pedals.rrlayout.json'],
      [],
      ['Documents/pedals.rrlayout.json'],
      ['Documents/not-a-layout.json'],
      ['Documents/template.svg'],
      ['Documents/drawing.svg']
    );
    expect(await running.invoke('cheat-sheets:importLayout', device)).toMatchObject({
      from: 'rigready',
      file: 'pedals.rrlayout.json',
      layout: { name: 'Thrustmaster TPR pedals' },
    });
    // Cancelled.
    expect(await running.invoke('cheat-sheets:importLayout', device)).toEqual({
      layout: null,
      skipped: [],
    });
    await expect(
      running.invoke('cheat-sheets:importLayout', { ...device, productId: 'B10A' })
    ).rejects.toThrow(/layout for another device.*044F:B68F.*044F:B10A/);
    await expect(running.invoke('cheat-sheets:importLayout', device)).rejects.toThrow(
      /not a usable layout.*not a RigReady device layout/
    );
    expect(await running.invoke('cheat-sheets:importLayout', device)).toMatchObject({
      from: 'joystick-diagrams',
      layout: { controls: [{ input: 'button:3' }] },
    });
    await expect(running.invoke('cheat-sheets:importLayout', device)).rejects.toThrow(
      /could not be converted.*placeholders/
    );
  });

  it('takes a photo of the device as a background, and refuses what is not a picture', async () => {
    const running = await start();
    const docs = path.join(running.home, 'Documents');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'photo.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    await fs.writeFile(path.join(docs, 'notes.txt'), 'hello');
    running.ports.dialogs.script.open.push(['Documents/photo.jpg'], ['Documents/notes.txt'], []);
    expect(await running.invoke('cheat-sheets:pickBackground')).toEqual({
      image: 'data:image/jpeg;base64,/9j/4A==',
    });
    await expect(running.invoke('cheat-sheets:pickBackground')).rejects.toThrow(/not a PNG, JPEG/);
    expect(await running.invoke('cheat-sheets:pickBackground')).toEqual({ image: null });
  });
});

describe('the picture', () => {
  it('is one script-free SVG that escapes every text and themes for screen, paper and night', async () => {
    const running = await start();
    await running.invoke('cheat-sheets:setNote', {
      ...HORNET,
      deviceKey: '4098:BEA8',
      control: 'button:20',
      note: '<img src=x onerror=alert(1)> & "hold"',
    });
    const stick = byTitle(await running.invoke<Sheet>('cheat-sheets:sheet', HORNET), 'Stick');
    for (const theme of ['dark', 'light', 'night'] as const) {
      const svg = renderDeviceSvg(stick, { theme });
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg).toContain(`data-theme="${theme}"`);
      expect(svg).toContain(THEMES[theme].bg);
      expect(svg).not.toMatch(/<script|onerror=alert\(1\)>/);
      expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;hold&quot;');
      expect(svg).toContain(
        '<title>Button 20 (Weapon release): Pickle: release weapon (Weapon Release Button)'
      );
      expect(svg).toContain('<title>Button 1: nothing bound</title>');
    }
    // Night: nothing white or blue.
    expect(renderDeviceSvg(stick, { theme: 'night' })).not.toMatch(/#4f8fe6|#ffffff/i);
    expect(renderDeviceSvg(stick, { theme: 'dark' })).toContain('#e2559b');

    // Empty controls can be left out; a switch and a frame with nothing in them go with them.
    const bare = renderDeviceSvg(stick, { theme: 'dark', showEmpty: false });
    expect(bare).not.toContain('data-control="button:1"');
    expect(bare).toContain('data-control="button:20"');
    const icp: SheetDevice = { ...stick, layout: builtinLayoutFor('4098', 'BF06')!, controls: [] };
    const nothing = renderDeviceSvg(icp, { theme: 'dark', showEmpty: false });
    expect(nothing).not.toContain('class="cs-ctl');
    expect(nothing).not.toContain('DCS switch');
    expect(nothing).not.toContain('Thumbwheels');
    expect(renderDeviceSvg(icp, { theme: 'dark' })).toContain('Thumbwheels');

    // The editor draws every position of a switch and handles to drag.
    const edit = renderDeviceSvg(stick, { theme: 'dark', edit: true });
    expect(edit).toContain('cs-editing');
    expect(edit).toContain('data-resize="0"');
    expect(edit).toContain('data-pin="0"');
    expect(edit).toContain('cs-group-hit');
  });

  it('draws a background picture and every kind of shape of a layout', () => {
    const layout: DeviceLayout = {
      ...builtinLayoutFor('044F', 'B68F')!,
      background: {
        image: 'data:image/png;base64,AAAA',
        x: 0,
        y: 0,
        w: 1000,
        h: 560,
        opacity: 0.5,
      },
      shapes: [
        { type: 'rect', x: 1, y: 2, w: 3, h: 4, r: 1, role: 'body' },
        { type: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 2, role: 'panel' },
        { type: 'line', points: [0, 0, 5, 5, 9, 1], closed: true, role: 'line' },
        { type: 'line', points: [0, 0, 5, 5], closed: false, role: 'accent' },
        { type: 'text', x: 5, y: 5, text: 'A & B', size: 12, role: 'screen' },
      ],
    };
    const svg = renderDeviceSvg({ layout, controls: [] }, { theme: 'light' });
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    expect(svg).toContain('<ellipse class="cs-s-panel"');
    expect(svg).toContain('<polygon class="cs-s-line" points="0,0 5,5 9,1"');
    expect(svg).toContain('<polyline class="cs-s-accent"');
    expect(svg).toContain('>A &amp; B</text>');
  });

  it('sizes label text to its card', () => {
    expect(fitFont(['Roll'], 200, 40)).toBe(14);
    // Text that needs it gets smaller type, but never smaller than reads with ease: below
    // that it is shortened (labels.test.ts).
    expect(fitFont(['Autopilot/Nosewheel Steering Disengage (Paddle)'], 120, 44)).toBe(12);
    expect(fitFont(['Autopilot/Nosewheel Steering Disengage (Paddle)'], 100, 30)).toBe(10.2);
    // A long word cannot be broken at a space and takes the rows it needs.
    expect(fitFont(['PUSH(DESCEND)'], 60, 20)).toBeLessThan(fitFont(['PUSH DESC'], 60, 20));
    // Only a card too small for one row at that size gets smaller type still.
    expect(fitFont(['A much longer text than this card could ever hold in any size'], 30, 10)).toBe(
      7
    );
    expect(fitFont(['Roll'], 200, 40, 1.5)).toBe(21);
  });
});

describe('pages', () => {
  it('prints one page per device and a summary, with the aircraft and device names on top', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const devices = [byTitle(sheet, 'Stick'), byTitle(sheet, 'Left MFD')];
    const a4 = printDocument(sheet, devices, { paper: 'A4', summary: true, stamp: '2026-10-03' });
    expect(a4.pages).toBe(3);
    expect(a4.html.match(/<section class="page"/g)).toHaveLength(3);
    expect(a4.html).toContain('<div class="ac">F/A-18C</div>');
    expect(a4.html).toContain(
      '<div class="dev">Stick<small>WINWING Orion Joystick Base 2 + JGRIP-F16'
    );
    expect(a4.html).toContain('30 of 56 controls bound');
    expect(a4.html).toContain('Most important actions');
    expect(a4.html).toContain('height:272mm');
    expect(a4.html).not.toContain('<script');
    const letter = printDocument(sheet, devices, { paper: 'Letter', summary: false, stamp: 'x' });
    expect(letter.pages).toBe(2);
    expect(letter.css).toContain('height:254mm');
    expect(letter.body.startsWith('<section class="page" data-device="4098:BEA8">')).toBe(true);
    expect(kindsOn(byTitle(sheet, 'Left MFD'))).toEqual(['displays']);
  });

  it('makes kneeboard pages at 768 x 1024 in a day and a night style', async () => {
    const sheet = await (await start()).invoke<Sheet>('cheat-sheets:sheet', HORNET);
    const stick = byTitle(sheet, 'Stick');
    const day = kneeboardDevicePage(sheet, stick, { style: 'light', stamp: '2026-10-03' });
    const night = kneeboardDevicePage(sheet, stick, { style: 'night', stamp: '2026-10-03' });
    for (const html of [day, night]) {
      expect(html).toContain('.page{width:768px;height:1024px');
      expect(html).toContain('<div class="ac">F/A-18C</div>');
      expect(html).toContain('30 controls bound');
      // Only what does something is on a kneeboard page.
      expect(html).not.toContain('data-control="button:1"');
    }
    expect(day).toContain('class="k-light"');
    expect(night).toContain('class="k-night"');
    expect(night).toContain('background:#000000');
    expect(night).not.toMatch(/#ffffff/i);
    const list = kneeboardListPage(sheet, 'Key actions', summaryActions(sheet, 10), {
      style: 'night',
      stamp: '2026-10-03',
    });
    expect(list).toContain('Pickle: release weapon');
    expect(list).toContain('<b>Weapon release <span>(Button 20)</span></b>');
  });
});

describe('live input and the pop-out', () => {
  it('sends what is held, per controller, while a window is watching', async () => {
    const running = await start();
    await running.invoke('cheat-sheets:watch', { client: 'a', on: true });
    const stick = running.ports.input.devices().find((d) => d.productId === 'BEA8')!;
    const state = (pressed: number[], x = 0): InputState => ({
      index: stick.index,
      name: stick.name,
      axes: Array.from({ length: stick.numAxes }, (_, i) => (i === 0 ? x : 0)),
      buttons: Array.from({ length: stick.numButtons }, (_, i) => pressed.includes(i + 1)),
      hats: [[0, 1]],
      timestamp: 1,
    });
    const sent = (): { devices: { guid: string; pressed: string[]; moved: string[] }[] }[] =>
      running.events
        .filter((e) => e.channel === 'cheat-sheets:event:input')
        .map((e) => e.payload as never);
    running.ports.input.emit([state([])]);
    // A quick press and release are both sent, not swallowed by the next state.
    running.ports.input.emit([state([20])]);
    running.ports.input.emit([state([], 0.5)]);
    const mine = () =>
      sent().flatMap((e) => e.devices.filter((d) => d.guid === stick.guid.toUpperCase()));
    await expect.poll(() => mine().at(-1)?.moved).toEqual(['axis:X']);
    const all = mine();
    expect(all.some((d) => d.pressed.includes('button:20') && d.pressed.includes('hat:1:U'))).toBe(
      true
    );
    expect(all.at(-1)).toMatchObject({ pressed: ['hat:1:U'], moved: ['axis:X'] });

    // Nobody watching: nothing is sent.
    await running.invoke('cheat-sheets:watch', { client: 'a', on: false });
    const count = sent().length;
    running.ports.input.emit([state([5])]);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(sent()).toHaveLength(count);
  });

  it('opens the quick look as a small window that stays on top', async () => {
    const running = await start();
    expect(
      await running.invoke('cheat-sheets:popOut', { ...HORNET, deviceKey: '4098:BEA8' })
    ).toEqual({ opened: true });
    expect(running.ports.window.panels).toEqual([
      {
        id: 'cheat-sheets-quick',
        route:
          '/configure/cheat-sheets/quick?game=dcs&aircraft=FA-18C_hornet&popped=1&device=4098%3ABEA8',
        title: 'RigReady quick look',
        width: 560,
        height: 640,
        alwaysOnTop: true,
      },
    ]);
  });

  it('writes a PDF where the user chose, one page per device plus the summary', async () => {
    const running = await start();
    running.ports.dialogs.script.save.push('Documents/hornet.pdf', null);
    const input = {
      ...HORNET,
      devices: ['4098:BEA8', '4098:BD26'],
      paper: 'Letter',
      summary: true,
    };
    expect(await running.invoke('cheat-sheets:savePdf', input)).toEqual({
      path: path.join(running.home, 'Documents', 'hornet.pdf'),
      pages: 3,
    });
    const pdf = await fs.readFile(path.join(running.home, 'Documents', 'hornet.pdf'), 'utf8');
    expect(pdf.startsWith('%PDF-')).toBe(true);
    const call = (running.ports.render as FakeRender).calls.find((c) => c.kind === 'pdf')!;
    expect(call.html.match(/<section class="page"/g)).toHaveLength(3);
    expect(await running.invoke('cheat-sheets:savePdf', input)).toEqual({ path: null, pages: 0 });
    await expect(
      running.invoke('cheat-sheets:savePdf', { ...input, devices: [], summary: false })
    ).rejects.toThrow(/at least one device/);
  });

  it('previews a kneeboard page as the picture that would be written', async () => {
    const running = await start();
    const preview = await running.invoke<{ image: string; width: number; height: number }>(
      'cheat-sheets:kneeboardPreview',
      { ...HORNET, deviceKey: '4098:BEA8', style: 'night' }
    );
    expect(preview).toMatchObject({ width: 768, height: 1024 });
    const bytes = Buffer.from(preview.image.split(',')[1]!, 'base64');
    expect(pngSize(new Uint8Array(bytes))).toEqual({ width: 768, height: 1024 });
    const html = (running.ports.render as FakeRender).calls.at(-1)!.html;
    expect(html).toContain('class="k-night"');
    expect(html).toContain('>Stick<');
    // Without a device it is the first page: the key actions.
    await running.invoke('cheat-sheets:kneeboardPreview', { ...HORNET, style: 'light' });
    expect((running.ports.render as FakeRender).calls.at(-1)!.html).toContain('Key actions');
  });
});
