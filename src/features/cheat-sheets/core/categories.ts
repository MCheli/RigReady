/**
 * What kind of thing an action is, for colour-coding: a small fixed set of kinds that
 * mean the same in every aircraft, decided from the game's own category path and the
 * action's name. The colours are never green, yellow or red: those mean status in RigReady.
 */

export const CATEGORY_IDS = [
  'flight',
  'engine',
  'weapons',
  'sensors',
  'countermeasures',
  'comms',
  'displays',
  'airframe',
  'systems',
  'view',
  'other',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  /** On a dark screen and on white paper. */
  color: string;
  /** In the night kneeboard style: dim, warm, no blue. */
  night: string;
}

export const CATEGORIES: Record<CategoryId, CategoryInfo> = {
  flight: { id: 'flight', label: 'Flight controls', color: '#4f8fe6', night: '#b8442e' },
  engine: { id: 'engine', label: 'Engines & fuel', color: '#ee8a3a', night: '#c4622a' },
  weapons: { id: 'weapons', label: 'Weapons', color: '#e2559b', night: '#e0352f' },
  sensors: { id: 'sensors', label: 'Sensors & targeting', color: '#9a7bf0', night: '#93302a' },
  countermeasures: {
    id: 'countermeasures',
    label: 'Countermeasures',
    color: '#cf5ad6',
    night: '#d2503a',
  },
  comms: { id: 'comms', label: 'Radio & comms', color: '#b98a5e', night: '#a8703a' },
  displays: { id: 'displays', label: 'Displays & UFC', color: '#31b4d6', night: '#7a2a24' },
  airframe: { id: 'airframe', label: 'Gear, flaps & airframe', color: '#8aa83a', night: '#a85a2a' },
  systems: { id: 'systems', label: 'Aircraft systems', color: '#7a8ea6', night: '#6a2a26' },
  view: { id: 'view', label: 'View', color: '#aab2bd', night: '#5a2420' },
  other: { id: 'other', label: 'Other', color: '#5f6b7a', night: '#4a201c' },
};

/** First match wins; the order settles names that fit two kinds ("Throttle Designator"). */
const RULES: [CategoryId, RegExp][] = [
  ['view', /\b(view|zoom|kneeboard|camera|head ?track|snap ?view|cockpit panel visibility)/],
  [
    'countermeasures',
    /\b(chaff|flare|dispens\w*|ecm|jammer|alq[- ]?\d*|alr[- ]?\d*|countermeasures?|rwr)\b/,
  ],
  [
    'sensors',
    /\b(radar|sensor|tdc|designator|undesignate|flir|tgp|targeting|antenna|raid|nvg|goggles|hmd|lst|ltd|laser|lock|tms|dms)\b/,
  ],
  [
    'weapons',
    /\b(weapons?|gun|guns|trigger|missile|bomb|rockets?|master arm|master mode|jettison|amraam|sidewinder|sparrow|pickle|release|cage|uncage|station|armament|fire rockets|pylon)\b/,
  ],
  ['comms', /\b(comm|comms|radio|ptt|mic|microphone|intercom|ics|salute|vhf|uhf|volume)\b/],
  [
    'displays',
    /\b(mdi|ddi|ampcd|mfd|mfcd|ufc|hud|pb \d+|osb ?\d*|display|brightness|contrast|symbology|icp|ded)\b/,
  ],
  [
    'flight',
    /\b(trim|trimmer|pitch|roll|rudder|yaw|autopilot|a\/p|atc|cyclic|pedals?|flight control|fcs|paddle|force trim)\b/,
  ],
  [
    'engine',
    /\b(throttle|thrust|engines?|apu|fuel|crank|afterburner|collective|governor|starter|probe|tanks?|bleed|rpm|idle)\b/,
  ],
  [
    'airframe',
    /\b(gear|brakes?|hook|wing fold|launch bar|nose ?wheel|anti[- ]?skid|flaps?|speed ?brake|canopy|eject\w*|seat|doors?|landing)\b/,
  ],
];

/** The kind of an action, from the game's category path (outermost first) and its name. */
export function categorize(action: string, category: readonly string[] = []): CategoryId {
  const name = action.toLowerCase();
  for (const [id, pattern] of RULES) if (pattern.test(name)) return id;
  const path = category.join(' ').toLowerCase();
  for (const [id, pattern] of RULES) if (pattern.test(path)) return id;
  return category.length > 0 ? 'systems' : 'other';
}

const FILLER = /\s+(Pushbutton|Push Button|Switch|Button|Control|Controller|Selector|Handle)\b/gi;

/**
 * A shorter way to say an action on a small label: "FLAP Switch - AUTO" becomes
 * "FLAP: AUTO". The full name is always available beside the picture.
 */
export function shortAction(action: string): string {
  const dash = action.indexOf(' - ');
  const head = dash >= 0 ? action.slice(0, dash) : action;
  const tail = dash >= 0 ? action.slice(dash + 3) : '';
  let short = head
    .replace(FILLER, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Never shorten a name down to nothing or to one unclear word.
  if (short.length < 3) short = head.trim();
  return tail ? `${short}: ${tail.trim()}` : short;
}
