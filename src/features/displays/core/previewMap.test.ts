import { describe, expect, it } from 'vitest';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import { analyzeLayout } from './plan';
import { morphOf, previewMaps } from './previewMap';

/** The desk as the rig is recorded: the Dell is the main display, the MFD screens lie flat. */
const dell: DisplayInfo = {
  id: '\\\\?\\display#deld139#5&1&uid4355#{e6f07b5f}',
  name: 'DELL G3223D',
  enabled: true,
  primary: true,
  x: 0,
  y: 0,
  width: 2560,
  height: 1440,
  rotation: 0,
};
const ultrawide: DisplayInfo = {
  id: '\\\\?\\display#sam7053#5&1&uid4357#{e6f07b5f}',
  name: 'LC49G95T',
  enabled: true,
  primary: false,
  x: 2560,
  y: 0,
  width: 5120,
  height: 1440,
  rotation: 0,
};
const mfd = (instance: string, x: number, extra: Partial<DisplayInfo> = {}): DisplayInfo => ({
  id: `\\\\?\\display#reg0319#${instance}&0&uid256#{e6f07b5f}`,
  name: 'USB_Monitor',
  enabled: true,
  primary: false,
  x,
  y: 0,
  width: 1024,
  height: 768,
  rotation: 0,
  ...extra,
});
const desk = [dell, ultrawide, mfd('a&1', 7680), mfd('a&2', 8704)];

/** Flying: the ultrawide is the main display, the MFD screens stand upright beside it, the Dell is off. */
const flying: DisplayTarget[] = [
  { id: ultrawide.id, name: 'LC49G95T', enabled: true, primary: true, x: 0, y: 0, rotation: 0 },
  {
    id: desk[2]!.id,
    name: 'USB_Monitor',
    enabled: true,
    primary: false,
    x: 5120,
    y: 0,
    width: 768,
    height: 1024,
    rotation: 90,
  },
  {
    id: desk[3]!.id,
    name: 'USB_Monitor',
    enabled: true,
    primary: false,
    x: 5888,
    y: 0,
    rotation: 90,
  },
  { id: dell.id, name: 'DELL G3223D', enabled: false, primary: false, x: 0, y: 0, rotation: 0 },
];

const names = { [desk[2]!.id.toLowerCase()]: 'MFD left' };
const maps = (expected: DisplayTarget[], current: DisplayInfo[]) =>
  previewMaps(expected, current, analyzeLayout(expected, current, names), names);

describe('the monitors before and after a layout is applied', () => {
  it('draws "before" as the monitors are now, by the names the owner gave them', () => {
    const { before } = maps(flying, desk);
    expect(before.map((m) => `${m.label} ${m.width}x${m.height} at ${m.x},${m.y}`)).toEqual([
      'DELL G3223D 2560x1440 at 0,0',
      'LC49G95T 5120x1440 at 2560,0',
      'MFD left 1024x768 at 7680,0',
      'USB_Monitor (2 of 2) 1024x768 at 8704,0',
    ]);
    expect(before.filter((m) => m.primary).map((m) => m.label)).toEqual(['DELL G3223D']);
    expect(before.every((m) => m.connected && m.enabled)).toBe(true);
  });

  it('draws "after" as the layout would leave them: moved, turned, switched off, a new main display', () => {
    const { after } = maps(flying, desk);
    expect(after).toEqual([
      expect.objectContaining({ label: 'DELL G3223D', enabled: false, primary: false, width: 0 }),
      expect.objectContaining({
        label: 'LC49G95T',
        enabled: true,
        primary: true,
        x: 0,
        y: 0,
        width: 5120,
        height: 1440,
      }),
      // The size the layout gives.
      expect.objectContaining({
        label: 'MFD left',
        x: 5120,
        width: 768,
        height: 1024,
        rotation: 90,
      }),
      // No size in the layout: the monitor's own, turned.
      expect.objectContaining({ x: 5888, width: 768, height: 1024, rotation: 90 }),
    ]);
  });

  it('keeps the same id for a monitor in both, so a drawing can move it', () => {
    const { before, after } = maps(flying, desk);
    expect(after.map((m) => m.id)).toEqual(before.map((m) => m.id));
  });

  it('leaves a monitor the layout does not mention as it is, except that it gives up being the main display', () => {
    const tv: DisplayInfo = {
      ...dell,
      id: '\\\\?\\display#tv0001#1&1&uid1#{e6f07b5f}',
      name: 'TV',
    };
    const { after } = maps(flying.slice(0, 3), [tv, ultrawide, desk[2]!]);
    expect(after[0]).toMatchObject({
      label: 'TV',
      enabled: true,
      primary: false,
      x: 0,
      y: 0,
      width: 2560,
    });
    // A layout that turns nothing on takes the main display from nobody.
    const off: DisplayTarget[] = [{ ...flying[3]!, id: ultrawide.id, name: 'LC49G95T' }];
    expect(maps(off, [tv, ultrawide]).after[0]).toMatchObject({ label: 'TV', primary: true });
  });

  it('gives a monitor that is off now the size of its largest mode, turned as the layout turns it', () => {
    const asleep = mfd('a&1', 0, {
      enabled: false,
      width: 0,
      height: 0,
      modes: [
        { width: 800, height: 600, refreshHz: 60 },
        { width: 1024, height: 768, refreshHz: 60 },
      ],
    });
    const { before, after } = maps(flying, [dell, ultrawide, asleep, desk[3]!]);
    expect(before[2]).toMatchObject({ enabled: false, width: 0, height: 0 });
    expect(after[2]).toMatchObject({ enabled: true, width: 768, height: 1024, rotation: 90 });
    // Nothing known about it at all: a full HD screen stands in, turned too.
    const blank = mfd('a&2', 0, { enabled: false, width: 0, height: 0 });
    expect(maps(flying, [dell, ultrawide, desk[2]!, blank]).after[3]).toMatchObject({
      width: 1080,
      height: 1920,
    });
    const flat = flying.map((t) => (t.id === blank.id ? { ...t, rotation: 0 as const } : t));
    expect(maps(flat, [dell, ultrawide, desk[2]!, blank]).after[3]).toMatchObject({
      width: 1920,
      height: 1080,
    });
  });

  it('shows a monitor the layout wants that is not connected only in "after", where it would be', () => {
    // Racing: the TV above the ultrawide, which is the main display and at 640 in the layout.
    const racing: DisplayTarget[] = [
      {
        id: ultrawide.id,
        name: 'LC49G95T',
        enabled: true,
        primary: true,
        x: 640,
        y: 2160,
        rotation: 0,
      },
      {
        id: '\\\\?\\display#tv0001#1&1&uid1#{e6f07b5f}',
        name: 'TV',
        enabled: true,
        primary: false,
        x: 1280,
        y: 0,
        width: 3840,
        height: 2160,
        rotation: 0,
      },
      {
        id: '\\\\?\\display#tv0002#1&1&uid2#{e6f07b5f}',
        name: 'Side screen',
        enabled: true,
        primary: false,
        x: -440,
        y: 2160,
        rotation: 90,
      },
      { id: dell.id, name: 'DELL G3223D', enabled: false, primary: false, x: 0, y: 0, rotation: 0 },
    ];
    const { before, after } = maps(racing, [dell, ultrawide]);
    expect(before.map((m) => m.label)).toEqual(['DELL G3223D', 'LC49G95T']);
    expect(after.map((m) => `${m.label} ${m.connected ? 'connected' : 'absent'}`)).toEqual([
      'DELL G3223D connected',
      'LC49G95T connected',
      'TV absent',
      'Side screen absent',
    ]);
    // The ultrawide goes to 0,0, so everything in the layout shifts by 640, 2160.
    expect(after[1]).toMatchObject({ x: 0, y: 0, primary: true });
    expect(after[2]).toMatchObject({ x: 640, y: -2160, width: 3840, height: 2160, primary: false });
    // No size in the layout and nothing connected to ask: a full HD screen on its side.
    expect(after[3]).toMatchObject({ x: -1080, y: 0, width: 1080, height: 1920 });
  });
});

describe('one drawing for both', () => {
  it('uses one frame for both states, so nothing jumps when the picture changes', () => {
    const morph = morphOf(maps(flying, desk));
    // Before spans 0..9728, after 0..6656: the frame is the wider one, as high as the tallest.
    expect(morph.ratio).toBeCloseTo(1440 / 9728, 5);
    const wide = morph.boxes.find((b) => b.label === 'LC49G95T')!;
    expect(wide.before!.left).toBeCloseTo((2560 / 9728) * 100, 5);
    expect(wide.after!.left).toBe(0);
    expect(wide.before!.width).toBeCloseTo(wide.after!.width, 5);
    expect(wide.after!.height).toBe(100);
  });

  it('says what happens to each monitor', () => {
    const morph = morphOf(maps(flying, desk));
    expect(morph.boxes.map((b) => `${b.label}: ${b.changes.join(', ')}`)).toEqual([
      'DELL G3223D: turns off',
      'LC49G95T: moves, becomes the main display',
      'MFD left: turns, moves',
      'USB_Monitor (2 of 2): turns, moves',
    ]);
    expect(morph.boxes[0]).toMatchObject({ primaryBefore: true, primaryAfter: false });
    expect(morph.boxes[0]!.after).toBeUndefined();
    expect(morph.boxes[2]).toMatchObject({
      rotationBefore: 0,
      rotationAfter: 90,
      sizeBefore: '1024x768',
      sizeAfter: '768x1024',
    });
    expect(morph.offBefore).toEqual([]);
    expect(morph.offAfter).toEqual(['DELL G3223D']);
  });

  it('draws a monitor that comes on, one that only changes size, and one that is not connected', () => {
    const asleep = { ...dell, enabled: false, primary: false, width: 0, height: 0 };
    const wake: DisplayTarget[] = [
      { id: dell.id, name: 'DELL G3223D', enabled: true, primary: true, x: 0, y: 0, rotation: 0 },
      {
        id: ultrawide.id,
        name: 'LC49G95T',
        enabled: true,
        primary: false,
        x: 1920,
        y: 0,
        width: 3840,
        height: 1080,
        rotation: 0,
      },
      {
        id: '\\\\?\\display#tv0001#1&1&uid1#{e6f07b5f}',
        name: 'TV',
        enabled: true,
        primary: false,
        x: 0,
        y: -2160,
        width: 3840,
        height: 2160,
        rotation: 0,
      },
    ];
    const current = [asleep, { ...ultrawide, x: 1920, primary: true }];
    const morph = morphOf(maps(wake, current));
    expect(morph.boxes.map((b) => `${b.label}: ${b.changes.join(', ')}`)).toEqual([
      'DELL G3223D: turns on',
      'LC49G95T: changes size',
      'TV: not connected',
    ]);
    expect(morph.boxes[0]!.before).toBeUndefined();
    expect(morph.boxes[0]!.sizeBefore).toBe('');
    expect(morph.boxes[2]).toMatchObject({ connected: false, sizeAfter: '3840x2160' });
    expect(morph.boxes[2]!.before).toBeUndefined();
    expect(morph.offBefore).toEqual(['DELL G3223D']);
    expect(morph.offAfter).toEqual([]);
  });

  it('has nothing to draw when no monitor is on in either state', () => {
    expect(morphOf({ before: [], after: [] })).toEqual({
      ratio: 0.3,
      boxes: [],
      offBefore: [],
      offAfter: [],
    });
  });
});
