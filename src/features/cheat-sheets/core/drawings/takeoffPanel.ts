import { btn, keyAt, label, momentary, part, resting, roundAt, toggleAt } from './parts';
import { circle, roundedRect } from './shapes';
import { DRAWING_FORMAT, DRAWING_VERSION, type DeviceDrawingInput } from './silhouette';

/**
 * The WinWing F/A-18 take-off panel 2 from the front: the gear lever at the left, the
 * switches and the jettison knob in the middle, the five station buttons, and the hook
 * lever over the wing fold handle at the right. Drawn from scratch, CC0.
 *
 * Which number is which control is the maker's own test screen for this panel (the
 * game ships a profile only for the first take-off panel, whose numbers differ); the
 * sources are in docs/research/controller-drawings.md. The panel reports 64 buttons and
 * the maker's screen places 41 of them.
 *
 * Both handles were moved on the owner's panel on 13 Nov. The brake handle: out 40, in 41,
 * left 39, right 38, and no button of its own while it rests. The wing fold handle: FOLD
 * 28, HOLD 29, SPREAD 30, each held while the handle is there, and 31 while it is pushed
 * in (released on let-go). It normally sits in SPREAD, so 30 is where it rests. The panel
 * also let go of 30 whenever the brake handle was moved off its rest: that is the panel's
 * own doing, not a position of the brake handle.
 */

const STATIONS: [string, number, number][] = [
  ['CTR', 434, 96],
  ['LI', 410, 138],
  ['RI', 458, 138],
  ['LO', 410, 180],
  ['RO', 458, 180],
];

export const TAKEOFF_PANEL_2: DeviceDrawingInput = {
  format: DRAWING_FORMAT,
  version: DRAWING_VERSION,
  name: 'WinWing F/A-18 take-off panel 2',
  match: { vendorId: '4098', productIds: ['BF05'] },
  author: 'RigReady',
  license: 'CC0-1.0',
  view: 'From the front',
  size: { width: 600, height: 320 },
  paths: [
    { d: roundedRect(2, 2, 596, 316, 14), role: 'body' },
    { d: roundedRect(8, 8, 370, 304, 10), role: 'panel' },
    { d: roundedRect(386, 8, 96, 304, 8), role: 'panel' },
    { d: roundedRect(488, 8, 104, 304, 10), role: 'panel' },
    // The gear lever in its slot, the caution light and the jettison button under it.
    { d: roundedRect(22, 46, 48, 136, 20), role: 'shade' },
    { d: roundedRect(30, 84, 32, 60, 12), role: 'key' },
    keyAt(32, 218, 40, 34, 4),
    roundAt(30, 280, 15),
    // The switches.
    ...toggleAt(135, 66),
    ...toggleAt(205, 66),
    ...toggleAt(135, 170),
    ...toggleAt(212, 158),
    ...toggleAt(103, 268),
    ...toggleAt(190, 268),
    // The jettison knob with its push button in the middle.
    { d: circle(300, 98, 34), role: 'key' },
    { d: circle(300, 98, 15), role: 'screen' },
    { d: 'M 276 74 L 284 82', role: 'line' },
    // The brake handle.
    { d: roundedRect(232, 196, 104, 30, 15), role: 'key' },
    // The station buttons and the lamps under them.
    ...STATIONS.map(([, x, y]) => keyAt(x, y, 40, 36, 4)),
    { d: roundedRect(398, 214, 72, 86, 4), role: 'shade' },
    // The hook lever and, under it, the wing fold handle.
    { d: roundedRect(516, 44, 48, 118, 14), role: 'shade' },
    { d: roundedRect(526, 58, 28, 92, 12), role: 'key' },
    { d: roundedRect(508, 174, 64, 116, 10), role: 'shade' },
    { d: roundedRect(526, 184, 28, 96, 12), role: 'key' },
  ],
  texts: [
    label(46, 34, 'LDG GEAR'),
    label(32, 216, 'MASTER', 6),
    label(32, 224, 'CAUTION', 6),
    label(30, 258, 'JETT', 7),
    label(135, 96, 'LAUNCH BAR'),
    label(205, 96, 'FLAP'),
    label(135, 138, 'LDG/TAXI LIGHT'),
    label(212, 126, 'ANTI SKID'),
    label(103, 236, 'HOOK BYPASS'),
    label(190, 236, 'PROBE'),
    label(300, 34, 'SELECT JETT'),
    label(300, 101, 'JETT', 7),
    label(284, 188, 'EMERG / PARK BRK'),
    label(434, 40, 'JETT STATION'),
    label(434, 52, 'SELECT'),
    ...STATIONS.map(([text, x, y]) => label(x, y + 3, text, 9)),
    label(434, 260, 'lamps', 7),
    label(540, 30, 'HOOK'),
    label(540, 304, 'WING FOLD'),
  ],
  controls: [
    part('gear', 'LDG GEAR lever', 46, 114, 'left', [
      btn(35, 'UP'),
      btn(36, 'middle'),
      btn(37, 'DOWN'),
    ]),
    part('lights', 'LDG/TAXI LIGHT switch', 135, 170, 'left', [btn(8, 'ON'), btn(9, 'OFF')]),
    part('caution', 'MASTER CAUTION', 32, 232, 'left', [btn(2)]),
    part('jett-push', 'Push to jettison', 30, 280, 'left', [btn(1)]),
    part('launch-bar', 'LAUNCH BAR switch', 135, 66, 'top', [btn(3, 'RETRACT'), btn(4, 'EXTEND')]),
    part('flap', 'FLAP switch', 205, 66, 'top', [btn(5, 'AUTO'), btn(6, 'HALF'), btn(7, 'FULL')]),
    part('select-jett', 'SELECT JETT knob', 300, 68, 'top', [
      btn(17, 'L FUS MSL'),
      btn(18, 'SAFE'),
      btn(19, 'R FUS MSL'),
      btn(20, 'RACK/LCHR'),
      btn(21, 'STORES'),
      momentary(btn(22, 'JETT push')),
    ]),
    part('stations', 'Station buttons', 476, 138, 'right', [
      btn(23, 'CTR'),
      btn(24, 'LI'),
      btn(25, 'RI'),
      btn(26, 'LO'),
      btn(27, 'RO'),
    ]),
    part('hook', 'HOOK lever', 540, 100, 'right', [
      btn(32, 'UP'),
      btn(33, 'middle'),
      btn(34, 'DOWN'),
    ]),
    part('hook-bypass', 'HOOK BYPASS switch', 103, 268, 'bottom', [
      btn(12, 'FIELD'),
      btn(13, 'CARRIER'),
    ]),
    part('probe', 'PROBE switch', 190, 268, 'bottom', [
      btn(14, 'EXTEND'),
      btn(15, 'RETRACT'),
      btn(16, 'EMERG EXTD'),
    ]),
    part('anti-skid', 'ANTI SKID switch', 212, 158, 'bottom', [btn(10, 'ON'), btn(11, 'OFF')]),
    part('brake', 'EMERG / PARK BRK handle', 284, 211, 'bottom', [
      btn(40, 'out'),
      btn(41, 'in'),
      btn(39, 'left'),
      btn(38, 'right'),
    ]),
    part('wing-fold', 'WING FOLD handle', 554, 232, 'right', [
      btn(28, 'FOLD'),
      btn(29, 'HOLD'),
      resting(btn(30, 'SPREAD')),
      momentary(btn(31, 'push')),
    ]),
  ],
  columnWidth: 210,
};
