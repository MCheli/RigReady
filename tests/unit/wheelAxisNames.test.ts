/**
 * The input tester (devices), the Wheel page (racing) and the two iRacing pages (racing and
 * iracing-bindings) call the axes of a wheel base by the same names. No feature imports
 * another, so each keeps its own table (devices/core/wheelAxes.ts,
 * racing/core/wheelbases/brands.ts, iracing-bindings/core/calibration.ts) and this test
 * holds them together: a name or a base added on one side fails here until the others follow.
 */
import { describe, expect, it } from 'vitest';
import { axisLabel } from '../../src/features/devices/core/input';
import { wheelAxes } from '../../src/features/devices/core/wheelAxes';
import { shownAxisName } from '../../src/features/iracing-bindings/core/calibration';
import { axisFromName } from '../../src/features/racing/core/bindingReaders';
import { axisName, gameAxisName, neutralAxisName } from '../../src/features/racing/core/devices';
import { brandOf } from '../../src/features/racing/core/wheelbases/brands';
import { WHEEL_PRODUCTS } from '../../src/features/racing/core/wheelbases/products';

/** Every axis a DirectInput controller can report, as the controller list spells them. */
const AXES = ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'];

const products = Object.entries(WHEEL_PRODUCTS).map(([id, product]) => {
  const [vendorId, productId] = id.split(':') as [string, string];
  return { id, vendorId, productId, product };
});

describe('one name for each axis of a wheel base', () => {
  it('the table of wheel products is there to walk', () => {
    expect(products.length).toBeGreaterThan(20);
    expect(products.some((p) => brandOf(p.product.brand)?.baseAxes)).toBe(true);
  });

  it('the tester names every axis of every known wheel product as the Wheel page does', () => {
    const differences: string[] = [];
    for (const { id, vendorId, productId } of products) {
      for (const axis of AXES) {
        const tester = axisLabel({ vendorId, productId, axisNames: [axis] }, 0);
        const wheelPage = axisName(neutralAxisName(axis), vendorId, productId);
        if (tester !== wheelPage)
          differences.push(`${id} ${axis}: tester "${tester}", Wheel page "${wheelPage}"`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('the tester draws a wheel for exactly the bases whose axes the Wheel page has a source for', () => {
    const wrong: string[] = [];
    for (const { id, vendorId, productId, product } of products) {
      const sourced = product.role === 'base' && brandOf(product.brand)?.baseAxes !== undefined;
      const drawn = wheelAxes({ vendorId, productId, axisNames: AXES }) !== undefined;
      if (sourced !== drawn) wrong.push(`${id}: axes sourced ${sourced}, wheel drawn ${drawn}`);
    }
    expect(wrong).toEqual([]);
  });

  it('an axis name iRacing copied from the driver is shown on both iRacing pages as the tester names the axis', () => {
    // The names the Fanatec driver gives (docs/research/racing.md, "Axis names on COL01").
    // iRacing writes them into joyCalib.yaml; RigReady calls Y otherwise.
    const DRIVER: Record<string, string> = {
      X: 'Wheel Axis',
      Y: 'Combined Pedals',
      Z: 'Accelerator',
      RZ: 'Brake',
      SLIDER1: 'Clutch',
      SLIDER2: 'Dial',
    };
    const differences: string[] = [];
    for (const { id, vendorId, productId } of products) {
      for (const [axis, driverName] of Object.entries(DRIVER)) {
        const tester = axisLabel({ vendorId, productId, axisNames: [axis] }, 0);
        const sourced = wheelAxes({ vendorId, productId, axisNames: ['X', axis] }) !== undefined;
        // Where the tester has the maker's names, a driver name that differs only by "Axis"
        // stays as iRacing has it; one that says something else is shown as the tester says it.
        const plain = (s: string): string => s.toLowerCase().replace(/\s+axis$/, '');
        const expected = sourced && plain(tester) !== plain(driverName) ? tester : driverName;
        const iracingBindings = shownAxisName(driverName, { vendorId, productId });
        const racingIracing = gameAxisName(driverName, vendorId, productId);
        if (iracingBindings !== expected || racingIracing !== expected)
          differences.push(
            `${id} ${axis} "${driverName}": iRacing bindings "${iracingBindings}", Racing iRacing "${racingIracing}", tester "${expected}"`
          );
        // And the binding is still matched to its axis by the driver's name.
        if (sourced && axisFromName(driverName, vendorId, productId) !== axis)
          differences.push(`${id} ${axis} "${driverName}": not matched to its axis`);
      }
    }
    expect(differences).toEqual([]);
    expect(shownAxisName('Combined Pedals', { vendorId: '0EB7', productId: '0007' })).toBe(
      'Clutch or combined pedals'
    );
  });

  it('a controller that is no wheel product keeps the names Windows gives its axes', () => {
    // A WinWing throttle: the same axes, none of them a pedal.
    const throttle = { vendorId: '4098', productId: 'BD26', axisNames: AXES };
    expect(AXES.map((_, i) => axisLabel(throttle, i))).toEqual([
      'X axis',
      'Y axis',
      'Z axis',
      'X rotation',
      'Y rotation',
      'Z rotation',
      'Slider 1',
      'Slider 2',
    ]);
    expect(wheelAxes(throttle)).toBeUndefined();
  });
});
