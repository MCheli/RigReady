import { ORION_BASE } from './orion';
import { btn } from './parts';
import { circle, fourWay, hat, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing F/A-18 grip on an Orion base, seen from behind as the pilot sees it. The
 * head is wide: a round button at the left, a four-way switch in the middle, the trim
 * hat at the right and a small four-way switch under it. A four-way switch sticks out
 * of the left side of the handle under the head. The trigger, a button on the bulge at
 * the front left and the paddle lever are on the front, drawn dashed. Drawn from
 * scratch, CC0.
 *
 * Numbered from the maker's own number map for the grip, which the default profiles the
 * game ships for it agree with. The game's profiles for the two Orion bases differ in
 * one number (8 on the first base, 21 on the second, for the same function); both are
 * on the small switch, so one map serves both. The sources are in
 * docs/research/controller-drawings.md. Nobody has pressed this grip for RigReady: it is
 * not on the owner's rig.
 */
function f18Grip(name: string, names: string[]): DeviceDrawingInput {
  return {
    format: DRAWING_FORMAT,
    version: DRAWING_VERSION,
    name,
    match: { vendorId: '4098', names },
    author: 'RigReady',
    license: 'CC0-1.0',
    view: 'From behind, as the pilot sees it',
    notes: 'Seen from behind, as you hold it. Dashed parts are on the front, under your fingers.',
    size: { width: 360, height: 820 },
    paths: [
      ...ORION_BASE,
      // The grip: a wide head, the handle with the bulge for the side switch at its left.
      {
        d:
          'M 60 152 C 60 104 104 70 180 66 C 254 62 302 96 302 148 C 302 186 282 216 252 232 ' +
          'L 248 262 L 246 330 C 246 420 250 560 252 690 L 110 690 C 112 600 116 480 118 384 ' +
          'C 94 380 80 358 82 332 C 84 306 102 292 122 290 L 124 250 C 86 240 60 200 60 152 Z',
        role: 'body',
      },
      {
        d: 'M 248 262 L 246 330 C 246 420 250 560 252 690 L 232 690 C 230 560 226 420 226 330 L 228 266 Z',
        role: 'shade',
      },
      // The rear face of the head, where the thumb works.
      {
        d:
          'M 74 152 C 74 114 112 84 180 80 C 246 78 288 104 288 148 C 288 180 270 206 244 220 ' +
          'L 134 236 C 100 226 74 192 74 152 Z',
        role: 'panel',
      },
      { d: circle(104, 154, 17), role: 'key' },
      { d: circle(180, 150, 24), role: 'key' },
      { d: circle(258, 150, 26), role: 'screen' },
      { d: circle(222, 208, 12), role: 'key' },
      // The switch on the left side of the handle.
      { d: roundedRect(84, 312, 44, 44, 10), role: 'panel' },
      { d: circle(106, 334, 13), role: 'key' },
      // On the front: the button on the bulge, the trigger and the paddle lever.
      { d: circle(140, 416, 10), role: 'key', dashed: true },
      {
        d: 'M 162 440 L 198 440 C 200 466 196 492 188 504 L 172 504 C 164 492 160 466 162 440 Z',
        role: 'panel',
        dashed: true,
      },
      { d: roundedRect(169, 540, 22, 134, 9), role: 'panel', dashed: true },
    ],
    texts: [
      { x: 180, y: 726, text: 'dashed: on the front', size: 10 },
      { x: 180, y: 786, text: 'ORION', size: 11 },
    ],
    controls: [
      {
        id: 'top-left-button',
        name: 'Top left button',
        glyph: 'button',
        at: { x: 104, y: 154 },
        side: 'left',
        inputs: [btn(7)],
      },
      {
        id: 'centre-switch',
        name: 'Centre switch',
        glyph: 'switch',
        at: { x: 180, y: 150 },
        side: 'top',
        inputs: [...fourWay(3, 4, 5, 6), btn(2, 'press')],
      },
      {
        id: 'trim',
        name: 'TRIM hat',
        glyph: 'hat',
        at: { x: 258, y: 150 },
        side: 'right',
        inputs: [...hat(1), btn(1, 'press')],
      },
      {
        id: 'lower-switch',
        name: 'Lower right switch',
        glyph: 'switch',
        at: { x: 222, y: 208 },
        side: 'right',
        inputs: [...fourWay(18, 19, 20, 21), btn(8, 'press')],
      },
      {
        id: 'side-switch',
        name: 'Left side switch',
        glyph: 'switch',
        at: { x: 106, y: 334 },
        side: 'left',
        inputs: [...fourWay(12, 13, 14, 15), btn(11, 'press')],
      },
      {
        id: 'front-button',
        name: 'Front left button',
        glyph: 'none',
        at: { x: 140, y: 416 },
        side: 'left',
        hidden: true,
        inputs: [btn(16)],
      },
      {
        id: 'trigger',
        name: 'Trigger',
        glyph: 'none',
        at: { x: 180, y: 472 },
        side: 'right',
        hidden: true,
        inputs: [btn(9, '1st'), btn(10, '2nd')],
      },
      {
        id: 'paddle',
        name: 'Paddle lever',
        glyph: 'none',
        at: { x: 180, y: 606 },
        side: 'right',
        hidden: true,
        inputs: [btn(17)],
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

export const F18_GRIP_BASE1 = f18Grip('WinWing Orion stick (base 1) with F/A-18 grip', [
  'BASE1 + F18 GRIP',
]);
export const F18_GRIP = f18Grip('WinWing Orion 2 stick with F/A-18 grip', [
  'F18 GRIP',
  'JGRIP-F18',
]);
