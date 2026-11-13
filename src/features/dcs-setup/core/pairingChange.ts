import { displayLabel, moveCrop, type Crop, type Placement, type ScreenSetup } from './screens';
import type { PlanScreen } from './simAppProImport';

/**
 * What happens to SimAppPro's screen plan after it was imported: the user works on the
 * setup (a crop here, a display moved there), and may then say that one of SimAppPro's
 * screens is another monitor than RigReady took it for, or apply the setup. Both must
 * respect what the user did in between.
 */

const sameCrop = (a: Crop, b: Crop): boolean =>
  a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/**
 * Carries a corrected pairing into the setup the user is working on, and keeps what the
 * user changed since the import.
 *
 * `before` is what the import made the last time, `after` what it makes with the corrected
 * pairing, `current` the setup on the page. For each thing the plan places:
 *
 * - the correction does not move it: it stays exactly as the user has it;
 * - the correction moves it and it is still on the monitor the import put it on: it goes
 *   to the newly paired monitor (or away, when the screen is now left out), and a crop the
 *   user set goes with it when the two monitors are the same size;
 * - the user moved it, removed it or placed it by hand since: the user's choice stays.
 *
 * Aircraft and displays the user added are not touched. `notes` says, in the user's words,
 * where a crop could not be kept.
 */
export function carryPairing(
  before: ScreenSetup,
  after: ScreenSetup,
  current: ScreenSetup
): { setup: ScreenSetup; notes: string[] } {
  const notes: string[] = [];
  const size = new Map(
    [...current.desktop, ...after.desktop].map((d) => [d.id, { width: d.width, height: d.height }])
  );

  // The main view: only the monitors the correction itself adds or takes away change.
  const mainNow = new Set(current.mainDisplayIds);
  for (const id of before.mainDisplayIds) {
    if (!after.mainDisplayIds.includes(id)) mainNow.delete(id);
  }
  for (const id of after.mainDisplayIds) {
    if (!before.mainDisplayIds.includes(id)) mainNow.add(id);
  }
  const mainDisplayIds = mainNow.size > 0 ? [...mainNow] : [...after.mainDisplayIds];

  const aircraft = current.aircraft.map((a) => ({ ...a, placements: [...a.placements] }));
  const units = new Set([...before.aircraft, ...after.aircraft].map((a) => a.unit));
  for (const unit of units) {
    const was = before.aircraft.find((a) => a.unit === unit);
    const now = after.aircraft.find((a) => a.unit === unit);
    let mine = aircraft.find((a) => a.unit === unit);
    if (!mine) {
      // An aircraft the import had and the page no longer has was removed by the user.
      if (was || !now) continue;
      mine = { unit: now.unit, label: now.label, placements: [] };
      aircraft.push(mine);
    }
    const names = new Set(
      [...(was?.placements ?? []), ...(now?.placements ?? [])].map((p) => p.name)
    );
    for (const name of names) {
      const b = was?.placements.find((p) => p.name === name);
      const a = now?.placements.find((p) => p.name === name);
      if (b?.displayId === a?.displayId) continue;
      const c = mine.placements.find((p) => p.name === name);
      if (c?.displayId !== b?.displayId) continue;
      mine.placements = mine.placements.filter((p) => p.name !== name);
      if (!a) continue;
      let next: Placement = { ...a, crop: { ...a.crop } };
      if (c && b && !sameCrop(c.crop, b.crop)) {
        // The user's own crop: it fits the new monitor only when that is the same size.
        const moved = moveCrop(size.get(c.displayId), size.get(a.displayId)!, c.crop);
        next = { ...a, crop: moved.crop };
        if (!moved.kept) {
          notes.push(
            `${displayLabel(unit, name)}: the crop you set was not kept, because the screen it is on now is another size. Set it again.`
          );
        }
      }
      mine.placements.push(next);
    }
  }
  return {
    setup: {
      mainDisplayIds,
      aircraft,
      desktop: after.desktop,
      desktopLabel: after.desktopLabel,
    },
    notes,
  };
}

/** A key for one thing a setup puts on a monitor. The separator cannot be in a unit or a display name. */
const mainKey = (displayId: string): string => `main\n${displayId}`;
const placementKey = (unit: string, name: string, displayId: string): string =>
  `${unit}\n${name}\n${displayId}`;

/** Everything a setup puts on a monitor, as keys. */
function placed(setup: ScreenSetup): Set<string> {
  const keys = new Set(setup.mainDisplayIds.map(mainKey));
  for (const aircraft of setup.aircraft) {
    for (const p of aircraft.placements) keys.add(placementKey(aircraft.unit, p.name, p.displayId));
  }
  return keys;
}

/**
 * What an import put on monitors it was not sure of: the placements somebody has to look
 * at before they are used. When one of SimAppPro's screens found no monitor at all, any
 * other pairing may be the one that took its place, so everything the import placed counts.
 */
export function uncertainPlacements(setup: ScreenSetup, screens: PlanScreen[]): string[] {
  const unsure = screens.filter((screen) => !screen.certain);
  if (unsure.length === 0) return [];
  if (unsure.some((screen) => !screen.displayId)) return [...placed(setup)];
  const monitors = new Set(unsure.map((screen) => screen.displayId!));
  const keys = setup.mainDisplayIds
    .filter((id) => unsure.some((s) => s.main && s.displayId === id))
    .map(mainKey);
  for (const aircraft of setup.aircraft) {
    for (const p of aircraft.placements) {
      if (monitors.has(p.displayId)) keys.push(placementKey(aircraft.unit, p.name, p.displayId));
    }
  }
  return keys;
}

/**
 * True when a setup still uses something an unchecked import put on a monitor it was not
 * sure of (`pending`, from uncertainPlacements), other than what the setup in use already
 * has. What is in use was applied by the user before, so it is not asked about again.
 */
export function usesUnchecked(
  pending: string[],
  setup: ScreenSetup,
  inUse: ScreenSetup | undefined
): boolean {
  const wanted = placed(setup);
  const have = inUse ? placed(inUse) : new Set<string>();
  return pending.some((key) => wanted.has(key) && !have.has(key));
}

/** The pairings of an import that are not certain, said in one line for a refusal. */
export function describeUnsure(screens: PlanScreen[], monitorName: (id: string) => string): string {
  return screens
    .filter((screen) => !screen.certain)
    .map((screen) => {
      const what = screen.shows.join(', ') || `SimAppPro's screen ${screen.planId}`;
      return screen.displayId
        ? `${what} on ${monitorName(screen.displayId)}`
        : `${what} on no screen`;
    })
    .join('; ');
}
