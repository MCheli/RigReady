import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wiredApp, type WiredApp } from '../../../../../tests/helpers';
import { generateLayout } from '../generate';
import { kneeboardDevicePage, KNEEBOARD_SIZE } from '../pages';
import {
  pictureFor,
  planPicture,
  renderPictureSvg,
  type PictureDevice,
  type PictureOptions,
} from '../picture';
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
  type DeviceDrawing,
} from './index';
import { DRAWINGS } from './builtin';
import { MFD_FRAME } from './mfd';
import { F16_GRIP } from './orion';
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
    axes: ['X', 'Y'],
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
    reports: { buttons: 32, axes: ['X', 'Y'], hats: 1 },
    controls: [
      bound('axis:X', 'Roll', 'flight'),
      bound('axis:Y', 'Pitch', 'flight'),
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
  it('are valid drawing files, for the WinWing grips, throttle, frames and panels and the Thrustmaster sticks, with every control anchored on the device', () => {
    const { drawings, broken } = builtinDrawings();
    expect(broken).toEqual([]);
    expect(drawings.map((d) => d.name)).toEqual([
      'WinWing Orion 2 stick with ViperAce (F-16EX) grip',
      'WinWing Orion stick (base 1) with F/A-18 grip',
      'WinWing Orion 2 stick with F/A-18 grip',
      'WinWing Orion throttle with F-15EX handles',
      'WinWing MFD1 button frame',
      'WinWing UFC1 with HUD1 panel',
      'WinWing ICP',
      'WinWing F/A-18 startup panel',
      'WinWing F/A-18 take-off panel 2',
      'Thrustmaster HOTAS Warthog joystick',
      'Thrustmaster T.16000M stick',
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
    // The MFD: twenty keys, four rockers, the side switch and the knob, numbered as the
    // frame reports them and named as the frame prints them.
    const mfd = drawingFor({ vendorId: '4098', productId: 'BEE0' })!;
    const inputsOf = (drawing: DeviceDrawing, id: string): string[] =>
      drawing.controls.find((c) => c.id === id)?.inputs.map((i) => i.id) ?? [];
    expect(mfd.controls.filter((c) => c.id.startsWith('osb-'))).toHaveLength(20);
    expect(inputsOf(mfd, 'osb-1')).toEqual(['button:42']);
    expect(inputsOf(mfd, 'osb-6')).toEqual(['button:31']);
    expect(inputsOf(mfd, 'osb-15')).toEqual(['button:12']);
    expect(inputsOf(mfd, 'osb-20')).toEqual(['button:1']);
    expect(inputsOf(mfd, 'day-night')).toEqual(['button:43', 'button:44']);
    expect(inputsOf(mfd, 'sym')).toEqual(['button:33', 'button:32']);
    expect(inputsOf(mfd, 'gain')).toEqual(['button:10', 'button:11']);
    expect(inputsOf(mfd, 'cont')).toEqual(['button:22', 'button:21']);
    expect(inputsOf(mfd, 'side-switch')).toEqual(['button:47', 'button:46', 'button:45']);
    expect(inputsOf(mfd, 'knob')).toEqual(['axis:SLIDER1', 'button:49', 'button:50', 'button:48']);
  });

  it("has a drawing for each of the owner's WinWing panels, found by what the panel reports, numbered as the maker numbers it", () => {
    const inputsOf = (drawing: DeviceDrawing, id: string): string[] =>
      drawing.controls.find((c) => c.id === id)?.inputs.map((i) => i.id) ?? [];
    const numbers = (from: number, to: number): string[] =>
      Array.from({ length: to - from + 1 }, (_, i) => `button:${from + i}`);
    const drawn = (drawing: DeviceDrawing): Set<string> =>
      new Set(drawing.controls.flatMap((c) => c.inputs.map((i) => i.id)));

    // The up-front controller with the HUD panel: one device to the PC.
    const ufc = drawingFor({ vendorId: '4098', productId: 'BEDE' })!;
    expect(ufc.name).toBe('WinWing UFC1 with HUD1 panel');
    expect(inputsOf(ufc, 'ip')).toEqual(['button:1']);
    expect(inputsOf(ufc, 'keypad')).toEqual(numbers(2, 13));
    expect(ufc.controls.find((c) => c.id === 'keypad')?.inputs.map((i) => i.tag)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      'CLR',
      '0',
      'ENT',
    ]);
    expect(inputsOf(ufc, 'options')).toEqual(numbers(14, 18));
    expect(inputsOf(ufc, 'emcon')).toEqual(['button:19']);
    expect(inputsOf(ufc, 'functions')).toEqual(numbers(20, 26));
    expect(inputsOf(ufc, 'comm-1')).toEqual(numbers(27, 29));
    expect(inputsOf(ufc, 'comm-2')).toEqual(numbers(30, 32));
    expect(inputsOf(ufc, 'adf')).toEqual(numbers(39, 41));
    expect(inputsOf(ufc, 'hud-reject')).toEqual(numbers(65, 67));
    expect(inputsOf(ufc, 'hud-att')).toEqual(numbers(75, 77));
    expect(inputsOf(ufc, 'hdg')).toEqual(['button:80', 'button:79', 'button:78']);
    expect(inputsOf(ufc, 'crs')).toEqual(['button:83', 'button:82', 'button:81']);
    expect(inputsOf(ufc, 'hud-aoa')).toEqual(['axis:SLIDER2']);
    // Every number the maker's screen places is drawn; the others are left off, not guessed.
    for (const id of [...numbers(1, 41), ...numbers(65, 83)])
      expect(drawn(ufc).has(id), id).toBe(true);
    for (const id of [...numbers(42, 64), ...numbers(84, 128), 'axis:SLIDER1'])
      expect(drawn(ufc).has(id), id).toBe(false);
    expect(ufc.controls.some((c) => c.assumed)).toBe(false);

    // The ICP: all 34 buttons and the four wheels.
    const icp = drawingFor({ vendorId: '4098', productId: 'BF06' })!;
    expect(icp.name).toBe('WinWing ICP');
    expect([...drawn(icp)].sort()).toEqual(
      [...numbers(1, 34), 'axis:X', 'axis:Y', 'axis:RX', 'axis:RY'].sort()
    );
    expect(inputsOf(icp, 'top-row')).toEqual(numbers(1, 6));
    expect(inputsOf(icp, 'rcl')).toEqual(['button:10']);
    expect(inputsOf(icp, 'entr')).toEqual(['button:14']);
    expect(inputsOf(icp, 'four-way')).toEqual([
      'button:22',
      'button:23',
      'button:24',
      'button:25',
      'button:21',
    ]);
    expect(inputsOf(icp, 'drift')).toEqual(numbers(26, 28));
    expect(inputsOf(icp, 'flir')).toEqual(['button:30', 'button:31']);
    expect(inputsOf(icp, 'gain')).toEqual(numbers(32, 34));
    expect(icp.controls.some((c) => c.assumed)).toBe(false);

    // The startup panel: all 57 buttons and both knobs.
    const startup = drawingFor({ vendorId: '4098', productId: 'BE03' })!;
    expect(startup.name).toBe('WinWing F/A-18 startup panel');
    expect([...drawn(startup)].sort()).toEqual([...numbers(1, 57), 'axis:RX', 'axis:RY'].sort());
    expect(inputsOf(startup, 'battery')).toEqual(numbers(12, 14));
    expect(inputsOf(startup, 'apu')).toEqual(numbers(38, 39));
    expect(inputsOf(startup, 'crank')).toEqual(numbers(40, 42));
    expect(inputsOf(startup, 'bleed')).toEqual(numbers(54, 57));
    expect(startup.controls.some((c) => c.assumed)).toBe(false);

    // The take-off panel 2: the 41 buttons the maker's screen places. Only the brake
    // handle is marked as not confirmed.
    const takeoff = drawingFor({ vendorId: '4098', productId: 'BF05' })!;
    expect(takeoff.name).toBe('WinWing F/A-18 take-off panel 2');
    expect([...drawn(takeoff)].sort()).toEqual(numbers(1, 41).sort());
    expect(inputsOf(takeoff, 'gear')).toEqual(numbers(35, 37));
    expect(inputsOf(takeoff, 'flap')).toEqual(numbers(5, 7));
    expect(inputsOf(takeoff, 'probe')).toEqual(numbers(14, 16));
    expect(inputsOf(takeoff, 'hook')).toEqual(numbers(32, 34));
    expect(takeoff.controls.filter((c) => c.assumed).map((c) => c.id)).toEqual(['brake']);
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
    expect(DRAWINGS).toHaveLength(11);
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
    ).toBe('25, 27–28, 32');
    expect(numbersOf({ ...base, inputs: [{ id: 'hat:1:U' }, { id: 'hat:1:D' }] })).toBe('H1');
    expect(
      numbersOf({ ...base, inputs: [{ id: 'axis:RX' }, { id: 'axis:RY' }, { id: 'button:26' }] })
    ).toBe('RX, RY, 26');
    // A control that is more than one kind of input: axes first, then the hat, then the
    // buttons in order with each run of neighbours as one range.
    expect(
      numbersOf({
        ...base,
        inputs: [{ id: 'hat:1:U' }, { id: 'hat:1:UR' }, { id: 'hat:1:D' }, { id: 'button:19' }],
      })
    ).toBe('H1, 19');
    expect(
      numbersOf({
        ...base,
        inputs: [
          { id: 'button:26' },
          { id: 'axis:RX' },
          { id: 'button:30' },
          { id: 'axis:RY' },
          { id: 'button:27' },
          { id: 'button:28' },
          { id: 'button:29' },
        ],
      })
    ).toBe('RX, RY, 26–30');
    expect(
      numbersOf({
        ...base,
        inputs: [{ id: 'axis:RZ' }, ...[1, 2, 41, 42, 3].map((n) => ({ id: `button:${n}` }))],
      })
    ).toBe('RZ, 1–3, 41–42');
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

  it('keeps the rows above and below a drawing clear of its columns: a column starts below a leader that passes over it, and under a long column a leader drops straight down before it turns', () => {
    // A frame with labels on all four sides, every input bound to a long name: the
    // columns at the sides run on below the frame.
    const parsed = parseDrawing(MFD_FRAME);
    if (!parsed.ok) throw new Error(parsed.reason);
    const inputs = parsed.drawing.controls.flatMap((c) => c.inputs.map((i) => i.id));
    const plan = planCallouts(
      parsed.drawing,
      inputs.map((id) => bound(id, `A long action name for ${id} that wraps`, 'sensors'))
    );
    expect(crossings(plan.callouts)).toBe(0);
    const on = (side: string) => plan.callouts.filter((c) => c.side === side);
    const columns = [...on('left'), ...on('right')];
    const columnsEnd = Math.max(...columns.map((c) => c.y + c.h));
    expect(plan.overflow).toBeGreaterThan(0);

    // Below: straight down from the key to under the last block of a column, then across.
    let turned = 0;
    for (const c of on('bottom')) {
      expect(c.y, c.control.id).toBeGreaterThan(columnsEnd);
      const edge = c.leader.at(-1)!;
      if (Math.abs(edge.x - c.anchor.x) <= 0.5) {
        expect(c.leader, c.control.id).toHaveLength(3);
        continue;
      }
      turned += 1;
      expect(c.leader, c.control.id).toHaveLength(4);
      expect(c.leader[1]!.x, c.control.id).toBe(c.anchor.x);
      expect(c.leader[1]!.y, c.control.id).toBeGreaterThan(columnsEnd);
      expect(c.leader[1]!.y, c.control.id).toBeLessThan(c.y);
    }
    expect(turned).toBeGreaterThan(1);

    // Above: where a leader passes over the inner edge of a column, the column has not begun.
    const inner = { left: Math.max(...on('left').map((c) => c.x + c.w)), right: on('right')[0]!.x };
    let over = 0;
    for (const c of on('top')) {
      const anchor = c.leader[0]!;
      const bend = c.leader[1]!;
      for (const side of ['left', 'right'] as const) {
        const outside = side === 'left' ? bend.x < inner.left : bend.x > inner.right;
        if (!outside) continue;
        over += 1;
        const part = (bend.x - inner[side]) / (bend.x - anchor.x);
        const crossesAt = bend.y + (anchor.y - bend.y) * part;
        expect(Math.min(...on(side).map((b) => b.y)), c.control.id).toBeGreaterThan(crossesAt);
      }
    }
    expect(over).toBeGreaterThan(1);
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
    }
    // Everything the game's own profile binds is on the drawing: nothing is left for the
    // list under it.
    const plan = planFor(device)!;
    expect(plan.extras).toEqual([]);
    // Parts are named for where they are, numbered as the maker's map numbers them: the
    // trigger is 9 and 10 (button 1 is the press of the trim hat, not the trigger).
    const head = (id: string) => plan.callouts.find((c) => c.control.id === id)?.head;
    expect(head('top-left-button')).toBe('Top left button · 7');
    expect(head('centre-switch')).toBe('Centre switch · 2–6');
    expect(head('trim')).toBe('TRIM hat · H1, 1');
    expect(head('lower-switch')).toBe('Lower right switch · 8, 18–21');
    expect(head('side-switch')).toBe('Left side switch · 11–15');
    expect(head('trigger')).toBe('Trigger · 9–10');
    expect(head('front-button')).toBe('Front left button · 16');
    expect(head('paddle')).toBe('Paddle lever · 17');
    const rows = (id: string) =>
      plan.callouts.find((c) => c.control.id === id)?.rows.map((r) => r.text);
    expect(rows('centre-switch')).toEqual([
      '↑ Sensor select: HUD',
      '→ Sensor select: right display',
      '↓ Sensor select: bottom display (AMPCD)',
      '← Sensor select: left display',
      'press Sensor control: depress',
    ]);
    expect(rows('lower-switch')).toEqual(['← RECCE event mark']);
    // Nothing on it is a guess, and no twist is drawn: no source shows one.
    const drawing = drawingFor(device)!;
    expect(drawing.controls.some((c) => c.assumed)).toBe(false);
    expect(drawing.controls.flatMap((c) => c.inputs.map((i) => i.id))).not.toContain('axis:RZ');
    // With the free controls shown, the numbers this stick reports that no source places
    // are listed in one row, so a press on any of them still lights.
    const all = planFor(device, { showEmpty: true })!;
    expect(all.extras).toHaveLength(1);
    expect(all.extras[0]!.cells?.map((cell) => cell.id)).toEqual(
      Array.from({ length: 11 }, (_, i) => `button:${22 + i}`)
    );
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
    // The hat that is a real hat also presses (button 19): one block, both in its head.
    expect(trim.head).toBe('TRIM hat · H1, 19');
    expect(trim.rows.map((r) => r.text)).toEqual(
      expect.arrayContaining([
        '↑ Trim nose down',
        '↓ Trim nose up',
        '← Trim left wing down',
        '→ Trim right wing down',
        'press Centre the view',
      ])
    );
    // The hat's diagonals carry only game defaults: shown muted, after the four directions.
    expect(trim.rows.filter((r) => r.id.startsWith('hat:') && r.dim).length).toBe(4);
    expect(trim.rows[0]!.dim).toBe(false);
    // The castle hat at the right of the head is buttons 37 to 40 with 36 as its press,
    // and none of that is a guess any more.
    const right = stick.callouts.find((c) => c.control.id === 'right-hat')!;
    expect(right.head).toBe('Right hat (DMS) · 36–40');
    expect(right.rows.map((r) => r.text)).toEqual([
      '↑ Sensor select: HUD',
      '→ Sensor select: right display',
      '↓ Sensor select: bottom display (AMPCD)',
      '← Sensor select: left display',
      'press Centre the view',
    ]);
    // The ribbed hat in the middle carries the radar elevation (32 up, 34 down).
    const centre = stick.callouts.find((c) => c.control.id === 'centre-hat')!;
    expect(centre.head).toBe('Centre hat (TMS) · 31–35');
    expect(centre.rows.map((r) => r.text)).toEqual([
      '↑ Radar elevation up',
      '↓ Radar elevation down',
    ]);
    // The weapon select is on the hat on the left side of the handle, where it really is.
    expect(
      stick.callouts.find((c) => c.control.id === 'thumb-hat')?.rows.map((r) => r.text)
    ).toEqual([
      '↑ Weapon select: AMRAAM',
      'forward Weapon select: Sparrow',
      '↓ Weapon select: Sidewinder',
      'back Weapon select: gun',
    ]);
    expect(stick.callouts.find((c) => c.control.id === 'ministick')?.head).toBe(
      'Mini-stick · RX, RY, 26–30'
    );
    expect(stick.callouts.find((c) => c.control.id === 'pinky-button')?.head).toBe(
      'Pinky button · 6'
    );
    // Only the right side hat still has directions nobody has pressed to check.
    expect(stick.placed!.drawing.controls.filter((c) => c.assumed).map((c) => c.id)).toEqual([
      'side-hat',
    ]);
    // Nothing is bound on the top front lever or the top left hat: no block on a kneeboard.
    expect(stick.callouts.find((c) => c.control.id === 'front-lever')).toBeUndefined();
    expect(stick.callouts.find((c) => c.control.id === 'castle-hat')).toBeUndefined();
    // Every input the grip reports is on the drawing, so nothing bound is left for the list under it.
    expect(stick.extras).toEqual([]);
    expect(stick.extrasBox).toBeUndefined();
    const drawn = new Set(stick.placed!.drawing.controls.flatMap((c) => c.inputs.map((i) => i.id)));
    for (let n = 1; n <= 42; n += 1) expect(drawn.has(`button:${n}`), `button ${n}`).toBe(true);
    for (const axis of ['X', 'Y', 'RX', 'RY', 'RZ', 'SLIDER1'])
      expect(drawn.has(`axis:${axis}`), axis).toBe(true);
    // With empty controls shown, the lever appears as an empty block and the trigger's first stage as a muted row.
    const all = planFor(byTitle(sheet, 'Stick'), { showEmpty: true })!;
    expect(all.callouts.find((c) => c.control.id === 'front-lever')?.empty).toBe(true);
    expect(all.callouts.find((c) => c.control.id === 'trigger')?.rows.map((r) => r.text)).toEqual([
      '1st —',
      '2nd Trigger: fire',
    ]);

    // The MFD: five keys and the knob above, five keys below, and at each side five keys
    // with the rockers of that side, each where the frame has it.
    const mfd = planFor(byTitle(sheet, 'Left MFD'))!;
    const sides = (side: string) => mfd.callouts.filter((c) => c.side === side);
    expect(sides('top')).toHaveLength(6);
    expect(sides('bottom')).toHaveLength(5);
    expect(sides('left').map((c) => c.control.id)).toEqual([
      'osb-20',
      'osb-19',
      'osb-18',
      'osb-17',
      'osb-16',
      'gain',
    ]);
    expect(sides('right').map((c) => c.control.id)).toEqual([
      'osb-6',
      'osb-7',
      'osb-8',
      'osb-9',
      'osb-10',
      'cont',
    ]);
    // Nothing is bound on the switch on the side edge: it shows only with the free controls.
    const every = planFor(byTitle(sheet, 'Left MFD'), { showEmpty: true })!;
    expect(every.callouts.filter((c) => c.side === 'right')).toHaveLength(8);
    expect(every.callouts.find((c) => c.control.id === 'side-switch')?.empty).toBe(true);
    expect(
      sides('top')
        .filter((c) => c.control.id.startsWith('osb-'))
        .map((c) => c.head)
    ).toEqual(['OSB 1 · 42', 'OSB 2 · 40', 'OSB 3 · 38', 'OSB 4 · 36', 'OSB 5 · 34']);
    expect(mfd.callouts.find((c) => c.control.id === 'gain')?.head).toBe('GAIN rocker · 10–11');
    expect(every.callouts.find((c) => c.control.id === 'day-night')?.head).toBe(
      'DAY / NGT rocker · 43–44'
    );
    expect(sides('top').every((c) => c.y + c.h < mfd.placed!.y)).toBe(true);
    expect(mfd.callouts.find((c) => c.control.id === 'knob')?.rows.map((r) => r.text)).toEqual([
      '◄ Left MDI Brightness: CCW/Left',
      '► Left MDI Brightness: CW/Right',
    ]);
    expect(mfd.extras).toEqual([]);

    // The throttle: each handle is one control, its travel with the IDLE and OFF stops; the
    // front of the left handle is labelled above the drawing, the front of the right below.
    const throttle = planFor(byTitle(sheet, 'Throttle'))!;
    const leftThrottle = throttle.callouts.find((c) => c.control.id === 'left-throttle')!;
    expect(leftThrottle.head).toBe('Left throttle · RY, 2, 31');
    expect(leftThrottle.rows.map((r) => r.text)).toEqual([
      'travel Throttle, left engine',
      'IDLE Left throttle to IDLE',
      'OFF Throttle (Left): OFF',
    ]);
    expect(throttle.callouts.find((c) => c.control.id === 'left-hat')?.side).toBe('top');
    expect(throttle.callouts.find((c) => c.control.id === 'ministick')?.side).toBe('bottom');
    expect(throttle.callouts.find((c) => c.control.id === 'ministick')?.head).toBe(
      'Mini-stick · X, Y, 35–39'
    );
    expect(
      throttle.callouts.find((c) => c.control.id === 'lower-thumb-switch')?.rows.map((r) => r.text)
    ).toEqual([
      'forward Speed brake out',
      'middle Speed brake in (two-position switch)',
      'back Speed brake in',
    ]);
    // Left and right on the two front hats are the only places still unchecked.
    expect(throttle.placed!.drawing.controls.filter((c) => c.assumed).map((c) => c.id)).toEqual([
      'left-hat',
      'front-hat',
    ]);
    expect(throttle.extras.map((r) => r.id)).toEqual([]);
    // Every input the throttle reports is drawn, except buttons 45 to 49, which no source
    // gives a control for.
    const onThrottle = new Set(
      throttle.placed!.drawing.controls.flatMap((c) => c.inputs.map((i) => i.id))
    );
    const missing: number[] = [];
    for (let n = 1; n <= 62; n += 1) if (!onThrottle.has(`button:${n}`)) missing.push(n);
    expect(missing).toEqual([45, 46, 47, 48, 49]);
    for (const axis of ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1'])
      expect(onThrottle.has(`axis:${axis}`), axis).toBe(true);
    // A press never lights nothing: with the free controls shown, those five are under
    // "More controls", one cell each, every one a control the page can light.
    const everyThrottle = planFor(byTitle(sheet, 'Throttle'), { showEmpty: true })!;
    expect(everyThrottle.extras).toHaveLength(1);
    expect(everyThrottle.extras[0]!.cells).toEqual(
      missing.map((n) => ({ id: `button:${n}`, text: String(n) }))
    );
    const lit = renderPictureSvg(byTitle(sheet, 'Throttle'), { theme: 'dark', showEmpty: true });
    for (const n of missing) {
      expect(lit, String(n)).toContain(`class="cs-ctl cs-empty" data-control="button:${n}"`);
    }
    for (let n = 1; n <= 62; n += 1) expect(lit, String(n)).toContain(`data-control="button:${n}"`);
    // Without them shown, the page lists only what is bound.
    expect(
      renderPictureSvg(byTitle(sheet, 'Throttle'), { theme: 'dark', showEmpty: false })
    ).not.toContain('data-control="button:45"');

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
  { name: 'T.16000M', known: 'tm-t16000m', vendorId: '044F', productId: 'B10A' },
] as const;

/**
 * Known by name and number, but with no picture known to match the real device: these
 * show as their named list, which claims no places.
 */
const LISTED = [
  {
    name: 'Throttle - HOTAS Warthog',
    known: 'tm-warthog-throttle',
    vendorId: '044F',
    productId: '0404',
    head: 'MS mic switch · 2–6',
  },
  {
    name: 'Saitek X52 Pro Flight Controller',
    known: 'saitek-x52-pro',
    vendorId: '06A3',
    productId: '0762',
    head: 'Stick top hat · 20–23',
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

/** Every input a device reports, each with a binding long enough to wrap. */
function everyInputBound(device: SheetDevice): SheetDevice {
  const reports = device.reports!;
  return {
    ...device,
    controls: [
      ...Array.from({ length: reports.buttons }, (_, i) =>
        bound(`button:${i + 1}`, `Long action name for button ${i + 1} that wraps`, 'sensors')
      ),
      ...Array.from({ length: reports.hats }, (_, h) =>
        ['U', 'R', 'D', 'L', 'UR', 'DR', 'DL', 'UL'].map((d) =>
          bound(`hat:${h + 1}:${d}`, `Hat ${h + 1} ${d} action`, 'view')
        )
      ).flat(),
      ...reports.axes.map((a) => bound(`axis:${a}`, `Axis ${a}`, 'flight')),
    ],
  };
}

describe("the owner's WinWing panels on the recorded rig", () => {
  const PANELS: [string, string, number][] = [
    // product id, drawing, controls on it
    ['BEE0', 'WinWing MFD1 button frame', 26],
    ['BEE2', 'WinWing MFD1 button frame', 26],
    ['BEDE', 'WinWing UFC1 with HUD1 panel', 25],
    ['BF06', 'WinWing ICP', 14],
    ['BE03', 'WinWing F/A-18 startup panel', 23],
    ['BF05', 'WinWing F/A-18 take-off panel 2', 14],
  ];

  it('draws each one, not a grid of cards, with no leader crossing and every label on the page, whatever is bound', async () => {
    const sheet = await hornet();
    for (const [productId, name, count] of PANELS) {
      const device = sheet.devices.find((d) => d.productId?.toUpperCase() === productId);
      if (!device) throw new Error(`The recorded rig has no ${productId}`);
      const picture = pictureFor(device);
      expect(picture.kind, name).toBe('drawing');
      if (picture.kind === 'drawing') expect(picture.source).toBe('builtin');
      expect(drawingFor(device)?.name).toBe(name);
      expect(drawingFor(device)?.controls, name).toHaveLength(count);
      // As the Hornet binds it, with and without the free controls.
      for (const showEmpty of [false, true]) {
        for (const options of [{}, { fontScale: 1.3, fill: 1230 }]) {
          const plan = planFor(device, { showEmpty, ...options });
          if (!plan) throw new Error(name);
          // The ICP is a Viper panel: the Hornet binds nothing on it.
          if (plan.callouts.length === 0 && !showEmpty) continue;
          expectSound(plan, device);
        }
      }
      // With every input bound: a block for every control of the drawing, and every
      // input the drawing leaves off in the list under it.
      const full = everyInputBound(device);
      for (const options of [{}, { fontScale: 1.12, fill: 1230 }]) {
        const plan = planFor(full, options)!;
        expectSound(plan, full);
        expect(plan.callouts, name).toHaveLength(count);
      }
    }
  });

  it('lists the numbers no source places under More controls, one cell each, only with the free controls shown', async () => {
    const sheet = await hornet();
    const device = (productId: string): SheetDevice =>
      sheet.devices.find((d) => d.productId?.toUpperCase() === productId)!;
    const free = (productId: string, showEmpty: boolean): string[] =>
      planFor(device(productId), { showEmpty })!
        .extras.flatMap((row) => row.cells ?? [])
        .map((cell) => cell.id);
    const numbers = (from: number, to: number): string[] =>
      Array.from({ length: to - from + 1 }, (_, i) => `button:${from + i}`);
    // The take-off panel reports 64 buttons and the maker's screen places 41.
    expect(free('BF05', true)).toEqual(numbers(42, 64));
    expect(free('BF05', false)).toEqual([]);
    // The ICP and the startup panel have every input on the drawing.
    expect(free('BF06', true)).toEqual([]);
    expect(free('BE03', true)).toEqual([]);
    // The up-front controller: one spare axis and the numbers between and after its parts.
    expect(free('BEDE', true)).toEqual(['axis:SLIDER1', ...numbers(42, 64), ...numbers(84, 128)]);
    // Each cell is a control the page can light when it is pressed.
    const svg = renderPictureSvg(device('BF05'), { theme: 'dark', showEmpty: true });
    expect(svg).toContain('data-control="button:42"');
    expect(svg).toContain('data-control="button:64"');
    expect(renderPictureSvg(device('BF05'), { theme: 'dark', showEmpty: false })).not.toContain(
      'data-control="button:42"'
    );
  });
});

describe('the drawings of the popular Thrustmaster controllers', () => {
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
          // A device with nothing bound has no blocks while empty controls are hidden.
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
      const svg = renderPictureSvg(byName(sheet, 'Joystick - HOTAS Warthog'), { theme });
      expect(svg).toContain('data-physical="h4"');
      expect(svg).toContain(`data-theme="${theme}"`);
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('<image');
    }
  });

  it('shows no picture of a device whose places are not known to match it: the Warthog throttle and the X52 Pro are their named lists', async () => {
    const sheet = await popularSheet();
    for (const entry of LISTED) {
      expect(drawingFor({ vendorId: entry.vendorId, productId: entry.productId })).toBeUndefined();
      expect(
        drawingFor({ vendorId: entry.vendorId, productId: 'FFFF', name: entry.name })
      ).toBeUndefined();
      const device = byName(sheet, entry.name);
      expect(pictureFor(device), entry.name).toMatchObject({
        kind: 'list',
        known: { id: entry.known },
      });
      // Every control is still named as the maker names it, with its numbers.
      const plan = planFor(device, { showEmpty: true })!;
      expect(plan.placed).toBeUndefined();
      expect(plan.callouts.map((c) => c.head)).toContain(entry.head);
      const svg = renderPictureSvg(device, { theme: 'dark', showEmpty: true });
      expect(svg).not.toContain('class="cs-drawing"');
      expect(svg).toContain('data-control="button:1"');
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
      const slug = entry.known.replace(/^tm-/, '');
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

/**
 * For a look without a window: with RIGREADY_DRAWINGS_SVG_OUT set, every shipped drawing
 * is written as one SVG file named after its device, every control shown. The owner's
 * stick and throttle carry the recorded rig's F/A-18C bindings; the others carry none.
 */
describe('the shipped drawings as picture files', () => {
  const slug = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  /** A device that reports exactly what its drawing draws, with nothing bound. */
  const bare = (drawing: DeviceDrawing): PictureDevice => {
    const ids = drawing.controls.flatMap((c) => c.inputs.map((i) => i.id));
    const buttons = Math.max(0, ...ids.map((id) => Number(/^button:(\d+)$/.exec(id)?.[1] ?? 0)));
    const hats = Math.max(0, ...ids.map((id) => Number(/^hat:(\d+):/.exec(id)?.[1] ?? 0)));
    const axes = ids.filter((id) => id.startsWith('axis:')).map((id) => id.slice(5));
    const vendorId = drawing.match.vendorId;
    const productId = drawing.match.productIds[0] ?? 'FFFF';
    const name = drawing.match.names[0] ?? drawing.name;
    return {
      vendorId,
      productId,
      name,
      layout: generateLayout({ name, vendorId, productId, buttons, axes, hats }),
      layoutSource: 'generated',
      controls: [],
      reports: { buttons, axes, hats },
    };
  };

  it('renders every shipped drawing, every control shown, to SVG markup that stands alone', async () => {
    const sheet = await hornet();
    const out = process.env['RIGREADY_DRAWINGS_SVG_OUT'];
    if (out) await fs.mkdir(out, { recursive: true });
    const { drawings, broken } = builtinDrawings();
    expect(broken).toEqual([]);
    const names = new Set<string>();
    for (const drawing of drawings) {
      const onRig = sheet.devices.find((d) => {
        const picture = pictureFor(d);
        return picture.kind === 'drawing' && picture.drawing.name === drawing.name;
      });
      const device: PictureDevice = onRig ?? bare(drawing);
      const picture = pictureFor(device);
      expect(picture.kind, drawing.name).toBe('drawing');
      if (picture.kind === 'drawing') expect(picture.drawing.name).toBe(drawing.name);
      const svg = renderPictureSvg(device, { theme: 'dark', showEmpty: true });
      expect(svg.startsWith('<svg'), drawing.name).toBe(true);
      expect(svg).not.toContain('<script');
      // Every input the drawing draws has a row that can light.
      for (const control of drawing.controls) {
        for (const input of control.inputs) {
          expect(svg, `${drawing.name}: ${input.id}`).toContain(`data-control="${input.id}"`);
        }
      }
      const name = slug(drawing.name);
      expect(names.has(name), name).toBe(false);
      names.add(name);
      if (out) await fs.writeFile(path.join(out, `${name}.svg`), svg, 'utf8');
    }
  });
});
