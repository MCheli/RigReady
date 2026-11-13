import { describe, expect, it } from 'vitest';
import type { DisplayTarget } from '../../../shared/models';
import {
  anchored,
  keepOnly,
  overlaps,
  quarterTurned,
  removed,
  resized,
  turnedBy,
  turnForArrow,
  turnInLayout,
  type Box,
} from './arrange';

const box = (id: string, x: number, y: number, width: number, height: number): Box => ({
  id,
  x,
  y,
  width,
  height,
});
const at = (boxes: Box[]): Record<string, string> =>
  Object.fromEntries(boxes.map((b) => [b.id, `${b.width}x${b.height} at ${b.x},${b.y}`]));

/** The owner's rig in the editor: the ultrawide, then three 1024x768 screens in a row. */
const rig = (): Box[] => [
  box('wide', 0, 0, 5120, 1440),
  box('left', 5120, 0, 1024, 768),
  box('centre', 6144, 0, 1024, 768),
  box('right', 7168, 0, 1024, 768),
];

describe('turning a monitor a quarter in an arrangement', () => {
  it('closes the gaps: three 1024-wide screens turned to portrait end at 5120, 5888 and 6656', () => {
    // What the sitting found: turned by hand they stayed at 5120, 6144 and 7168, 256 px apart.
    const first = quarterTurned(rig(), 'left');
    expect(first.fitted).toBe(true);
    expect(first.moved).toEqual(['centre', 'right']);
    expect(at(first.boxes)).toEqual({
      wide: '5120x1440 at 0,0',
      left: '768x1024 at 5120,0',
      centre: '1024x768 at 5888,0',
      right: '1024x768 at 6912,0',
    });
    const second = quarterTurned(first.boxes, 'centre');
    expect(second.moved).toEqual(['right']);
    const third = quarterTurned(second.boxes, 'right');
    expect(third.moved).toEqual([]);
    expect(at(third.boxes)).toEqual({
      wide: '5120x1440 at 0,0',
      left: '768x1024 at 5120,0',
      centre: '768x1024 at 5888,0',
      right: '768x1024 at 6656,0',
    });
    expect(overlaps(third.boxes)).toEqual([]);
    // And back: turned to landscape again they make room for each other.
    const back = quarterTurned(third.boxes, 'left');
    expect(back.moved).toEqual(['centre', 'right']);
    expect(at(back.boxes)).toMatchObject({
      left: '1024x768 at 5120,0',
      centre: '768x1024 at 6144,0',
      right: '768x1024 at 6912,0',
    });
  });

  it('moves what is below by the change in height, and what is beyond that with it', () => {
    const boxes = [
      box('top', 0, 0, 1024, 768),
      box('below', 0, 768, 1024, 768),
      box('lowest', 0, 1536, 1024, 768),
      box('beside', 1024, 0, 500, 500),
    ];
    expect(at(resized(boxes, 'top', 768, 1024))).toEqual({
      top: '768x1024 at 0,0',
      below: '1024x768 at 0,1024',
      lowest: '1024x768 at 0,1792',
      beside: '500x500 at 768,0',
    });
  });

  it('leaves alone a monitor that is neither beside nor below the turned one', () => {
    const boxes = [
      box('main', 0, 0, 2560, 1440),
      box('above', 0, -768, 1024, 768),
      box('mfd', 2560, 0, 1024, 768),
    ];
    const turned = quarterTurned(boxes, 'mfd');
    expect(turned.moved).toEqual([]);
    expect(at(turned.boxes)).toMatchObject({
      main: '2560x1440 at 0,0',
      above: '1024x768 at 0,-768',
      mfd: '768x1024 at 2560,0',
    });
  });

  it('says so, and moves nothing else, when the others cannot be moved without covering each other', () => {
    // Four screens in a square: turning one corner pushes its two neighbours into each other.
    const square = [
      box('a', 0, 0, 1024, 768),
      box('b', 1024, 0, 1024, 768),
      box('c', 0, 768, 1024, 768),
      box('d', 1024, 768, 1024, 768),
    ];
    expect(overlaps(resized(square, 'a', 768, 1024)).length).toBeGreaterThan(0);
    const turned = quarterTurned(square, 'a');
    expect(turned.fitted).toBe(false);
    expect(turned.moved).toEqual([]);
    expect(at(turned.boxes)).toEqual({
      a: '768x1024 at 0,0',
      b: '1024x768 at 1024,0',
      c: '1024x768 at 0,768',
      d: '1024x768 at 1024,768',
    });
  });

  it('does nothing for a monitor that is not in the arrangement', () => {
    const boxes = rig();
    expect(quarterTurned(boxes, 'nope')).toEqual({ boxes, moved: [], fitted: true });
    expect(resized(boxes, 'nope', 1, 1)).toBe(boxes);
  });
});

describe('a monitor that goes away', () => {
  it('lets what was to its right close up by its width', () => {
    expect(at(removed(rig(), 'left'))).toEqual({
      wide: '5120x1440 at 0,0',
      centre: '1024x768 at 5120,0',
      right: '1024x768 at 6144,0',
    });
  });

  it('lets what was below close up when nothing was to its right', () => {
    const boxes = [box('top', 0, 0, 1024, 768), box('below', 0, 768, 1024, 768)];
    expect(at(removed(boxes, 'top'))).toEqual({ below: '1024x768 at 0,0' });
  });

  it('puts the main display at 0,0 and everything else with it', () => {
    const boxes = [box('dell', 0, 0, 2560, 1440), box('wide', 2560, 0, 5120, 1440)];
    expect(at(anchored(boxes, 'wide'))).toEqual({
      dell: '2560x1440 at -2560,0',
      wide: '5120x1440 at 0,0',
    });
    expect(anchored(boxes, 'dell')).toBe(boxes);
    expect(anchored(boxes, undefined)).toBe(boxes);
  });
});

describe('which way is up', () => {
  it('turns the picture by where the arrow is seen to point', () => {
    // docs/research/owner-rig.md: an arrow seen pointing right needs 90° more.
    expect(turnForArrow('right')).toBe(90);
    expect(turnForArrow('down')).toBe(180);
    expect(turnForArrow('left')).toBe(270);
    expect(turnedBy(0, 90)).toBe(90);
    expect(turnedBy(0, 270)).toBe(270);
    expect(turnedBy(90, 180)).toBe(270);
    expect(turnedBy(270, 180)).toBe(90);
    expect(turnedBy(270, 90)).toBe(0);
    expect(turnedBy(180, 270)).toBe(90);
  });
});

const target = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<DisplayTarget> = {}
): DisplayTarget => ({
  id,
  name: id,
  enabled: true,
  primary: false,
  x,
  y,
  width,
  height,
  rotation: 0,
  ...extra,
});
const off = (id: string, extra: Partial<DisplayTarget> = {}): DisplayTarget => ({
  id,
  name: id,
  enabled: false,
  primary: false,
  x: 0,
  y: 0,
  rotation: 0,
  ...extra,
});
const places = (displays: DisplayTarget[]): Record<string, string> =>
  Object.fromEntries(
    displays.map((d) => [
      d.id,
      d.enabled
        ? `${d.width}x${d.height} at ${d.x},${d.y} turned ${d.rotation}${d.primary ? ' main' : ''}`
        : 'off',
    ])
  );

describe('turning a monitor in a layout', () => {
  const layout = (): DisplayTarget[] => [
    target('wide', 0, 0, 5120, 1440, { primary: true }),
    target('left', 5120, 0, 1024, 768),
    target('centre', 6144, 0, 1024, 768),
    off('dell'),
  ];

  it('swaps width and height on a quarter turn and moves the monitors beside it', () => {
    const turned = turnInLayout(layout(), 'LEFT', 90);
    expect(turned.fitted).toBe(true);
    expect(places(turned.displays)).toEqual({
      wide: '5120x1440 at 0,0 turned 0 main',
      left: '768x1024 at 5120,0 turned 90',
      centre: '1024x768 at 5888,0 turned 0',
      dell: 'off',
    });
  });

  it('only changes the rotation on half a turn', () => {
    const portrait = turnInLayout(layout(), 'left', 90).displays;
    const flipped = turnInLayout(portrait, 'left', 270);
    expect(flipped.fitted).toBe(true);
    expect(places(flipped.displays)).toMatchObject({
      left: '768x1024 at 5120,0 turned 270',
      centre: '1024x768 at 5888,0 turned 0',
    });
  });

  it('keeps the main display at 0,0 when the turned monitor is to its left', () => {
    const displays = [
      target('mfd', -1024, 0, 1024, 768),
      target('wide', 0, 0, 5120, 1440, { primary: true }),
    ];
    expect(places(turnInLayout(displays, 'mfd', 270).displays)).toEqual({
      mfd: '768x1024 at -768,0 turned 270',
      wide: '5120x1440 at 0,0 turned 0 main',
    });
  });

  it('uses the size of the connected monitor when the layout holds none', () => {
    const displays = [
      target('wide', 0, 0, 5120, 1440, { primary: true }),
      {
        id: 'left',
        name: 'left',
        enabled: true,
        primary: false,
        x: 5120,
        y: 0,
        rotation: 0 as const,
      },
      target('centre', 6144, 0, 1024, 768),
    ];
    // Without the size there is no telling what touches what: only the rotation changes.
    const blind = turnInLayout(displays, 'left', 90);
    expect(blind.fitted).toBe(false);
    expect(blind.displays.find((d) => d.id === 'left')).toMatchObject({ rotation: 90, x: 5120 });
    expect(blind.displays.find((d) => d.id === 'centre')).toMatchObject({ x: 6144 });
    const sized = turnInLayout(displays, 'left', 90, (d) =>
      d.id === 'left' ? { width: 1024, height: 768 } : undefined
    );
    expect(sized.fitted).toBe(true);
    expect(sized.displays.find((d) => d.id === 'centre')).toMatchObject({ x: 5888 });
  });

  it('says when the others could not be moved, and leaves their places as they were', () => {
    const square = [
      target('a', 0, 0, 1024, 768, { primary: true }),
      target('b', 1024, 0, 1024, 768),
      target('c', 0, 768, 1024, 768),
      target('d', 1024, 768, 1024, 768),
    ];
    const turned = turnInLayout(square, 'a', 90);
    expect(turned.fitted).toBe(false);
    expect(places(turned.displays)).toEqual({
      a: '768x1024 at 0,0 turned 90 main',
      b: '1024x768 at 1024,0 turned 0',
      c: '1024x768 at 0,768 turned 0',
      d: '1024x768 at 1024,768 turned 0',
    });
  });

  it('leaves a layout alone when the monitor is off in it or not part of it', () => {
    const displays = layout();
    expect(turnInLayout(displays, 'dell', 90)).toEqual({ displays, fitted: true });
    expect(turnInLayout(displays, 'nope', 90)).toEqual({ displays, fitted: true });
  });
});

describe('a new layout from the monitors that stay on', () => {
  /** The desk as recorded: Dell (main), ultrawide, three small screens, one more that is off. */
  const desk = (): DisplayTarget[] => [
    target('dell', 0, 0, 2560, 1440, { primary: true, serial: '12NFXG3' }),
    target('wide', 2560, 0, 5120, 1440, { refreshHz: 120 }),
    target('left', 7680, 0, 1024, 768, { usbSerial: 'WWIN-1' }),
    target('centre', 8704, 0, 1024, 768, { usbSerial: 'WWIN-2' }),
    off('tv', { serial: 'TV-9' }),
  ];

  it('lists every monitor, the ones not chosen as off, and makes the one nearest the top left the main display', () => {
    const made = keepOnly(desk(), ['WIDE']);
    expect(places(made)).toEqual({
      dell: 'off',
      wide: '5120x1440 at 0,0 turned 0 main',
      left: 'off',
      centre: 'off',
      tv: 'off',
    });
    // What finds a monitor again on another connector stays with it, on or off.
    expect(made.find((d) => d.id === 'dell')).toEqual(off('dell', { serial: '12NFXG3' }));
    expect(made.find((d) => d.id === 'left')).toEqual(off('left', { usbSerial: 'WWIN-1' }));
    expect(made.find((d) => d.id === 'wide')).toMatchObject({ refreshHz: 120 });
  });

  it('closes up where a monitor between the ones that stay went', () => {
    expect(places(keepOnly(desk(), ['dell', 'left', 'centre']))).toEqual({
      dell: '2560x1440 at 0,0 turned 0 main',
      wide: 'off',
      left: '1024x768 at 2560,0 turned 0',
      centre: '1024x768 at 3584,0 turned 0',
      tv: 'off',
    });
    // The main display went: the leftmost that stays takes over, at 0,0.
    expect(places(keepOnly(desk(), ['left', 'centre']))).toEqual({
      dell: 'off',
      wide: 'off',
      left: '1024x768 at 0,0 turned 0 main',
      centre: '1024x768 at 1024,0 turned 0',
      tv: 'off',
    });
  });

  it('is the monitors as they are when every one that is on stays on', () => {
    const current = desk();
    expect(keepOnly(current, ['dell', 'wide', 'left', 'centre'])).toEqual(current);
  });

  it('never switches on a monitor that is off: its size and place are not known', () => {
    expect(places(keepOnly(desk(), ['dell', 'tv']))).toMatchObject({
      dell: '2560x1440 at 0,0 turned 0 main',
      tv: 'off',
    });
  });

  it('leaves the ones that stay where they are when closing up would put one over another', () => {
    // "tall" stands to the right of "gone" and reaches down past it, beside "under".
    // Closing up would slide "tall" into the place of "gone" and over "under".
    const current = [
      target('high', 0, 0, 1000, 500, { primary: true }),
      target('gone', 0, 500, 1000, 500),
      target('tall', 1000, 500, 1000, 1000),
      target('under', 0, 1000, 1000, 500),
    ];
    const closed = removed(
      current.map((d) => box(d.id, d.x, d.y, d.width ?? 0, d.height ?? 0)),
      'gone'
    );
    expect(overlaps(closed).map((pair) => pair.map((b) => b.id))).toEqual([['tall', 'under']]);
    expect(places(keepOnly(current, ['high', 'tall', 'under']))).toEqual({
      high: '1000x500 at 0,0 turned 0 main',
      gone: 'off',
      tall: '1000x1000 at 1000,500 turned 0',
      under: '1000x500 at 0,1000 turned 0',
    });
  });
});
