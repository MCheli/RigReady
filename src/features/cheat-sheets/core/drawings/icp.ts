import { axis, btn, keyAt, label, part, rockerAt, roundAt, toggleAt, type PathItem } from './parts';
import { circle, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing ICP (the F-16's up-front keypad) from the front. Drawn from scratch, CC0.
 * Which number is which key, and where the key is, is the maker's own test screen for
 * the panel; the sources are written down in docs/research/controller-drawings.md.
 * Every input the panel reports is on the drawing.
 */

const TOP_ROW_X = [90, 158, 226, 294, 362, 430];
const TOP_ROW = ['COM 1', 'COM 2', 'IFF', 'LIST', 'A-A', 'A-G'];
const PAD_X = [104, 172, 240];
const PAD_Y = [322, 390, 457];
const PAD_WORDS = ['T-ILS', 'ALOW', '', 'STPT', 'CRUS', 'TIME', 'MARK', 'FIX', 'A-CAL'];

/** A thumbwheel on a side edge: a ribbed strip. */
const wheel = (x: number, y: number): PathItem[] => [
  { d: roundedRect(x - 15, y - 62, 30, 124, 6), role: 'key' },
  ...[-40, -20, 0, 20, 40].map((dy) => ({
    d: `M ${x - 10} ${y + dy} L ${x + 10} ${y + dy}`,
    role: 'line' as const,
  })),
];

const digit = (n: number): string => `${n}${PAD_WORDS[n - 1] ? ` ${PAD_WORDS[n - 1]}` : ''}`;

export const ICP: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing ICP',
  match: { vendorId: '4098', productIds: ['BF06'] },
  author: 'RigReady',
  license: 'CC0-1.0',
  view: 'From the front',
  notes: 'The four ribbed wheels are on the left and right edges of the panel.',
  size: { width: 520, height: 600 },
  paths: [
    {
      d: 'M 70 4 L 450 4 L 510 22 Q 518 25 518 34 L 518 584 Q 518 596 506 596 L 14 596 Q 2 596 2 584 L 2 34 Q 2 25 10 22 Z',
      role: 'body',
    },
    { d: roundedRect(22, 40, 476, 150, 8), role: 'panel' },
    { d: roundedRect(72, 54, 376, 122, 6), role: 'screen' },
    { d: roundedRect(50, 212, 420, 68, 8), role: 'panel' },
    { d: roundedRect(50, 284, 420, 300, 8), role: 'panel' },
    { d: roundedRect(74, 292, 284, 198, 4), role: 'shade' },
    ...TOP_ROW_X.map((x) => roundAt(x, 246, 23)),
    ...PAD_Y.flatMap((y) => PAD_X.map((x) => keyAt(x, y, 46))),
    keyAt(327, 322, 46),
    keyAt(327, 390, 46),
    keyAt(307, 457, 46),
    ...wheel(25, 313),
    ...wheel(25, 497),
    ...wheel(495, 313),
    ...wheel(495, 497),
    ...rockerAt(104, 539, 34, 66),
    { d: circle(206, 539, 24), role: 'key' },
    { d: roundedRect(196, 529, 20, 20, 3), role: 'screen' },
    ...toggleAt(308, 539),
    roundAt(419, 337, 15),
    ...rockerAt(419, 414, 34, 68),
    ...toggleAt(416, 514),
  ],
  texts: [
    ...TOP_ROW.map((text, i) => label(TOP_ROW_X[i]!, 249, text, 8.5)),
    ...PAD_Y.flatMap((y, row) =>
      PAD_X.flatMap((x, col) => {
        const n = row * 3 + col + 1;
        const word = PAD_WORDS[n - 1];
        return [label(x, y + 14, String(n), 15), ...(word ? [label(x, y - 9, word, 7.5)] : [])];
      })
    ),
    label(327, 325, 'RCL', 9),
    label(327, 393, 'ENTR', 9),
    label(307, 471, '0', 15),
    label(307, 448, 'M-SEL', 7.5),
    label(60, 316, 'SYM', 8),
    label(60, 500, 'BRT', 8),
    label(456, 316, 'RET', 8),
    label(456, 500, 'CONT', 8),
    label(160, 542, 'RTN', 8),
    label(252, 542, 'SEQ', 8),
    label(308, 516, 'DRIFT C/O', 8),
    label(352, 542, 'NORM', 8),
    label(308, 572, 'WARN RESET', 8),
    label(419, 316, 'WX', 8),
    label(384, 417, 'FLIR', 8),
    label(416, 492, 'GAIN', 8),
    label(446, 517, 'LVL', 8),
    label(416, 544, 'AUTO', 8),
  ],
  controls: [
    part('sym-wheel', 'SYM wheel', 25, 313, 'left', [axis('Y')]),
    part(
      'top-row',
      'Top row buttons',
      70,
      246,
      'left',
      TOP_ROW.map((tag, i) => btn(i + 1, tag))
    ),
    part('keypad', 'Number keys', 84, 390, 'left', [
      btn(7, digit(1)),
      btn(8, digit(2)),
      btn(9, digit(3)),
      btn(11, digit(4)),
      btn(12, digit(5)),
      btn(13, digit(6)),
      btn(15, digit(7)),
      btn(16, digit(8)),
      btn(17, digit(9)),
      btn(18, '0 M-SEL'),
    ]),
    part('brt-wheel', 'BRT wheel', 25, 497, 'left', [axis('RY')]),
    part('ret-wheel', 'RET DEPR wheel', 495, 283, 'right', [axis('X')]),
    part('rcl', 'RCL key', 347, 322, 'right', [btn(10)]),
    part('wx', 'WX button', 419, 337, 'right', [btn(29)]),
    part('entr', 'ENTR key', 347, 390, 'right', [btn(14)]),
    part('flir', 'FLIR rocker', 419, 414, 'right', [btn(30, '▲'), btn(31, '▼')]),
    part('cont-wheel', 'CONT wheel', 495, 497, 'right', [axis('RX')]),
    part('gain', 'GAIN switch', 416, 514, 'right', [
      btn(32, 'GAIN'),
      btn(33, 'LVL'),
      btn(34, 'AUTO'),
    ]),
    part('rocker', 'Lower left rocker', 104, 539, 'bottom', [btn(19, '▲'), btn(20, '▼')]),
    part('four-way', 'RTN / SEQ switch', 206, 539, 'bottom', [
      btn(22, '↑'),
      btn(23, 'SEQ →'),
      btn(24, '↓'),
      btn(25, '← RTN'),
      btn(21, 'press'),
    ]),
    part('drift', 'DRIFT C/O switch', 308, 539, 'bottom', [
      btn(26, 'DRIFT C/O'),
      btn(27, 'NORM'),
      btn(28, 'WARN RESET'),
    ]),
  ],
  columnWidth: 230,
};
