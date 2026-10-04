import { describe, expect, it } from 'vitest';
import { drawDesk } from './rigDrawing';

const monitor = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  enabled = true
) => ({
  id,
  x,
  y,
  width,
  height,
  enabled,
});

describe('the monitors drawn to scale', () => {
  // The flying rig: an ultrawide and three screens standing on end to its right.
  const flying = [
    monitor('wide', 0, 0, 5120, 1440),
    monitor('mfd1', 5120, 0, 768, 1024),
    monitor('mfd2', 5888, 0, 768, 1024),
    monitor('mfd3', 6656, 0, 768, 1024),
    monitor('desk', 0, 0, 0, 0, false),
  ];

  it('fits the whole desktop in the box, every monitor at its place and in proportion', () => {
    const drawing = drawDesk(flying, 300, 86)!;
    expect(drawing.width).toBe(300);
    expect(drawing.height).toBeLessThanOrEqual(86);
    // One scale for both directions: nothing is stretched.
    expect(drawing.scale).toBeCloseTo(300 / 7424, 6);
    const [wide, mfd1, , mfd3] = drawing.boxes;
    expect(wide).toMatchObject({ left: 0, top: 0 });
    expect(wide!.width / wide!.height).toBeCloseTo(5120 / 1440, 1);
    expect(mfd1!.height).toBeGreaterThan(mfd1!.width);
    expect(mfd1!.left).toBeCloseTo(wide!.width, 0);
    expect(mfd3!.left + mfd3!.width).toBeCloseTo(300, 0);
  });

  it('leaves out monitors that are off', () => {
    const drawing = drawDesk(flying, 300, 86)!;
    expect(drawing.boxes.map((b) => b.monitor.id)).toEqual(['wide', 'mfd1', 'mfd2', 'mfd3']);
  });

  it('a tall arrangement is limited by the height', () => {
    const stacked = [monitor('top', 0, -2160, 3840, 2160), monitor('bottom', 0, 0, 3840, 1600)];
    const drawing = drawDesk(stacked, 300, 86)!;
    expect(drawing.height).toBe(86);
    expect(drawing.width).toBeLessThan(300);
    // A monitor above the main one has a negative position: it is drawn at the top.
    expect(drawing.boxes[0]).toMatchObject({ top: 0, left: 0 });
    expect(drawing.boxes[1]!.top).toBeCloseTo(drawing.boxes[0]!.height, 0);
  });

  it('one monitor fills the box as far as its shape allows', () => {
    const drawing = drawDesk([monitor('only', 0, 0, 1920, 1080)], 300, 86)!;
    expect(drawing.height).toBe(86);
    expect(drawing.width).toBeCloseTo(86 * (1920 / 1080), 0);
  });

  it('with no monitor on there is nothing to draw', () => {
    expect(drawDesk([monitor('off', 0, 0, 0, 0, false)], 300, 86)).toBeUndefined();
    expect(drawDesk([], 300, 86)).toBeUndefined();
  });
});
