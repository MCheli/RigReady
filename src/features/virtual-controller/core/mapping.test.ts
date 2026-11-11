import { describe, expect, it } from 'vitest';
import type { InputDevice, InputState } from '../../../shared/models';
import {
  computeReport,
  isVirtualPadLike,
  planMapping,
  resolveController,
  sameReport,
  shapeStick,
  shapeTrigger,
  sourceReader,
  splitThrottle,
  wheelRange,
} from './mapping';
import { PadProfileSchema, type PadProfileInput } from './profile';

const flat = { invert: false, deadzone: 0, curve: 1, range: 1 };
const close = (value: number, expected: number): void => expect(value).toBeCloseTo(expected, 6);

const stick: InputDevice = {
  index: 0,
  name: 'WINWING Orion Joystick Base 2 + JGRIP-F16',
  guid: '806DDF00-B756-11F0-8023-444553540000',
  productGuid: '',
  vendorId: '4098',
  productId: 'BEA8',
  numAxes: 3,
  numButtons: 4,
  numHats: 1,
  axisNames: ['X', 'Y', 'RZ'],
};
const pedals: InputDevice = {
  index: 1,
  name: 'T-Pendular-Rudder',
  guid: '7F3956A0-B756-11F0-801B-444553540000',
  productGuid: '',
  vendorId: '044F',
  productId: 'B68F',
  numAxes: 3,
  numButtons: 0,
  numHats: 0,
  axisNames: ['X', 'Y', 'Z'],
};
const devices = [stick, pedals];
const ref = (d: InputDevice): { name: string; guid: string } => ({ name: d.name, guid: d.guid });

function states(...list: Partial<InputState>[]): Map<number, InputState> {
  const map = new Map<number, InputState>();
  for (const s of list) {
    map.set(s.index!, {
      index: s.index!,
      name: s.name ?? '',
      axes: s.axes ?? [],
      buttons: s.buttons ?? [],
      hats: s.hats ?? [],
      timestamp: 0,
    });
  }
  return map;
}

describe('virtual controller mapping math', () => {
  it('a stick axis: straight through, inverted, clamped', () => {
    close(shapeStick(0.5, flat), 0.5);
    close(shapeStick(-1, flat), -1);
    close(shapeStick(0.5, { ...flat, invert: true }), -0.5);
    close(shapeStick(3, flat), 1);
    close(shapeStick(Number.NaN, flat), 0);
  });

  it('a deadzone gives nothing inside it and starts from zero at its edge, not with a jump', () => {
    const shape = { ...flat, deadzone: 0.1 };
    close(shapeStick(0.05, shape), 0);
    close(shapeStick(-0.1, shape), 0);
    close(shapeStick(0.1 + 1e-9, shape), 0);
    close(shapeStick(0.55, shape), 0.5);
    close(shapeStick(1, shape), 1);
    close(shapeStick(-0.55, shape), -0.5);
  });

  it('range reaches full output early (a wheel turned a third of its way is full lock)', () => {
    const shape = { ...flat, range: 0.3 };
    close(shapeStick(0.15, shape), 0.5);
    close(shapeStick(0.3, shape), 1);
    close(shapeStick(0.9, shape), 1);
    close(shapeStick(-0.3, shape), -1);
  });

  it('a curve above 1 is gentler near the centre and still reaches full', () => {
    const shape = { ...flat, curve: 2 };
    close(shapeStick(0.5, shape), 0.25);
    close(shapeStick(-0.5, shape), -0.25);
    close(shapeStick(1, shape), 1);
    close(shapeStick(0.5, { ...flat, curve: 0.5 }), Math.SQRT1_2);
  });

  it('deadzone, range and curve together, in that order', () => {
    // 0.6 past a 0.2 deadzone is 0.5; full at 0.5 of the rest makes it 1; squared stays 1.
    close(shapeStick(0.6, { invert: false, deadzone: 0.2, range: 0.5, curve: 2 }), 1);
    // 0.4 past the deadzone is 0.25; at half range 0.5; squared 0.25.
    close(shapeStick(0.4, { invert: false, deadzone: 0.2, range: 0.5, curve: 2 }), 0.25);
  });

  it('a pedal onto a trigger: released is 0, pressed is 1, with its own deadzone and curve', () => {
    close(shapeTrigger(-1, flat), 0);
    close(shapeTrigger(0, flat), 0.5);
    close(shapeTrigger(1, flat), 1);
    // A pedal that reads 1 when released is inverted.
    close(shapeTrigger(1, { ...flat, invert: true }), 0);
    close(shapeTrigger(-1, { ...flat, invert: true }), 1);
    close(shapeTrigger(-0.9, { ...flat, deadzone: 0.1 }), 0);
    close(shapeTrigger(0, { ...flat, deadzone: 0.2 }), 0.375);
    close(shapeTrigger(0, { ...flat, curve: 2 }), 0.25);
    close(shapeTrigger(0, { ...flat, range: 0.5 }), 1);
  });

  it('one throttle split over both triggers at the idle detent', () => {
    const shape = { invert: false, split: 0.5, deadzone: 0, curve: 1 };
    expect(splitThrottle(0, shape)).toEqual({ lt: 0, rt: 0 });
    expect(splitThrottle(1, shape)).toEqual({ lt: 0, rt: 1 });
    expect(splitThrottle(-1, shape)).toEqual({ lt: 1, rt: 0 });
    const half = splitThrottle(0.5, shape);
    close(half.rt, 0.5);
    close(half.lt, 0);
    // An idle detent at 38% of the travel, as one Steam guide sets it for a WinWing throttle.
    const detent = { ...shape, split: 0.38 };
    expect(splitThrottle(-0.24, detent)).toEqual({ lt: 0, rt: 0 });
    close(splitThrottle(-1, detent).lt, 1);
    close(splitThrottle(1, detent).rt, 1);
    close(splitThrottle(0.38, detent).rt, (0.69 - 0.38) / 0.62);
  });

  it('the split has a deadzone on each side and can be inverted', () => {
    const shape = { invert: false, split: 0.5, deadzone: 0.1, curve: 1 };
    expect(splitThrottle(0.05, shape)).toEqual({ lt: 0, rt: 0 });
    expect(splitThrottle(-0.05, shape)).toEqual({ lt: 0, rt: 0 });
    close(splitThrottle(1, shape).rt, 1);
    close(splitThrottle(0.55, shape).rt, 0.5);
    const inverted = splitThrottle(1, { ...shape, invert: true });
    expect(inverted.rt).toBe(0);
    close(inverted.lt, 1);
  });

  it('finds the controller by GUID, and by name on another PC', () => {
    expect(resolveController(ref(pedals), devices)).toBe(pedals);
    expect(
      resolveController(
        { name: pedals.name, guid: '00000000-0000-0000-0000-000000000000' },
        devices
      )
    ).toBe(pedals);
    expect(resolveController({ name: 'Not here' }, devices)).toBeUndefined();
  });

  it('reads buttons, hat directions (with their diagonals) and an axis used as a button', () => {
    const now = states({ index: 0, axes: [0.8, -0.7, 0], buttons: [false, true], hats: [[1, 1]] });
    const read = (input: string, when?: 'above' | 'below'): number | undefined =>
      sourceReader({ device: ref(stick), input, ...(when ? { when } : {}) }, devices)?.(now);
    expect(read('JOY_BTN1')).toBe(0);
    expect(read('JOY_BTN2')).toBe(1);
    expect(read('JOY_BTN_POV1_U')).toBe(1);
    expect(read('JOY_BTN_POV1_R')).toBe(1);
    expect(read('JOY_BTN_POV1_UR')).toBe(1);
    expect(read('JOY_BTN_POV1_D')).toBe(0);
    expect(read('JOY_BTN_POV1_UL')).toBe(0);
    expect(read('JOY_X')).toBeCloseTo(0.8);
    expect(read('JOY_X', 'above')).toBe(1);
    expect(read('JOY_Y', 'below')).toBe(1);
    expect(read('JOY_Y', 'above')).toBe(0);
    // Inputs the controller does not have are not mapped, never read as zero.
    expect(read('JOY_Z')).toBeUndefined();
    expect(read('JOY_BTN5')).toBeUndefined();
    expect(read('JOY_BTN_POV2_U')).toBeUndefined();
  });

  it('a whole report from a flight stick and pedals, with what is missing named', () => {
    const input: PadProfileInput = {
      id: 'test',
      name: 'Test',
      sticks: {
        lx: { source: { device: ref(stick), input: 'JOY_X' } },
        ly: { source: { device: ref(stick), input: 'JOY_Y' }, invert: true },
        rx: { source: { device: ref(pedals), input: 'JOY_Z' }, deadzone: 0.1 },
        ry: { source: { device: { name: 'Gone' }, input: 'JOY_X' } },
      },
      throttle: { source: { device: ref(pedals), input: 'JOY_X' }, split: 0.5, deadzone: 0 },
      buttons: {
        a: { source: { device: ref(stick), input: 'JOY_BTN1' } },
        up: { source: { device: ref(stick), input: 'JOY_BTN_POV1_U' } },
        lb: { source: { device: ref(pedals), input: 'JOY_Y', when: 'below' } },
      },
    };
    const profile = PadProfileSchema.parse(input);
    const plan = planMapping(profile, devices);
    expect(plan.missing).toEqual(['ry']);
    expect(plan.mapped.sort()).toEqual(['a', 'lb', 'lx', 'ly', 'rx', 'throttle', 'up']);
    const report = computeReport(
      profile,
      plan,
      states(
        { index: 0, axes: [0.25, 0.5, 0], buttons: [true], hats: [[0, 1]] },
        { index: 1, axes: [1, -0.9, 0.05] }
      )
    );
    close(report.lx, 0.25);
    close(report.ly, -0.5);
    close(report.rx, 0);
    close(report.ry, 0);
    close(report.rt, 1);
    close(report.lt, 0);
    expect(report.buttons).toBe(0x1000 | 0x0001 | 0x0100);
    // Nothing moved yet: a neutral report.
    expect(computeReport(profile, plan, new Map())).toMatchObject({ buttons: 0, lt: 0, rt: 0 });
  });

  it('triggers from their own pedals, or from a button, when the throttle is not split', () => {
    const profile = PadProfileSchema.parse({
      id: 'wheel',
      name: 'Wheel',
      triggers: {
        rt: { source: { device: ref(pedals), input: 'JOY_X' } },
        lt: { source: { device: ref(stick), input: 'JOY_BTN2' } },
      },
    });
    const report = computeReport(
      profile,
      planMapping(profile, devices),
      states({ index: 0, buttons: [false, true] }, { index: 1, axes: [0, 0, 0] })
    );
    close(report.rt, 0.5);
    expect(report.lt).toBe(1);
  });

  it('a button on a stick pushes it all the way', () => {
    const profile = PadProfileSchema.parse({
      id: 'b',
      name: 'B',
      sticks: { rx: { source: { device: ref(stick), input: 'JOY_BTN1' }, invert: true } },
    });
    const report = computeReport(
      profile,
      planMapping(profile, devices),
      states({ index: 0, buttons: [true] })
    );
    expect(report.rx).toBe(-1);
  });

  it('tells reports a game could not tell apart, the wheel range, and virtual pads', () => {
    const a = { lx: 0.1, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: 1 };
    expect(sameReport(a, { ...a })).toBe(true);
    expect(sameReport(a, { ...a, lx: 0.1 + 1e-6 })).toBe(true);
    expect(sameReport(a, { ...a, lx: 0.2 })).toBe(false);
    expect(sameReport(a, { ...a, buttons: 2 })).toBe(false);
    expect(sameReport(undefined, a)).toBe(false);
    close(wheelRange(900, 270), 0.3);
    close(wheelRange(900, 1080), 1);
    close(wheelRange(0, 270), 1);
    expect(isVirtualPadLike({ vendorId: '045E', productId: '028E', name: 'Controller' })).toBe(
      true
    );
    expect(
      isVirtualPadLike({ vendorId: '', productId: '', name: 'Controller (XBOX 360 For Windows)' })
    ).toBe(true);
    expect(isVirtualPadLike(stick)).toBe(false);
  });
});
