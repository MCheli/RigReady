import { t16000m, warthogStick, warthogThrottle } from '../known/thrustmaster';
import { circle, placeKnown, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * Thrustmaster's most common flight controllers, drawn from scratch in the same flat
 * style as the WinWing drawings (no vendor artwork), CC0. The controls, their names and
 * their input numbers are the known-device maps in `../known/thrustmaster.ts`; only where
 * each one is on the device is decided here. Where the places come from is in
 * docs/research/controller-drawings.md (section 7).
 */

const TM = '044F';
const CC0 = 'CC0-1.0';

/** A toggle switch seen from above or behind: the round base and its bat. */
function toggle(x: number, y: number): { d: string; role: 'key' | 'line' }[] {
  return [
    { d: circle(x, y, 9), role: 'key' },
    { d: `M ${x} ${y} L ${x} ${y - 15}`, role: 'line' },
  ];
}

/**
 * The HOTAS Warthog stick, seen from behind as the pilot sees it, placed as the A-10C
 * grip it copies (figure 69 of the DCS A-10C flight manual): the weapon release top left
 * and the trim hat top right of the head, TMS and DMS side by side below them, the CMS
 * standing out of the left side under the head, the master mode button on the spur at
 * the right. The trigger and the paddle are on the front, so they show as the bumps they
 * make at the left edge; the paddle is drawn dashed. The NWS button is low on the left.
 */
export const WARTHOG_STICK: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Thrustmaster HOTAS Warthog joystick',
  match: { vendorId: TM, productIds: ['0402'], names: ['Joystick - HOTAS Warthog'] },
  author: 'RigReady',
  license: CC0,
  view: 'From behind, as the pilot sees it',
  notes: 'Numbered as Windows reports the stick without a TARGET profile.',
  size: { width: 360, height: 820 },
  paths: [
    // The round metal base and the gimbal boot.
    { d: roundedRect(30, 742, 300, 62, 22), role: 'body' },
    {
      d: 'M 140 690 L 220 690 Q 228 690 228 698 L 234 744 L 126 744 L 132 698 Q 132 690 140 690 Z',
      role: 'shade',
    },
    // The grip: the head with the thumb hump at the top left and the spur at the right,
    // the neck, the handle, the flare at the bottom.
    {
      d:
        'M 92 128 C 88 84 112 52 152 46 L 236 40 C 270 36 292 58 292 92 L 296 128 ' +
        'C 300 150 292 164 278 170 L 270 240 C 268 274 252 294 232 302 L 228 330 L 228 430 ' +
        'C 228 480 236 530 236 570 C 236 620 242 662 246 700 L 114 700 C 118 662 124 620 124 570 ' +
        'C 124 530 132 480 132 430 L 132 330 L 126 304 C 100 296 84 272 84 240 Z',
      role: 'body',
    },
    {
      d: 'M 232 302 L 228 330 L 228 430 C 228 480 236 530 236 570 C 236 620 242 662 246 700 L 226 700 C 222 662 216 620 216 570 C 216 530 208 480 208 430 L 210 312 Z',
      role: 'shade',
    },
    // The rear face of the head, where the hats sit.
    {
      d:
        'M 106 132 C 104 96 124 72 156 66 L 232 58 C 256 54 274 70 274 96 L 266 236 ' +
        'C 264 260 250 274 232 280 L 130 282 C 112 278 100 262 100 242 Z',
      role: 'panel',
    },
    // The weapon release button's boss, the trim hat's ring, the bosses of TMS and DMS.
    { d: circle(130, 100, 17), role: 'key' },
    { d: circle(214, 92, 24), role: 'screen' },
    { d: circle(150, 178, 19), role: 'key' },
    { d: circle(228, 188, 19), role: 'key' },
    // The CMS, standing out of the left side under the head.
    { d: roundedRect(84, 290, 54, 34, 11), role: 'panel' },
    // The trigger and the paddle, at the front, as the bumps they make at the edge.
    { d: 'M 132 340 C 102 344 88 366 90 392 C 92 418 108 430 134 430 Z', role: 'panel' },
    {
      d: 'M 126 590 C 104 594 94 610 96 630 C 98 648 110 658 128 660 Z',
      role: 'panel',
      dashed: true,
    },
  ],
  texts: [{ x: 180, y: 786, text: 'HOTAS WARTHOG', size: 11 }],
  controls: placeKnown(warthogStick, {
    s2: { at: { x: 130, y: 100 }, side: 'left', glyph: 'button' },
    h1: { at: { x: 214, y: 92 }, side: 'right', glyph: 'hat' },
    s1: { at: { x: 286, y: 146 }, side: 'right', glyph: 'button' },
    h2: { at: { x: 150, y: 178 }, side: 'left', glyph: 'hat' },
    h3: { at: { x: 228, y: 188 }, side: 'right', glyph: 'hat' },
    h4: { at: { x: 104, y: 307 }, side: 'left', glyph: 'hat' },
    trigger: { at: { x: 100, y: 386 }, side: 'left', glyph: 'none' },
    s3: { at: { x: 140, y: 548 }, side: 'left', glyph: 'button' },
    s4: { at: { x: 108, y: 626 }, side: 'left', glyph: 'none', hidden: true },
    stick: { at: { x: 180, y: 772 }, side: 'right', glyph: 'axes' },
  }),
  columnWidth: 300,
};

/**
 * The HOTAS Warthog throttle, seen from above with the pilot at the bottom: the two
 * handles in their slot (the left one the A-10's, the right one the F-15E's), the idle
 * detents under them, the friction lever on the left of the base, and the switch panel
 * on the right of the base (its switches in two columns, approximately where they are). The handle switches are placed as figure 70 of the DCS
 * A-10C flight manual shows them: mic switch, speed brake and boat switch down the
 * inboard side of the left handle under the thumb, the china hat at its front, the
 * pinky switch at its back and the left throttle button on its outboard side; the slew
 * control and the coolie hat on the inboard side of the right handle.
 */
export const WARTHOG_THROTTLE: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Thrustmaster HOTAS Warthog throttle',
  match: { vendorId: TM, productIds: ['0404'], names: ['Throttle - HOTAS Warthog'] },
  author: 'RigReady',
  license: CC0,
  view: 'From above, the pilot at the bottom',
  notes:
    'Numbered as Windows reports the throttle without a TARGET profile. The places of the panel switches are approximate: drag a dot in Edit drawing if one is off.',
  size: { width: 470, height: 700 },
  paths: [
    { d: roundedRect(0, 0, 470, 700, 24), role: 'body' },
    // The slot the handles travel in.
    { d: roundedRect(30, 40, 210, 460, 14), role: 'screen' },
    // Left handle: the A-10's, with its switches down the inboard side.
    {
      d: 'M 54 110 C 54 82 70 70 94 70 L 106 70 C 126 70 134 84 132 110 L 130 200 L 128 420 C 128 436 120 444 106 444 L 80 444 C 66 444 58 436 58 420 L 56 200 Z',
      role: 'panel',
    },
    {
      d: 'M 132 110 L 130 200 L 128 420 C 128 436 120 444 106 444 L 118 444 C 128 440 134 430 134 420 L 136 200 Z',
      role: 'shade',
    },
    // Right handle: the F-15E's, the slew and the coolie at its inboard top.
    {
      d: 'M 150 110 C 148 84 156 70 176 70 L 188 70 C 212 70 228 82 228 110 L 226 200 L 224 420 C 224 436 216 444 202 444 L 176 444 C 162 444 154 436 154 420 L 152 200 Z',
      role: 'panel',
    },
    {
      d: 'M 228 110 L 226 200 L 224 420 C 224 436 216 444 202 444 L 214 444 C 224 440 230 430 230 420 L 232 200 Z',
      role: 'shade',
    },
    // The idle detents under the handles.
    { d: roundedRect(60, 456, 160, 24, 6), role: 'shade' },
    // The friction lever on the left of the base.
    { d: roundedRect(8, 540, 24, 80, 8), role: 'key' },
    // The switch panel on the right of the base.
    { d: roundedRect(262, 40, 190, 620, 14), role: 'panel' },
    ...toggle(286, 124),
    ...toggle(318, 124),
    ...toggle(386, 116),
    ...toggle(424, 108),
    ...toggle(302, 236),
    { d: circle(408, 226, 11), role: 'key' },
    { d: roundedRect(290, 322, 22, 44, 6), role: 'key' },
    ...toggle(408, 336),
    ...toggle(302, 456),
    { d: circle(392, 448, 12), role: 'key' },
    { d: roundedRect(418, 420, 22, 50, 8), role: 'key' },
  ],
  texts: [
    { x: 93, y: 424, text: 'L', size: 18 },
    { x: 189, y: 424, text: 'R', size: 18 },
    { x: 302, y: 80, text: 'EFL', size: 10 },
    { x: 405, y: 72, text: 'ENG OPER', size: 10 },
    { x: 302, y: 194, text: 'APU', size: 10 },
    { x: 408, y: 194, text: 'L/G WRN', size: 10 },
    { x: 301, y: 310, text: 'FLAPS', size: 10 },
    { x: 408, y: 304, text: 'EAC', size: 10 },
    { x: 302, y: 414, text: 'RDR ALTM', size: 10 },
    { x: 410, y: 406, text: 'AUTOPILOT', size: 10 },
    { x: 357, y: 620, text: 'HOTAS WARTHOG', size: 11 },
  ],
  controls: placeKnown(warthogThrottle, {
    ch: { at: { x: 86, y: 76 }, side: 'left', glyph: 'rocker' },
    ms: { at: { x: 116, y: 112 }, side: 'left', glyph: 'switch' },
    ltb: { at: { x: 62, y: 150 }, side: 'left', glyph: 'button' },
    spd: { at: { x: 124, y: 176 }, side: 'left', glyph: 'rocker' },
    bs: { at: { x: 124, y: 236 }, side: 'left', glyph: 'rocker' },
    throttles: { at: { x: 140, y: 320 }, side: 'left', glyph: 'slide' },
    ps: { at: { x: 62, y: 392 }, side: 'left', glyph: 'rocker' },
    idle: { at: { x: 140, y: 468 }, side: 'left', glyph: 'none' },
    friction: { at: { x: 20, y: 580 }, side: 'left', glyph: 'none' },
    sc: { at: { x: 168, y: 100 }, side: 'right', glyph: 'stick' },
    coolie: { at: { x: 170, y: 160 }, side: 'right', glyph: 'hat' },
    efl: { at: { x: 302, y: 124 }, side: 'right', glyph: 'none' },
    eol: { at: { x: 386, y: 116 }, side: 'right', glyph: 'none' },
    eor: { at: { x: 424, y: 108 }, side: 'right', glyph: 'none' },
    apu: { at: { x: 302, y: 236 }, side: 'right', glyph: 'none' },
    ldgh: { at: { x: 408, y: 226 }, side: 'right', glyph: 'none' },
    flaps: { at: { x: 301, y: 344 }, side: 'right', glyph: 'none' },
    eac: { at: { x: 408, y: 336 }, side: 'right', glyph: 'none' },
    rdr: { at: { x: 302, y: 456 }, side: 'right', glyph: 'none' },
    ap: { at: { x: 406, y: 448 }, side: 'right', glyph: 'none' },
  }),
  columnWidth: 260,
};

/** Six base keys in two rows of three, centred on (x, y). */
function bank(x: number, y: number): { d: string; role: 'key' }[] {
  return [-30, 0, 30].flatMap((dx) =>
    [-17, 17].map((dy) => ({
      d: roundedRect(x + dx - 11, y + dy - 11, 22, 22, 5),
      role: 'key' as const,
    }))
  );
}

/**
 * The T.16000M stick, seen from behind: the ambidextrous grip with the hat on top and
 * its three buttons round it, the trigger at the front (the bump at the left edge), the
 * wide base with a bank of six buttons either side and the throttle slider at its front
 * left. Thrustmaster's manual numbers the base buttons by bank but neither it nor any
 * other public source says which key of a bank is which number, so each bank is one
 * control, as the named list has it.
 */
export const T16000M: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Thrustmaster T.16000M stick',
  match: { vendorId: TM, productIds: ['B10A'], names: ['T.16000M'] },
  author: 'RigReady',
  license: CC0,
  view: 'From behind, as the pilot sees it',
  notes:
    'The grip and base buttons are named by their group, not by their place in it: press one to see which it is.',
  size: { width: 400, height: 760 },
  paths: [
    // The base, its two banks of keys and the throttle slider.
    { d: roundedRect(10, 560, 380, 180, 40), role: 'body' },
    { d: roundedRect(36, 586, 120, 84, 12), role: 'panel' },
    { d: roundedRect(244, 586, 120, 84, 12), role: 'panel' },
    ...bank(96, 628),
    ...bank(304, 628),
    { d: roundedRect(30, 690, 120, 22, 10), role: 'screen' },
    { d: roundedRect(66, 684, 24, 34, 6), role: 'key' },
    // The boot.
    {
      d: 'M 166 512 L 234 512 Q 242 512 242 520 L 248 562 L 152 562 L 158 520 Q 158 512 166 512 Z',
      role: 'shade',
    },
    // The grip: a round head, the neck, the handle.
    {
      d:
        'M 120 110 C 120 70 152 46 200 46 C 248 46 280 70 280 110 L 276 210 ' +
        'C 274 240 258 256 238 262 L 234 290 L 236 400 C 238 440 246 480 246 520 ' +
        'L 154 520 C 154 480 162 440 164 400 L 166 290 L 162 262 C 142 256 126 240 124 210 Z',
      role: 'body',
    },
    {
      d: 'M 238 262 L 234 290 L 236 400 C 238 440 246 480 246 520 L 228 520 C 228 480 220 440 218 400 L 216 270 Z',
      role: 'shade',
    },
    // The head's top face, the hat's ring and the three grip buttons.
    {
      d: 'M 136 116 C 138 82 164 64 200 64 C 236 64 262 82 264 116 L 260 200 C 258 224 244 238 224 240 L 176 240 C 156 238 142 224 140 200 Z',
      role: 'panel',
    },
    { d: circle(200, 100, 22), role: 'screen' },
    { d: circle(156, 126, 12), role: 'key' },
    { d: circle(244, 126, 12), role: 'key' },
    { d: circle(200, 180, 14), role: 'key' },
    // The trigger, at the front, as the bump it makes at the edge.
    { d: 'M 166 290 C 140 294 128 314 130 338 C 132 360 146 372 168 372 Z', role: 'panel' },
  ],
  texts: [{ x: 200, y: 726, text: 'T.16000M', size: 12 }],
  controls: placeKnown(t16000m, {
    hat: { at: { x: 200, y: 100 }, side: 'right', glyph: 'hat' },
    grip: { at: { x: 200, y: 180 }, side: 'left', glyph: 'none' },
    trigger: { at: { x: 140, y: 334 }, side: 'left', glyph: 'none' },
    stick: { at: { x: 200, y: 450 }, side: 'right', glyph: 'axes' },
    'base-left': { at: { x: 96, y: 628 }, side: 'left', glyph: 'none' },
    'base-right': { at: { x: 304, y: 628 }, side: 'right', glyph: 'none' },
    throttle: { at: { x: 78, y: 701 }, side: 'left', glyph: 'none' },
  }),
  columnWidth: 300,
};

export const THRUSTMASTER_DRAWINGS: DeviceDrawingInput[] = [
  WARTHOG_STICK,
  WARTHOG_THROTTLE,
  T16000M,
];
