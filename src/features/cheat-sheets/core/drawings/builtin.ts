import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The drawings RigReady ships, drawn from scratch (no vendor artwork), CC0. Coordinates
 * are in each drawing's own units; the callout planner scales the drawing into the
 * middle of the canvas.
 *
 * Which input number sits on which physical control comes from WinWing's own DCS profiles
 * for the device where there is one (the `.diff.lua` templates DCS ships for the Hornet),
 * else from the shipped layouts (core/builtin/index.ts). A control whose numbers are a
 * guess is marked `assumed` (its label shows "?") until someone checks it on the device.
 * A control whose inputs are not known is drawn and never labelled.
 */

const WINWING = '4098';
const CC0 = 'CC0-1.0';

/** A rounded rectangle as an absolute path. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const right = x + w;
  const bottom = y + h;
  return (
    `M ${x + r} ${y} L ${right - r} ${y} Q ${right} ${y} ${right} ${y + r} ` +
    `L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom} ` +
    `L ${x + r} ${bottom} Q ${x} ${bottom} ${x} ${bottom - r} ` +
    `L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} Z`
  );
}

/** A circle as an absolute path (two arcs). */
function circle(cx: number, cy: number, r: number): string {
  return `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;
}

const hat = (n: number): { id: string; tag: string }[] => [
  { id: `hat:${n}:U`, tag: '↑' },
  { id: `hat:${n}:R`, tag: '→' },
  { id: `hat:${n}:D`, tag: '↓' },
  { id: `hat:${n}:L`, tag: '←' },
  { id: `hat:${n}:UR`, tag: '↗' },
  { id: `hat:${n}:DR`, tag: '↘' },
  { id: `hat:${n}:DL`, tag: '↙' },
  { id: `hat:${n}:UL`, tag: '↖' },
];

const fourWay = (up: number, right: number, down: number, left: number) => [
  { id: `button:${up}`, tag: '↑' },
  { id: `button:${right}`, tag: '→' },
  { id: `button:${down}`, tag: '↓' },
  { id: `button:${left}`, tag: '←' },
];

/** The Orion base and its boot, the same under every grip. */
const ORION_BASE = [
  { d: roundedRect(30, 742, 300, 62, 14), role: 'body' as const },
  {
    d: 'M 142 690 L 218 690 Q 226 690 226 698 L 230 744 L 130 744 L 134 698 Q 134 690 142 690 Z',
    role: 'shade' as const,
  },
];

/**
 * The Orion 2 base with the F-16EX grip, seen from behind as the pilot sees it: the head
 * with its hats on top, the handle, the paddle at the back, the base. The trigger and the
 * pinky lever are on the front, so they show as the bumps they make at the left edge;
 * the front button under the trigger is drawn dashed.
 */
export const F16_GRIP: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing Orion 2 stick with F-16EX grip',
  match: { vendorId: WINWING, productIds: ['BEA8'] },
  author: 'RigReady',
  license: CC0,
  view: 'From behind, as the pilot sees it',
  notes:
    'The places of the hats and buttons are assumed until checked: press one and see which row lights up.',
  size: { width: 360, height: 820 },
  paths: [
    // The base plate and the gimbal boot.
    ...ORION_BASE,
    // The grip: the head, wide and leaning so the thumb reaches its left, a neck, the
    // handle with its palm swell, the flare at the bottom.
    {
      d:
        'M 100 96 C 104 70 126 58 156 54 L 236 42 C 262 38 282 54 282 80 L 276 240 ' +
        'C 274 268 258 286 236 292 L 230 310 L 228 420 C 228 470 236 520 236 560 ' +
        'C 236 610 242 660 246 700 L 114 700 C 118 660 124 610 124 560 C 124 520 132 470 132 420 ' +
        'L 130 310 L 124 292 C 100 286 86 266 86 238 Z',
      role: 'body',
    },
    // Shadow down the right of the handle, for a little volume.
    {
      d: 'M 236 292 L 230 310 L 228 420 C 228 470 236 520 236 560 C 236 610 242 660 246 700 L 226 700 C 222 660 216 610 216 560 C 216 520 210 470 210 420 L 212 306 Z',
      role: 'shade',
    },
    // The rear face of the head, where the hats sit.
    {
      d:
        'M 112 104 C 116 84 134 72 158 68 L 232 58 C 252 54 268 66 268 86 L 262 236 ' +
        'C 260 258 248 272 230 278 L 132 280 C 112 276 100 262 100 242 Z',
      role: 'panel',
    },
    // The trigger (front) and the pinky lever (front), as the bumps they make at the edge.
    { d: 'M 132 318 C 100 322 84 344 86 372 C 88 400 106 412 134 412 Z', role: 'panel' },
    { d: 'M 132 496 C 110 500 100 514 102 534 C 104 552 116 562 134 564 Z', role: 'panel' },
    // The paddle at the back of the handle.
    { d: roundedRect(146, 636, 68, 76, 8), role: 'panel' },
    { d: 'M 158 652 L 202 652 M 158 664 L 202 664 M 158 676 L 202 676', role: 'line' },
  ],
  texts: [{ x: 180, y: 786, text: 'ORION 2', size: 11 }],
  controls: [
    {
      id: 'pickle',
      name: 'Pickle',
      glyph: 'button',
      at: { x: 124, y: 102 },
      side: 'left',
      inputs: [{ id: 'button:20' }],
    },
    {
      id: 'trim',
      name: 'TRIM hat',
      glyph: 'hat',
      at: { x: 210, y: 100 },
      side: 'right',
      inputs: hat(1),
    },
    {
      id: 'tms',
      name: 'TMS · 4-way',
      glyph: 'switch',
      at: { x: 122, y: 176 },
      side: 'left',
      inputs: fourWay(37, 38, 39, 40),
      assumed: true,
    },
    // The CMS: a four-way with a press. WinWing's own Hornet profile for this grip puts the
    // sensor control switch here (31 press, 32 to 35 forward, right, aft, left).
    {
      id: 'cms',
      name: 'CMS · 4-way',
      glyph: 'switch',
      at: { x: 250, y: 160 },
      side: 'right',
      inputs: [...fourWay(32, 33, 34, 35), { id: 'button:31', tag: 'press' }],
      assumed: true,
    },
    {
      id: 'ministick',
      name: 'Mini-stick',
      glyph: 'stick',
      at: { x: 236, y: 234 },
      side: 'right',
      inputs: [
        { id: 'axis:RX', tag: '↔' },
        { id: 'axis:RY', tag: '↕' },
        { id: 'button:26', tag: 'press' },
      ],
      assumed: true,
    },
    {
      id: 'dms',
      name: 'DMS · 4-way',
      glyph: 'switch',
      at: { x: 168, y: 250 },
      side: 'left',
      inputs: fourWay(13, 10, 11, 12),
      assumed: true,
    },
    {
      id: 'trigger',
      name: 'Trigger',
      glyph: 'none',
      at: { x: 96, y: 366 },
      side: 'left',
      inputs: [
        { id: 'button:4', tag: '1st' },
        { id: 'button:5', tag: '2nd' },
      ],
      assumed: true,
    },
    {
      id: 'nws',
      name: 'Front button',
      glyph: 'button',
      at: { x: 172, y: 446 },
      side: 'left',
      hidden: true,
      inputs: [{ id: 'button:6' }],
      assumed: true,
    },
    {
      id: 'pinky',
      name: 'Pinky lever',
      glyph: 'none',
      at: { x: 108, y: 530 },
      side: 'left',
      inputs: [{ id: 'axis:SLIDER1' }],
      assumed: true,
    },
    {
      id: 'twist',
      name: 'Twist',
      glyph: 'axis',
      at: { x: 180, y: 600 },
      side: 'left',
      inputs: [{ id: 'axis:RZ' }],
    },
    {
      id: 'paddle',
      name: 'Paddle',
      glyph: 'none',
      at: { x: 180, y: 674 },
      side: 'right',
      inputs: [{ id: 'button:8' }],
      assumed: true,
    },
    {
      id: 'base',
      name: 'Stick',
      glyph: 'axes',
      at: { x: 180, y: 766 },
      side: 'right',
      inputs: [
        { id: 'axis:X', tag: '↔' },
        { id: 'axis:Y', tag: '↕' },
      ],
    },
  ],
  columnWidth: 300,
};

/**
 * The Orion throttle base with the F-15EX handles, seen from above with the pilot at the
 * bottom: the two handles on their slot, the finger lifts under them (the IDLE and OFF
 * detents), the switch panel on the base in front of the pilot.
 */
export const ORION_THROTTLE: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing Orion throttle with F-15EX handles',
  match: { vendorId: WINWING, productIds: ['BD26'] },
  author: 'RigReady',
  license: CC0,
  view: 'From above, the pilot at the bottom',
  notes:
    'The places of the handle switches and the base switches are assumed until checked: press one and see which row lights up.',
  size: { width: 440, height: 660 },
  paths: [
    { d: roundedRect(0, 0, 440, 660, 24), role: 'body' },
    // The slot the handles travel in.
    { d: roundedRect(118, 40, 204, 426, 14), role: 'screen' },
    // Left handle: the wide thumb rest at the top, the grip below it, a shadow on its inner side.
    {
      d: 'M 136 100 C 136 72 154 60 178 60 L 190 60 C 212 60 222 78 218 104 L 214 180 L 212 400 C 212 416 202 424 188 424 L 164 424 C 150 424 142 416 144 400 L 146 180 Z',
      role: 'panel',
    },
    {
      d: 'M 218 104 L 214 180 L 212 400 C 212 416 202 424 188 424 L 202 424 C 212 420 218 410 218 400 L 220 180 Z',
      role: 'shade',
    },
    // Right handle, its mirror image.
    {
      d: 'M 304 100 C 304 72 286 60 262 60 L 250 60 C 228 60 218 78 222 104 L 226 180 L 228 400 C 228 416 238 424 252 424 L 276 424 C 290 424 298 416 296 400 L 294 180 Z',
      role: 'panel',
    },
    {
      d: 'M 222 104 L 226 180 L 228 400 C 228 416 238 424 252 424 L 238 424 C 228 420 222 410 222 400 L 220 180 Z',
      role: 'shade',
    },
    // The finger lifts under each handle.
    { d: roundedRect(150, 430, 58, 28, 6), role: 'shade' },
    { d: roundedRect(232, 430, 58, 28, 6), role: 'shade' },
    // The switch panel on the base.
    { d: roundedRect(28, 490, 384, 152, 12), role: 'panel' },
    { d: circle(70, 540, 22), role: 'key' },
    { d: 'M 70 522 L 70 532', role: 'line' },
    { d: circle(134, 540, 22), role: 'key' },
    { d: 'M 134 522 L 134 532', role: 'line' },
    { d: roundedRect(324, 512, 14, 56, 5), role: 'screen' },
    { d: roundedRect(320, 530, 22, 10, 3), role: 'key' },
    // Six toggle switches along the front edge.
    ...[60, 110, 160, 210, 260, 310].map((x) => ({
      d: circle(x + 10, 606, 9),
      role: 'key' as const,
    })),
    ...[60, 110, 160, 210, 260, 310].map((x) => ({
      d: `M ${x + 10} 606 L ${x + 10} 592`,
      role: 'line' as const,
    })),
  ],
  texts: [
    { x: 178, y: 396, text: 'L', size: 18 },
    { x: 262, y: 396, text: 'R', size: 18 },
  ],
  controls: [
    {
      id: 'left-throttle',
      name: 'Left throttle',
      glyph: 'slide',
      at: { x: 179, y: 262 },
      side: 'left',
      inputs: [{ id: 'axis:RY' }],
    },
    {
      id: 'left-lift',
      name: 'Left finger lift',
      glyph: 'none',
      at: { x: 179, y: 444 },
      side: 'left',
      inputs: [
        { id: 'button:31', tag: 'IDLE' },
        { id: 'button:2', tag: 'OFF' },
      ],
    },
    {
      id: 'comm',
      name: 'COMM · 4-way',
      glyph: 'switch',
      at: { x: 178, y: 96 },
      side: 'left',
      inputs: fourWay(6, 7, 8, 9),
      assumed: true,
    },
    {
      id: 'speedbrake',
      name: 'Speed brake · 3-way',
      glyph: 'switch',
      at: { x: 154, y: 170 },
      side: 'left',
      inputs: [
        { id: 'button:3', tag: '▲' },
        { id: 'button:4', tag: '●' },
        { id: 'button:5', tag: '▼' },
      ],
      assumed: true,
    },
    {
      id: 'atc',
      name: 'ATC',
      glyph: 'button',
      at: { x: 158, y: 330 },
      side: 'left',
      inputs: [{ id: 'button:50' }],
      assumed: true,
    },
    {
      id: 'right-throttle',
      name: 'Right throttle',
      glyph: 'slide',
      at: { x: 261, y: 290 },
      side: 'right',
      inputs: [{ id: 'axis:RX' }],
    },
    {
      id: 'right-lift',
      name: 'Right finger lift',
      glyph: 'none',
      at: { x: 261, y: 444 },
      side: 'right',
      inputs: [
        { id: 'button:30', tag: 'IDLE' },
        { id: 'button:1', tag: 'OFF' },
      ],
    },
    {
      id: 'tdc',
      name: 'TDC mini-stick',
      glyph: 'stick',
      at: { x: 262, y: 96 },
      side: 'right',
      inputs: [
        { id: 'axis:X', tag: '↔' },
        { id: 'axis:Y', tag: '↕' },
        { id: 'button:35', tag: 'press' },
      ],
      assumed: true,
    },
    {
      id: 'dispense',
      name: 'Dispense · 3-way',
      glyph: 'switch',
      at: { x: 288, y: 170 },
      side: 'right',
      inputs: [
        { id: 'button:22', tag: '▲' },
        { id: 'button:23', tag: '●' },
        { id: 'button:24', tag: '▼' },
      ],
      assumed: true,
    },
    {
      id: 'antenna',
      name: 'Antenna elevation',
      glyph: 'rocker',
      at: { x: 288, y: 236 },
      side: 'right',
      inputs: [
        { id: 'button:25', tag: '▲' },
        { id: 'button:27', tag: '▼' },
        { id: 'button:28', tag: '▲' },
        { id: 'button:32', tag: '▼' },
      ],
      assumed: true,
    },
    {
      id: 'cage',
      name: 'Cage / uncage',
      glyph: 'button',
      at: { x: 246, y: 336 },
      side: 'right',
      inputs: [{ id: 'button:16' }],
      assumed: true,
    },
    {
      id: 'raid',
      name: 'RAID / FOV',
      glyph: 'button',
      at: { x: 282, y: 370 },
      side: 'right',
      inputs: [{ id: 'button:53' }, { id: 'button:56' }],
      assumed: true,
    },
    {
      id: 'knobs',
      name: 'Base knobs',
      glyph: 'none',
      at: { x: 102, y: 540 },
      side: 'left',
      inputs: [
        { id: 'axis:Z', tag: 'left' },
        { id: 'axis:RZ', tag: 'right' },
      ],
      assumed: true,
    },
    {
      id: 'slider',
      name: 'Base slider',
      glyph: 'none',
      at: { x: 331, y: 540 },
      side: 'right',
      inputs: [{ id: 'axis:SLIDER1' }],
      assumed: true,
    },
    {
      id: 'switches',
      name: 'Base switches',
      glyph: 'none',
      at: { x: 195, y: 606 },
      side: 'bottom',
      inputs: [{ id: 'button:21' }, { id: 'button:40' }, { id: 'button:42' }, { id: 'button:59' }],
      assumed: true,
    },
  ],
  columnWidth: 300,
};

const OSB_TOP = [42, 40, 38, 36, 34];
const OSB_RIGHT = [31, 29, 27, 25, 23];
const OSB_BOTTOM = [12, 14, 16, 18, 20];
const OSB_LEFT = [1, 3, 5, 7, 9];
const KEY_AT = [148, 214, 280, 346, 412];

/**
 * The MFD1 button frame from the front: twenty keys around the screen, a rocker in each
 * corner, the knob below. The keys are numbered as the frame reports them.
 */
export const MFD_FRAME: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing MFD1 button frame',
  match: { vendorId: WINWING, productIds: ['BEE0', 'BEE1', 'BEE2'] },
  author: 'RigReady',
  license: CC0,
  view: 'From the front',
  size: { width: 560, height: 614 },
  paths: [
    { d: roundedRect(0, 0, 560, 560, 40), role: 'body' },
    { d: roundedRect(22, 22, 516, 516, 30), role: 'panel' },
    { d: roundedRect(108, 108, 344, 344, 8), role: 'screen' },
    ...KEY_AT.flatMap((at) => [
      { d: roundedRect(at - 18, 40, 36, 36, 6), role: 'key' as const },
      { d: roundedRect(at - 18, 484, 36, 36, 6), role: 'key' as const },
      { d: roundedRect(40, at - 18, 36, 36, 6), role: 'key' as const },
      { d: roundedRect(484, at - 18, 36, 36, 6), role: 'key' as const },
    ]),
    // The rockers in the corners, with the line between their two halves.
    ...[
      [58, 58],
      [502, 58],
      [58, 502],
      [502, 502],
    ].flatMap(([x, y]) => [
      { d: roundedRect(x! - 15, y! - 31, 30, 62, 15), role: 'key' as const },
      { d: `M ${x! - 10} ${y} L ${x! + 10} ${y}`, role: 'line' as const },
    ]),
    { d: circle(280, 588, 20), role: 'key' },
    { d: 'M 280 572 L 280 582', role: 'line' },
  ],
  texts: [
    { x: 58, y: 106, text: 'GAIN', size: 9 },
    { x: 502, y: 106, text: 'SYM', size: 9 },
    { x: 58, y: 462, text: 'BRT', size: 9 },
    { x: 502, y: 462, text: 'CON', size: 9 },
  ],
  controls: [
    ...KEY_AT.map((at, i) => ({
      id: `osb-${i + 1}`,
      name: `OSB ${i + 1}`,
      glyph: 'key' as const,
      at: { x: at, y: 58 },
      side: 'top' as const,
      inputs: [{ id: `button:${OSB_TOP[i]}` }],
    })),
    ...KEY_AT.map((at, i) => ({
      id: `osb-${6 + i}`,
      name: `OSB ${6 + i}`,
      glyph: 'key' as const,
      at: { x: 502, y: at },
      side: 'right' as const,
      inputs: [{ id: `button:${OSB_RIGHT[i]}` }],
    })),
    ...KEY_AT.map((at, i) => ({
      id: `osb-${15 - i}`,
      name: `OSB ${15 - i}`,
      glyph: 'key' as const,
      at: { x: at, y: 502 },
      side: 'bottom' as const,
      inputs: [{ id: `button:${OSB_BOTTOM[i]}` }],
    })),
    ...KEY_AT.map((at, i) => ({
      id: `osb-${20 - i}`,
      name: `OSB ${20 - i}`,
      glyph: 'key' as const,
      at: { x: 58, y: at },
      side: 'left' as const,
      inputs: [{ id: `button:${OSB_LEFT[i]}` }],
    })),
    {
      id: 'gain',
      name: 'GAIN',
      glyph: 'key',
      at: { x: 58, y: 58 },
      side: 'left',
      inputs: [
        { id: 'button:43', tag: '▲' },
        { id: 'button:44', tag: '▼' },
      ],
    },
    {
      id: 'sym',
      name: 'SYM',
      glyph: 'key',
      at: { x: 502, y: 58 },
      side: 'right',
      inputs: [
        { id: 'button:33', tag: '▲' },
        { id: 'button:32', tag: '▼' },
      ],
    },
    {
      id: 'brt',
      name: 'BRT',
      glyph: 'key',
      at: { x: 58, y: 502 },
      side: 'left',
      inputs: [
        { id: 'button:10', tag: '▲' },
        { id: 'button:11', tag: '▼' },
      ],
    },
    {
      id: 'con',
      name: 'CON',
      glyph: 'key',
      at: { x: 502, y: 502 },
      side: 'right',
      inputs: [
        { id: 'button:22', tag: '▲' },
        { id: 'button:21', tag: '▼' },
      ],
    },
    {
      id: 'knob',
      name: 'Knob',
      glyph: 'key',
      at: { x: 280, y: 588 },
      side: 'bottom',
      inputs: [
        { id: 'axis:SLIDER1', tag: 'turn' },
        { id: 'button:49', tag: '◄' },
        { id: 'button:50', tag: '►' },
      ],
    },
  ],
  columnWidth: 210,
};

/**
 * The F/A-18 grip on an Orion base, seen from behind as the pilot sees it: the trim hat on
 * the crown, the pickle on its boss at the top left, the sensor control switch and the
 * weapon select switch down the left side under the thumb, the RECCE button on the right.
 * The trigger, the undesignate button and the paddle are on the front, drawn dashed.
 * Numbered as WinWing's own Hornet profiles for the grip number them; only the trigger's
 * first detent is a guess. The two bases differ in one number (the RECCE button).
 */
function f18Grip(name: string, names: string[], recce: number): DeviceDrawingInput {
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_VERSION,
    name,
    match: { vendorId: WINWING, names },
    author: 'RigReady',
    license: CC0,
    view: 'From behind, as the pilot sees it',
    notes: 'Numbered as WinWing numbers this grip in its DCS profiles.',
    size: { width: 360, height: 820 },
    paths: [
      ...ORION_BASE,
      // The grip: a rounded crown, the head swelling to the left where the thumb works,
      // a waist, the handle, a flared foot.
      {
        d:
          'M 96 120 C 96 76 130 46 180 44 C 232 42 270 70 272 112 L 270 250 ' +
          'C 268 282 252 300 232 308 L 228 330 L 230 430 C 232 480 240 530 240 580 ' +
          'C 240 630 244 668 248 700 L 112 700 C 116 668 120 630 120 580 C 120 530 128 480 130 430 ' +
          'L 132 330 L 128 308 C 98 298 84 276 84 246 Z',
        role: 'body',
      },
      {
        d: 'M 232 308 L 228 330 L 230 430 C 232 480 240 530 240 580 C 240 630 244 668 248 700 L 228 700 C 224 668 220 630 220 580 C 220 530 212 480 210 430 L 212 318 Z',
        role: 'shade',
      },
      // The crown, where the trim hat and the pickle sit.
      {
        d: 'M 112 124 C 114 88 142 64 180 62 C 222 60 252 84 254 118 L 252 150 L 110 156 Z',
        role: 'panel',
      },
      // The pickle's raised boss at the top left.
      { d: circle(126, 112, 20), role: 'key' },
      // The thumb face down the left side of the head.
      { d: 'M 92 170 L 136 168 L 138 286 C 118 284 98 272 94 252 Z', role: 'panel' },
      // The trigger and its guard, at the front, as the bump they make at the left edge.
      { d: 'M 130 340 C 98 344 82 368 84 396 C 86 424 104 436 132 436 Z', role: 'panel' },
      // The paddle at the front of the foot, dashed: the pilot does not see it.
      { d: roundedRect(140, 600, 80, 70, 10), role: 'panel', dashed: true },
    ],
    texts: [{ x: 180, y: 786, text: 'ORION', size: 11 }],
    controls: [
      {
        id: 'pickle',
        name: 'Pickle',
        glyph: 'button',
        at: { x: 126, y: 112 },
        side: 'left',
        inputs: [{ id: 'button:7' }],
      },
      {
        id: 'trim',
        name: 'Trim hat',
        glyph: 'hat',
        at: { x: 196, y: 96 },
        side: 'right',
        inputs: hat(1),
      },
      {
        id: 'sensor',
        name: 'Sensor control · 4-way',
        glyph: 'switch',
        at: { x: 114, y: 196 },
        side: 'left',
        inputs: [...fourWay(3, 4, 5, 6), { id: 'button:2', tag: 'press' }],
      },
      {
        id: 'recce',
        name: 'RECCE',
        glyph: 'button',
        at: { x: 238, y: 196 },
        side: 'right',
        inputs: [{ id: `button:${recce}` }],
      },
      {
        id: 'weapon',
        name: 'Weapon select',
        glyph: 'switch',
        at: { x: 116, y: 258 },
        side: 'left',
        inputs: [
          { id: 'button:12', tag: '↑' },
          { id: 'button:13', tag: 'press' },
          { id: 'button:14', tag: '↓' },
          { id: 'button:11', tag: '←' },
        ],
      },
      {
        id: 'trigger',
        name: 'Trigger',
        glyph: 'none',
        at: { x: 96, y: 390 },
        side: 'left',
        inputs: [
          { id: 'button:1', tag: '1st' },
          { id: 'button:9', tag: '2nd' },
        ],
      },
      {
        id: 'undesignate',
        name: 'Undesignate / NWS',
        glyph: 'button',
        at: { x: 196, y: 470 },
        side: 'right',
        hidden: true,
        inputs: [{ id: 'button:16' }],
      },
      {
        id: 'twist',
        name: 'Twist',
        glyph: 'axis',
        at: { x: 180, y: 556 },
        side: 'right',
        inputs: [{ id: 'axis:RZ' }],
      },
      {
        id: 'paddle',
        name: 'Paddle',
        glyph: 'lever',
        at: { x: 180, y: 636 },
        side: 'right',
        hidden: true,
        inputs: [{ id: 'button:17' }],
      },
      {
        id: 'base',
        name: 'Stick',
        glyph: 'axes',
        at: { x: 180, y: 766 },
        side: 'right',
        inputs: [
          { id: 'axis:X', tag: '↔' },
          { id: 'axis:Y', tag: '↕' },
        ],
      },
    ],
    columnWidth: 300,
  };
}

export const F18_GRIP_BASE1 = f18Grip(
  'WinWing Orion stick (base 1) with F/A-18 grip',
  ['BASE1 + F18 GRIP'],
  8
);
export const F18_GRIP = f18Grip(
  'WinWing Orion 2 stick with F/A-18 grip',
  ['F18 GRIP', 'JGRIP-F18'],
  21
);

export const DRAWINGS: DeviceDrawingInput[] = [
  F16_GRIP,
  F18_GRIP_BASE1,
  F18_GRIP,
  ORION_THROTTLE,
  MFD_FRAME,
];
