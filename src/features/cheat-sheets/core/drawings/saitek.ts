import { x52pro } from '../known/logitech';
import { circle, placeKnown, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The Saitek (now Logitech) X52 Pro, drawn from scratch in the same flat style as the
 * other drawings, CC0. The stick and the throttle are cabled together and report to
 * Windows as one device, so they are one drawing: the throttle on the left, the stick on
 * the right, both seen from behind as the pilot sees them. The controls, names and
 * numbers are the known-device map in `../known/logitech.ts`; where each is, is from
 * the product photos and FlightGear's X52 Pro map (docs/research/controller-drawings.md,
 * section 7).
 */

const CC0 = 'CC0-1.0';
const T_AT = [430, 474, 518, 562, 606, 650];

export const X52_PRO: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'Saitek / Logitech X52 Pro',
  match: { vendorId: '06A3', productIds: ['0762'], names: ['X52 Pro'] },
  author: 'RigReady',
  license: CC0,
  view: 'Throttle and stick from behind, as the pilot sees them',
  notes:
    'The places of the grip buttons are approximate: drag a dot in Edit drawing if one is off. With the Saitek software running, the pinkie switch may act as a shift and not reach the game.',
  size: { width: 720, height: 620 },
  paths: [
    // The throttle: its base with the display, the slot, the handle leaning on it.
    { d: roundedRect(20, 440, 290, 160, 18), role: 'body' },
    { d: roundedRect(56, 486, 160, 74, 6), role: 'screen' },
    { d: roundedRect(120, 444, 110, 18, 8), role: 'shade' },
    {
      d: 'M 96 120 C 96 84 122 62 160 62 L 200 62 C 236 62 256 86 254 120 L 246 300 C 244 330 230 350 206 356 L 210 450 L 130 450 L 132 356 C 112 348 100 330 100 300 Z',
      role: 'body',
    },
    // The handle's inboard face, under the left thumb.
    {
      d: 'M 180 90 L 234 92 C 244 94 246 102 244 112 L 236 290 C 234 306 226 316 212 318 L 184 318 Z',
      role: 'panel',
    },
    { d: circle(214, 108, 10), role: 'key' },
    { d: roundedRect(198, 164, 32, 32, 7), role: 'key' },
    { d: circle(150, 84, 9), role: 'key' },
    // The stick: its base with the six toggles, the boot, the grip.
    { d: roundedRect(390, 470, 310, 130, 22), role: 'body' },
    { d: roundedRect(410, 530, 260, 44, 10), role: 'panel' },
    ...T_AT.flatMap((x) => [
      { d: circle(x, 556, 8), role: 'key' as const },
      { d: `M ${x} 556 L ${x} 542`, role: 'line' as const },
    ]),
    {
      d: 'M 506 428 L 574 428 Q 582 428 582 436 L 588 472 L 492 472 L 498 436 Q 498 428 506 428 Z',
      role: 'shade',
    },
    {
      d:
        'M 452 120 C 452 78 486 52 536 50 C 590 48 628 76 630 118 L 626 240 ' +
        'C 624 270 608 290 586 296 L 582 320 L 584 380 C 584 400 588 416 590 432 ' +
        'L 490 432 C 492 416 496 400 496 380 L 498 320 L 494 296 C 470 288 456 268 454 240 Z',
      role: 'body',
    },
    {
      d: 'M 586 296 L 582 320 L 584 380 C 584 400 588 416 590 432 L 572 432 C 570 416 566 400 566 380 L 566 304 Z',
      role: 'shade',
    },
    // The rear face of the head with its hats and buttons.
    {
      d: 'M 466 124 C 468 92 496 72 536 70 C 578 70 608 90 610 122 L 606 230 C 604 252 592 266 572 270 L 504 270 C 484 266 472 252 470 230 Z',
      role: 'panel',
    },
    // The fire button's flip-up safety cover, on top.
    { d: roundedRect(518, 46, 44, 22, 7), role: 'accent' },
    { d: circle(592, 96, 10), role: 'key' },
    { d: roundedRect(492, 98, 30, 30, 7), role: 'key' },
    { d: circle(507, 178, 17), role: 'screen' },
    { d: circle(560, 140, 10), role: 'key' },
    { d: circle(580, 204, 13), role: 'key' },
    { d: circle(484, 232, 9), role: 'key' },
    // The trigger and the pinkie switch, at the front, as the bumps they make at the edge.
    { d: 'M 498 300 C 474 304 462 322 464 344 C 466 364 478 374 498 374 Z', role: 'panel' },
    {
      d: 'M 494 384 C 478 388 470 400 472 414 C 474 426 482 432 494 432 Z',
      role: 'panel',
      dashed: true,
    },
  ],
  texts: [
    ...T_AT.map((x, i) => ({ x, y: 588, text: `T${i + 1}`, size: 9 })),
    { x: 136, y: 580, text: 'X52 PRO', size: 11 },
  ],
  controls: placeKnown(x52pro, {
    i: { at: { x: 150, y: 84 }, side: 'left', glyph: 'button' },
    d: { at: { x: 214, y: 108 }, side: 'left', glyph: 'button' },
    e: { at: { x: 108, y: 160 }, side: 'left', glyph: 'button', hidden: true },
    'throttle-hat': { at: { x: 214, y: 180 }, side: 'left', glyph: 'switch' },
    throttle: { at: { x: 170, y: 400 }, side: 'left', glyph: 'slide' },
    fire: { at: { x: 540, y: 58 }, side: 'top', glyph: 'button' },
    a: { at: { x: 592, y: 96 }, side: 'top', glyph: 'button' },
    h1: { at: { x: 507, y: 113 }, side: 'top', glyph: 'switch' },
    b: { at: { x: 560, y: 140 }, side: 'top', glyph: 'button' },
    pov: { at: { x: 507, y: 178 }, side: 'right', glyph: 'hat' },
    mode: { at: { x: 580, y: 204 }, side: 'right', glyph: 'knob' },
    c: { at: { x: 484, y: 232 }, side: 'right', glyph: 'button' },
    trigger: { at: { x: 474, y: 338 }, side: 'right', glyph: 'none' },
    pinkie: { at: { x: 480, y: 410 }, side: 'right', glyph: 'none', hidden: true },
    stick: { at: { x: 540, y: 500 }, side: 'right', glyph: 'axes' },
    toggles: { at: { x: 540, y: 556 }, side: 'right', glyph: 'none' },
  }),
  columnWidth: 240,
};

export const SAITEK_DRAWINGS: DeviceDrawingInput[] = [X52_PRO];
