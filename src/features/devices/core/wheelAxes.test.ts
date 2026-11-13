import { describe, expect, it } from 'vitest';
import { axisPercent, axisRaw, widen } from './input';
import { pedalTravel, steering, wheelAxes, wheelAxisName } from './wheelAxes';

/** The wheel base of the recorded rig, as the controller list has it. */
const dd2 = {
  vendorId: '0EB7',
  productId: '0007',
  axisNames: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'],
};

describe('the axes of a wheel base', () => {
  it('names the axes the maker names, and no others', () => {
    expect(wheelAxisName(dd2, 'X')).toBe('Wheel');
    expect(wheelAxisName(dd2, 'Y')).toBe('Combined pedals');
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
      { index: 1, name: 'Combined pedals', role: 'combined' },
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
