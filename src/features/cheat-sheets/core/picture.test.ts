import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import { builtinLayoutFor } from './builtin';
import { crossings, DRAWING_FORMAT, DRAWING_VERSION, planList } from './drawings';
import type { DeviceLayout } from './layout';
import { kneeboardDevicePage, KNEEBOARD_FILL } from './pages';
import { pictureFor, planPicture, renderPictureSvg } from './picture';
import type { Sheet, SheetDevice } from './sheet';

/**
 * Which picture a device gets (a drawing, the cards of a layout, or a list), what the
 * user changed on a drawing in the editor, a drawing of the user's own, and a device
 * nothing is known about. On the recorded rig with the owner's Hornet bindings.
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
/** A tiny real PNG, standing in for the user's photo of a device. */
const PHOTO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAGCAIAAABxZ0isAAAAFklEQVR4nGNsaGhgwAaYsIoOWgkAVXYBjYpOvYQAAAAASUVORK5CYII=';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function start(): Promise<WiredApp> {
  app = await wiredApp('cheat-sheets-hornet', { files: FILES });
  return app;
}

const byTitle = (sheet: Sheet, title: string): SheetDevice => {
  const device = sheet.devices.find((d) => d.title === title);
  if (!device) throw new Error(`No device ${title} in ${sheet.devices.map((d) => d.title)}`);
  return device;
};

const sheetOf = (running: WiredApp): Promise<Sheet> =>
  running.invoke<Sheet>('cheat-sheets:windowSheet', HORNET);

const STICK = { vendorId: '4098', productId: 'BEA8' };

describe('the picture of a device', () => {
  it('is RigReady’s drawing where there is one, the cards of a layout where not, and a layout of the user’s keeps its cards', async () => {
    const running = await start();
    const sheet = await sheetOf(running);
    const kinds = Object.fromEntries(sheet.devices.map((d) => [d.title, pictureFor(d).kind]));
    expect(kinds).toMatchObject({
      Stick: 'drawing',
      Throttle: 'drawing',
      'Left MFD': 'drawing',
      'Centre MFD': 'drawing',
      'Right MFD': 'drawing',
      Pedals: 'cards',
      'R-VPC Panel #1': 'cards',
    });
    const stick = byTitle(sheet, 'Stick');
    expect(pictureFor(stick)).toMatchObject({ kind: 'drawing', source: 'builtin' });
    expect(renderPictureSvg(stick, { theme: 'dark' })).toContain('cs-drawn');
    expect(renderPictureSvg(byTitle(sheet, 'Pedals'), { theme: 'dark' })).toContain(
      'data-item="0"'
    );

    // A layout of cards the owner saved (as 1.x did) is drawn as he arranged it.
    const own: DeviceLayout = { ...builtinLayoutFor('4098', 'BEA8')!, name: 'My stick' };
    own.controls = own.controls.map((c, i) => (i === 0 ? { ...c, x: 400, y: 900 } : c));
    await running.invoke('cheat-sheets:saveLayout', { ...STICK, layout: own });
    const saved = byTitle(await sheetOf(running), 'Stick');
    expect(saved.layoutSource).toBe('user');
    expect(pictureFor(saved).kind).toBe('cards');
    const cards = renderPictureSvg(saved, { theme: 'dark' });
    expect(cards).not.toContain('cs-drawn');
    expect(cards).toMatch(
      /<g data-item="0"><g class="cs-ctl[^"]*" data-control="button:20"[^>]* transform="translate\(400 900\)"/
    );
  });

  it('applies what the user changed on the drawing: where a control is, its side and its name', async () => {
    const running = await start();
    const before = planPicture(byTitle(await sheetOf(running), 'Stick'), { showEmpty: false })!;
    const trimBefore = before.callouts.find((c) => c.control.id === 'trim')!;
    expect(trimBefore.side).toBe('right');

    const layout: DeviceLayout = {
      ...builtinLayoutFor('4098', 'BEA8')!,
      drawing: {
        // Off the drawing on purpose: kept on it.
        anchors: { trim: { x: 120, y: 9000 } },
        sides: { trim: 'left' },
        names: { 'red-button': 'Weapon release' },
      },
    };
    await running.invoke('cheat-sheets:saveLayout', { ...STICK, layout });
    const stick = byTitle(await sheetOf(running), 'Stick');
    const picture = pictureFor(stick);
    expect(picture).toMatchObject({ kind: 'drawing', source: 'changed' });
    const plan = planPicture(stick, { showEmpty: false })!;
    const trim = plan.callouts.find((c) => c.control.id === 'trim')!;
    expect(trim.side).toBe('left');
    expect(trim.control.at).toEqual({ x: 120, y: 820 });
    expect(trim.anchor.y).toBeGreaterThan(trimBefore.anchor.y);
    expect(plan.callouts.find((c) => c.control.id === 'red-button')?.head).toBe(
      'Weapon release · 20'
    );
    expect(crossings(plan.callouts)).toBe(0);

    // A photo in place of the silhouette: the picture, the dots and labels, no silhouette.
    await running.invoke('cheat-sheets:saveLayout', {
      ...STICK,
      layout: { ...layout, background: { image: PHOTO, x: 0, y: 0, w: 360, h: 820, opacity: 0.8 } },
    });
    const photo = renderPictureSvg(byTitle(await sheetOf(running), 'Stick'), { theme: 'light' });
    expect(photo).toContain(`<image href="${PHOTO}"`);
    expect(photo).toContain('opacity="0.8"');
    expect(photo).not.toContain('class="cs-s-body"');
    expect(photo).toContain('data-control="button:20"');

    // Discarded: RigReady's drawing as it ships.
    expect(await running.invoke('cheat-sheets:resetLayout', STICK)).toEqual({ removed: 1 });
    expect(pictureFor(byTitle(await sheetOf(running), 'Stick'))).toMatchObject({
      source: 'builtin',
    });
  });

  it('lays a kneeboard page out as large as fits, every label inside the page, no leader crossing', async () => {
    const running = await start();
    const sheet = await sheetOf(running);
    for (const title of ['Stick', 'Throttle', 'Left MFD']) {
      const device = byTitle(sheet, title);
      const options = {
        showEmpty: false,
        fontScale: 1.12,
        fill: KNEEBOARD_FILL,
        maxFontScale: 1.55,
      };
      const plan = planPicture(device, options)!;
      const small = planPicture(device, { showEmpty: false, fontScale: 1.12 })!;
      expect(plan.height, title).toBeLessThanOrEqual(KNEEBOARD_FILL);
      expect(plan.callouts[0]!.size, title).toBeGreaterThanOrEqual(small.callouts[0]!.size);
      expect(crossings(plan.callouts), title).toBe(0);
      for (const c of plan.callouts) {
        expect(c.x, `${title} ${c.head}`).toBeGreaterThanOrEqual(0);
        expect(c.y, `${title} ${c.head}`).toBeGreaterThanOrEqual(0);
        expect(c.x + c.w, `${title} ${c.head}`).toBeLessThanOrEqual(plan.width);
        expect(c.y + c.h, `${title} ${c.head}`).toBeLessThanOrEqual(plan.height);
      }
      // The page is the drawing, sized to the page's picture area.
      const page = kneeboardDevicePage(sheet, device, { style: 'night', stamp: 's' });
      expect(page).toContain('cs-drawn');
      expect(page).toContain(`viewBox="0 0 1000 ${plan.height}"`);
    }
    // The stick's labels are larger than the 1.x kneeboard's 14 x 1.12.
    const stick = planPicture(byTitle(sheet, 'Stick'), {
      showEmpty: false,
      fontScale: 1.12,
      fill: KNEEBOARD_FILL,
      maxFontScale: 1.55,
    })!;
    expect(stick.callouts[0]!.size).toBeGreaterThan(14 * 1.2);
  });
});

describe('the trainer’s picture', () => {
  it('has every control that does something on it to be lit, with nothing written on it', async () => {
    const running = await start();
    const stick = byTitle(await sheetOf(running), 'Stick');
    const ids = stick.controls.map((c) => c.id);
    const svg = renderPictureSvg(
      { ...stick, controls: [] },
      { theme: 'dark', showEmpty: true, listed: ids }
    );
    for (const id of ids) expect(svg, id).toContain(`data-control="${id}"`);
    expect(svg).not.toContain('cs-bound');
    // The controls are named as on the device; what they do is the question.
    expect(svg).toContain('Red button · 20');
    expect(svg).not.toContain('release weapon');
  });
});

describe('a device RigReady knows nothing about', () => {
  it('is a list of its controls in blocks, every binding on it, a run of free buttons one line', async () => {
    const running = await start();
    await mutate(running, [
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
          numButtons: 40,
          numHats: 1,
          axisNames: ['X', 'Y', 'RZ', 'SLIDER1'],
        },
      },
    ]);
    const logitech = byTitle(await sheetOf(running), 'Logitech Extreme 3D');
    expect(logitech.layoutSource).toBe('generated');
    expect(pictureFor(logitech).kind).toBe('list');
    const controls = [
      ...logitech.controls,
      {
        id: 'button:3',
        name: 'Button 3',
        conflict: false,
        bindings: [
          {
            actionId: 'a',
            action: 'Gear up',
            short: 'Gear up',
            modifiers: [],
            category: [],
            kind: 'airframe' as const,
            source: 'user' as const,
            alsoOn: [],
          },
        ],
      },
      { id: 'hat:1:U', name: 'Hat 1 up', conflict: false, bindings: [], note: 'look up' },
    ];
    const plan = planList(controls, logitech.reports, { showEmpty: true });
    expect(plan.placed).toBeUndefined();
    expect(plan.callouts.map((c) => c.head)).toEqual([
      'Axes',
      'Hat 1',
      'Buttons 1–8',
      'Buttons 9–40',
    ]);
    expect(plan.callouts.every((c) => c.leader.length === 0)).toBe(true);
    // The run of free buttons: one row with a cell for each number, so a press lights it.
    const run = plan.callouts.find((c) => c.head === 'Buttons 9–40')!.rows;
    expect(run).toHaveLength(1);
    expect(run[0]!.cells?.map((cell) => cell.id)).toEqual(
      Array.from({ length: 32 }, (_, i) => `button:${9 + i}`)
    );
    expect(run[0]!.cells?.[0]?.text).toBe('9');
    expect(plan.callouts.find((c) => c.head === 'Buttons 1–8')?.rows.map((r) => r.text)).toEqual(
      expect.arrayContaining(['3 Gear up', '4 —'])
    );
    // Only what does something on a kneeboard: the run of free buttons and the free rows go.
    const small = planList(controls, logitech.reports, { showEmpty: false });
    const heads = small.callouts.map((c) => c.head);
    expect(heads).toEqual(expect.arrayContaining(['Hat 1', 'Buttons 1–8']));
    expect(heads).not.toContain('Buttons 9–40');
    expect(small.callouts.find((c) => c.head === 'Buttons 1–8')!.rows.map((r) => r.text)).toEqual([
      '3 Gear up',
    ]);
    // Two columns, side by side, none overlapping, on the canvas.
    for (const c of plan.callouts) {
      expect(c.x + c.w).toBeLessThanOrEqual(plan.width);
      expect(c.y + c.h).toBeLessThanOrEqual(plan.height);
    }
    const svg = renderPictureSvg({ ...logitech, controls }, { theme: 'night' });
    expect(svg).toContain('cs-listed');
    expect(svg).toContain('data-control="button:3"');
    expect(svg).not.toContain('<polyline class="cs-lead2"');
    // With the free controls shown, every input the device reports is on the page to
    // be lit: a free button in the run, and a hat direction with nothing bound.
    const every = renderPictureSvg({ ...logitech, controls }, { theme: 'night', showEmpty: true });
    for (const id of ['button:9', 'button:40', 'button:4', 'hat:1:D', 'axis:SLIDER1']) {
      expect(every, id).toContain(`data-control="${id}"`);
    }
    expect(every).toMatch(/class="cs-ctl cs-empty" data-control="button:40"/);
  });
});

describe('a drawing of the user’s own', () => {
  const drawingFile = (productId: string, at = { x: 40, y: 30 }) =>
    JSON.stringify({
      format: DRAWING_FORMAT,
      version: DRAWING_VERSION,
      name: 'My pedals',
      match: { vendorId: '044F', productIds: [productId] },
      size: { width: 200, height: 100 },
      image: PHOTO,
      controls: [
        { id: 'rudder', name: 'Rudder', glyph: 'axis', at, inputs: [{ id: 'axis:Z' }] },
        { id: 'left', name: 'Left brake', at: { x: 30, y: 60 }, inputs: [{ id: 'axis:Y' }] },
      ],
    });

  it('is imported from a drawing file, checked like any import, and drawn round its photo', async () => {
    const running = await start();
    const docs = path.join(running.home, 'Documents');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'pedals.rrdrawing.json'), drawingFile('B68F'));
    await fs.writeFile(path.join(docs, 'other.rrdrawing.json'), drawingFile('B10A'));
    await fs.writeFile(
      path.join(docs, 'off.rrdrawing.json'),
      drawingFile('B68F', { x: 900, y: 30 })
    );
    running.ports.dialogs.script.open.push(
      ['Documents/pedals.rrdrawing.json'],
      ['Documents/other.rrdrawing.json'],
      ['Documents/off.rrdrawing.json']
    );
    const device = { vendorId: '044F', productId: 'B68F', name: 'Thrustmaster TPR Pedals' };
    const imported = await running.invoke<{ layout: DeviceLayout; from: string }>(
      'cheat-sheets:importLayout',
      device
    );
    expect(imported).toMatchObject({ from: 'rigready-drawing', file: 'pedals.rrdrawing.json' });
    expect(imported.layout.drawing?.custom?.name).toBe('My pedals');
    // It keeps the device's layout under it, so "arrange cards" still has its cards.
    expect(imported.layout.name).toBe('Thrustmaster TPR pedals');
    await expect(running.invoke('cheat-sheets:importLayout', device)).rejects.toThrow(
      /drawing of another device/
    );
    await expect(running.invoke('cheat-sheets:importLayout', device)).rejects.toThrow(
      /not a usable drawing.*anchored outside/
    );

    // Saved, the pedals are drawn round the photo with a label per control.
    await running.invoke('cheat-sheets:saveLayout', {
      vendorId: '044F',
      productId: 'B68F',
      layout: imported.layout,
    });
    const pedals = byTitle(await sheetOf(running), 'Pedals');
    expect(pictureFor(pedals)).toMatchObject({ kind: 'drawing', source: 'custom' });
    const svg = renderPictureSvg(pedals, { theme: 'dark' });
    expect(svg).toContain(`<image href="${PHOTO}"`);
    expect(svg).toContain('data-anchor="rudder"');
    expect(svg).toContain('data-control="axis:Z"');
    const plan = planPicture(pedals, { showEmpty: true })!;
    expect(plan.callouts.map((c) => c.head)).toEqual(['Rudder · Z', 'Left brake · Y']);
    expect(crossings(plan.callouts)).toBe(0);
  });
});
