import { findMonitor } from '../../../core/displays/identity';
import type { DisplayInfo } from '../../../shared/models';
import type { At, StoredMonitor, StoredPlace } from './settings';

/**
 * Where a widget is shown: the screen the user put it on, found again by what the monitor
 * is (not by Windows' numbering, which changes with every layout), and the place on it.
 * When that screen is off or unplugged ("Desk" instead of "Flying"), the main screen stands
 * in at the same place, the stored place is kept, and the page says so; the widget is back
 * on its own screen as soon as that is on again.
 */

/** A screen the overlay can be shown on, for the page. */
export interface OverlayScreen {
  id: string;
  name: string;
  primary: boolean;
  width: number;
  height: number;
}

export interface ResolvedPlace {
  /** The screen it is shown on: on, with a size. */
  display: DisplayInfo;
  at: At;
  /** The stored screen itself (true), or the main screen (false). */
  own: boolean;
  /** The stored screen's name, when it is not on and the main screen stands in. */
  away?: string;
}

/** A monitor that is on and has a size to draw on. */
const usable = (display: DisplayInfo): boolean =>
  display.enabled && display.width > 0 && display.height > 0;

/** The main screen: Windows' primary one, or the first that is on. */
export function mainScreen(displays: readonly DisplayInfo[]): DisplayInfo | undefined {
  const on = displays.filter(usable);
  return on.find((d) => d.primary) ?? on[0];
}

/**
 * A name per monitor id (lower case): the owner's, or the monitor's own, numbered when
 * several share it.
 */
export function screenNames(
  displays: readonly DisplayInfo[],
  given: Record<string, string> = {}
): Map<string, string> {
  const totals = new Map<string, number>();
  for (const d of displays) totals.set(d.name, (totals.get(d.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const d of displays) {
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    const total = totals.get(d.name) ?? 1;
    const own = d.name.trim() || 'Screen';
    names.set(
      d.id.toLowerCase(),
      given[d.id.toLowerCase()]?.trim() || (total > 1 ? `${own} (${n} of ${total})` : own)
    );
  }
  return names;
}

/** The screens that are on, the main one first, then left to right. */
export function overlayScreens(
  displays: readonly DisplayInfo[],
  given: Record<string, string> = {}
): OverlayScreen[] {
  const names = screenNames(displays, given);
  return displays
    .filter(usable)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || a.x - b.x || a.y - b.y)
    .map((d) => ({
      id: d.id,
      name: names.get(d.id.toLowerCase()) ?? 'Screen',
      primary: d.primary,
      width: d.width,
      height: d.height,
    }));
}

/** What is kept of a monitor to find it again. */
export function storedMonitor(display: DisplayInfo, name: string): StoredMonitor {
  return {
    id: display.id,
    ...(display.serial ? { serial: display.serial } : {}),
    ...(display.usbSerial ? { usbSerial: display.usbSerial } : {}),
    name,
  };
}

/**
 * Where to show a widget now. Undefined when no screen is on (a PC run without a monitor):
 * there is nothing to show it on.
 */
export function resolvePlace(
  stored: StoredPlace | undefined,
  defaultAt: At,
  displays: readonly DisplayInfo[]
): ResolvedPlace | undefined {
  const main = mainScreen(displays);
  if (!main) return undefined;
  const at = stored?.at ?? defaultAt;
  if (!stored?.monitor) return { display: main, at, own: true };
  // Among every connected monitor, on or off: one that is connected but off is still
  // that monitor, and must not be mistaken for another of its model.
  const found = findMonitor(stored.monitor, [], [...displays]);
  if (found && usable(found)) return { display: found, at, own: true };
  const names = screenNames(displays);
  const name =
    stored.monitor.name.trim() ||
    (found ? names.get(found.id.toLowerCase()) : undefined) ||
    'the screen it was on';
  return { display: main, at, own: false, away: name };
}

/**
 * What tells one showing of a panel from another: when this is the same as last time,
 * the panel is where it should be and is left alone.
 */
export function placeSignature(
  place: ResolvedPlace,
  size: { width: number; height: number },
  movable: boolean
): string {
  const d = place.display;
  return [
    d.id,
    d.x,
    d.y,
    d.width,
    d.height,
    place.at.x,
    place.at.y,
    size.width,
    size.height,
    movable ? 'move' : 'lock',
  ].join('|');
}
