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
  'driving',
  'car',
  'pit',
  'view',
  'other',
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

/** How a kind's marker is drawn where colour alone is not enough (the night style). */
export type CategoryPattern = 'solid' | 'dashed';

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  /** On a dark screen and on white paper. */
  color: string;
  /** In the night kneeboard style: warm only (red to amber), nothing blue or white. */
  night: string;
  /** In the night style the marker is a solid or a dashed bar, so two kinds never look alike. */
  nightPattern: CategoryPattern;
}

/**
 * The night style has only the warm end of the spectrum to work with, which is too narrow
 * for fourteen hues. So it uses four hues (red, orange, amber, salmon) in a bright and a
 * dim step, and a second cue: the marker is a solid or a dashed bar. Any two kinds differ
 * in the bar or clearly in colour (layout.test.ts measures the difference).
 */
const NIGHT = {
  red: '#ff3b30',
  dimRed: '#8a1c17',
  orange: '#ff8419',
  dimOrange: '#9a4a0c',
  amber: '#e6aa00',
  dimAmber: '#8a6a0a',
  salmon: '#f29a8a',
  maroon: '#571511',
} as const;

const kind = (
  id: CategoryId,
  label: string,
  color: string,
  night: string,
  nightPattern: CategoryPattern = 'solid'
): CategoryInfo => ({ id, label, color, night, nightPattern });

export const CATEGORIES: Record<CategoryId, CategoryInfo> = {
  flight: kind('flight', 'Flight controls', '#4f8fe6', NIGHT.red),
  engine: kind('engine', 'Engines & fuel', '#ee8a3a', NIGHT.orange),
  weapons: kind('weapons', 'Weapons', '#e2559b', NIGHT.amber),
  sensors: kind('sensors', 'Sensors & targeting', '#9a7bf0', NIGHT.salmon),
  countermeasures: kind('countermeasures', 'Countermeasures', '#cf5ad6', NIGHT.dimRed),
  comms: kind('comms', 'Radio & comms', '#b98a5e', NIGHT.dimOrange),
  displays: kind('displays', 'Displays & UFC', '#31b4d6', NIGHT.dimAmber),
  airframe: kind('airframe', 'Gear, flaps & airframe', '#8aa83a', NIGHT.red, 'dashed'),
  systems: kind('systems', 'Aircraft systems', '#7a8ea6', NIGHT.orange, 'dashed'),
  driving: kind('driving', 'Driving', '#4a90e2', NIGHT.amber, 'dashed'),
  car: kind('car', 'Car adjustments', '#f08c42', NIGHT.salmon, 'dashed'),
  pit: kind('pit', 'Pit & session', '#9d7cf2', NIGHT.dimRed, 'dashed'),
  view: kind('view', 'View', '#aab2bd', NIGHT.dimOrange, 'dashed'),
  other: kind('other', 'Other', '#5f6b7a', NIGHT.maroon),
};

/**
 * A game whose reader already says what kind an action is (its outermost category is the
 * name of a kind: "Driving", "Pit & session", "View") is taken at its word.
 */
const NAMED: Record<string, CategoryId> = {
  ...Object.fromEntries(CATEGORY_IDS.map((id) => [CATEGORIES[id].label.toLowerCase(), id])),
  'radio & chat': 'comms',
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
  const named = NAMED[(category[0] ?? '').trim().toLowerCase()];
  if (named) return named;
  const name = action.toLowerCase();
  for (const [id, pattern] of RULES) if (pattern.test(name)) return id;
  const path = category.join(' ').toLowerCase();
  for (const [id, pattern] of RULES) if (pattern.test(path)) return id;
  return category.length > 0 ? 'systems' : 'other';
}

/**
 * The game's category path, to show beside the kind. A reader that gives the kind itself
 * as the category ("Driving", "Pit & session") has said it already: nothing is repeated.
 */
export function categoryTrail(category: readonly string[]): string {
  const named = NAMED[(category[0] ?? '').trim().toLowerCase()] !== undefined;
  return (named ? category.slice(1) : category).join(' › ');
}

/** Words that only say what kind of control it is, which the picture already shows. */
const FILLER =
  /\s+(Pushbutton|Push Button|Switch|Button|Control|Controller|Selector|Handle|Knob)\b/gi;

/**
 * A shorter way to say an action on a small label: "FLAP Switch - AUTO" becomes
 * "FLAP: AUTO", "HUD Symbology Brightness Selector Knob - NIGHT" becomes "HUD Symbology
 * Brightness: NIGHT". The full name is always available beside the picture.
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
