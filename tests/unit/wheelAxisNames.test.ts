/**
 * The input tester (devices) and the Wheel page (racing) call the axes of a wheel base by
 * the same names. No feature imports another, so each keeps its own table
 * (devices/core/wheelAxes.ts, racing/core/wheelbases/brands.ts) and this test holds them
 * together: a name or a base added on one side fails here until the other side follows.
 */
import { describe, expect, it } from 'vitest';
import { axisLabel } from '../../src/features/devices/core/input';
import { wheelAxes } from '../../src/features/devices/core/wheelAxes';
import { axisName, neutralAxisName } from '../../src/features/racing/core/devices';
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
