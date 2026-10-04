/**
 * What kind of thing a device of a setup is, told from its name: enough to draw the right
 * picture beside it. General knowledge about sim hardware names; a name nobody recognises
 * is simply a device.
 */

export type DeviceKind =
  | 'stick'
  | 'throttle'
  | 'pedals'
  | 'wheel'
  | 'shifter'
  | 'tracker'
  | 'deck'
  | 'display'
  | 'panel'
  | 'headset'
  | 'keyboard'
  | 'mouse'
  | 'other';

/**
 * In order: the first that matches wins, so "Throttle Base" is a throttle and "Wheel Base"
 * a wheel before "Base" makes either a stick.
 */
const RULES: [DeviceKind, RegExp][] = [
  ['pedals', /\b(pedals?|rudder|tpr|t-?pendular|crosswind|slaw|mfg)\b/i],
  ['throttle', /\b(throttles?|collective|quadrant|twcs|taurus)\b/i],
  ['shifter', /\b(shifter|handbrake|h-?pattern|sequential)\b/i],
  ['wheel', /\b(wheel|podium|clubsport|csl|steering|direct drive|dd[12]|simucube|moza)\b/i],
  ['tracker', /\b(track ?ir|tobii|head ?track\w*|eye ?track\w*|smoothtrack)\b/i],
  ['deck', /\b(stream ?deck|loupedeck)\b/i],
  ['headset', /\b(headset|headphones?|quest|reverb|pimax|vr)\b/i],
  ['display', /\b(mfd|ufc|hud|icp|ded|pfd|eicas)\d*\b|\b(display|screen)\b/i],
  ['panel', /\b(panel|button ?box|switch ?box|control ?box|console)\b/i],
  ['keyboard', /\bkeyboard\b/i],
  ['mouse', /\b(mouse|trackball)\b/i],
  [
    'stick',
    /\b(joystick|stick|grip|jgrip|gunfighter|gladiator|warbrd|alpha|orion|ursa|hotas|t\.?16000m?|base)\b/i,
  ],
];

export function deviceKind(name: string): DeviceKind {
  for (const [kind, pattern] of RULES) if (pattern.test(name)) return kind;
  return 'other';
}

/** The picture for each kind, from the bundled Material Design set. */
export const KIND_ICON: Record<DeviceKind, string> = {
  stick: 'mdi-controller',
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

/** The word for each kind, for a tooltip and a screen reader. */
export const KIND_NAME: Record<DeviceKind, string> = {
  stick: 'Stick',
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
 * Names short enough for a row of chips: the word most of the devices begin with (their
 * maker: "WINWING MFD1-L", "WINWING UFC1 + HUD1") is left out, since it tells them apart
 * from nothing. Only when more than half of them share it, and only when the short names
 * still tell every device apart; a name that would be left with next to nothing keeps the
 * word. The whole name stays in the tooltip.
 */
export function chipNames(names: string[]): string[] {
  const whole = names.map((name) => name.trim());
  const first = (name: string): string => name.split(/\s+/)[0] ?? '';
  const counts = new Map<string, number>();
  for (const name of whole) {
    const word = first(name).toLowerCase();
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const [make, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  // A word, not a number, that more than half of the devices begin with.
  if (count < 2 || count * 2 <= whole.length || !/^[a-z][\w-]*$/.test(make)) return whole;
  const short = whole.map((name) => {
    const word = first(name);
    const rest = name.slice(word.length).trim();
    return word.toLowerCase() === make && rest.length >= 3 ? rest : name;
  });
  const distinct = new Set(short.map((name) => name.toLowerCase())).size;
  return distinct === new Set(whole.map((name) => name.toLowerCase())).size ? short : whole;
}
