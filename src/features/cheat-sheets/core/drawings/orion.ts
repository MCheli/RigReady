import { resting } from './parts';
import { circle, fourWay, hat, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The owner's own stick and throttle: the WinWing Orion 2 base with the ViperAce (F-16EX)
 * grip, and the Orion throttle base with the F-15EX handles. Drawn from scratch, CC0.
 *
 * Which number is which control, and where the control is, is written down with its
 * sources in docs/research/controller-drawings.md: the maker's own test screen for each
 * part (which number lights at which place), the default profiles the game ships for the
 * grip, the owner's own bindings, and what the owner found by pressing on 12 and 13 Nov
 * 2026. Every input the device reports is on its drawing, except the throttle's buttons 45
 * to 49 and 60 to 62, which nothing lit when the owner went round every control. No
 * control is `assumed` any more: the directions that rested on an angled picture were
 * pressed on the real grip and throttle. An input marked `rest` is where its control
 * rests, held with no hand on it; those are the ones seen held before anything was pressed.
 */

const WINWING = '4098';
const CC0 = 'CC0-1.0';

/** The Orion base and its boot, the same under every grip. */
export const ORION_BASE = [
  { d: roundedRect(30, 742, 300, 62, 14), role: 'body' as const },
  {
    d: 'M 142 690 L 218 690 Q 226 690 226 698 L 230 744 L 130 744 L 134 698 Q 134 690 142 690 Z',
    role: 'shade' as const,
  },
];

const press = (button: number): { id: string; tag: string } => ({
  id: `button:${button}`,
  tag: 'press',
});

/** A hat on a side face: up and down as arrows, the other two as "forward" and "back". */
const sideHat = (up: number, forward: number, down: number, back: number, push: number) => [
  { id: `button:${up}`, tag: '↑' },
  { id: `button:${forward}`, tag: 'forward' },
  { id: `button:${down}`, tag: '↓' },
  { id: `button:${back}`, tag: 'back' },
  press(push),
];

/**
 * The Orion 2 base with the ViperAce grip, seen from behind as the pilot sees it. The
 * head leans to the left and carries six controls on its rear face: the large trim hat
 * at the top right, the red button beside it, a castle hat at the upper left, the round
 * mini-stick on the bulge under that, a ribbed hat in the middle and a castle hat at the
 * right. Under the head a hat sticks out on each side of the handle, the left one lower.
 * What the fingers work is on the front and drawn dashed: the lever under the front of
 * the head, the two-stage trigger and the long lever hinged at the base. The small button
 * for the little finger sticks out of the left edge just above the hand rest.
 */
export const F16_GRIP: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing Orion 2 stick with ViperAce (F-16EX) grip',
  match: { vendorId: WINWING, productIds: ['BEA8'], names: ['JGRIP-F16'] },
  author: 'RigReady',
  license: CC0,
  view: 'From behind, as the pilot sees it',
  notes: 'Seen from behind, as you hold it. Dashed parts are on the front, under your fingers.',
  size: { width: 360, height: 820 },
  paths: [
    // The base plate and the gimbal boot.
    ...ORION_BASE,
    // The grip: the head, wide and leaning to the left with a bulge for the mini-stick,
    // the neck, the handle with its palm swell.
    {
      d:
        'M 92 104 C 100 74 128 58 160 52 L 246 38 C 284 34 306 58 304 96 L 298 232 ' +
        'C 296 266 278 290 248 298 L 236 314 L 234 430 C 234 480 240 524 240 562 ' +
        'C 240 612 244 660 248 690 L 112 690 C 116 660 120 612 120 562 C 120 524 126 480 126 430 ' +
        'L 124 318 C 96 312 66 296 60 262 L 58 204 C 58 164 72 130 92 104 Z',
      role: 'body',
    },
    // Shadow down the right of the handle, for a little volume.
    {
      d:
        'M 236 314 L 234 430 C 234 480 240 524 240 562 C 240 612 244 660 248 690 L 228 690 ' +
        'C 224 660 220 612 220 562 C 220 524 214 480 214 430 L 216 318 Z',
      role: 'shade',
    },
    // The rear face of the head, where the thumb works.
    {
      d:
        'M 104 112 C 110 88 134 72 162 66 L 244 52 C 274 48 292 66 290 96 L 284 228 ' +
        'C 282 256 268 276 244 284 L 132 300 C 100 300 76 284 72 258 L 70 206 ' +
        'C 70 170 84 136 104 112 Z',
      role: 'panel',
    },
    // The hand rest at the bottom of the handle.
    { d: roundedRect(94, 682, 172, 20, 10), role: 'panel' },
    // The seats of the six controls on the head.
    { d: circle(252, 100, 30), role: 'screen' },
    { d: circle(180, 96, 14), role: 'accent' },
    { d: circle(120, 130, 21), role: 'key' },
    { d: circle(126, 222, 24), role: 'key' },
    { d: circle(186, 180, 21), role: 'key' },
    { d: circle(254, 200, 21), role: 'key' },
    // The hat on each side of the handle under the head: the left one sits lower.
    { d: roundedRect(78, 336, 54, 40, 12), role: 'panel' },
    { d: circle(102, 356, 14), role: 'key' },
    { d: roundedRect(230, 308, 54, 40, 12), role: 'panel' },
    { d: circle(260, 328, 14), role: 'key' },
    // On the front, top to bottom: the lever under the head, the trigger and the long
    // lever hinged at the base.
    { d: 'M 160 384 L 200 384 L 196 424 L 164 424 Z', role: 'panel', dashed: true },
    {
      d: 'M 162 440 L 198 440 C 200 466 196 492 188 504 L 172 504 C 164 492 160 466 162 440 Z',
      role: 'panel',
      dashed: true,
    },
    { d: roundedRect(169, 528, 22, 146, 9), role: 'panel', dashed: true },
    // The little finger's button, on the left edge just above the hand rest.
    { d: circle(113, 650, 12), role: 'key' },
  ],
  texts: [
    { x: 180, y: 726, text: 'dashed: on the front', size: 10 },
    { x: 180, y: 786, text: 'ORION 2', size: 11 },
  ],
  controls: [
    {
      id: 'red-button',
      name: 'Red button',
      glyph: 'button',
      at: { x: 180, y: 96 },
      side: 'top',
      inputs: [{ id: 'button:20' }],
    },
    {
      id: 'trim',
      name: 'TRIM hat',
      glyph: 'hat',
      at: { x: 252, y: 100 },
      side: 'right',
      inputs: [...hat(1), press(19)],
    },
    {
      id: 'castle-hat',
      name: 'Top left hat',
      glyph: 'hat',
      at: { x: 120, y: 130 },
      side: 'left',
      inputs: [...fourWay(22, 23, 24, 25), press(21)],
    },
    {
      id: 'centre-hat',
      name: 'Centre hat (TMS)',
      glyph: 'hat',
      at: { x: 186, y: 180 },
      side: 'left',
      inputs: [...fourWay(32, 33, 34, 35), press(31)],
    },
    // Reports its position on two axes and, pushed to an end, a button as well.
    {
      id: 'ministick',
      name: 'Mini-stick',
      glyph: 'stick',
      at: { x: 126, y: 222 },
      side: 'left',
      inputs: [
        { id: 'axis:RX', tag: '↔' },
        { id: 'axis:RY', tag: '↕' },
        press(26),
        { id: 'button:27', tag: '↑ as button' },
        { id: 'button:28', tag: '→ as button' },
        { id: 'button:29', tag: '↓ as button' },
        { id: 'button:30', tag: '← as button' },
      ],
    },
    {
      id: 'right-hat',
      name: 'Right hat (DMS)',
      glyph: 'hat',
      at: { x: 254, y: 200 },
      side: 'right',
      inputs: [...fourWay(37, 38, 39, 40), press(36)],
    },
    {
      id: 'thumb-hat',
      name: 'Left side hat (CMS)',
      glyph: 'hat',
      at: { x: 102, y: 356 },
      side: 'left',
      inputs: sideHat(10, 13, 12, 11, 9),
    },
    // Pressed on the owner's grip on 13 Nov: up 15, right 16, down 17, left 18, press 14,
    // each way as he named it holding the stick. Its face looks back and to the right, so
    // it is seen from behind and its ways are named as for the hats on the head.
    {
      id: 'side-hat',
      name: 'Right side hat',
      glyph: 'hat',
      at: { x: 260, y: 328 },
      side: 'right',
      inputs: [...fourWay(15, 16, 17, 18), press(14)],
    },
    // One lever: an axis over its travel, button 1 while it rests, 2 once it leaves rest,
    // then 41, 42 and 3 one after the other towards the full pull. Button 1 is held
    // whenever the lever is let go (the maker's screen lights it at rest, and the owner's
    // grip reported it held before anything was pressed).
    {
      id: 'front-lever',
      name: 'Top front lever',
      glyph: 'lever',
      at: { x: 180, y: 404 },
      side: 'left',
      hidden: true,
      inputs: [
        { id: 'axis:RZ', tag: 'travel' },
        resting({ id: 'button:1', tag: '1 at rest' }),
        { id: 'button:2', tag: '2 off rest' },
        { id: 'button:41', tag: '41 part way' },
        { id: 'button:42', tag: '42 further' },
        { id: 'button:3', tag: '3 full pull' },
      ],
    },
    {
      id: 'trigger',
      name: 'Trigger',
      glyph: 'none',
      at: { x: 180, y: 472 },
      side: 'right',
      hidden: true,
      inputs: [
        { id: 'button:4', tag: '1st' },
        { id: 'button:5', tag: '2nd' },
      ],
    },
    // The same for the paddle: button 7 is held whenever it is let go.
    {
      id: 'paddle',
      name: 'Paddle lever',
      glyph: 'lever',
      at: { x: 180, y: 592 },
      side: 'right',
      hidden: true,
      inputs: [
        { id: 'axis:SLIDER1', tag: 'travel' },
        resting({ id: 'button:7', tag: '7 at rest' }),
        { id: 'button:8', tag: '8 pulled' },
      ],
    },
    {
      id: 'pinky-button',
      name: 'Pinky button',
      glyph: 'button',
      at: { x: 113, y: 650 },
      side: 'left',
      inputs: [{ id: 'button:6' }],
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
 * The Orion throttle base with the F-15EX handles, in four views one under the other,
 * because no single view shows it all. From the top: the front of the left handle as the
 * fingers find it, with the knob and the switch on its outer end and a hat between two
 * small buttons; the base from above, with the two slots, their OFF and IDLE stops and
 * the friction lever; the side of the right handle the thumb rests on, forward to the
 * right; and the front of the right handle, with the finger lever, the mini-stick, a hat
 * and the wheel on the corner next to the thumb side. Both fronts run left to right as
 * the pilot has them.
 *
 * Left and right on the two front hats were read off the maker's picture, which looks at
 * the handles from the front, and mirrored; the owner's presses on 13 Nov confirmed both
 * (left handle: left 52, right 54; right handle: left 29, right 33).
 */
export const ORION_THROTTLE: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing Orion throttle with F-15EX handles',
  match: { vendorId: WINWING, productIds: ['BD26'], names: ['F15EX HANDLE'] },
  author: 'RigReady',
  license: CC0,
  view: 'Four views: the front of each handle, the base from above, the thumb side',
  notes:
    'Four views, top to bottom. The front of the left handle, where your fingers rest, left to right as you sit. ' +
    'The base from above. The side of the right handle your thumb rests on. The front of the right handle. ' +
    'The throttle also reports buttons 45 to 49 and 60 to 62, which no control was seen to press.',
  size: { width: 340, height: 876 },
  paths: [
    // The front of the left handle, with its outer end at the left.
    { d: roundedRect(40, 24, 260, 112, 24), role: 'body' },
    {
      d: 'M 64 24 L 116 24 L 116 136 L 64 136 Q 40 136 40 112 L 40 48 Q 40 24 64 24 Z',
      role: 'shade',
    },
    { d: roundedRect(124, 36, 166, 88, 14), role: 'panel' },
    { d: circle(78, 62, 22), role: 'screen' },
    { d: circle(78, 62, 15), role: 'key' },
    { d: roundedRect(67, 96, 22, 30, 8), role: 'screen' },
    { d: circle(152, 80, 11), role: 'key' },
    { d: circle(207, 80, 21), role: 'key' },
    { d: circle(262, 80, 11), role: 'key' },
    // The base from above: the two slots, the handles' stems in them, the friction slot.
    { d: roundedRect(40, 182, 260, 190, 18), role: 'body' },
    { d: roundedRect(88, 200, 24, 150, 10), role: 'screen' },
    { d: roundedRect(148, 200, 24, 150, 10), role: 'screen' },
    { d: roundedRect(80, 252, 40, 26, 8), role: 'key' },
    { d: roundedRect(140, 252, 40, 26, 8), role: 'key' },
    { d: roundedRect(246, 296, 20, 58, 9), role: 'screen' },
    { d: circle(256, 325, 8), role: 'key' },
    // The side of the right handle the thumb rests on, forward to the right.
    { d: roundedRect(64, 422, 212, 262, 28), role: 'body' },
    { d: roundedRect(74, 432, 192, 242, 20), role: 'panel' },
    { d: roundedRect(100, 446, 52, 22, 9), role: 'screen' },
    { d: circle(120, 514, 23), role: 'screen' },
    { d: circle(120, 514, 15), role: 'key' },
    { d: roundedRect(174, 502, 48, 48, 8), role: 'key' },
    { d: circle(108, 568, 10), role: 'key' },
    { d: circle(148, 608, 20), role: 'key' },
    { d: roundedRect(96, 642, 52, 22, 9), role: 'screen' },
    // The front of the right handle; the wheel is on the corner next to the thumb side.
    { d: roundedRect(40, 738, 260, 112, 24), role: 'body' },
    { d: roundedRect(50, 750, 196, 88, 14), role: 'panel' },
    { d: roundedRect(67, 767, 22, 54, 9), role: 'screen' },
    { d: roundedRect(116, 768, 52, 52, 8), role: 'key' },
    { d: circle(212, 794, 23), role: 'screen' },
    { d: circle(212, 794, 15), role: 'key' },
    { d: roundedRect(258, 744, 30, 44, 8), role: 'key' },
    { d: 'M 263 756 L 283 756 M 263 766 L 283 766 M 263 776 L 283 776', role: 'line' },
  ],
  texts: [
    { x: 170, y: 14, text: 'LEFT HANDLE, FROM THE FRONT', size: 10 },
    { x: 78, y: 148, text: 'outer end', size: 8 },
    { x: 170, y: 172, text: 'BASE, FROM ABOVE', size: 10 },
    { x: 100, y: 195, text: 'L', size: 9 },
    { x: 160, y: 195, text: 'R', size: 9 },
    { x: 202, y: 214, text: 'MAX', size: 9 },
    { x: 202, y: 240, text: 'MIL', size: 9 },
    { x: 202, y: 320, text: 'IDLE', size: 9 },
    { x: 202, y: 346, text: 'OFF', size: 9 },
    { x: 256, y: 290, text: 'FRICTION', size: 8 },
    { x: 170, y: 386, text: 'this edge is nearest you', size: 9 },
    { x: 170, y: 412, text: 'RIGHT HANDLE, THUMB SIDE', size: 10 },
    { x: 100, y: 698, text: '← back', size: 9 },
    { x: 240, y: 698, text: 'forward →', size: 9 },
    { x: 170, y: 728, text: 'RIGHT HANDLE, FROM THE FRONT', size: 10 },
    { x: 262, y: 864, text: 'thumb side →', size: 8 },
  ],
  controls: [
    // The left handle. The knurled knob on its outer end is the RZ axis (the maker's
    // screen ties RZ to it, and RZ stays wherever the knob is left). It gives no button:
    // nothing of 60 to 62 lit on the owner's throttle, so they are not claimed here.
    {
      id: 'left-knob',
      name: 'Left handle knob',
      glyph: 'knob',
      at: { x: 78, y: 62 },
      side: 'left',
      inputs: [{ id: 'axis:RZ', tag: 'turn' }],
    },
    // Under it, the three-way slider the owner pressed on 13 Nov: 59 at one end, 57 at
    // the other, and 58 held whenever it rests in the middle. It slides smoothly from end
    // to end, so it is named a slider, not a switch.
    {
      id: 'left-switch',
      name: 'Left handle slider',
      glyph: 'rocker',
      at: { x: 78, y: 111 },
      side: 'left',
      inputs: [
        { id: 'button:59', tag: '59 one end' },
        resting({ id: 'button:58', tag: 'middle' }),
        { id: 'button:57', tag: '57 other end' },
      ],
    },
    {
      id: 'left-outer-button',
      name: 'Left outer button',
      glyph: 'button',
      at: { x: 152, y: 80 },
      side: 'top',
      inputs: [{ id: 'button:56' }],
    },
    {
      id: 'left-hat',
      name: 'Left handle hat',
      glyph: 'hat',
      at: { x: 207, y: 80 },
      side: 'top',
      inputs: [...fourWay(51, 54, 53, 52), press(55)],
    },
    {
      id: 'left-inner-button',
      name: 'Left inner button',
      glyph: 'button',
      at: { x: 262, y: 80 },
      side: 'top',
      inputs: [{ id: 'button:50' }],
    },
    // The base. Each handle is an axis over its travel, with a button at IDLE and at OFF.
    // Pulled back to its IDLE stop is where a throttle rests: the IDLE button is held there.
    {
      id: 'left-throttle',
      name: 'Left throttle',
      glyph: 'slide',
      at: { x: 100, y: 265 },
      side: 'left',
      inputs: [
        { id: 'axis:RY', tag: 'travel' },
        resting({ id: 'button:31', tag: 'IDLE' }),
        { id: 'button:2', tag: 'OFF' },
      ],
    },
    {
      id: 'right-throttle',
      name: 'Right throttle',
      glyph: 'slide',
      at: { x: 160, y: 265 },
      side: 'right',
      inputs: [
        { id: 'axis:RX', tag: 'travel' },
        resting({ id: 'button:30', tag: 'IDLE' }),
        { id: 'button:1', tag: 'OFF' },
      ],
    },
    {
      id: 'friction',
      name: 'Friction lever',
      glyph: 'none',
      at: { x: 256, y: 325 },
      side: 'right',
      inputs: [{ id: 'axis:SLIDER1' }],
    },
    // The thumb side of the right handle.
    {
      id: 'upper-thumb-switch',
      name: 'Upper thumb switch',
      glyph: 'switch',
      at: { x: 126, y: 457 },
      side: 'left',
      inputs: [
        { id: 'button:22', tag: 'forward' },
        resting({ id: 'button:23', tag: 'middle' }),
        { id: 'button:24', tag: 'back' },
      ],
    },
    {
      id: 'rear-thumb-hat',
      name: 'Rear thumb hat',
      glyph: 'hat',
      at: { x: 120, y: 514 },
      side: 'left',
      inputs: sideHat(12, 13, 14, 15, 16),
    },
    {
      id: 'front-thumb-hat',
      name: 'Front thumb hat',
      glyph: 'hat',
      at: { x: 198, y: 526 },
      side: 'right',
      inputs: sideHat(17, 18, 19, 20, 21),
    },
    {
      id: 'thumb-button',
      name: 'Thumb button',
      glyph: 'button',
      at: { x: 108, y: 568 },
      side: 'left',
      inputs: [{ id: 'button:11' }],
    },
    {
      id: 'lower-thumb-hat',
      name: 'Lower thumb hat',
      glyph: 'hat',
      at: { x: 148, y: 608 },
      side: 'right',
      inputs: sideHat(6, 7, 8, 9, 10),
    },
    {
      id: 'lower-thumb-switch',
      name: 'Lower thumb switch',
      glyph: 'switch',
      at: { x: 122, y: 653 },
      side: 'left',
      inputs: [
        { id: 'button:3', tag: 'forward' },
        resting({ id: 'button:4', tag: 'middle' }),
        { id: 'button:5', tag: 'back' },
      ],
    },
    // The front of the right handle.
    {
      id: 'finger-lever',
      name: 'Finger lever',
      glyph: 'rocker',
      at: { x: 78, y: 794 },
      side: 'bottom',
      inputs: [
        { id: 'axis:Z', tag: 'travel' },
        { id: 'button:40', tag: '↑ end' },
        resting({ id: 'button:41', tag: 'centre' }),
        { id: 'button:42', tag: '↓ end' },
      ],
    },
    {
      id: 'ministick',
      name: 'Mini-stick',
      glyph: 'stick',
      at: { x: 142, y: 794 },
      side: 'bottom',
      inputs: [
        { id: 'axis:X', tag: '↔' },
        { id: 'axis:Y', tag: '↕' },
        press(35),
        { id: 'button:36', tag: '↑ as button' },
        { id: 'button:37', tag: '→ as button' },
        { id: 'button:38', tag: '↓ as button' },
        { id: 'button:39', tag: '← as button' },
      ],
    },
    {
      id: 'front-hat',
      name: 'Front hat',
      glyph: 'hat',
      at: { x: 212, y: 794 },
      side: 'bottom',
      inputs: [...fourWay(28, 33, 32, 29), press(34)],
    },
    {
      id: 'wheel',
      name: 'Wheel',
      glyph: 'none',
      at: { x: 273, y: 766 },
      side: 'right',
      inputs: [
        { id: 'button:25', tag: '↑' },
        { id: 'button:43', tag: '↑ further' },
        { id: 'button:27', tag: '↓' },
        { id: 'button:44', tag: '↓ further' },
        press(26),
      ],
    },
  ],
  columnWidth: 300,
};
