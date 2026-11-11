import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../../tests/helpers';
import { generateLayout } from '../generate';
import { kneeboardDevicePage, KNEEBOARD_SIZE } from '../pages';
import { pictureFor, planPicture, renderPictureSvg, type PictureOptions } from '../picture';
import { textWidth, THEMES } from '../render';
import type { Sheet, SheetControl, SheetDevice } from '../sheet';
import {
  builtinDrawings,
  crossings,
  drawingFor,
  numbersOf,
  parseDrawing,
  pathBox,
  planCallouts,
  planList,
  renderPlanSvg,
  segmentsCross,
  stack,
  wrapText,
  type CalloutPlan,
} from './index';
import { DRAWINGS, F16_GRIP } from './builtin';
import { knownDevices } from '../known';

/**
 * PROTOTYPE: the device drawings with automatic callouts, laid out for the owner's
 * F/A-18C bindings on the recorded rig. The invariants: no two leader lines cross, every
 * label is on the page, every control is anchored on the drawn device, and nothing bound
 * is left out. With RIGREADY_DRAWINGS_OUT set, the pages are also written as HTML so they
 * can be rendered next to the shipped pictures (docs/research/controller-drawings.md).
 */

const HORNET = { game: 'dcs', aircraftId: 'FA-18C_hornet' };
const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/steamapps/libraryfolders.vdf',
  'Program Files (x86)/Steam/steamapps/appmanifest_223750.acf',
  'Program Files (x86)/Steam/steamapps/common/DCSWorld/**',
];
const DEVICES = ['Stick', 'F/A-18 grip', 'Throttle', 'Left MFD'] as const;

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

async function hornet(): Promise<Sheet> {
  app = await wiredApp('cheat-sheets-hornet', { files: FILES });
  return app.invoke<Sheet>('cheat-sheets:sheet', HORNET);
}

/** The plan of a device's drawing, empty controls left off unless asked for. */
const planFor = (
  device: SheetDevice,
  options: Omit<PictureOptions, 'theme'> = {}
): CalloutPlan | undefined => planPicture(device, { showEmpty: false, ...options });
const renderDrawingSvg = (device: SheetDevice, options: PictureOptions): string | undefined =>
  pictureFor(device).kind === 'drawing'
    ? renderPictureSvg(device, { showEmpty: false, ...options })
    : undefined;

/** A control of a made-up sheet: one binding of the user's. */
function bound(
  id: string,
  short: string,
  kind: SheetControl['bindings'][number]['kind']
): SheetControl {
  return {
    id,
    name: id,
    bindings: [
      {
        actionId: `${id}-${short}`,
        action: short,
        short,
        modifiers: [],
        category: [],
        kind,
        source: 'user',
        alsoOn: [],
      },
    ],
    conflict: false,
  };
}

/**
 * The F/A-18 grip on an Orion 2 base as WinWing's own Hornet profile binds it (the DCS
 * template "WINWING JOYSTICK BASE2 + F18 GRIP"). The recorded rig has the F-16 grip, so
 * this sheet is made from the stick's with the grip and the bindings changed.
 */
function f18Device(stick: SheetDevice): SheetDevice {
  // RigReady 1.x had no layout of this grip: it drew the generated grid of cards.
  const layout = generateLayout({
    name: 'WINWING JOYSTICK BASE2 + F18 GRIP',
    vendorId: '4098',
    productId: 'BE01',
    buttons: 32,
    axes: ['X', 'Y', 'RZ'],
    hats: 1,
  });
  return {
    ...stick,
    layout,
    key: '4098:F18',
    name: 'WINWING JOYSTICK BASE2 + F18 GRIP',
    title: 'F/A-18 grip',
    productId: 'BE01',
    layoutSource: 'generated',
    controls: [
      bound('axis:X', 'Roll', 'flight'),
      bound('axis:Y', 'Pitch', 'flight'),
      bound('axis:RZ', 'Rudder', 'flight'),
      bound('hat:1:U', 'Trim nose down', 'flight'),
      bound('hat:1:R', 'Trim right wing down', 'flight'),
      bound('hat:1:D', 'Trim nose up', 'flight'),
      bound('hat:1:L', 'Trim left wing down', 'flight'),
      bound('button:2', 'Sensor control: depress', 'sensors'),
      bound('button:3', 'Sensor select: HUD', 'sensors'),
      bound('button:4', 'Sensor select: right display', 'sensors'),
      bound('button:5', 'Sensor select: bottom display (AMPCD)', 'sensors'),
      bound('button:6', 'Sensor select: left display', 'sensors'),
      bound('button:7', 'Pickle: release weapon', 'weapons'),
      bound('button:9', 'Trigger: fire', 'weapons'),
      bound('button:11', 'Weapon select: Sidewinder', 'weapons'),
      bound('button:12', 'Weapon select: Sparrow', 'weapons'),
      bound('button:13', 'Weapon select: AMRAAM', 'weapons'),
      bound('button:14', 'Weapon select: gun', 'weapons'),
      bound('button:16', 'Undesignate / nose wheel steering', 'sensors'),
      bound('button:17', 'Paddle: autopilot off', 'flight'),
      bound('button:21', 'RECCE event mark', 'sensors'),
    ],
  };
}

const byTitle = (sheet: Sheet, title: string): SheetDevice => {
  if (title === 'F/A-18 grip') return f18Device(byTitle(sheet, 'Stick'));
  const device = sheet.devices.find((d) => d.title === title);
  if (!device) throw new Error(`No device ${title}`);
  return device;
};

const boxOf = (c: { x: number; y: number; w: number; h: number }) => ({
  left: c.x,
  top: c.y,
  right: c.x + c.w,
  bottom: c.y + c.h,
});

const overlap = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): boolean => {
  const p = boxOf(a);
  const q = boxOf(b);
  return (
    p.left < q.right - 0.5 &&
    q.left < p.right - 0.5 &&
    p.top < q.bottom - 0.5 &&
    q.top < p.bottom - 0.5
  );
};

/** Every invariant a plan must hold, in one place, so each device is checked the same way. */
function expectSound(plan: CalloutPlan, device: SheetDevice): void {
  const title = device.title;
  expect(plan.callouts.length, title).toBeGreaterThan(0);
  expect(crossings(plan.callouts), `${title}: leaders cross`).toBe(0);
  for (const c of plan.callouts) {
    const box = boxOf(c);
    expect(box.left, `${title}: ${c.head} off the left`).toBeGreaterThanOrEqual(0);
    expect(box.top, `${title}: ${c.head} off the top`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${title}: ${c.head} off the right`).toBeLessThanOrEqual(plan.width);
    expect(box.bottom, `${title}: ${c.head} off the bottom`).toBeLessThanOrEqual(plan.height);
    // The leader starts on the control and ends on the block's edge.
    expect(c.leader[0]).toEqual(c.anchor);
    const end = c.leader[c.leader.length - 1]!;
    expect(end.x >= box.left - 0.01 && end.x <= box.right + 0.01).toBe(true);
    expect(end.y >= box.top - 0.01 && end.y <= box.bottom + 0.01).toBe(true);
    // Every line of text fits the block's width.
    const inner = c.w - 2 * 7 - 8 - 6;
    for (const row of c.rows) {
      for (const line of row.lines)
        expect(textWidth(line, c.size), `${title}: ${line}`).toBeLessThanOrEqual(inner + 0.01);
    }
  }
  for (let i = 0; i < plan.callouts.length; i++) {
    for (let j = i + 1; j < plan.callouts.length; j++) {
      const a = plan.callouts[i]!;
      const b = plan.callouts[j]!;
      expect(overlap(a, b), `${title}: ${a.head} overlaps ${b.head}`).toBe(false);
    }
  }
  // The drawing is between the columns, not under them.
  const placed = plan.placed!;
  const drawRight = placed.x + placed.drawing.size.width * placed.scale;
  for (const c of plan.callouts) {
    if (c.side === 'left') expect(c.x + c.w, title).toBeLessThanOrEqual(placed.x);
    if (c.side === 'right') expect(c.x, title).toBeGreaterThanOrEqual(drawRight);
  }
  // Nothing bound is left out: on a block, or in the list under the drawing.
  const shown = new Set([
    ...plan.callouts.flatMap((c) => c.rows.map((r) => r.id)),
    ...plan.extras.map((r) => r.id),
  ]);
  for (const control of device.controls) {
    if (control.bindings.length > 0 || control.note)
      expect(shown.has(control.id), `${title}: ${control.id}`).toBe(true);
  }
}

describe('the shipped drawings', () => {
  it('are valid drawing files, for the WinWing grips, throttle and MFD frames and the popular Thrustmaster and Saitek controllers, with every control anchored on the device', () => {
    const { drawings, broken } = builtinDrawings();
    expect(broken).toEqual([]);
    expect(drawings.map((d) => d.name)).toEqual([
      'WinWing Orion 2 stick with F-16EX grip',
      'WinWing Orion stick (base 1) with F/A-18 grip',
      'WinWing Orion 2 stick with F/A-18 grip',
      'WinWing Orion throttle with F-15EX handles',
      'WinWing MFD1 button frame',
      'Thrustmaster HOTAS Warthog joystick',
      'Thrustmaster HOTAS Warthog throttle',
      'Thrustmaster T.16000M stick',
      'Saitek / Logitech X52 Pro',
    ]);
    expect(drawingFor({ vendorId: '4098', productId: 'BEA8' })?.name).toContain('F-16EX');
    expect(drawingFor({ vendorId: '4098', productId: 'bee1' })?.name).toContain('MFD1');
    expect(drawingFor({ vendorId: '4098', productId: 'BD26' })?.controls.length).toBeGreaterThan(
      10
    );
    expect(drawingFor({ vendorId: '044F', productId: 'B68F' })).toBeUndefined();
    expect(drawingFor({ vendorId: '044f', productId: '0402' })?.name).toContain('Warthog joystick');
    for (const drawing of drawings) {
      const boxes = drawing.paths.map((p) => pathBox(p.d)).filter(Boolean) as {
        x: number;
        y: number;
        w: number;
        h: number;
      }[];
      for (const control of drawing.controls) {
        const { x, y } = control.at;
        const onDevice = boxes.some(
          (b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2
        );
        expect(onDevice, `${drawing.name}: ${control.id} is off the device`).toBe(true);
      }
      // No input is on two controls.
      const ids = drawing.controls.flatMap((c) => c.inputs.map((i) => i.id));
      expect(new Set(ids).size).toBe(ids.length);
    }
    // The MFD: twenty keys, four rockers and the knob, numbered as the frame reports them.
    const mfd = drawingFor({ vendorId: '4098', productId: 'BEE0' })!;
    expect(mfd.controls.filter((c) => c.id.startsWith('osb-'))).toHaveLength(20);
    expect(mfd.controls.find((c) => c.id === 'osb-6')?.inputs[0]?.id).toBe('button:31');
    expect(mfd.controls.find((c) => c.id === 'osb-20')?.inputs[0]?.id).toBe('button:1');
    expect(mfd.controls.find((c) => c.id === 'gain')?.inputs.map((i) => i.id)).toEqual([
      'button:43',
      'button:44',
    ]);
  });

  it('are refused with the reason when an anchor is off the drawing or an input is placed twice', () => {
    const off = {
      ...F16_GRIP,
      controls: [{ id: 'x', name: 'X', at: { x: 9000, y: 10 }, inputs: [{ id: 'button:1' }] }],
    };
    expect(parseDrawing(off)).toMatchObject({ ok: false, reason: /anchored outside/ });
    const twice = {
      ...F16_GRIP,
      controls: [
        { id: 'a', name: 'A', at: { x: 10, y: 10 }, inputs: [{ id: 'button:1' }] },
        { id: 'b', name: 'B', at: { x: 20, y: 10 }, inputs: [{ id: 'button:1' }] },
      ],
    };
    expect(parseDrawing(twice)).toMatchObject({ ok: false, reason: /more than one control/ });
    expect(parseDrawing({ format: 'nope' })).toMatchObject({ ok: false });
    expect(DRAWINGS).toHaveLength(9);
    expect(pathBox('M 10 20 L 30 40 C 1 2 3 4 50 60 Z')).toEqual({ x: 1, y: 2, w: 49, h: 58 });
    expect(pathBox('M 260 588 A 20 20 0 1 0 300 588 A 20 20 0 1 0 260 588 Z')).toEqual({
      x: 260,
      y: 588,
      w: 40,
      h: 0,
    });
    expect(pathBox('')).toBeUndefined();
  });
});

describe('the callout planner', () => {
  it('wraps text at spaces, breaks a word wider than the box, and ends a label too long for three lines with an ellipsis', () => {
    expect(wrapText('Pickle: release weapon', 300, 14)).toEqual(['Pickle: release weapon']);
    const wrapped = wrapText('Sensor select: bottom display (AMPCD)', 120, 14);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join(' ')).toBe('Sensor select: bottom display (AMPCD)');
    const broken = wrapText('Supercalifragilisticexpialidocious', 60, 14);
    expect(broken.length).toBeGreaterThan(1);
    for (const line of broken) expect(textWidth(line, 14)).toBeLessThanOrEqual(60);
    const long = wrapText('one two three four five six seven eight nine ten eleven twelve', 60, 14);
    expect(long).toHaveLength(3);
    expect(long[2]!.endsWith('…')).toBe(true);
    expect(wrapText('', 100, 14)).toEqual([]);
  });

  it('names the inputs of a control the short way: a run of buttons, a hat, or each by itself', () => {
    const at = { x: 0, y: 0 };
    const base = {
      id: 'x',
      name: 'X',
      glyph: 'button' as const,
      at,
      hidden: false,
      assumed: false,
      inputs: [],
    };
    expect(
      numbersOf({ ...base, inputs: [37, 38, 39, 40].map((n) => ({ id: `button:${n}` })) })
    ).toBe('37–40');
    expect(
      numbersOf({ ...base, inputs: [13, 10, 11, 12].map((n) => ({ id: `button:${n}` })) })
    ).toBe('10–13');
    expect(
      numbersOf({ ...base, inputs: [25, 27, 28, 32].map((n) => ({ id: `button:${n}` })) })
    ).toBe('25, 27, 28, 32');
    expect(numbersOf({ ...base, inputs: [{ id: 'hat:1:U' }, { id: 'hat:1:D' }] })).toBe('H1');
    expect(
      numbersOf({ ...base, inputs: [{ id: 'axis:RX' }, { id: 'axis:RY' }, { id: 'button:26' }] })
    ).toBe('RX, RY, 26');
    expect(numbersOf({ ...base, inputs: [{ id: 'button:20' }] })).toBe('20');
    expect(numbersOf(base)).toBe('');
  });

  it('stacks blocks as close to their controls as the others allow, never overlapping, and pulls a column up to the bottom', () => {
    // Three blocks that want the same spot are spread around it.
    const same = stack(
      [
        { want: 300, h: 50 },
        { want: 300, h: 50 },
        { want: 300, h: 50 },
      ],
      0,
      1000
    );
    expect(same).toEqual([275, 335, 395]);
    // Far apart, each sits centred on its control.
    expect(
      stack(
        [
          { want: 100, h: 40 },
          { want: 500, h: 40 },
        ],
        0,
        1000
      )
    ).toEqual([80, 480]);
    // Too low for the page: pulled up so the column ends at the bottom, still in order.
    const pulled = stack(
      [
        { want: 900, h: 60 },
        { want: 980, h: 60 },
      ],
      0,
      1000
    );
    expect(pulled[1]).toBe(940);
    expect(pulled[0]).toBe(870);
    // Nothing goes above the top even when it wants to.
    expect(
      stack(
        [
          { want: 0, h: 60 },
          { want: 10, h: 60 },
        ],
        20,
        1000
      )
    ).toEqual([20, 90]);
    // More than fits: the column runs on below, with no overlap.
    const tall = stack(
      [
        { want: 10, h: 400 },
        { want: 20, h: 400 },
        { want: 30, h: 400 },
      ],
      0,
      500
    );
    expect(tall).toEqual([0, 410, 820]);
  });

  it('knows when two leader lines cross, and when they only meet at an end', () => {
    const cross = segmentsCross(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: 0, y: 10 }, b: { x: 10, y: 0 } }
    );
    expect(cross).toBe(true);
    const touch = segmentsCross(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: 10, y: 10 }, b: { x: 20, y: 0 } }
    );
    expect(touch).toBe(false);
    const apart = segmentsCross(
      { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { a: { x: 0, y: 5 }, b: { x: 10, y: 5 } }
    );
    expect(apart).toBe(false);
    expect(
      crossings([
        {
          leader: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
          ],
        },
        {
          leader: [
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
        },
      ])
    ).toBe(1);
  });

  it('trades two blocks whose leaders would cross so that none do', () => {
    // Two controls side by side at nearly the same height on the left: in anchor order
    // their leaders would cross; the planner swaps them.
    const drawing = parseDrawing({
      ...F16_GRIP,
      controls: [
        {
          id: 'far',
          name: 'Far',
          at: { x: 300, y: 100 },
          side: 'left',
          inputs: [{ id: 'button:1' }],
        },
        {
          id: 'near',
          name: 'Near',
          at: { x: 100, y: 104 },
          side: 'left',
          inputs: [{ id: 'button:2' }],
        },
        {
          id: 'low',
          name: 'Low',
          at: { x: 100, y: 700 },
          side: 'left',
          inputs: [{ id: 'button:3' }],
        },
      ],
    });
    if (!drawing.ok) throw new Error(drawing.reason);
    const bound = (id: string, action: string) => ({
      id,
      name: id,
      conflict: false,
      bindings: [
        {
          actionId: action,
          action,
          short: action,
          modifiers: [],
          category: [],
          kind: 'other' as const,
          source: 'user' as const,
          alsoOn: [],
        },
      ],
    });
    const plan = planCallouts(drawing.drawing, [
      bound(
        'button:1',
        'A long label that takes a tall block because it wraps onto several lines of text here'
      ),
      bound('button:2', 'B'),
      bound('button:3', 'C'),
    ]);
    expect(crossings(plan.callouts)).toBe(0);
    expect(plan.callouts.map((c) => c.head)).toEqual(['Far · 1', 'Near · 2', 'Low · 3']);
  });
});

describe('the F/A-18 grip', () => {
  it('is found by the name the grip reports, numbered as WinWing numbers it, with every bound control on the drawing', async () => {
    const sheet = await hornet();
    const device = byTitle(sheet, 'F/A-18 grip');
    expect(drawingFor(device)?.name).toBe('WinWing Orion 2 stick with F/A-18 grip');
    expect(
      drawingFor({ vendorId: '4098', productId: 'BE02', name: 'WINWING JOYSTICK BASE1 + F18 GRIP' })
        ?.name
    ).toContain('base 1');
    // The F-16 grip is still the F-16 grip, by its product id, whatever it is called.
    expect(drawingFor({ vendorId: '4098', productId: 'BEA8', name: 'F18 GRIP' })?.name).toContain(
      'F-16EX'
    );
    expect(drawingFor({ vendorId: '044F', productId: 'BE01', name: 'F18 GRIP' })).toBeUndefined();
    expect(pictureFor(device).kind).toBe('drawing');
    for (const showEmpty of [false, true]) {
      const plan = planFor(device, { showEmpty })!;
      expectSound(plan, device);
      expect(plan.extras).toEqual([]);
    }
    const plan = planFor(device)!;
    const head = (id: string) => plan.callouts.find((c) => c.control.id === id)?.head;
    expect(head('pickle')).toBe('Pickle · 7');
    expect(head('sensor')).toBe('Sensor control · 4-way · 2–6');
    expect(head('recce')).toBe('RECCE · 21');
    expect(head('trigger')).toBe('Trigger · 1, 9');
  });
});

describe('the Hornet on the recorded rig, drawn the new way', () => {
  it('lays the stick, the throttle and an MFD out with no leader crossing, every label on the page and nothing bound left out', async () => {
    const sheet = await hornet();
    for (const title of DEVICES) {
      const device = byTitle(sheet, title);
      for (const showEmpty of [false, true]) {
        const plan = planFor(device, { showEmpty, fontScale: showEmpty ? 1 : 1.12 });
        if (!plan) throw new Error(`No drawing for ${title}`);
        expectSound(plan, device);
      }
    }
    // The stick: one block per physical control, not one card per input.
    const stick = planFor(byTitle(sheet, 'Stick'))!;
    const trim = stick.callouts.find((c) => c.control.id === 'trim')!;
    expect(trim.head).toBe('TRIM hat · H1');
    expect(trim.rows.map((r) => r.text)).toEqual(
      expect.arrayContaining([
        '↑ Trim nose down',
        '↓ Trim nose up',
        '← Trim left wing down',
        '→ Trim right wing down',
      ])
    );
    // The hat's diagonals carry only game defaults: shown muted, after the four directions.
    expect(trim.rows.filter((r) => r.dim).length).toBe(4);
    expect(trim.rows[0]!.dim).toBe(false);
    const tms = stick.callouts.find((c) => c.control.id === 'tms')!;
    expect(tms.head).toBe('TMS · 4-way · 37–40 ?');
    expect(tms.rows.map((r) => r.text)).toEqual([
      '↑ Sensor select: HUD',
      '→ Sensor select: right display',
      '↓ Sensor select: bottom display (AMPCD)',
      '← Sensor select: left display',
    ]);
    // The CMS carries the radar elevation (32 forward, 34 aft), as WinWing's own profile
    // places the sensor switch there. The twist is unbound: no block on a kneeboard.
    expect(stick.callouts.find((c) => c.control.id === 'cms')?.rows.map((r) => r.text)).toEqual([
      '↑ Radar elevation up',
      '↓ Radar elevation down',
    ]);
    expect(stick.callouts.find((c) => c.control.id === 'twist')).toBeUndefined();
    // Bound buttons the drawing does not place (the two centre-view buttons) are listed under it.
    expect(stick.extras.map((r) => r.id)).toEqual(['button:19', 'button:36']);
    expect(stick.extrasBox).toBeDefined();
    // With empty controls shown, the twist appears as an empty block and the trigger's first detent as a muted row.
    const all = planFor(byTitle(sheet, 'Stick'), { showEmpty: true })!;
    expect(all.callouts.find((c) => c.control.id === 'twist')?.empty).toBe(true);
    expect(all.callouts.find((c) => c.control.id === 'trigger')?.rows.map((r) => r.text)).toEqual([
      '1st —',
      '2nd Trigger: fire',
    ]);

    // The MFD: a row of five above and six below (the knob), five keys and the one bound
    // rocker either side (GAIN and SYM have nothing bound in the Hornet).
    const mfd = planFor(byTitle(sheet, 'Left MFD'))!;
    const sides = (side: string) => mfd.callouts.filter((c) => c.side === side);
    expect(sides('top')).toHaveLength(5);
    expect(sides('bottom')).toHaveLength(6);
    expect(sides('left').map((c) => c.control.id)).toEqual([
      'osb-20',
      'osb-19',
      'osb-18',
      'osb-17',
      'osb-16',
      'brt',
    ]);
    expect(sides('right').map((c) => c.control.id)).toEqual([
      'osb-6',
      'osb-7',
      'osb-8',
      'osb-9',
      'osb-10',
      'con',
    ]);
    const every = planFor(byTitle(sheet, 'Left MFD'), { showEmpty: true })!;
    expect(every.callouts.filter((c) => c.side === 'left')).toHaveLength(7);
    expect(every.callouts.find((c) => c.control.id === 'gain')?.empty).toBe(true);
    expect(sides('top').map((c) => c.head)).toEqual([
      'OSB 1 · 42',
      'OSB 2 · 40',
      'OSB 3 · 38',
      'OSB 4 · 36',
      'OSB 5 · 34',
    ]);
    expect(sides('top').every((c) => c.y + c.h < mfd.placed!.y)).toBe(true);
    expect(mfd.callouts.find((c) => c.control.id === 'knob')?.rows.map((r) => r.text)).toEqual([
      '◄ Left MDI Brightness: CCW/Left',
      '► Left MDI Brightness: CW/Right',
    ]);
    expect(mfd.extras).toEqual([]);

    // The throttle: the finger lifts carry the detents, the base switches go below.
    const throttle = planFor(byTitle(sheet, 'Throttle'))!;
    expect(
      throttle.callouts.find((c) => c.control.id === 'left-lift')?.rows.map((r) => r.text)
    ).toEqual(['IDLE Left throttle to IDLE', 'OFF Throttle (Left): OFF']);
    expect(throttle.callouts.find((c) => c.control.id === 'switches')?.side).toBe('bottom');
    expect(throttle.extras.map((r) => r.id)).toEqual([]);

    // Asked to fill a kneeboard page, the drawing grows and the columns give way, but
    // never below the width that keeps labels on one or two lines; the invariants hold.
    for (const title of DEVICES) {
      const device = byTitle(sheet, title);
      const plain = planFor(device, { fontScale: 1.3 })!;
      const filled = planFor(device, { fontScale: 1.3, fill: 1230 })!;
      expectSound(filled, device);
      expect(filled.placed!.scale, title).toBeGreaterThanOrEqual(plain.placed!.scale);
      const least = Math.min(250, filled.placed!.drawing.columnWidth);
      for (const c of filled.callouts) {
        if (c.side === 'left' || c.side === 'right') {
          expect(c.w, title).toBeGreaterThanOrEqual(least);
        }
      }
    }
    const grown = planFor(byTitle(sheet, 'Stick'), { fill: 1230 })!;
    expect(grown.placed!.scale).toBeGreaterThan(1.1);
    expect(grown.height).toBeGreaterThan(1000);
  });

  it('renders the picture in every theme with a row per bound input the page can light up, and nothing that runs', async () => {
    const sheet = await hornet();
    for (const title of DEVICES) {
      const device = byTitle(sheet, title);
      for (const theme of ['dark', 'light', 'night'] as const) {
        const svg = renderDrawingSvg(device, { theme, showEmpty: theme === 'dark' })!;
        expect(svg.startsWith('<svg ')).toBe(true);
        expect(svg).not.toContain('<script');
        expect(svg).toContain(`data-theme="${theme}"`);
        for (const control of device.controls) {
          if (control.bindings.length > 0)
            expect(svg, `${title} ${control.id}`).toContain(`data-control="${control.id}"`);
        }
        expect(svg).toContain(`fill:${THEMES[theme].bg}`);
      }
    }
    // A device without a drawing has no new picture; the shipped one stays.
    expect(renderDrawingSvg(byTitle(sheet, 'Pedals'), { theme: 'dark' })).toBeUndefined();
    // The modifier and the tag are set in bold; text is escaped.
    const stick = byTitle(sheet, 'Stick');
    const svg = renderDrawingSvg(stick, { theme: 'light' })!;
    expect(svg).toContain('<tspan class="cs-tag">↑</tspan>');
    const panel = byTitle(sheet, 'R-VPC Panel #1');
    expect(renderDrawingSvg(panel, { theme: 'light' })).toBeUndefined();
    expect(svg).not.toMatch(/<[^>]*[^\\]"[^>]*</);
    // A plan renders for a note and an escaped action too.
    const noted: SheetDevice = {
      ...stick,
      controls: stick.controls.map((c) =>
        c.id === 'button:20' ? { ...c, note: 'hold <it> & wait' } : c
      ),
    };
    const withNote = renderPictureSvg(noted, { theme: 'dark' });
    expect(withNote).toContain('✎ hold &lt;it&gt; &amp; wait');

    // Written out for a look, when asked (the Electron render script makes PNGs of these).
    const out = process.env['RIGREADY_DRAWINGS_OUT'];
    if (!out) return;
    await fs.mkdir(out, { recursive: true });
    const pages: { html: string; png: string; width: number; height: number }[] = [];
    const sheetDocument = (svg: string, theme: 'dark' | 'light'): string =>
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:${THEMES[theme].bg}}svg{display:block;width:1000px;height:auto}</style></head><body>${svg}</body></html>`;
    const heightOf = (svg: string): number =>
      Math.round(Number(/viewBox="0 0 \d+(?:\.\d+)? (\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 1000));
    const titles = (process.env['RIGREADY_DRAWINGS_DEVICES'] ?? DEVICES.join(',')).split(',');
    for (const title of titles) {
      const device = byTitle(sheet, title);
      // The same device drawn the 1.x way: its shipped layout as cards.
      const asCards: SheetDevice = {
        ...device,
        layoutSource: 'user',
        layout: { ...device.layout, drawing: undefined },
      };
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const write = async (name: string, html: string, width: number, height: number) => {
        const file = path.join(out, `${name}.html`);
        await fs.writeFile(file, html, 'utf8');
        pages.push({ html: file, png: path.join(out, `${name}.png`), width, height });
      };
      for (const [when, shown] of [
        ['before', asCards],
        ['after', device],
      ] as const) {
        const svg = renderPictureSvg(shown, { theme: 'dark' });
        await write(`${when}-${slug}-sheet`, sheetDocument(svg, 'dark'), 1000, heightOf(svg));
        for (const style of ['light', 'night'] as const) {
          const page = kneeboardDevicePage(sheet, shown, { style, stamp: '2026-11-07' });
          const word = style === 'night' ? 'night' : 'day';
          await write(
            `${when}-${slug}-kneeboard-${word}`,
            page,
            KNEEBOARD_SIZE.width,
            KNEEBOARD_SIZE.height
          );
        }
      }
    }
    await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(pages, null, 2), 'utf8');
  });
});

/** The popular controllers drawn the way the WinWing devices are (section 7 of the research note). */
const POPULAR = [
  {
    name: 'Joystick - HOTAS Warthog',
    known: 'tm-warthog-stick',
    vendorId: '044F',
    productId: '0402',
  },
  {
    name: 'Throttle - HOTAS Warthog',
    known: 'tm-warthog-throttle',
    vendorId: '044F',
    productId: '0404',
  },
  { name: 'T.16000M', known: 'tm-t16000m', vendorId: '044F', productId: 'B10A' },
  {
    name: 'Saitek X52 Pro Flight Controller',
    known: 'saitek-x52-pro',
    vendorId: '06A3',
    productId: '0762',
  },
] as const;

async function popularSheet(): Promise<Sheet> {
  app = await wiredApp('cheat-sheets-known-devices', { files: FILES });
  return app.invoke<Sheet>('cheat-sheets:sheet', HORNET);
}

const byName = (sheet: Sheet, name: string): SheetDevice => {
  const device = sheet.devices.find((d) => d.name === name);
  if (!device) throw new Error(`No device ${name}: ${sheet.devices.map((d) => d.name).join(', ')}`);
  return device;
};

describe('the drawings of the popular Thrustmaster and Saitek controllers', () => {
  it('anchor every control the named map has, with the same name and inputs, on a drawn part of the device', () => {
    for (const entry of POPULAR) {
      const drawing = drawingFor({ vendorId: entry.vendorId, productId: entry.productId })!;
      expect(drawing, entry.name).toBeDefined();
      // Found by the name the device reports too, whatever its product id.
      expect(
        drawingFor({ vendorId: entry.vendorId, productId: 'FFFF', name: entry.name })?.name
      ).toBe(drawing.name);
      const known = knownDevices().devices.find((d) => d.id === entry.known)!;
      expect(drawing.controls.map((c) => c.id).sort()).toEqual(
        known.controls.map((c) => c.id).sort()
      );
      for (const control of known.controls) {
        const drawn = drawing.controls.find((c) => c.id === control.id)!;
        expect(drawn.name).toBe(control.name);
        expect(drawn.inputs.map((i) => i.id)).toEqual(control.inputs.map((i) => i.id));
        expect(drawn.assumed).toBe(false);
      }
      // Every anchor is on a drawn surface of the device, not on an outline or in the air.
      const surfaces = drawing.paths
        .filter((p) => p.role !== 'line')
        .map((p) => pathBox(p.d))
        .filter(Boolean) as { x: number; y: number; w: number; h: number }[];
      for (const control of drawing.controls) {
        const { x, y } = control.at;
        const on = surfaces.some(
          (b) => x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2
        );
        expect(on, `${drawing.name}: ${control.id} is off the device`).toBe(true);
      }
      // The outline is a schematic of paths, never a photo.
      expect(drawing.image).toBeUndefined();
      expect(drawing.paths.length).toBeGreaterThan(5);
    }
  });

  it('lays each out for the Hornet fixture bindings and for every input bound, with no leader crossing and every label on the page', async () => {
    const sheet = await popularSheet();
    for (const entry of POPULAR) {
      const device = byName(sheet, entry.name);
      const picture = pictureFor(device);
      expect(picture.kind, entry.name).toBe('drawing');
      if (picture.kind === 'drawing') expect(picture.source).toBe('builtin');
      for (const showEmpty of [false, true]) {
        for (const options of [{}, { fontScale: 1.3, fill: 1230 }]) {
          const plan = planFor(device, { showEmpty, ...options });
          if (!plan) throw new Error(entry.name);
          // The X52 Pro has no Hornet defaults: with empty controls hidden it has no blocks.
          if (plan.callouts.length === 0 && !showEmpty) continue;
          expectSound(plan, device);
        }
      }
      // Every input the device reports bound, with labels long enough to wrap.
      const reports = device.reports!;
      const controls = [
        ...Array.from({ length: reports.buttons }, (_, i) =>
          bound(`button:${i + 1}`, `Long action name for button ${i + 1} that wraps`, 'sensors')
        ),
        ...Array.from({ length: reports.hats }, (_, h) =>
          ['U', 'R', 'D', 'L', 'UR', 'DR', 'DL', 'UL'].map((d) =>
            bound(`hat:${h + 1}:${d}`, `Hat ${h + 1} ${d} action`, 'view')
          )
        ).flat(),
        ...reports.axes.map((a) => bound(`axis:${a}`, `Axis ${a}`, 'flight')),
      ];
      const full: SheetDevice = { ...device, controls };
      for (const options of [{}, { fontScale: 1.12, fill: 1230 }]) {
        const plan = planFor(full, options)!;
        expectSound(plan, full);
        // Every control of the drawing has its block.
        expect(plan.callouts).toHaveLength(drawingFor(device)!.controls.length);
      }
    }
    // The Warthog stick with DCS's Hornet defaults: named as Thrustmaster names it.
    const stick = planFor(byName(sheet, 'Joystick - HOTAS Warthog'))!;
    const heads = stick.callouts.map((c) => c.head);
    expect(heads).toContain('S2 weapon release · 2');
    expect(heads).toContain('H4 CMS hat · 15–19');
    expect(stick.extras).toEqual([]);
    for (const theme of ['dark', 'light', 'night'] as const) {
      const svg = renderPictureSvg(byName(sheet, 'Throttle - HOTAS Warthog'), { theme });
      expect(svg).toContain('data-physical="coolie"');
      expect(svg).toContain(`data-theme="${theme}"`);
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('<image');
    }
  });

  it('keeps the user’s changes to a drawing, and a layout of cards they arranged before', async () => {
    const sheet = await popularSheet();
    const device = byName(sheet, 'T.16000M');
    const moved: SheetDevice = {
      ...device,
      layoutSource: 'user',
      layout: {
        ...device.layout,
        drawing: { anchors: { hat: { x: 210, y: 120 } }, sides: {}, names: { hat: 'POV' } },
      },
    };
    const picture = pictureFor(moved);
    expect(picture).toMatchObject({ kind: 'drawing', source: 'changed' });
    if (picture.kind !== 'drawing') return;
    expect(picture.drawing.controls.find((c) => c.id === 'hat')).toMatchObject({
      name: 'POV',
      at: { x: 210, y: 120 },
    });
    const cards: SheetDevice = {
      ...device,
      layoutSource: 'user',
      layout: { ...device.layout, drawing: undefined },
    };
    expect(pictureFor(cards).kind).toBe('cards');
  });

  it('writes before and after pictures when asked', async () => {
    const out = process.env['RIGREADY_DRAWINGS_OUT'];
    if (!out) return;
    const sheet = await popularSheet();
    await fs.mkdir(out, { recursive: true });
    const pages: { html: string; png: string; width: number; height: number }[] = [];
    const heightOf = (svg: string): number =>
      Math.round(Number(/viewBox="0 0 \d+(?:\.\d+)? (\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? 1000));
    const escape = (doc: string): string => doc.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const svgDoc = (svg: string): string =>
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden;background:${THEMES.dark.bg}}svg{display:block;width:1000px;height:auto}</style></head><body>${svg}</body></html>`;
    const column = (title: string, doc: string, w: number, h: number): string =>
      `<div style="flex:none"><div style="font:600 22px Segoe UI,sans-serif;color:#ddd;padding:8px 0">${title}</div>` +
      `<iframe style="border:0;display:block;width:${w}px;height:${h}px" srcdoc="${escape(doc)}"></iframe></div>`;
    for (const entry of POPULAR) {
      const device = byName(sheet, entry.name);
      const known = knownDevices().devices.find((d) => d.id === entry.known)!;
      // Before: the named list the device had without a drawing.
      const list = planList(device.controls, device.reports, {
        showEmpty: true,
        named: known.controls,
      });
      const before = renderPlanSvg(list, device.controls, { theme: 'dark' });
      const after = renderPictureSvg(device, { theme: 'dark', showEmpty: true });
      const { width: kw, height: kh } = KNEEBOARD_SIZE;
      const day = kneeboardDevicePage(sheet, device, { style: 'light', stamp: '2026-11-11' });
      const night = kneeboardDevicePage(sheet, device, { style: 'night', stamp: '2026-11-11' });
      const html =
        `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#181a1f}</style></head><body>` +
        `<div style="display:flex;gap:24px;padding:16px;align-items:flex-start">` +
        column('Before: named list', svgDoc(before), 1000, heightOf(before)) +
        column('After: RigReady drawing', svgDoc(after), 1000, heightOf(after)) +
        column('Kneeboard, day', day, kw, kh) +
        column('Kneeboard, night', night, kw, kh) +
        `</div></body></html>`;
      const slug = entry.known.replace(/^(tm|saitek)-/, '');
      const file = path.join(out, `compare-${slug}.html`);
      await fs.writeFile(file, html, 'utf8');
      pages.push({
        html: file,
        png: path.join(out, `compare-${slug}.png`),
        width: 2000 + 2 * kw + 3 * 24 + 32,
        height: Math.max(heightOf(before), heightOf(after), kh) + 32 + 42,
      });
    }
    await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(pages, null, 2), 'utf8');
  });
});
