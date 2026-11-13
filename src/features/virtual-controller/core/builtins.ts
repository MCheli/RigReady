import { PadProfileSchema, type PadProfile } from './profile';

/**
 * Starting points: profiles that say what each part of the virtual controller is for,
 * from what players of these games use (docs/research/gamepad-emulation.md), without
 * naming any controller. A copy is made and the user presses or moves their own control
 * for each part. They are never started as they are: nothing in them is mapped yet.
 *
 * A plain hint fits any game. What a part does in one game goes in `gameHint`, and only
 * in a starting point that names that game in `game` and in its own name; the page shows
 * it as "In <game>: ...". "HOTAS to gamepad" and the wheel name no game.
 */

export const BUILTIN_PREFIX = 'starting-';

const aceCombat = PadProfileSchema.parse({
  id: 'starting-flight-stick-ace-combat',
  name: 'Flight stick to gamepad (Ace Combat 8)',
  game: 'Ace Combat 8',
  description:
    'For Ace Combat 8: Wings of Theve. Stick on the left stick, rudder on the right stick, throttle on RT, and a button of yours (the speed brake switch, say) on LT to slow down. RT and LT held together give the high-G turn. The notes for the game follow players\' guides, which do not agree on A, B, X and Y: check those on the game\'s controls screen. For any other game, start from "HOTAS to gamepad". A starting point: press or move your own control for each part.',
  kind: 'xbox360',
  sticks: {
    lx: {
      hint: 'Roll: the stick left and right',
      gameHint: 'Rolls with the Expert flight controls; with Standard it turns the aircraft',
      deadzone: 0.03,
    },
    // DirectInput reads a stick pulled back as positive; a gamepad stick pulled down is
    // negative. Inverted, pulling back is "stick down", which climbs with the game's
    // default (not inverted) setting.
    ly: { hint: 'Pitch: pull back to climb', invert: true, deadzone: 0.03 },
    rx: { hint: 'Yaw: rudder pedals or the stick twist', deadzone: 0.05 },
    ry: { hint: 'A hat or a mini stick, if you want this direction', deadzone: 0.1 },
  },
  // No split throttle here: one axis on both triggers can never hold both at once, and
  // this game needs both for its high-G turn. The throttle drives RT, a button drives LT.
  triggers: {
    rt: {
      hint: 'Throttle: forward presses it further',
      gameHint: 'Speeds up. Held together with LT: a high-G turn',
      deadzone: 0.05,
    },
    lt: {
      hint: 'A button, such as the speed brake switch',
      gameHint: 'Slows down. Held together with RT: a high-G turn',
    },
  },
  buttons: {
    a: { hint: 'Trigger' },
    b: { hint: 'Weapon release' },
    x: { hint: 'A thumb button' },
    y: { hint: 'A thumb button' },
    rs: { hint: 'A button under your thumb', gameHint: 'Lock on' },
    ls: { hint: 'A button under your thumb', gameHint: 'Evasive manoeuvres, with the stick' },
    left: { hint: 'Hat left', gameHint: 'Change weapon' },
    right: { hint: 'Hat right', gameHint: 'Change weapon' },
    up: { hint: 'Hat up', gameHint: 'Zoom the reticle' },
    down: { hint: 'Hat down', gameHint: 'Zoom the reticle' },
    start: { hint: 'Pause and the menu' },
    back: { hint: 'A button on the throttle or the base', gameHint: 'Target information' },
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

export const BUILTIN_PROFILES: readonly PadProfile[] = [aceCombat, hotas, wheel];

export const isBuiltin = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);

/** What a copy of each starting point is called until the user names it. */
const COPY_NAMES: Record<string, string> = {
  [aceCombat.id]: 'My Ace Combat 8 stick',
  [hotas.id]: 'My HOTAS',
  [wheel.id]: 'My wheel and pedals',
};

/**
 * The name a copy starts with. A copy of a starting point for one game keeps the game in
 * its name, so its row does not read as a profile for every game.
 */
export const copyName = (from: Pick<PadProfile, 'id' | 'name'>): string =>
  COPY_NAMES[from.id] ?? `Copy of ${from.name}`.slice(0, 80).trimEnd();
