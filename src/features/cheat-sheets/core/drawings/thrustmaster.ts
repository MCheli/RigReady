import { t16000m, twcs, warthogStick, warthogThrottle } from '../known/thrustmaster';
import { circle, placeKnown, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * Thrustmaster's most common flight controllers, drawn from scratch in the same flat
 * style as the WinWing drawings (no vendor artwork), CC0. The controls, their names and
 * their input numbers are the known-device maps in `../known/thrustmaster.ts`; only where
 * each one is on the device is decided here. Where the places come from is in
 * docs/research/controller-drawings.md (sections 7 and 8).
 *
 * A device is drawn here only where its picture is known to match the real thing: every
 * place is settled by the maker's numbered diagram of the device and, for the Warthog,
 * by the figures of the A-10C it copies in the game's own manual.
 */

const TM = '044F';
const CC0 = 'CC0-1.0';

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

/** A toggle switch seen from above: its collar and the end of its lever. */
function toggle(x: number, y: number): { d: string; role: 'key' | 'screen' }[] {
  return [
    { d: circle(x, y, 12), role: 'key' },
    { d: circle(x, y, 5), role: 'screen' },
  ];
}

/** A slide switch on the side of a handle: its slot and the knob in it. */
function slide(x: number, y: number): { d: string; role: 'key' | 'screen' }[] {
  return [
    { d: roundedRect(x - 30, y - 13, 60, 26, 10), role: 'screen' },
    { d: roundedRect(x - 8, y - 10, 16, 20, 5), role: 'key' },
  ];
}

/**
 * The HOTAS Warthog throttle, in three views, top to bottom, as Thrustmaster's manual
 * draws it with every number ("Configuration of buttons and axes"):
 *
 * - The handles from the front, where the fingers rest: the right handle's front face
 *   carries the coolie switch at its thumb side and the slew control beside it, the left
 *   handle's front face the left throttle button. Seen from the front the right handle is
 *   on the left. Figure 70 of the game's A-10C manual shows the same: going across the
 *   front from the left handle to the thumb side, the left throttle button, the slew
 *   control, the coolie hat.
 * - The thumb side of the right handle (forward to the right): the mic switch at the top,
 *   the speed brake and the boat switch below it, the china hat at the bottom. Figure 70
 *   has this cluster on the same face, in the same order.
 * - The base from above, the pilot at the bottom: the slot the handles travel in, the
 *   flaps switch on its left, the fuel flow and engine operate switches, the APU switch and
 *   the gear horn button on its right, the wheel that reports the slider axis on the right
 *   edge, and the strip nearest the pilot with EAC, radar altimeter and autopilot. The
 *   pinky switch stands out of the left handle's outer side, at its back.
 */
export const WARTHOG_THROTTLE: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Thrustmaster HOTAS Warthog throttle',
  match: { vendorId: TM, productIds: ['0404'], names: ['Throttle - HOTAS Warthog'] },
  author: 'RigReady',
  license: CC0,
  view: 'Three views: the handles from the front, the thumb side, the base from above',
  notes:
    'Three views, top to bottom. The handles from the front, where your fingers rest: seen this way the right handle is on the left. ' +
    'The side of the right handle your thumb rests on. The base from above, the edge nearest you at the bottom. ' +
    'Numbered as Windows reports the throttle without a TARGET profile.',
  size: { width: 360, height: 912 },
  paths: [
    // The handles from the front. The right handle, with the mic switch standing out of
    // its thumb side at the far left; the left handle, narrower, to its right.
    { d: roundedRect(12, 56, 24, 32, 8), role: 'shade' },
    { d: roundedRect(30, 26, 190, 112, 26), role: 'body' },
    { d: roundedRect(44, 40, 162, 84, 16), role: 'panel' },
    { d: circle(92, 82, 25), role: 'screen' },
    { d: circle(92, 82, 16), role: 'key' },
    { d: circle(166, 82, 21), role: 'key' },
    { d: circle(166, 82, 9), role: 'screen' },
    { d: roundedRect(236, 34, 100, 96, 24), role: 'body' },
    { d: roundedRect(248, 46, 76, 72, 14), role: 'panel' },
    { d: circle(286, 82, 12), role: 'key' },
    // The thumb side of the right handle, forward to the right.
    { d: roundedRect(52, 196, 268, 214, 32), role: 'body' },
    { d: roundedRect(66, 210, 240, 186, 22), role: 'panel' },
    { d: circle(122, 258, 26), role: 'screen' },
    { d: circle(122, 258, 16), role: 'key' },
    ...slide(208, 293),
    ...slide(208, 335),
    { d: roundedRect(234, 362, 64, 26, 11), role: 'key' },
    { d: 'M 266 366 L 266 384', role: 'line' },
    // The base from above: the slot with the two handles in it, the pinky switch on the
    // left handle, the flaps switch, the switches right of the slot, the slider wheel on
    // the right edge, and the strip nearest the pilot.
    { d: roundedRect(18, 468, 324, 420, 22), role: 'body' },
    { d: roundedRect(72, 492, 104, 252, 12), role: 'screen' },
    { d: roundedRect(82, 604, 38, 72, 12), role: 'panel' },
    { d: roundedRect(128, 598, 40, 84, 14), role: 'panel' },
    { d: roundedRect(64, 650, 20, 12, 4), role: 'key' },
    { d: roundedRect(30, 644, 28, 60, 8), role: 'key' },
    { d: 'M 34 674 L 54 674', role: 'line' },
    { d: roundedRect(206, 504, 104, 32, 12), role: 'panel' },
    ...toggle(226, 520),
    ...toggle(290, 520),
    ...toggle(226, 592),
    ...toggle(290, 592),
    ...toggle(258, 648),
    { d: circle(258, 712, 13), role: 'key' },
    { d: roundedRect(318, 636, 16, 96, 6), role: 'key' },
    {
      d: 'M 320 652 L 332 652 M 320 664 L 332 664 M 320 676 L 332 676 M 320 688 L 332 688 M 320 700 L 332 700 M 320 712 L 332 712',
      role: 'line',
    },
    { d: roundedRect(30, 772, 300, 96, 14), role: 'panel' },
    ...toggle(74, 822),
    ...toggle(142, 822),
    { d: roundedRect(196, 802, 98, 40, 14), role: 'shade' },
    { d: circle(222, 822, 14), role: 'key' },
    ...toggle(270, 822),
  ],
  texts: [
    { x: 180, y: 14, text: 'HANDLES, FROM THE FRONT', size: 10 },
    { x: 125, y: 154, text: 'right handle', size: 9 },
    { x: 286, y: 154, text: 'left handle', size: 9 },
    { x: 186, y: 184, text: 'RIGHT HANDLE, THUMB SIDE', size: 10 },
    { x: 100, y: 426, text: '← back', size: 9 },
    { x: 272, y: 426, text: 'forward →', size: 9 },
    { x: 180, y: 456, text: 'BASE, FROM ABOVE', size: 10 },
    { x: 124, y: 510, text: 'MAX', size: 9 },
    { x: 124, y: 736, text: 'OFF', size: 9 },
    { x: 101, y: 644, text: 'L', size: 11 },
    { x: 148, y: 644, text: 'R', size: 11 },
    { x: 44, y: 636, text: 'FLAPS', size: 8 },
    { x: 180, y: 902, text: 'this edge is nearest you', size: 9 },
  ],
  controls: placeKnown(warthogThrottle, {
    coolie: { at: { x: 92, y: 82 }, side: 'left', glyph: 'hat' },
    sc: { at: { x: 166, y: 82 }, side: 'top', glyph: 'stick' },
    ltb: { at: { x: 286, y: 82 }, side: 'right', glyph: 'button' },
    ms: { at: { x: 122, y: 258 }, side: 'left', glyph: 'hat' },
    spd: { at: { x: 208, y: 293 }, side: 'right', glyph: 'none' },
    bs: { at: { x: 208, y: 335 }, side: 'right', glyph: 'none' },
    ch: { at: { x: 266, y: 375 }, side: 'right', glyph: 'none' },
    throttles: { at: { x: 124, y: 550 }, side: 'left', glyph: 'slide' },
    ps: { at: { x: 72, y: 656 }, side: 'left', glyph: 'none' },
    flaps: { at: { x: 44, y: 674 }, side: 'left', glyph: 'none' },
    idle: { at: { x: 124, y: 716 }, side: 'left', glyph: 'none' },
    efl: { at: { x: 258, y: 520 }, side: 'right', glyph: 'none' },
    eol: { at: { x: 226, y: 592 }, side: 'right', glyph: 'none' },
    eor: { at: { x: 290, y: 592 }, side: 'right', glyph: 'none' },
    apu: { at: { x: 258, y: 648 }, side: 'right', glyph: 'none' },
    friction: { at: { x: 326, y: 684 }, side: 'right', glyph: 'none' },
    ldgh: { at: { x: 258, y: 712 }, side: 'right', glyph: 'none' },
    eac: { at: { x: 74, y: 822 }, side: 'left', glyph: 'none' },
    rdr: { at: { x: 142, y: 822 }, side: 'bottom', glyph: 'none' },
    ap: { at: { x: 246, y: 822 }, side: 'right', glyph: 'none' },
  }),
  columnWidth: 300,
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

/**
 * The TWCS throttle, as Thrustmaster's manual draws it with every number ("Mapping of the
 * 14 buttons and 8 axes"), in three views top to bottom:
 *
 * - The side of the handle with the mini-stick: the mini-stick, and in a row beside it the
 *   wheel switch (4 above, 5 below), button 3 and button 2, then the antenna dial; the
 *   rocker runs along the bottom of that side.
 * - The side with the hats: the 8-way POV hat at the top, the hat 7 to 10 under it, the
 *   hat 11 to 14 under that, button 1 low at the side. Each hat's ways are as the manual
 *   draws them looking at this side.
 * - The base from above, the edge nearest the pilot at the bottom: the handle on its
 *   rail (the throttle, Z) and, at the back, the socket TFRP pedals plug into.
 *
 * The manual draws the two sides without saying which is the left and which the right,
 * so the views are named by what is on them.
 */
export const TWCS: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Thrustmaster TWCS throttle',
  match: { vendorId: TM, productIds: ['B687'], names: ['TWCS Throttle'] },
  author: 'RigReady',
  license: CC0,
  view: 'Three views: the side with the mini-stick, the side with the hats, the base from above',
  notes:
    'Three views, top to bottom: the side of the handle with the mini-stick, the side with the hats, the base from above. ' +
    'Numbered as Windows reports the throttle without a TARGET profile.',
  size: { width: 360, height: 892 },
  paths: [
    // The side with the mini-stick, and the rocker along its bottom.
    { d: roundedRect(30, 28, 300, 186, 44), role: 'body' },
    { d: roundedRect(46, 42, 268, 150, 32), role: 'panel' },
    { d: circle(100, 104, 30), role: 'screen' },
    { d: circle(100, 104, 18), role: 'key' },
    { d: circle(100, 104, 6), role: 'screen' },
    { d: roundedRect(150, 76, 22, 56, 9), role: 'key' },
    { d: 'M 153 92 L 169 92 M 153 104 L 169 104 M 153 116 L 169 116', role: 'line' },
    { d: circle(202, 118, 12), role: 'key' },
    { d: circle(238, 138, 12), role: 'key' },
    { d: circle(284, 116, 24), role: 'key' },
    { d: 'M 284 96 L 284 108', role: 'line' },
    { d: roundedRect(64, 196, 212, 30, 12), role: 'key' },
    { d: 'M 170 200 L 170 222', role: 'line' },
    // The side with the hats.
    { d: roundedRect(100, 276, 160, 296, 44), role: 'body' },
    { d: roundedRect(114, 290, 132, 268, 32), role: 'panel' },
    { d: circle(180, 334, 22), role: 'screen' },
    { d: circle(180, 334, 13), role: 'key' },
    { d: circle(180, 404, 24), role: 'screen' },
    { d: roundedRect(168, 392, 24, 24, 6), role: 'key' },
    { d: circle(180, 472, 22), role: 'screen' },
    { d: circle(180, 472, 13), role: 'key' },
    { d: circle(156, 530, 11), role: 'key' },
    // The base from above: the rail, the handle on it, the pedals' socket at the back.
    { d: roundedRect(60, 626, 240, 232, 28), role: 'body' },
    { d: roundedRect(170, 642, 20, 190, 8), role: 'screen' },
    { d: roundedRect(118, 700, 124, 84, 26), role: 'panel' },
    { d: roundedRect(166, 840, 28, 16, 3), role: 'key' },
  ],
  texts: [
    { x: 180, y: 16, text: 'SIDE WITH THE MINI-STICK', size: 10 },
    { x: 180, y: 264, text: 'SIDE WITH THE HATS', size: 10 },
    { x: 180, y: 614, text: 'BASE, FROM ABOVE', size: 10 },
    { x: 180, y: 656, text: 'MAX', size: 9 },
    { x: 180, y: 882, text: 'this edge is nearest you', size: 9 },
  ],
  controls: placeKnown(twcs, {
    'mini-stick': { at: { x: 100, y: 104 }, side: 'left', glyph: 'stick' },
    wheel: { at: { x: 161, y: 104 }, side: 'top', glyph: 'none' },
    b3: { at: { x: 202, y: 118 }, side: 'top', glyph: 'button' },
    b2: { at: { x: 238, y: 138 }, side: 'right', glyph: 'button' },
    antenna: { at: { x: 284, y: 116 }, side: 'right', glyph: 'knob' },
    rocker: { at: { x: 120, y: 211 }, side: 'left', glyph: 'rocker' },
    pov: { at: { x: 180, y: 334 }, side: 'right', glyph: 'hat' },
    'middle-hat': { at: { x: 180, y: 404 }, side: 'left', glyph: 'hat' },
    'lower-hat': { at: { x: 180, y: 472 }, side: 'right', glyph: 'hat' },
    b1: { at: { x: 156, y: 530 }, side: 'left', glyph: 'button' },
    throttle: { at: { x: 180, y: 742 }, side: 'right', glyph: 'slide' },
    pedals: { at: { x: 180, y: 848 }, side: 'left', glyph: 'none' },
  }),
  columnWidth: 300,
};

export const THRUSTMASTER_DRAWINGS: DeviceDrawingInput[] = [
  WARTHOG_STICK,
  WARTHOG_THROTTLE,
  T16000M,
  TWCS,
];
