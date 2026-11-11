import { axes, axis, button, hatButtons, positions, pov } from './builder';
import type { KnownDeviceInput } from './schema';

/**
 * Logitech (formerly Saitek) devices. Labels as printed on the device; numbers as Windows
 * reports them. Sources: docs/research/device-control-names.md.
 */

export const x52pro: KnownDeviceInput = {
  id: 'saitek-x52-pro',
  name: 'Saitek / Logitech X52 Pro',
  match: { vendorId: '06A3', productIds: ['0762'], names: ['X52 Pro'] },
  shape: { buttons: 39, hats: 1, axes: ['X', 'Y', 'Z', 'RX', 'RY', 'RZ', 'SLIDER1'] },
  notes:
    'With the Saitek software running, the pinkie switch may act as a shift and not reach the game.',
  controls: [
    axes('stick', 'Stick', [
      ['X', 'Roll'],
      ['Y', 'Pitch'],
      ['RZ', 'Twist'],
    ]),
    axis('throttle', 'Throttle', 'Z'),
    positions('trigger', 'Trigger', [
      [1, 'First'],
      [15, 'Second'],
    ]),
    button('fire', 'Fire button', 2),
    button('a', 'A button', 3),
    button('b', 'B button', 4),
    button('c', 'C button', 5),
    button('pinkie', 'Pinkie switch', 6),
    hatButtons('h1', 'Stick top hat', { U: 20, R: 21, D: 22, L: 23 }),
    pov('pov', 'Stick POV hat'),
    positions('toggles', 'T1–T6 toggles', [
      [9, 'T1'],
      [10, 'T2'],
      [11, 'T3'],
      [12, 'T4'],
      [13, 'T5'],
      [14, 'T6'],
    ]),
    button('d', 'D button', 7),
    button('e', 'E button', 8),
    hatButtons('throttle-hat', 'Throttle hat', { U: 24, R: 25, D: 26, L: 27 }),
    positions('mode', 'Mode switch', [
      [28, '1'],
      [29, '2'],
      [30, '3'],
    ]),
    button('i', 'i button', 31),
  ],
};

export const LOGITECH: KnownDeviceInput[] = [x52pro];
