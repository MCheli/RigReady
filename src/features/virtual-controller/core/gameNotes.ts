import { BUTTON_NAMES, STICK_NAMES, type ButtonName, type PadProfile } from './profile';

/**
 * Notes for one game. A part's plain hint says which control of the user's belongs on it
 * ("Roll: the stick left and right") and fits any game. What the part does in one game
 * ("Lock on") is a game note: it is kept in `gameHint`, the game is named once in the
 * profile's `game`, and the page shows it as "In Ace Combat 8: Lock on". A copy used for
 * another game drops the notes in one press and keeps everything else.
 */

/** "In Ace Combat 8: Lock on". */
export const gameNoteText = (profile: Pick<PadProfile, 'game'>, note: string): string =>
  `In ${profile.game ?? 'the game'}: ${note}`;

/** How many parts carry a note for the profile's game. */
export function gameNoteCount(profile: PadProfile): number {
  const parts = [
    ...STICK_NAMES.map((n) => profile.sticks[n]),
    profile.triggers.lt,
    profile.triggers.rt,
    profile.throttle,
    ...BUTTON_NAMES.map((n) => profile.buttons[n]),
  ];
  return parts.filter((p) => p?.gameHint !== undefined).length;
}

/** The profile with no game named and no game note; mapping, shaping and plain hints stay. */
export function withoutGameNotes(profile: PadProfile): PadProfile {
  // A plain copy: the page hands in a profile it is editing.
  const out = JSON.parse(JSON.stringify(profile)) as PadProfile;
  delete out.game;
  for (const name of STICK_NAMES) delete out.sticks[name].gameHint;
  delete out.triggers.lt.gameHint;
  delete out.triggers.rt.gameHint;
  if (out.throttle) delete out.throttle.gameHint;
  for (const name of BUTTON_NAMES) {
    const button = out.buttons[name];
    if (button) delete button.gameHint;
  }
  return out;
}

/**
 * The button hints the Ace Combat 8 starting point carried until November 2026, when a
 * hint said what a button did in that one game and nothing on the page said which game.
 */
const EARLIER_ACE_COMBAT: Partial<Record<ButtonName, string>> = {
  a: 'Fire the gun or missile, as set in the game',
  b: 'Special weapon',
  x: 'Change target',
  y: 'Change view',
  rs: 'Lock on (R3 in the Standard layout)',
  ls: 'Evasive manoeuvres (L3 with the left stick)',
  left: 'Change weapon',
  right: 'Change weapon',
  up: 'Zoom the reticle',
  down: 'Zoom the reticle',
  back: 'Target information',
};

/**
 * A copy made from that earlier starting point: its button hints become notes for
 * Ace Combat 8, so the page says which game they are about and they can be dropped. Told
 * by three or more of those hints, word for word; any other profile is returned as it is.
 */
export function separateGameNotes(profile: PadProfile): PadProfile {
  if (profile.game !== undefined) return profile;
  const earlier = BUTTON_NAMES.filter(
    (name) =>
      EARLIER_ACE_COMBAT[name] !== undefined &&
      profile.buttons[name]?.hint === EARLIER_ACE_COMBAT[name]
  );
  if (earlier.length < 3) return profile;
  const buttons = { ...profile.buttons };
  for (const name of earlier) {
    const source = buttons[name]?.source;
    buttons[name] = { ...(source ? { source } : {}), gameHint: EARLIER_ACE_COMBAT[name]! };
  }
  return { ...profile, game: 'Ace Combat 8', buttons };
}
