import { PadProfileSchema, type PadProfile } from './profile';

/**
 * Starting points: profiles that say what each part of the virtual controller is for,
 * from what players of these games use (docs/research/gamepad-emulation.md), without
 * naming any controller. A copy is made and the user presses or moves their own control
 * for each part. They are never started as they are: nothing in them is mapped yet.
 */

export const BUILTIN_PREFIX = 'starting-';

const flightStick = PadProfileSchema.parse({
  id: 'starting-flight-stick-ace-combat',
  name: 'Flight stick to gamepad (Ace Combat 8)',
  description:
    "For games that read only a gamepad, such as Ace Combat 8: Wings of Theve. Follows the game's Standard Xbox layout: pitch and roll on the left stick, yaw on the right stick, throttle forward on RT and back on LT. A starting point: press or move your own control for each part, then check every axis in the game.",
  kind: 'xbox360',
  sticks: {
    lx: { hint: 'Roll: the stick left and right', deadzone: 0.03 },
    // DirectInput reads a stick pulled back as positive; a gamepad stick pulled down is
    // negative. Inverted, pulling back is "stick down", which climbs with the game's
    // default (not inverted) setting.
    ly: { hint: 'Pitch: pull back to climb', invert: true, deadzone: 0.03 },
    rx: { hint: 'Yaw: rudder pedals or the stick twist', deadzone: 0.05 },
    ry: { hint: 'Camera up and down (a hat or a mini stick), if you want it', deadzone: 0.1 },
  },
  throttle: {
    hint: 'Throttle: forward accelerates (RT), back slows down (LT); put the split at your idle detent',
    split: 0.5,
    deadzone: 0.05,
  },
  buttons: {
    a: { hint: 'Fire the gun or missile, as set in the game' },
    b: { hint: 'Special weapon' },
    x: { hint: 'Change target' },
    y: { hint: 'Change view' },
    rs: { hint: 'Lock on (R3 in the Standard layout)' },
    ls: { hint: 'Evasive manoeuvres (L3 with the left stick)' },
    left: { hint: 'Change weapon' },
    right: { hint: 'Change weapon' },
    up: { hint: 'Zoom the reticle' },
    down: { hint: 'Zoom the reticle' },
    start: { hint: 'Pause and the menu' },
    back: { hint: 'Target information' },
  },
});

const hotas = PadProfileSchema.parse({
  id: 'starting-hotas',
  name: 'HOTAS to gamepad',
  description:
    'For any flight or space game that reads only a gamepad: stick on the left stick, rudder on the right stick, throttle split over the triggers, hat on the d-pad. A starting point: press or move your own control for each part.',
  kind: 'xbox360',
  sticks: {
    lx: { hint: 'Roll: the stick left and right', deadzone: 0.03 },
    ly: { hint: 'Pitch: pull back for "stick down"', invert: true, deadzone: 0.03 },
    rx: { hint: 'Yaw: rudder pedals or the stick twist', deadzone: 0.05 },
    ry: { hint: 'A mini stick or a second axis, if the game uses one', deadzone: 0.1 },
  },
  throttle: { hint: 'Throttle: forward on RT, back on LT', split: 0.5, deadzone: 0.05 },
  buttons: {
    a: { hint: 'Trigger' },
    b: { hint: 'Weapon release' },
    x: { hint: 'A thumb button' },
    y: { hint: 'A thumb button' },
    lb: { hint: 'A throttle button' },
    rb: { hint: 'A throttle button' },
    up: { hint: 'Hat up' },
    down: { hint: 'Hat down' },
    left: { hint: 'Hat left' },
    right: { hint: 'Hat right' },
    start: { hint: 'Menu' },
    back: { hint: 'Map or view' },
  },
});

const wheel = PadProfileSchema.parse({
  id: 'starting-wheel-pedals',
  name: 'Wheel and pedals to gamepad (driving games, console emulators)',
  description:
    'For driving games and console emulators that read only a gamepad: steering on the left stick, throttle on RT, brake on LT, shifter paddles on the bumpers or A and X. Set the range to the steering lock you want (a 900 degree wheel reaching full lock at 270 degrees is 0.3). A starting point: press or move your own control for each part.',
  kind: 'xbox360',
  sticks: {
    lx: { hint: 'Steering: the wheel; range sets the lock, curve the linearity', range: 0.3 },
    ly: { hint: 'Not used by most driving games' },
    rx: { hint: 'Clutch, if a game reads it here (optional)' },
    ry: { hint: 'Look around, if you want it' },
  },
  triggers: {
    rt: { hint: 'Throttle pedal', deadzone: 0.02 },
    lt: { hint: 'Brake pedal; a curve above 1 gives finer control at the top', deadzone: 0.02 },
  },
  buttons: {
    rb: { hint: 'Shift up (right paddle), or A in many older games' },
    lb: { hint: 'Shift down (left paddle), or X in many older games' },
    a: { hint: 'Accept, or shift up' },
    b: { hint: 'Back, or handbrake' },
    x: { hint: 'Shift down or change view' },
    y: { hint: 'Change view' },
    start: { hint: 'Pause and the menu' },
    back: { hint: 'Map or select' },
    up: { hint: 'D-pad up (a funky switch or a hat)' },
    down: { hint: 'D-pad down' },
    left: { hint: 'D-pad left' },
    right: { hint: 'D-pad right' },
  },
});

export const BUILTIN_PROFILES: readonly PadProfile[] = [flightStick, hotas, wheel];

export const isBuiltin = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);
