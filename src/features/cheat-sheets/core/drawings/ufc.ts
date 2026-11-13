import {
  axis,
  btn,
  keyAt,
  knobAt,
  label,
  part,
  rockerAcrossAt,
  rockerAt,
  roundAt,
  toggleAt,
} from './parts';
import { roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing UFC1 with the HUD1 panel that plugs into it (one device to the PC), from
 * the front: the HUD panel on top, the up-front controller under it, and the three
 * rockers on the lower front face at the bottom. Drawn from scratch, CC0.
 *
 * Which number is which control, and where the control is, is the maker's own test
 * screen for each part, and the game's default Hornet profile agrees on every name;
 * the sources are in docs/research/controller-drawings.md. The device reports 128
 * buttons and names 60 of them; the rest have no control on it that any source shows.
 * The channel knobs can also report as a turning axis in another mode of the device,
 * which is not drawn.
 */

const PAD_X = [128, 182, 236];
const PAD_Y = [408, 465, 522, 581];
const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLR', '0', 'ENT'];
const OPTION_Y = [336, 399, 461, 522, 585];
const FUNCTION_X = [137, 184, 232, 280, 328, 376, 423];
const FUNCTIONS = ['A/P', 'IFF', 'TCN', 'ILS', 'D/L', 'BCN', 'ON/OFF'];

export const UFC_HUD: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing UFC1 with HUD1 panel',
  match: { vendorId: '4098', productIds: ['BEDE'] },
  author: 'RigReady',
  license: 'CC0-1.0',
  view: 'From the front',
  notes:
    'Top: the HUD panel. Middle: the up-front controller. Bottom: the three rockers on its lower front face.',
  size: { width: 560, height: 852 },
  paths: [
    // The HUD panel: a wide strip, a narrower part under it and a foot at each end.
    { d: roundedRect(20, 4, 520, 150, 10), role: 'body' },
    { d: roundedRect(4, 132, 96, 112, 8), role: 'body' },
    { d: roundedRect(460, 132, 96, 112, 8), role: 'body' },
    {
      d:
        'M 40 14 L 520 14 Q 526 14 526 20 L 526 82 Q 526 88 520 88 L 462 88 Q 456 88 456 94 ' +
        'L 456 140 Q 456 146 450 146 L 110 146 Q 104 146 104 140 L 104 94 Q 104 88 98 88 ' +
        'L 40 88 Q 34 88 34 82 L 34 20 Q 34 14 40 14 Z',
      role: 'panel',
    },
    { d: roundedRect(12, 150, 80, 86, 6), role: 'panel' },
    { d: roundedRect(468, 150, 80, 86, 6), role: 'panel' },
    ...toggleAt(75, 52),
    ...knobAt(157, 52),
    ...toggleAt(239, 52),
    ...knobAt(320, 52),
    ...toggleAt(402, 52),
    ...knobAt(484, 52),
    ...knobAt(185, 118),
    ...toggleAt(266, 118),
    ...toggleAt(348, 118),
    ...toggleAt(52, 202),
    ...toggleAt(508, 202),
    // The up-front controller.
    { d: roundedRect(8, 266, 544, 470, 12), role: 'body' },
    { d: roundedRect(14, 284, 72, 352, 4), role: 'panel' },
    { d: roundedRect(88, 284, 384, 352, 4), role: 'panel' },
    { d: roundedRect(474, 284, 72, 352, 4), role: 'panel' },
    { d: roundedRect(99, 318, 167, 40, 3), role: 'screen' },
    ...OPTION_Y.flatMap((y) => [
      { d: roundedRect(336, y - 18, 121, 36, 3), role: 'screen' as const },
      roundAt(300, y, 15),
    ]),
    ...PAD_Y.flatMap((y) => PAD_X.map((x) => keyAt(x, y, 40))),
    roundAt(50, 352, 17),
    ...toggleAt(50, 428),
    ...knobAt(50, 510),
    { d: roundedRect(33, 578, 34, 34, 3), role: 'screen' },
    ...knobAt(510, 352),
    keyAt(510, 428, 40),
    ...knobAt(510, 510),
    { d: roundedRect(493, 578, 34, 34, 3), role: 'screen' },
    ...FUNCTION_X.map((x) => keyAt(x, 668, 38)),
    ...knobAt(52, 690, 20),
    ...knobAt(508, 690, 20),
    { d: roundedRect(165, 708, 230, 20, 6), role: 'shade' },
    // The lower front face with its three rockers.
    { d: roundedRect(8, 752, 544, 92, 10), role: 'body' },
    { d: roundedRect(20, 762, 520, 72, 6), role: 'panel' },
    ...rockerAcrossAt(73, 792),
    ...rockerAt(280, 792),
    ...rockerAcrossAt(487, 792),
  ],
  texts: [
    label(75, 30, 'NORM'),
    label(75, 80, 'REJ 2'),
    label(157, 28, 'BRT'),
    label(239, 30, 'DAY'),
    label(239, 80, 'NIGHT'),
    label(320, 28, 'BLK LVL'),
    label(402, 30, 'W/B'),
    label(402, 80, 'OFF'),
    label(484, 28, 'BAL'),
    label(185, 97, 'AOA'),
    label(266, 100, 'ALT'),
    label(348, 100, 'ATT'),
    label(52, 180, 'HDG'),
    label(508, 180, 'CRS'),
    label(50, 326, 'I/P'),
    label(50, 408, 'ADF'),
    label(50, 487, 'VOL'),
    label(50, 566, 'COMM 1'),
    label(510, 329, 'BRT'),
    label(510, 426, 'EM', 8),
    label(510, 436, 'CON', 8),
    label(510, 487, 'VOL'),
    label(510, 566, 'COMM 2'),
    ...PAD_Y.flatMap((y, row) =>
      PAD_X.map((x, col) => {
        const text = PAD[row * 3 + col]!;
        return label(x, y + (text.length > 1 ? 4 : 5), text, text.length > 1 ? 10 : 14);
      })
    ),
    ...FUNCTIONS.map((text, i) =>
      i === 6 ? label(FUNCTION_X[i]!, 667, 'ON', 8) : label(FUNCTION_X[i]!, 671, text, 9)
    ),
    label(423, 677, 'OFF', 8),
    label(176, 828, 'lower front face', 8),
  ],
  controls: [
    part('hud-reject', 'HUD reject switch', 75, 52, 'left', [
      btn(65, 'NORM'),
      btn(66, 'REJ 1'),
      btn(67, 'REJ 2'),
    ]),
    part('hud-brt', 'HUD BRT knob', 157, 52, 'top', [axis('X')]),
    part('hud-day', 'HUD day / night switch', 239, 52, 'top', [btn(68, 'DAY'), btn(69, 'NIGHT')]),
    part('hud-blk', 'HUD BLK LVL knob', 320, 52, 'top', [axis('Y')]),
    part('hud-video', 'HUD video switch', 402, 52, 'top', [
      btn(70, 'W/B'),
      btn(71, 'VID'),
      btn(72, 'OFF'),
    ]),
    part('hud-bal', 'HUD BAL knob', 484, 52, 'right', [axis('Z')]),
    part('hud-aoa', 'HUD AOA knob', 185, 118, 'left', [axis('SLIDER2')]),
    part('hud-alt', 'HUD ALT switch', 266, 118, 'left', [btn(73, 'BARO'), btn(74, 'RDR')]),
    part('hud-att', 'HUD ATT switch', 348, 118, 'right', [
      btn(75, 'INS'),
      btn(76, 'AUTO'),
      btn(77, 'STBY'),
    ]),
    part('hdg', 'HDG switch', 52, 202, 'left', [btn(80, '←'), btn(79, 'centre'), btn(78, '→')]),
    part('crs', 'CRS switch', 508, 202, 'right', [btn(83, '←'), btn(82, 'centre'), btn(81, '→')]),
    part('ip', 'I/P button', 50, 352, 'left', [btn(1)]),
    part('adf', 'ADF switch', 50, 428, 'left', [btn(39, '1'), btn(40, 'OFF'), btn(41, '2')]),
    part(
      'keypad',
      'Keypad',
      106,
      581,
      'bottom',
      PAD.map((tag, i) => btn(i + 2, tag))
    ),
    part('vol-1', 'COMM 1 volume', 50, 510, 'left', [axis('RX')]),
    part('comm-1', 'COMM 1 knob', 52, 690, 'left', [btn(27, '◄'), btn(28, '►'), btn(29, 'pull')]),
    part(
      'options',
      'Option buttons',
      300,
      336,
      'right',
      OPTION_Y.map((_, i) => btn(14 + i, String(i + 1)))
    ),
    part('ufc-brt', 'UFC BRT knob', 510, 352, 'right', [axis('RZ')]),
    part('emcon', 'EMCON button', 528, 428, 'right', [btn(19)]),
    part('vol-2', 'COMM 2 volume', 510, 510, 'right', [axis('RY')]),
    part(
      'functions',
      'Function buttons',
      328,
      685,
      'bottom',
      FUNCTIONS.map((tag, i) => btn(20 + i, tag))
    ),
    part('comm-2', 'COMM 2 knob', 508, 690, 'right', [btn(30, '◄'), btn(31, '►'), btn(32, 'pull')]),
    part('rocker-left', 'Left rocker', 73, 792, 'bottom', [btn(33, '◄'), btn(34, '►')]),
    part('rocker-middle', 'Middle rocker', 280, 792, 'bottom', [btn(36, '▲'), btn(35, '▼')]),
    part('rocker-right', 'Right rocker', 487, 792, 'bottom', [btn(37, '◄'), btn(38, '►')]),
  ],
  columnWidth: 220,
};
