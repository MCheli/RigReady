import type { BoundAircraft } from '../../../core/bindings';

/**
 * Which aircraft or car the labels are for. A game keeps one set of bindings per aircraft,
 * and nothing tells RigReady which one is being flown right now, so it goes by what it does
 * know, best first:
 *
 * 1. the one the user chose on the Overlay page for the setup in use (`chosen`);
 * 2. one the setup itself names: a check of the setup is about that aircraft (`setup`);
 * 3. the only one the game has bindings for (`only`);
 * 4. one the setup is called after: "DCS F/A-18C" is the F/A-18C (`setup`);
 * 5. otherwise the first with bindings of the user's own, which is a guess, and the page
 *    says so and asks (`guess`).
 */

export type PickedHow = 'chosen' | 'setup' | 'only' | 'guess';

export interface AircraftPick {
  aircraft: BoundAircraft;
  how: PickedHow;
}

/** Letters and digits only, lower case: "F/A-18C" and "fa-18c" are the same word. */
const plain = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Shorter than this, a word says too little ("f5" is in many names). */
const SHORTEST = 3;

/**
 * How much of a setup's name speaks for an aircraft: the length of the longest of the
 * aircraft's own words (its name, its id, a part of its id) found in the name. 0: none.
 */
function spokenFor(setupName: string, aircraft: BoundAircraft): number {
  const name = plain(setupName);
  const words = [aircraft.name, aircraft.id, ...aircraft.id.split(/[^A-Za-z0-9]+/)].map(plain);
  let most = 0;
  for (const word of words) {
    if (word.length >= SHORTEST && name.includes(word)) most = Math.max(most, word.length);
  }
  return most;
}

export function pickAircraft(input: {
  /** What the game has bindings for, in the game's order (the user's own first). */
  aircraft: readonly BoundAircraft[];
  /** The id the user chose for this setup, when one was chosen. */
  chosen?: string | undefined;
  /** The ids the setup's own checks name, in their order. */
  named?: readonly string[];
  setupName?: string | undefined;
}): AircraftPick | undefined {
  const { aircraft } = input;
  if (aircraft.length === 0) return undefined;
  const byId = (id: string): BoundAircraft | undefined =>
    aircraft.find((a) => a.id === id) ??
    aircraft.find((a) => a.id.toLowerCase() === id.toLowerCase());

  const chosen = input.chosen ? byId(input.chosen) : undefined;
  if (chosen) return { aircraft: chosen, how: 'chosen' };

  for (const id of input.named ?? []) {
    const named = byId(id);
    if (named) return { aircraft: named, how: 'setup' };
  }

  const general = aircraft.find((a) => a.general);
  if (aircraft.length === 1 || general) return { aircraft: general ?? aircraft[0]!, how: 'only' };

  if (input.setupName) {
    let best: BoundAircraft | undefined;
    let most = 0;
    for (const candidate of aircraft) {
      const spoken = spokenFor(input.setupName, candidate);
      // The first of equals: the game lists the user's own first.
      if (spoken > most) {
        most = spoken;
        best = candidate;
      }
    }
    if (best) return { aircraft: best, how: 'setup' };
  }

  return { aircraft: aircraft.find((a) => a.hasUserBindings) ?? aircraft[0]!, how: 'guess' };
}

/**
 * The aircraft a setup's checks are about: every check that says `aircraft` in its
 * parameters (bindings match the devices, the kneeboard pages are written), in the order
 * of the checks, each id once. A check that is switched off still says what the setup is for.
 */
export function aircraftNamedBy(
  checks: readonly { params?: Record<string, unknown> | undefined }[]
): string[] {
  const ids: string[] = [];
  for (const check of checks) {
    const id = check.params?.['aircraft'];
    if (typeof id === 'string' && id !== '' && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
