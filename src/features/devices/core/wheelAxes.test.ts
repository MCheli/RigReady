import { describe, expect, it } from 'vitest';
import { axisPercent, axisRaw, widen } from './input';
import {
  clutchAxis,
  pedalTravel,
  steering,
  wheelAxes,
  wheelAxisName,
  type AxisSeen,
  type WheelAxis,
} from './wheelAxes';

/** The wheel base of the recorded rig, as the controller list has it. */
const dd2 = {
  vendorId: '0EB7',
  productId: '0007',
  axisNames: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'],
};

describe('the axes of a wheel base', () => {
  it('names the axes the maker names, and no others', () => {
    expect(wheelAxisName(dd2, 'X')).toBe('Wheel');
    // The driver calls Y "Combined Pedals" in every pedal mode; with the pedals separate it
    // carries the clutch, and Windows does not say which mode the base is in.
    expect(wheelAxisName(dd2, 'Y')).toBe('Clutch or combined pedals');
    expect(wheelAxisName(dd2, 'Z')).toBe('Accelerator');
    expect(wheelAxisName(dd2, 'RZ')).toBe('Brake');
    expect(wheelAxisName(dd2, 'SLIDER1')).toBe('Clutch');
    expect(wheelAxisName(dd2, 'slider2')).toBe('Dial');
    expect(wheelAxisName(dd2, 'RX')).toBeUndefined();
    expect(wheelAxisName(dd2, undefined)).toBeUndefined();
    // The ids are matched whatever their case.
    expect(wheelAxisName({ vendorId: '0eb7', productId: '0e03' }, 'X')).toBe('Wheel');
  });

  it('names nothing on a controller RigReady has no source for', () => {
    // Another maker's base, the same maker's pedals on their own lead, no ids at all.
    expect(wheelAxisName({ vendorId: '346E', productId: '0004' }, 'X')).toBeUndefined();
    expect(wheelAxisName({ vendorId: '0EB7', productId: '183B' }, 'Z')).toBeUndefined();
    expect(wheelAxisName({}, 'X')).toBeUndefined();
    expect(wheelAxisName(undefined, 'X')).toBeUndefined();
    expect(wheelAxes({ ...dd2, vendorId: '346E' })).toBeUndefined();
    expect(wheelAxes(undefined)).toBeUndefined();
  });

  it("lists the axes by what they are, with their place among the controller's axes", () => {
    expect(wheelAxes(dd2)).toEqual([
      { index: 0, name: 'Wheel', role: 'steering' },
      { index: 1, name: 'Clutch or combined pedals', role: 'clutchOrCombined' },
      { index: 2, name: 'Accelerator', role: 'accelerator' },
      { index: 5, name: 'Brake', role: 'brake' },
      { index: 6, name: 'Clutch', role: 'clutch' },
      { index: 7, name: 'Dial', role: 'dial' },
    ]);
    // A base that reports fewer axes: what it has, at the places it has them.
    expect(wheelAxes({ ...dd2, axisNames: ['X', 'RZ'] })).toEqual([
      { index: 0, name: 'Wheel', role: 'steering' },
      { index: 1, name: 'Brake', role: 'brake' },
    ]);
    // No steering axis, no wheel to draw.
    expect(wheelAxes({ ...dd2, axisNames: ['Z', 'RZ'] })).toBeUndefined();
  });
});

describe('the steering in words', () => {
  it('says the side and the share of the travel to that side', () => {
    expect(steering(0)).toEqual({ side: 'centre', percent: 0, text: 'Centre' });
    expect(steering(-0.37)).toEqual({ side: 'left', percent: 37, text: 'Left 37%' });
    expect(steering(0.5)).toEqual({ side: 'right', percent: 50, text: 'Right 50%' });
    expect(steering(-1).text).toBe('Left 100%');
    expect(steering(1).text).toBe('Right 100%');
  });

  it('calls the wheel straight within 1% of the travel of the centre, and no further', () => {
    expect(steering(0.019).side).toBe('centre');
    expect(steering(-0.019).side).toBe('centre');
    expect(steering(0.021)).toMatchObject({ side: 'right', percent: 2 });
    expect(steering(-0.021)).toMatchObject({ side: 'left', percent: 2 });
  });

  it('holds on a value that is no reading', () => {
    expect(steering(Number.NaN).side).toBe('centre');
    expect(steering(4).text).toBe('Right 100%');
    expect(steering(-4).text).toBe('Left 100%');
  });
});

describe('how far a pedal is pressed', () => {
  it('counts from the low end when the pedal rests there', () => {
    expect(pedalTravel(-1, -1)).toBe(0);
    expect(pedalTravel(0, -1)).toBe(0.5);
    expect(pedalTravel(1, -1)).toBe(1);
  });

  it('counts from the high end when the first reading was there', () => {
    expect(pedalTravel(1, 1)).toBe(0);
    expect(pedalTravel(0, 1)).toBe(0.5);
    expect(pedalTravel(-1, 0.95)).toBe(1);
  });

  it('counts from the low end when nothing is known yet or the first reading was mid-way', () => {
    expect(pedalTravel(-1, undefined)).toBe(0);
    expect(pedalTravel(1, undefined)).toBe(1);
    expect(pedalTravel(0.5, 0)).toBe(0.75);
    expect(pedalTravel(Number.NaN, -1)).toBe(0.5);
  });
});

describe('which axis the Clutch bar reads (the clutch on Y at the second look)', () => {
  const axes = wheelAxes(dd2)!;
  const Y = 1;
  const SLIDER1 = 6;
  /** What the tester saw: per axis index, the first reading and every reading since. */
  const seenFrom =
    (readings: Record<number, number[]>) =>
    (index: number): AxisSeen => {
      const values = readings[index];
      if (!values?.length) return {};
      return {
        rest: values[0],
        range: { min: Math.min(...values), max: Math.max(...values) },
      };
    };
  const nameOf = (axis: WheelAxis | undefined): string | undefined => axis?.name;

  it('reads Y when the clutch pedal moves it and Slider 1 sits still, as on the rig at the second look', () => {
    // The pedals rest high and fall when pressed. Slider 1 stayed at 100% the whole time.
    const pressed = seenFrom({ [Y]: [1, 0.2, -1], [SLIDER1]: [1, 1, 1] });
    const axis = clutchAxis(axes, pressed);
    expect(axis).toMatchObject({ index: Y, role: 'clutchOrCombined' });
    // Fully pressed reads 100% on the bar, counted from where Y rested.
    expect(Math.round(pedalTravel(-1, 1) * 100)).toBe(100);
  });

  it('reads Slider 1 once it moves, whatever Y does', () => {
    expect(nameOf(clutchAxis(axes, seenFrom({ [SLIDER1]: [-1, 0.6] })))).toBe('Clutch');
    expect(clutchAxis(axes, seenFrom({ [Y]: [1, -1], [SLIDER1]: [1, 0.5] }))?.index).toBe(SLIDER1);
  });

  it('never takes Y for the clutch when it rests mid-way, as accelerator and brake together do', () => {
    // Combined mode: Y rests at the middle, the accelerator moves it one way, the brake the other.
    const combined = seenFrom({ [Y]: [0, 0.8, -0.7, 0], [SLIDER1]: [-1, -1] });
    expect(clutchAxis(axes, combined)?.index).toBe(SLIDER1);
  });

  it('keeps to Slider 1 while nothing has moved more than a wobble', () => {
    expect(clutchAxis(axes, seenFrom({}))?.index).toBe(SLIDER1);
    expect(clutchAxis(axes, seenFrom({ [Y]: [1, 0.95], [SLIDER1]: [1, 0.97] }))?.index).toBe(
      SLIDER1
    );
  });

  it('a base with only one of the two: Slider 1 always, Y only once it moved as a pedal', () => {
    const noY = wheelAxes({ ...dd2, axisNames: ['X', 'Z', 'RZ', 'SLIDER1'] })!;
    expect(clutchAxis(noY, seenFrom({}))?.name).toBe('Clutch');
    const noSlider = wheelAxes({ ...dd2, axisNames: ['X', 'Y', 'Z', 'RZ'] })!;
    expect(clutchAxis(noSlider, seenFrom({}))).toBeUndefined();
    expect(clutchAxis(noSlider, seenFrom({ 1: [0, 0.9] }))).toBeUndefined();
    expect(clutchAxis(noSlider, seenFrom({ 1: [-1, 0.4] }))?.index).toBe(1);
  });
});

describe('the end of the travel in numbers (the wheel that read 99% at the sitting)', () => {
  it('reads 100% when the wheel reports its highest value, and 99% only when it does not', () => {
    // Full scale: the highest raw value there is.
    expect(axisRaw(1)).toBe(65535);
    expect(Math.round(axisPercent(widen(widen(undefined, -1), 1).max))).toBe(100);
    expect(steering(1).percent).toBe(100);
    // 99% is not the tester rounding a full value down: it takes a highest value that
    // stopped short of full scale, by more than half a percent of the travel.
    const short = 0.985;
    expect(axisRaw(short)).toBeLessThan(65208);
    expect(Math.round(axisPercent(widen(widen(undefined, -1), short).max))).toBe(99);
    // Anything within half a percent of the end still reads 100.
    expect(Math.round(axisPercent(0.991))).toBe(100);
  });
});
