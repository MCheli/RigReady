import type { GameKind } from '../shared/models';

/**
 * What kind of thing a piece of a rig is, told from its name: enough to draw the right
 * picture beside it, and to say what a game is played with. General knowledge about sim
 * hardware names; a name nobody recognises is simply a device.
 *
 * The rules here are a first guess. The user can say what a device is on the Devices page,
 * and their answer wins wherever a kind is read: ask for it through the names port
 * (`ctx.names.devices()`, then `whatIs`; see core/names) before falling back on
 * `deviceKind(name)`.
 */

/** Every kind, in the order a list offers them. 'other' is a device of no kind here. */
export const DEVICE_KINDS = [
  'stick',
  'yoke',
  'throttle',
  'pedals',
  'wheel',
  'shifter',
  'tracker',
  'deck',
  'display',
  'panel',
  'headset',
  'keyboard',
  'mouse',
  'other',
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** The picture for each kind, from the bundled Material Design set. */
export const KIND_ICON: Record<DeviceKind, string> = {
  stick: 'mdi-controller',
  yoke: 'mdi-airplane',
  throttle: 'mdi-tune-vertical',
  pedals: 'mdi-shoe-print',
  wheel: 'mdi-steering',
  shifter: 'mdi-car-shift-pattern',
  tracker: 'mdi-webcam',
  deck: 'mdi-view-grid',
  display: 'mdi-monitor-dashboard',
  panel: 'mdi-toggle-switch-outline',
  headset: 'mdi-headset',
  keyboard: 'mdi-keyboard-outline',
  mouse: 'mdi-mouse',
  other: 'mdi-usb',
};

/** The word for each kind, for a list, a tooltip and a screen reader. */
export const KIND_NAME: Record<DeviceKind, string> = {
  stick: 'Stick',
  yoke: 'Yoke',
  throttle: 'Throttle',
  pedals: 'Pedals',
  wheel: 'Wheel',
  shifter: 'Shifter',
  tracker: 'Head tracker',
  deck: 'Button deck',
  display: 'Display unit',
  panel: 'Panel',
  headset: 'Headset',
  keyboard: 'Keyboard',
  mouse: 'Mouse',
  other: 'Device',
};

/**
 * What a device can be said to be used for: the family of sims it is gear for. "Both" is
 * an answer too: a button box or a headset is used in either.
 */
export const DEVICE_USES = ['flight', 'racing', 'both'] as const satisfies readonly (
  GameKind | 'both'
)[];
export type DeviceUse = (typeof DEVICE_USES)[number];

/**
 * In order: the first that matches wins, so "Throttle Base" is a throttle and "Wheel Base"
 * a wheel before "Base" makes either a stick. A few names come before the general rules
 * because a later word would mislead: Moza's AB9 is a flight base although Moza makes
 * wheels, and the MTLP panel's name is cut to "Landing Pane" by DirectInput.
 */
const RULES: [DeviceKind, RegExp][] = [
  ['stick', /\b(moza ab\d|mh16|sidestick|t\.?a320 (co)?pilot)\b/i],
  ['panel', /\bmtlp\b/i],
  ['pedals', /\b(pedals?|rudder|tpr|t-?pendular|crosswind|slaw|mfg|t-?lcm|t3pa)\b/i],
  ['throttle', /\b(throttles?|collective|quadrant|twcs|taurus|stecs|q-?eng)\b/i],
  ['shifter', /\b(shifter|handbrake|h-?pattern|sequential|gear ?shift)\b/i],
  ['yoke', /\b(yoke|alpha flight controls|velocity ?one flight)\b/i],
  [
    'wheel',
    /\b(wheel|podium|clubsport|csl|steering|direct ?drive|dd[12]|simucube|moza|simagic|cammus|invicta|forte|la prima|velocity ?one race|t\d{3}(rs|gt|x)?|t-?gt|ts-?(pc|xw)|tmx|g(25|27|29|920|923)|driving force)\b/i,
  ],
  ['tracker', /\b(track ?ir|tobii|opentrack|head ?track\w*|eye ?track\w*|smoothtrack)\b/i],
  ['deck', /\b(stream ?deck|loupedeck)\b/i],
  ['headset', /\b(headset|headphones?|quest|reverb|pimax|vr)\b/i],
  ['display', /\b(mfd|ufc|hud|icp|ded|pfd|eicas)\d*\b|\b(display|screen)\b/i],
  ['panel', /\b(panel|button ?box|switch ?box|control ?box|console)\b/i],
  ['keyboard', /\bkeyboard\b/i],
  ['mouse', /\b(mouse|trackball)\b/i],
  [
    'stick',
    /\b(joystick|stick|flightstick|fighterstick|combatstick|grip|jgrip|gunfighter|gladiator|warbrd|mongoos\w*|alpha|orion|ursa|hotas|t\.?16000m?|base)\b/i,
  ],
];

export function deviceKind(name: string): DeviceKind {
  for (const [kind, pattern] of RULES) if (pattern.test(name)) return kind;
  return 'other';
}

/** The kinds of sim gear a game can be played with. A head tracker and a button deck count. */
export const GEAR_KINDS = [
  'stick',
  'yoke',
  'throttle',
  'pedals',
  'wheel',
  'shifter',
  'tracker',
  'deck',
  'display',
  'panel',
  'headset',
] as const satisfies readonly DeviceKind[];
export type GearKind = (typeof GEAR_KINDS)[number];

/**
 * What a game is played with, said by its game module. A new setup for the game starts
 * from this: what the game plausibly needs comes ticked, and everything else found on the
 * rig is offered and left for the user to tick. Every part is optional; what a module
 * leaves out is what a game of its kind (flight, racing) usually uses.
 */
export interface GamePlayedWith {
  /**
   * The kinds of gear the game reads. Gear of another kind is not kept by default, and
   * nor is the software that runs it (a head tracker's program for a game that reads no
   * head tracker).
   */
  gear?: GearKind[];
  /**
   * False when the game is played without helper programs (panel software, voice
   * commands, telemetry tools): none is kept by default, however many are running.
   */
  helpers?: boolean;
  /** False when the game has no voice chat or radio: the microphone is not kept by default. */
  microphone?: boolean;
  /**
   * True when the game reads a gamepad and not sim gear: a new setup offers the step that
   * starts a virtual controller, fed from the gear named in `gear`.
   */
  gamepad?: boolean;
}

/** `GamePlayedWith` with nothing left out. Without `gear`, any gear of the family is kept. */
export interface PlayedWith {
  gear?: GearKind[];
  helpers: boolean;
  microphone: boolean;
  gamepad: boolean;
}

/**
 * What a sim of each kind usually reads. A head tracker is flight gear: racing sims that
 * support one are driven without it far more often than with, so there it is the user's
 * call. Displays and panels are in both: MFDs and switch panels, dashes and button boxes.
 */
const GEAR_BY_KIND: Record<GameKind, GearKind[]> = {
  flight: ['stick', 'yoke', 'throttle', 'pedals', 'panel', 'display', 'tracker', 'deck', 'headset'],
  racing: ['wheel', 'pedals', 'shifter', 'panel', 'display', 'deck', 'headset'],
};

/**
 * What a game is played with: what its module says, and for what it leaves out, what a
 * game of its kind usually uses. With no game and no kind nothing is known, so nothing is
 * ruled out.
 */
export function playedWith(
  game: { kind?: GameKind | undefined; playedWith?: GamePlayedWith | undefined } | undefined,
  family?: GameKind
): PlayedWith {
  const said = game?.playedWith;
  const kind = game?.kind ?? family;
  const gear = said?.gear ?? (kind ? GEAR_BY_KIND[kind] : undefined);
  return {
    ...(gear ? { gear: [...gear] } : {}),
    helpers: said?.helpers ?? true,
    microphone: said?.microphone ?? true,
    gamepad: said?.gamepad ?? false,
  };
}
