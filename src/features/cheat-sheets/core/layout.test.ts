import { describe, expect, it } from 'vitest';
import { builtinLayoutFor, builtinLayouts } from './builtin';
import { categorize, shortAction } from './categories';
import { convertJoystickDiagrams, parseTransform, placeholderControl } from './convert';
import { appendUnplaced, generateLayout, shapeFromControls } from './generate';
import {
  compareControlIds,
  controlIdOf,
  controlName,
  controlShort,
  DeviceLayoutSchema,
  layoutMatches,
  parseLayout,
  placedControls,
  serializeLayout,
  type DeviceLayout,
} from './layout';
import { axisValues, LiveTracker, pressedControls } from './live';

const boxes = (layout: DeviceLayout) =>
  layout.controls.map((c) => ({
    id: c.kind === 'cross' ? `cross ${c.label}` : c.input,
    x: c.x,
    y: c.y,
    r: c.x + c.w,
    b: c.y + c.h,
  }));

describe('the layout format', () => {
  it('names controls the way DirectInput numbers them, whatever the game calls them', () => {
    expect(controlIdOf('JOY_BTN12')).toBe('button:12');
    expect(controlIdOf('JOY_BTN_POV1_UL')).toBe('hat:1:UL');
    expect(controlIdOf('JOY_RZ')).toBe('axis:RZ');
    expect(controlIdOf('JOY_SLIDER1')).toBe('axis:SLIDER1');
    // A keyboard key has no place on a controller picture.
    expect(controlIdOf('LShift')).toBeUndefined();
    expect(controlIdOf('JOY_BTN0')).toBeUndefined();
    expect(controlName('button:12')).toBe('Button 12');
    expect(controlName('hat:1:UL')).toBe('Hat 1 up-left');
    expect(controlName('axis:RZ')).toBe('Z rotation');
    expect(controlShort('axis:SLIDER1')).toBe('S1');
    expect(controlShort('hat:1:U')).toBe('H1↑');
    expect(['button:10', 'axis:X', 'button:2', 'hat:1:U'].sort(compareControlIds)).toEqual([
      'axis:X',
      'hat:1:U',
      'button:2',
      'button:10',
    ]);
  });

  it('reads back what it writes, and says in words why a file is not a layout', () => {
    const layout = builtinLayoutFor('4098', 'BEE1')!;
    const again = parseLayout(serializeLayout(layout));
    expect(again.ok && again.layout).toEqual(layout);

    expect(parseLayout('{ nope')).toMatchObject({ ok: false, reason: /not valid JSON/ });
    expect(parseLayout('{"name":"x"}')).toMatchObject({
      ok: false,
      reason: /not a RigReady device layout/,
    });
    const broken = {
      ...layout,
      controls: [{ kind: 'button', input: 'BTN 1', x: 0, y: 0, w: 5, h: 5 }],
    };
    expect(parseLayout(JSON.stringify(broken)).ok).toBe(false);
    const twice = { ...layout, controls: [layout.controls[0], layout.controls[0]] };
    expect(parseLayout(JSON.stringify(twice))).toMatchObject({
      ok: false,
      reason: /placed more than once/,
    });
    // Nothing in a layout can be a script or a link: a background must be an image data URL.
    const linked = {
      ...layout,
      background: { image: 'https://example.com/x.png', x: 0, y: 0, w: 10, h: 10 },
    };
    expect(parseLayout(JSON.stringify(linked)).ok).toBe(false);
  });

  it('matches a device by vendor id and any of its product ids', () => {
    const layout = builtinLayoutFor('4098', 'bee1')!;
    expect(layoutMatches(layout, '4098', 'BEE2')).toBe(true);
    expect(layoutMatches(layout, '4098', 'BEA8')).toBe(false);
    expect(layoutMatches(layout, undefined, 'BEE2')).toBe(false);
  });
});

describe('the layouts RigReady ships', () => {
  const { layouts, broken } = builtinLayouts();

  it('cover the devices of the rig, as valid layout files', () => {
    expect(broken).toEqual([]);
    const owned: [string, string][] = [
      ['4098', 'BEE0'],
      ['4098', 'BEE1'],
      ['4098', 'BEE2'],
      ['4098', 'BEA8'],
      ['4098', 'BD26'],
      ['4098', 'BEDE'],
      ['4098', 'BF06'],
      ['4098', 'BE03'],
      ['4098', 'BF05'],
      ['044F', 'B68F'],
      ['3344', 'C259'],
      ['0EB7', '0007'],
    ];
    for (const [vendorId, productId] of owned) {
      expect(builtinLayoutFor(vendorId, productId), `${vendorId}:${productId}`).toBeDefined();
    }
    for (const layout of layouts) {
      expect(DeviceLayoutSchema.safeParse(layout).success, layout.name).toBe(true);
      expect(parseLayout(serializeLayout(layout)).ok, layout.name).toBe(true);
      expect(layout.license).toBe('CC0-1.0');
    }
    expect(builtinLayoutFor('046D', 'C215')).toBeUndefined();
  });

  it('keep every card on the canvas and no two cards on top of each other', () => {
    for (const layout of layouts) {
      const all = boxes(layout);
      for (const box of all) {
        expect(box.x, `${layout.name} ${box.id}`).toBeGreaterThanOrEqual(0);
        expect(box.y, `${layout.name} ${box.id}`).toBeGreaterThanOrEqual(0);
        expect(box.r, `${layout.name} ${box.id}`).toBeLessThanOrEqual(layout.canvas.width);
        expect(box.b, `${layout.name} ${box.id}`).toBeLessThanOrEqual(layout.canvas.height);
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const [a, b] = [all[i]!, all[j]!];
          const overlap = a.x < b.r - 0.5 && b.x < a.r - 0.5 && a.y < b.b - 0.5 && b.y < a.b - 0.5;
          expect(overlap, `${layout.name}: ${a.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });

  it('draw the MFD frame as twenty buttons around a screen with a rocker in each corner', () => {
    const mfd = builtinLayoutFor('4098', 'BEE1')!;
    const osb = mfd.controls.filter((c) => c.kind === 'button' && c.label?.startsWith('OSB'));
    expect(osb).toHaveLength(20);
    const screen = mfd.shapes.find((s) => s.type === 'rect' && s.role === 'screen');
    expect(screen).toBeDefined();
    // The frame's own numbering: 42 is the first button of the top row, 1 the top of the left side.
    const at = (input: string) =>
      mfd.controls.find((c) => c.kind !== 'cross' && c.input === input)!;
    expect(at('button:42').label).toBe('OSB 1');
    expect(at('button:42').y).toBeLessThan(at('button:1').y);
    expect(at('button:1').x).toBeLessThan(at('button:31').x);
    expect(at('button:12').y).toBeGreaterThan(at('button:9').y);
    for (const rocker of ['GAIN ▲', 'SYM ▼', 'BRT ▲', 'CON ▼']) {
      expect(
        mfd.controls.some((c) => c.label === rocker),
        rocker
      ).toBe(true);
    }
  });

  it('place the pedals as two toe brakes and a rudder, the stick with its hat as a cross', () => {
    const pedals = builtinLayoutFor('044F', 'B68F')!;
    expect([...placedControls(pedals)].sort()).toEqual(['axis:X', 'axis:Y', 'axis:Z']);
    const stick = builtinLayoutFor('4098', 'BEA8')!;
    const hat = stick.controls.find((c) => c.kind === 'cross' && c.label === 'TRIM hat');
    expect(hat?.kind === 'cross' && hat.inputs.U).toBe('hat:1:U');
    // Every button the grip reports is somewhere on the sheet.
    const placed = placedControls(stick);
    for (let n = 1; n <= 42; n++) expect(placed.has(`button:${n}`), `button ${n}`).toBe(true);
  });
});

describe('a generated layout, for a device nobody has drawn', () => {
  const shape = {
    name: 'Logitech Extreme 3D',
    vendorId: '046d',
    productId: 'c215',
    buttons: 12,
    axes: ['X', 'Y', 'RZ', 'SLIDER1'],
    hats: 1,
  };

  it('groups axes, the hat as a cross and buttons in rows of eight in their own numbering', () => {
    const layout = DeviceLayoutSchema.parse(generateLayout(shape));
    expect(layout.match).toEqual({ vendorId: '046D', productIds: ['C215'] });
    expect(layout.groups.map((g) => g.label)).toEqual(['Axes', 'Hat', 'Buttons']);
    expect(layout.controls.filter((c) => c.kind === 'axis')).toHaveLength(4);
    const hat = layout.controls.find((c) => c.kind === 'cross')!;
    expect(hat.kind === 'cross' && Object.keys(hat.inputs)).toHaveLength(8);
    const buttons = layout.controls.filter((c) => c.kind === 'button');
    expect(buttons.map((b) => b.kind === 'button' && b.input)).toEqual(
      Array.from({ length: 12 }, (_, i) => `button:${i + 1}`)
    );
    // Rows of eight: button 9 starts the second row, under button 1.
    expect(buttons[8]!.x).toBe(buttons[0]!.x);
    expect(buttons[8]!.y).toBeGreaterThan(buttons[0]!.y);
    expect(buttons[7]!.y).toBe(buttons[0]!.y);
    const lowest = Math.max(...layout.controls.map((c) => c.y + c.h));
    expect(layout.canvas.height).toBeGreaterThan(lowest);
  });

  it('adds controls that do something but are not on a layout below it', () => {
    const pedals = builtinLayoutFor('044F', 'B68F')!;
    expect(appendUnplaced(pedals, ['axis:X'])).toBe(pedals);
    const more = DeviceLayoutSchema.parse(
      appendUnplaced(pedals, ['button:3', 'axis:RX', 'button:3'])
    );
    expect(more.groups.at(-1)?.label).toBe('More controls');
    expect(more.controls.slice(-2).map((c) => c.kind !== 'cross' && [c.kind, c.input])).toEqual([
      ['axis', 'axis:RX'],
      ['button', 'button:3'],
    ]);
    expect(more.canvas.height).toBeGreaterThan(pedals.canvas.height);
    expect(more.controls.slice(-1)[0]!.y).toBeGreaterThanOrEqual(pedals.canvas.height);
  });

  it('works out the shape of a device that is not attached from what is bound on it', () => {
    expect(
      shapeFromControls({ name: 'Old stick' }, [
        'button:7',
        'button:3',
        'hat:1:U',
        'axis:Y',
        'axis:X',
      ])
    ).toEqual({
      name: 'Old stick',
      vendorId: '0000',
      productId: '0000',
      buttons: 7,
      axes: ['X', 'Y'],
      hats: 1,
    });
    expect(generateLayout({ ...shape, buttons: 0, axes: [], hats: 0 }).controls).toEqual([]);
  });
});

describe('kinds of action, for colour-coding', () => {
  it('sorts the Hornet actions the owner has bound into kinds that mean something', () => {
    const cases: [string, string[], string][] = [
      ['Weapon Release Button', ['Stick', 'HOTAS'], 'weapons'],
      ['Gun Trigger - SECOND DETENT (Press to shoot)', ['Stick', 'HOTAS'], 'weapons'],
      ['Select Sidewinder', ['Stick', 'HOTAS'], 'weapons'],
      ['Throttle Designator Controller - Depress', ['Throttle Grip', 'HOTAS'], 'sensors'],
      ['Sensor Control Switch - Fwd', ['Stick', 'HOTAS'], 'sensors'],
      ['Radar Elevation Control - Up', ['Throttle Grip', 'HOTAS'], 'sensors'],
      ['Dispense Switch - Aft(FLARE)/Center(OFF)', ['Throttle Grip', 'HOTAS'], 'countermeasures'],
      ['COMM Switch - COMM 1 (call radio menu)', ['Throttle Grip', 'HOTAS'], 'comms'],
      ['UFC COMM 1 Volume Control Knob', ['Instrument Panel', 'UFC'], 'comms'],
      ['Left MDI PB 5', ['Instrument Panel', 'Left MDI'], 'displays'],
      ['UFC Function Selector Pushbutton - A/P', ['Instrument Panel', 'UFC'], 'displays'],
      ['Trimmer Switch - LEFT WING DOWN', ['Stick', 'Flight Control', 'HOTAS'], 'flight'],
      ['Autopilot/Nosewheel Steering Disengage (Paddle) Switch', ['Stick', 'HOTAS'], 'flight'],
      ['ATC Engage/Disengage Switch', ['Throttle Grip', 'HOTAS'], 'flight'],
      ['Thrust Left', ['Flight Control'], 'engine'],
      ['Throttle (Left) - OFF', ['Throttle Quadrant'], 'engine'],
      ['Probe Control Switch - EXTEND', ['Left Console', 'Fuel Control Panel'], 'engine'],
      ['Landing Gear Control Handle - UP', ['Left Vertical Panel'], 'airframe'],
      ['Speed Brake Switch - EXTEND', ['Throttle Grip', 'HOTAS'], 'airframe'],
      ['Wheel Brake Left', ['Systems'], 'airframe'],
      ['Ground Power Switch 1 - A ON', ['Left Console', 'Ground Power Panel'], 'systems'],
      ['Battery Switch - ON', ['Right Console', 'Electrical Power Panel'], 'systems'],
      ['View Center', ['View'], 'view'],
      ['Zoom in slow', ['View'], 'view'],
      ['Something nobody has heard of', [], 'other'],
    ];
    for (const [action, category, kind] of cases) {
      expect(categorize(action, category), action).toBe(kind);
    }
  });

  it('shortens an action for a small label without losing what it is', () => {
    expect(shortAction('FLAP Switch - AUTO')).toBe('FLAP: AUTO');
    expect(shortAction('UFC Keyboard Pushbutton - 1')).toBe('UFC Keyboard: 1');
    expect(shortAction('Weapon Release Button')).toBe('Weapon Release');
    expect(shortAction('Gun Trigger - SECOND DETENT (Press to shoot)')).toBe(
      'Gun Trigger: SECOND DETENT (Press to shoot)'
    );
    expect(shortAction('Roll')).toBe('Roll');
    // Never shortened to nothing.
    expect(shortAction('A Button')).toBe('A Button');
  });
});

describe('converting a Joystick Diagrams template the user supplies', () => {
  const svg =
    `<?xml version="1.0"?><!-- a template --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">` +
    `<script>alert(1)</script><rect width="400" height="300" onclick="x()"/>` +
    `<g transform="translate(20,10) scale(2)"><text x="10" y="30" font-size="10">BUTTON_1</text>` +
    `<text><tspan x="100" y="30" style="font-size:8px">BUTTON_2</tspan></text></g>` +
    `<text transform="matrix(1 0 0 1 50 200)" x="0" y="0">AXIS_SLIDER_1</text>` +
    `<text x="300" y="250">POV_1_UL</text><text x="5" y="5">BUTTON_1_MODIFIER</text>` +
    `<text x="9" y="9">Just a caption</text></svg>`;

  it('turns placeholders into controls at their places, over the drawing as the background', () => {
    const result = convertJoystickDiagrams(svg, {
      name: 'My stick',
      vendorId: '046d',
      productId: 'c215',
    });
    if (!result.ok) throw new Error(result.reason);
    const { layout } = result;
    expect(layout.canvas).toEqual({ width: 1000, height: 750 });
    expect(layout.match).toEqual({ vendorId: '046D', productIds: ['C215'] });
    const at = (input: string) =>
      layout.controls.find((c) => c.kind !== 'cross' && c.input === input)!;
    // translate(20,10) scale(2) puts x=10 at 40; 400 units become 1000.
    expect(at('button:1').x).toBe(100);
    expect(at('button:2').x).toBe(550);
    expect(at('axis:SLIDER1')).toMatchObject({ kind: 'axis', x: 125 });
    expect(at('hat:1:UL').x).toBe(750);
    expect(result.skipped).toEqual(['BUTTON_1_MODIFIER']);
    // The drawing is kept, without the placeholder texts and without anything that could run.
    const drawing = Buffer.from(layout.background!.image.split(',')[1]!, 'base64').toString('utf8');
    expect(drawing).toContain('<rect width="400"');
    expect(drawing).toContain('Just a caption');
    expect(drawing).not.toMatch(/BUTTON_1<|script|onclick/);
  });

  it('refuses what is not a template, with the reason', () => {
    const target = { name: 'x', vendorId: '046D', productId: 'C215' };
    expect(convertJoystickDiagrams('hello', target)).toMatchObject({
      ok: false,
      reason: /not an SVG/,
    });
    expect(
      convertJoystickDiagrams('<svg><text x="1" y="1">BUTTON_1</text></svg>', target)
    ).toMatchObject({
      ok: false,
      reason: /how large/,
    });
    expect(
      convertJoystickDiagrams(
        '<svg width="100" height="50"><text x="1" y="1">Hi</text></svg>',
        target
      )
    ).toMatchObject({ ok: false, reason: /placeholders/ });
  });

  it('understands the placeholder names and SVG transforms', () => {
    expect(placeholderControl(' button_12 ')).toEqual({ id: 'button:12', kind: 'button' });
    expect(placeholderControl('AXIS_RZ')).toEqual({ id: 'axis:RZ', kind: 'axis' });
    expect(placeholderControl('AXIS_SLIDER_2')).toEqual({ id: 'axis:SLIDER2', kind: 'axis' });
    expect(placeholderControl('POV_2_D')).toEqual({ id: 'hat:2:D', kind: 'button' });
    expect(placeholderControl('BUTTON_0')).toBeUndefined();
    expect(parseTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(parseTransform('scale(2, 3)')).toEqual([2, 0, 0, 3, 0, 0]);
    const quarter = parseTransform('rotate(90)');
    expect(Math.round(quarter[1])).toBe(1);
    expect(Math.round(quarter[2])).toBe(-1);
    expect(parseTransform('skewX(nonsense)')).toEqual([1, 0, 0, 1, 0, 0]);
  });
});

describe('live input as control ids', () => {
  const device = {
    index: 3,
    name: 'Stick',
    guid: 'aaaa-01',
    productGuid: '',
    vendorId: '4098',
    productId: 'BEA8',
    numAxes: 2,
    numButtons: 4,
    numHats: 1,
    axisNames: ['X', 'RZ'],
  };
  const state = (buttons: boolean[], hat: [number, number], axes: number[]) => ({
    index: 3,
    name: 'Stick',
    axes,
    buttons,
    hats: [hat],
    timestamp: 1,
  });

  it('names what is held and where the axes are', () => {
    expect(pressedControls(state([false, true, false, true], [1, 1], [0, 0]))).toEqual([
      'button:2',
      'button:4',
      'hat:1:UR',
    ]);
    expect(pressedControls(state([], [0, 0], []))).toEqual([]);
    expect(axisValues(device, { axes: [0.5, -3, 9] })).toEqual({ 'axis:X': 0.5, 'axis:RZ': -1 });
  });

  it('says an axis moved only when it travelled, not when it wobbles', () => {
    const tracker = new LiveTracker();
    expect(tracker.update(undefined, state([], [0, 0], [0, 0]))).toBeUndefined();
    expect(tracker.update(device, state([], [0, 0], [0, 0]))).toMatchObject({
      guid: 'AAAA-01',
      moved: [],
    });
    expect(tracker.update(device, state([], [0, 0], [0.03, 0]))?.moved).toEqual([]);
    expect(tracker.update(device, state([true], [0, 0], [0.4, 0]))).toMatchObject({
      pressed: ['button:1'],
      moved: ['axis:X'],
    });
    tracker.reset();
    expect(tracker.update(device, state([], [0, 0], [0.9, 0]))?.moved).toEqual([]);
  });
});
