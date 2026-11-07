import { z } from 'zod';

/**
 * A control of a device, named the way DirectInput numbers it, whatever the game:
 * `button:12` (Button 12, the first is 1), `axis:X` (X, Y, Z, RX, RY, RZ, SLIDER1, SLIDER2),
 * `hat:1:U` (hat 1 pushed up; U, UR, R, DR, D, DL, L, UL). In its own module so the layout
 * format and the drawing format can both use it without importing each other.
 */
export const CONTROL_ID =
  /^(button:[1-9]\d{0,2}|axis:[A-Z][A-Z0-9]{0,7}|hat:[1-9]:(U|UR|R|DR|D|DL|L|UL))$/;
export const ControlIdSchema = z.string().regex(CONTROL_ID);
