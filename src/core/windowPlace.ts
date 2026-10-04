import { z } from 'zod';

/**
 * Where the user left one of RigReady's small extra windows (a panel, such as the
 * cheat-sheet pop-out), so that it opens there again. Pure: the platform supplies the
 * screens that are connected and does the reading and the writing.
 */

export const WindowPlaceSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1).max(20000),
  height: z.number().int().min(1).max(20000),
});
export type WindowPlace = z.infer<typeof WindowPlaceSchema>;

const PanelPlacesSchema = z.object({
  panels: z.record(z.string(), z.unknown()).default({}),
});

/** A screen's usable area, in the units windows are placed in. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The places stored in the panels file, by panel id. A file that is missing, damaged or
 * holds something else has none: the windows open at their default size and the file is
 * written again when one is moved. An entry that is not a place is left out.
 */
export function panelPlaces(text: string | undefined): Record<string, WindowPlace> {
  if (text === undefined) return {};
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    // Not JSON: nothing is remembered, and the next move writes a good file.
    return {};
  }
  const parsed = PanelPlacesSchema.safeParse(data);
  if (!parsed.success) return {};
  const places: Record<string, WindowPlace> = {};
  for (const [id, value] of Object.entries(parsed.data.panels)) {
    const place = WindowPlaceSchema.safeParse(value);
    if (place.success) places[id] = place.data;
  }
  return places;
}

/** The panels file with one panel's place set. */
export function withPanelPlace(text: string | undefined, id: string, place: WindowPlace): string {
  return JSON.stringify({ panels: { ...panelPlaces(text), [id]: place } }, null, 2);
}

/**
 * A remembered place, checked against the screens that are connected now: the monitor
 * layout changes between flying and the desk, and a window must never open where no
 * screen is. The same place when enough of the window's top edge is on a screen to see it
 * and take hold of it; only its size when it is not; nothing when no place was stored.
 */
export function placeOnScreens(
  place: WindowPlace | undefined,
  screens: readonly WorkArea[],
  min: { width: number; height: number }
): { width: number; height: number; x?: number; y?: number } | undefined {
  if (!place) return undefined;
  const width = Math.max(min.width, place.width);
  const height = Math.max(min.height, place.height);
  const visible = screens.some(
    (area) =>
      place.x + 80 < area.x + area.width &&
      place.x + width - 80 > area.x &&
      place.y >= area.y - 10 &&
      place.y + 40 < area.y + area.height
  );
  return visible ? { x: place.x, y: place.y, width, height } : { width, height };
}
