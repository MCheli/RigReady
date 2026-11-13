import { describe, expect, it } from 'vitest';
import { NEUTRAL_PAD_REPORT } from '../../../shared/models';
import { padView, shortLabel } from './padView';
import { BUTTON_BITS } from './profile';

describe('the live picture of the virtual controller', () => {
  it('no report yet reads as a controller at rest', () => {
    for (const view of [padView(undefined, 'xbox360'), padView(NEUTRAL_PAD_REPORT, 'xbox360')]) {
      expect(view).toEqual({
        left: { x: 0, y: 0 },
        right: { x: 0, y: 0 },
        lt: 0,
        rt: 0,
        pressed: [],
        valueLines: ['LT 0% · RT 0%', 'Left stick: centred', 'Right stick: centred'],
        valuesText: 'LT 0% · RT 0% · Left stick: centred · Right stick: centred',
        pressedText: 'Nothing pressed',
      });
    }
  });

  it('says where the sticks stand, how far the triggers are pressed and what is down', () => {
    const view = padView(
      {
        lx: 0.4,
        ly: -1,
        rx: -0.26,
        ry: 0,
        lt: 1,
        rt: 0.62,
        buttons: BUTTON_BITS.a | BUTTON_BITS.rb | BUTTON_BITS.up | BUTTON_BITS.ls,
      },
      'xbox360'
    );
    expect(view.left).toEqual({ x: 0.4, y: -1 });
    expect(view.right).toEqual({ x: -0.26, y: 0 });
    expect(view.lt).toBe(1);
    expect(view.rt).toBe(0.62);
    expect(view.pressed).toEqual(['a', 'rb', 'ls', 'up']);
    expect(view.valuesText).toBe(
      'LT 100% · RT 62% · Left stick: 40% right, 100% down · Right stick: 26% left'
    );
    expect(view.pressedText).toBe('Pressed: A, RB, L3, D-pad up');
  });

  it('a stick a hair off the middle still reads as centred', () => {
    const view = padView({ ...NEUTRAL_PAD_REPORT, lx: 0.004, ry: 0.5 }, 'xbox360');
    expect(view.valuesText).toBe('LT 0% · RT 0% · Left stick: centred · Right stick: 50% up');
  });

  it('uses the names of a DualShock 4 when the game sees one', () => {
    const view = padView(
      { ...NEUTRAL_PAD_REPORT, lt: 0.5, buttons: BUTTON_BITS.a | BUTTON_BITS.back },
      'ds4'
    );
    expect(view.valuesText).toMatch(/^L2 50% · R2 0% · /);
    expect(view.pressedText).toBe('Pressed: Cross, Share');
    expect(shortLabel('rt', 'ds4')).toBe('R2');
    expect(shortLabel('rt', 'xbox360')).toBe('RT');
    expect(shortLabel('lt', 'xbox360')).toBe('LT');
    // A part the DualShock 4 names no differently keeps its plain name.
    expect(shortLabel('up', 'ds4')).toBe('D-pad up');
    expect(shortLabel('guide', 'xbox360')).toBe('Guide');
  });
});
