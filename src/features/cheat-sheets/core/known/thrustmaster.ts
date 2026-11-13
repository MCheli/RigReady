import { axes, axis, button, hatButtons, positions, pov } from './builder';
import type { KnownDeviceInput } from './schema';

/**
 * Thrustmaster devices. Names as Thrustmaster prints them in the manuals (the Warthog's
 * TG1, S2, H2 ...), numbers as Windows reports them without a TARGET profile. Sources and
 * the DCS World default files that confirm each number: docs/research/device-control-names.md.
 */

const TM = '044F';

export const warthogStick: KnownDeviceInput = {
  id: 'tm-warthog-stick',
  name: 'Thrustmaster HOTAS Warthog joystick',
  match: { vendorId: TM, productIds: ['0402'], names: ['Joystick - HOTAS Warthog'] },
  shape: { buttons: 19, hats: 1, axes: ['X', 'Y'] },
  controls: [
    axes('stick', 'Stick', [
      ['X', 'Roll'],
      ['Y', 'Pitch'],
    ]),
    positions('trigger', 'TG trigger', [
      [1, 'TG1 first'],
      [6, 'TG2 second'],
    ]),
    button('s2', 'S2 weapon release', 2),
    button('s1', 'S1 master mode button', 5),
    button('s3', 'S3 NWS button', 3),
    button('s4', 'S4 paddle lever', 4),
    pov('h1', 'H1 trim hat'),
    hatButtons('h2', 'H2 TMS hat', { U: 7, R: 8, D: 9, L: 10 }),
    hatButtons('h3', 'H3 DMS hat', { U: 11, R: 12, D: 13, L: 14 }),
    hatButtons('h4', 'H4 CMS hat', { U: 15, R: 16, D: 17, L: 18, C: 19 }),
  ],
};

export const warthogThrottle: KnownDeviceInput = {
  id: 'tm-warthog-throttle',
  name: 'Thrustmaster HOTAS Warthog throttle',
  match: { vendorId: TM, productIds: ['0404'], names: ['Throttle - HOTAS Warthog'] },
  shape: { buttons: 32, hats: 1, axes: ['X', 'Y', 'Z', 'RZ', 'SLIDER1'] },
  controls: [
    axes('throttles', 'Throttles', [
      ['RZ', 'Left'],
      ['Z', 'Right'],
    ]),
    positions('idle', 'Idle detents', [
      [30, 'Left'],
      [29, 'Right'],
    ]),
    {
      id: 'sc',
      name: 'SC slew control',
      inputs: [
        { id: 'axis:X', tag: '↔' },
        { id: 'axis:Y', tag: '↕' },
        { id: 'button:1', tag: 'Press' },
      ],
    },
    positions('ms', 'MS mic switch', [
      [3, '↑'],
      [4, 'Fwd'],
      [5, '↓'],
      [6, 'Aft'],
      [2, 'Press'],
    ]),
    // Thrustmaster's manual lists the coolie as the throttle's 8-way hat.
    pov('coolie', 'Coolie switch', 1),
    positions('spd', 'SPD speed brake', [
      [7, 'Fwd'],
      [8, 'Aft'],
    ]),
    positions('bs', 'BS boat switch', [
      [9, 'Fwd'],
      [10, 'Aft'],
    ]),
    positions('ch', 'CH china hat', [
      [11, 'Fwd'],
      [12, 'Aft'],
    ]),
    positions('ps', 'PS pinky switch', [
      [13, 'Fwd'],
      [14, 'Aft'],
    ]),
    button('ltb', 'LTB left throttle button', 15),
    axis('friction', 'Friction wheel', 'SLIDER1'),
    positions('efl', 'Fuel flow', [
      [16, 'L NORM'],
      [17, 'R NORM'],
    ]),
    positions('eol', 'Left engine operate', [
      [31, 'IGN'],
      [18, 'MOTOR'],
    ]),
    positions('eor', 'Right engine operate', [
      [32, 'IGN'],
      [19, 'MOTOR'],
    ]),
    button('apu', 'APU start', 20),
    button('ldgh', 'Landing gear horn silence', 21),
    positions('flaps', 'Flaps', [
      [22, 'UP'],
      [23, 'DN'],
    ]),
    button('eac', 'EAC arm', 24),
    button('rdr', 'Radar altimeter NRM', 25),
    positions('ap', 'Autopilot', [
      [26, 'ENGAGE'],
      [27, 'PATH'],
      [28, 'ALT'],
    ]),
  ],
};

export const t16000m: KnownDeviceInput = {
  id: 'tm-t16000m',
  name: 'Thrustmaster T.16000M stick',
  match: { vendorId: TM, productIds: ['B10A'], names: ['T.16000M'] },
  shape: { buttons: 16, hats: 1, axes: ['X', 'Y', 'RZ', 'SLIDER1'] },
  notes:
    'The grip and base buttons are named by their bank, not by their place in it: press one to see which it is.',
  controls: [
    axes('stick', 'Stick', [
      ['X', 'Roll'],
      ['Y', 'Pitch'],
      ['RZ', 'Twist'],
    ]),
    axis('throttle', 'Throttle wheel', 'SLIDER1'),
    button('trigger', 'Trigger', 1),
    positions('grip', 'Grip buttons', [
      [2, '2'],
      [3, '3'],
      [4, '4'],
    ]),
    pov('hat', 'Hat'),
    positions('base-left', 'Base, left bank', [
      [5, '5'],
      [6, '6'],
      [7, '7'],
      [8, '8'],
      [9, '9'],
      [10, '10'],
    ]),
    positions('base-right', 'Base, right bank', [
      [11, '11'],
      [12, '12'],
      [13, '13'],
      [14, '14'],
      [15, '15'],
      [16, '16'],
    ]),
  ],
};

/**
 * The TWCS throttle, numbered as Thrustmaster's manual draws it ("Mapping of the 14 buttons
 * and 8 axes"): on one side of the handle the mini-stick (X, Y, its press 6), the wheel
 * switch (4 up, 5 down), buttons 3 and 2, the antenna dial (the first slider) and the
 * rocker (RZ); on the other side the 8-way POV hat, the hats 7 to 10 and 11 to 14, and
 * button 1. The throttle is Z. TFRP pedals plugged into the throttle report through it:
 * the rudder as the second slider, the toe brakes as RY (left) and RX (right).
 */
export const twcs: KnownDeviceInput = {
  id: 'tm-twcs-throttle',
  name: 'Thrustmaster TWCS throttle',
  match: { vendorId: TM, productIds: ['B687'], names: ['TWCS Throttle'] },
  shape: { buttons: 14, hats: 1, axes: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1', 'SLIDER2'] },
  controls: [
    axis('throttle', 'Throttle', 'Z'),
    {
      id: 'mini-stick',
      name: 'Mini-stick',
      inputs: [
        { id: 'axis:X', tag: '↔' },
        { id: 'axis:Y', tag: '↕' },
        { id: 'button:6', tag: 'Press' },
      ],
    },
    positions('wheel', 'Wheel switch', [
      [4, '↑'],
      [5, '↓'],
    ]),
    button('b3', 'Button by the wheel', 3),
    button('b2', 'Button by the dial', 2),
    axis('antenna', 'Antenna dial', 'SLIDER1'),
    axis('rocker', 'Rocker', 'RZ'),
    pov('pov', 'POV hat'),
    hatButtons('middle-hat', 'Middle hat', { U: 7, R: 8, D: 9, L: 10 }),
    hatButtons('lower-hat', 'Lower hat', { U: 11, R: 12, D: 13, L: 14 }),
    button('b1', 'Bottom button', 1),
    axes('pedals', 'TFRP pedals, plugged in', [
      ['SLIDER2', 'Rudder'],
      ['RY', 'Left brake'],
      ['RX', 'Right brake'],
    ]),
  ],
};

export const THRUSTMASTER: KnownDeviceInput[] = [warthogStick, warthogThrottle, t16000m, twcs];
