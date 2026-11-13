import { axis, btn, keyAt, knobAt, label, part, rockerAt } from './parts';
import { roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing MFD1 button frame from the front: five keys on each side of the screen,
 * the knob at the top, a rocker across each cut top corner (DAY / NGT on the left, SYM
 * on the right), an upright rocker in each bottom corner (GAIN on the left, CONT on the
 * right) and a small three-position switch on the right side edge. Drawn from scratch,
 * CC0.
 *
 * The keys are numbered as the frame reports them: the maker's own test screen for the
 * frame, and the default profiles the game ships for it. The frame reports 50 buttons;
 * the 16 numbers between the keys belong to no key of this frame. Sources are in
 * docs/research/controller-drawings.md.
 */

const OSB_TOP = [42, 40, 38, 36, 34];
const OSB_RIGHT = [31, 29, 27, 25, 23];
const OSB_BOTTOM = [12, 14, 16, 18, 20];
const OSB_LEFT = [1, 3, 5, 7, 9];
const ACROSS = [148, 214, 280, 346, 412];
const DOWN = [226, 292, 358, 424, 490];

export const MFD_FRAME: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing MFD1 button frame',
  match: { vendorId: '4098', productIds: ['BEE0', 'BEE1', 'BEE2'] },
  author: 'RigReady',
  license: 'CC0-1.0',
  view: 'From the front',
  notes: 'The dashed switch is on the right side edge of the frame.',
  size: { width: 560, height: 620 },
  paths: [
    // The frame, its two top corners cut off.
    {
      d: 'M 144 4 L 416 4 L 556 144 L 556 606 Q 556 616 546 616 L 14 616 Q 4 616 4 606 L 4 144 Z',
      role: 'body',
    },
    { d: roundedRect(60, 140, 440, 422, 10), role: 'panel' },
    { d: roundedRect(84, 164, 392, 374, 8), role: 'screen' },
    ...ACROSS.flatMap((at) => [keyAt(at, 112, 36, 32), keyAt(at, 588, 36, 32)]),
    ...DOWN.flatMap((at) => [keyAt(32, at, 32, 36), keyAt(528, at, 32, 36)]),
    ...knobAt(280, 36, 17),
    // The rockers across the cut corners, with the line between their halves.
    { d: 'M 124 77 L 108 61 L 74 95 L 90 111 Z', role: 'key' },
    { d: 'M 93 80 L 105 92', role: 'line' },
    { d: 'M 436 77 L 452 61 L 486 95 L 470 111 Z', role: 'key' },
    { d: 'M 467 80 L 455 92', role: 'line' },
    // The upright rockers in the bottom corners.
    ...rockerAt(32, 568, 26, 52),
    ...rockerAt(528, 568, 26, 52),
    // The switch on the right side edge.
    { d: roundedRect(542, 168, 12, 40, 5), role: 'key', dashed: true },
  ],
  texts: [
    label(146, 62, 'DAY', 9),
    label(50, 124, 'NGT', 9),
    label(414, 62, 'SYM', 9),
    label(246, 76, 'OFF', 8),
    label(314, 76, 'BRT', 8),
    label(84, 592, 'GAIN', 9),
    label(476, 592, 'CONT', 9),
  ],
  controls: [
    ...ACROSS.map((at, i) =>
      part(`osb-${i + 1}`, `OSB ${i + 1}`, at, 112, 'top', [btn(OSB_TOP[i]!)])
    ),
    ...DOWN.map((at, i) =>
      part(`osb-${6 + i}`, `OSB ${6 + i}`, 528, at, 'right', [btn(OSB_RIGHT[i]!)])
    ),
    ...ACROSS.map((at, i) =>
      part(`osb-${15 - i}`, `OSB ${15 - i}`, at, 588, 'bottom', [btn(OSB_BOTTOM[i]!)])
    ),
    ...DOWN.map((at, i) =>
      part(`osb-${20 - i}`, `OSB ${20 - i}`, 32, at, 'left', [btn(OSB_LEFT[i]!)])
    ),
    part('knob', 'Knob', 280, 36, 'top', [
      axis('SLIDER1', 'turn'),
      btn(49, '◄'),
      btn(50, '►'),
      btn(48, 'press'),
    ]),
    part('day-night', 'DAY / NGT rocker', 86, 99, 'left', [btn(43, 'DAY'), btn(44, 'NGT')]),
    part('sym', 'SYM rocker', 474, 99, 'right', [btn(33, '▲'), btn(32, '▼')]),
    part('side-switch', 'Side switch', 548, 188, 'right', [
      btn(47, 'up'),
      btn(46, 'middle'),
      btn(45, 'down'),
    ]),
    part('gain', 'GAIN rocker', 32, 568, 'left', [btn(10, '▲'), btn(11, '▼')]),
    part('cont', 'CONT rocker', 528, 568, 'right', [btn(22, '▲'), btn(21, '▼')]),
  ],
  columnWidth: 210,
};
