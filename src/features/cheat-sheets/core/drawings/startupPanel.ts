import { axis, btn, knobAt, label, part, toggleAt, type DrawnInput } from './parts';
import { roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing F/A-18 startup panel from the front: a tall panel shaped like a C, the
 * FIRE test switch on the arm at the top right and the fuel switches on the arm at the
 * bottom. Drawn from scratch, CC0.
 *
 * Which number is which switch position is the maker's own test screen for the panel,
 * and the game's default Hornet profile agrees; the sources are in
 * docs/research/controller-drawings.md. Every input the panel reports is on the drawing.
 * The two ends of the GEN TIE switch are told apart by place only (up, down): the panel
 * and the game's profile word them differently.
 */

/** A ground power switch: A ON above, AUTO in the middle, B ON below. */
const groundPower = (first: number): DrawnInput[] => [
  btn(first, 'A ON'),
  btn(first + 1, 'AUTO'),
  btn(first + 2, 'B ON'),
];

const tank = (first: number): DrawnInput[] => [
  btn(first, 'ORIDE'),
  btn(first + 1, 'NORM'),
  btn(first + 2, 'STOP'),
];

export const STARTUP_PANEL: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing F/A-18 startup panel',
  match: { vendorId: '4098', productIds: ['BE03'] },
  author: 'RigReady',
  license: 'CC0-1.0',
  view: 'From the front',
  size: { width: 400, height: 790 },
  paths: [
    {
      d: 'M 5 71 L 393 5 L 393 155 L 217 155 L 217 619 L 393 619 L 393 782 L 5 782 Z',
      role: 'body',
    },
    { d: roundedRect(11, 79, 86, 538, 4), role: 'panel' },
    { d: 'M 101 62 L 213 44 L 213 626 L 101 626 Z', role: 'panel' },
    { d: roundedRect(249, 34, 112, 100, 4), role: 'panel' },
    { d: roundedRect(11, 622, 86, 152, 4), role: 'panel' },
    { d: roundedRect(101, 645, 286, 130, 4), role: 'panel' },
    // Left column.
    ...toggleAt(55, 118),
    ...toggleAt(55, 186),
    ...toggleAt(55, 254),
    ...toggleAt(63, 322),
    ...toggleAt(63, 390),
    ...knobAt(58, 473, 20),
    { d: roundedRect(36, 524, 30, 66, 6), role: 'shade' },
    ...toggleAt(51, 566),
    ...toggleAt(34, 668),
    ...toggleAt(54, 744),
    // Middle column.
    ...toggleAt(177, 112),
    ...toggleAt(126, 164),
    ...toggleAt(177, 196),
    ...toggleAt(126, 248),
    ...toggleAt(177, 282),
    ...knobAt(163, 378, 19),
    ...knobAt(129, 460, 19),
    ...toggleAt(177, 512),
    ...toggleAt(157, 598),
    // The arm at the top right.
    ...toggleAt(301, 92),
    // The arm at the bottom.
    { d: roundedRect(128, 672, 38, 82, 4), role: 'shade' },
    ...toggleAt(147, 715),
    ...toggleAt(217, 706),
    ...toggleAt(283, 706),
    ...toggleAt(333, 734),
  ],
  texts: [
    label(55, 98, 'L GEN'),
    label(55, 166, 'BATTERY'),
    label(55, 234, 'R GEN'),
    label(24, 356, 'ANTI', 7),
    label(24, 366, 'ICE', 7),
    label(63, 302, 'PITOT'),
    label(63, 370, 'ENG'),
    label(58, 444, 'BLEED AIR'),
    label(51, 606, 'GEN TIE'),
    label(54, 640, 'APU'),
    label(54, 716, 'ENG CRANK'),
    label(176, 153, 'GND PWR'),
    label(154, 115, '1', 9),
    label(149, 167, '2', 9),
    label(150, 199, '3', 9),
    label(153, 251, '4', 9),
    label(139, 285, 'EXT PWR'),
    label(163, 348, 'FORMATION'),
    label(129, 430, 'POSITION'),
    label(177, 492, 'STROBE'),
    label(157, 578, 'INTR WING'),
    label(301, 62, 'FIRE', 9),
    label(147, 664, 'PROBE'),
    label(250, 666, 'EXT TANKS'),
    label(217, 686, 'WING', 7),
    label(283, 686, 'CTR', 7),
    label(333, 712, 'DUMP'),
  ],
  controls: [
    part('l-gen', 'L GEN switch', 55, 118, 'left', [btn(7, 'NORM'), btn(8, 'OFF')]),
    part('battery', 'BATTERY switch', 55, 186, 'left', [
      btn(12, 'ON'),
      btn(13, 'OFF'),
      btn(14, 'ORIDE'),
    ]),
    part('r-gen', 'R GEN switch', 55, 254, 'left', [btn(21, 'NORM'), btn(22, 'OFF')]),
    part('pitot', 'PITOT switch', 63, 322, 'left', [btn(26, 'ON'), btn(27, 'AUTO')]),
    part('eng-ice', 'ENG anti-ice switch', 63, 390, 'left', [
      btn(28, 'ON'),
      btn(29, 'OFF'),
      btn(30, 'TEST'),
    ]),
    part('bleed', 'BLEED AIR knob', 58, 473, 'left', [
      btn(54, 'OFF'),
      btn(55, 'L OFF'),
      btn(56, 'NORM'),
      btn(57, 'R OFF'),
    ]),
    part('gen-tie', 'GEN TIE switch', 51, 566, 'left', [btn(34, '▲'), btn(35, '▼')]),
    part('apu', 'APU switch', 34, 668, 'left', [btn(38, 'ON'), btn(39, 'OFF')]),
    part('crank', 'ENG CRANK switch', 54, 744, 'left', [
      btn(40, 'L'),
      btn(41, 'OFF'),
      btn(42, 'R'),
    ]),
    part('fire', 'FIRE test switch', 301, 92, 'top', [
      btn(1, 'TEST A'),
      btn(2, 'NORM'),
      btn(3, 'TEST B'),
    ]),
    part('gnd-1', 'GND PWR 1 switch', 177, 112, 'top', groundPower(4)),
    part('gnd-2', 'GND PWR 2 switch', 126, 164, 'top', groundPower(9)),
    part('gnd-3', 'GND PWR 3 switch', 177, 196, 'right', groundPower(15)),
    part('gnd-4', 'GND PWR 4 switch', 126, 248, 'right', groundPower(18)),
    part('ext-pwr', 'EXT PWR switch', 177, 282, 'right', [
      btn(23, 'RESET'),
      btn(24, 'NORM'),
      btn(25, 'OFF'),
    ]),
    part('formation', 'FORMATION knob', 163, 378, 'right', [axis('RX')]),
    part('position', 'POSITION knob', 129, 460, 'right', [axis('RY')]),
    part('strobe', 'STROBE switch', 177, 512, 'right', [
      btn(31, 'BRT'),
      btn(32, 'OFF'),
      btn(33, 'DIM'),
    ]),
    part('intr-wing', 'INTR WING switch', 157, 598, 'right', [btn(36, 'INHIBIT'), btn(37, 'NORM')]),
    part('probe', 'PROBE switch', 147, 715, 'bottom', [
      btn(43, 'EXTEND'),
      btn(44, 'RETRACT'),
      btn(45, 'EMERG EXTD'),
    ]),
    part('tank-wing', 'EXT TANKS WING', 217, 706, 'bottom', tank(46)),
    part('tank-ctr', 'EXT TANKS CTR', 283, 706, 'bottom', tank(49)),
    part('dump', 'FUEL DUMP switch', 333, 734, 'bottom', [btn(52, 'ON'), btn(53, 'OFF')]),
  ],
  columnWidth: 240,
};
