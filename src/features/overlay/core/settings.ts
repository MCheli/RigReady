import { z } from 'zod';

/**
 * What the overlay remembers, under the data root in `overlay/settings.json`. Schemas only
 * (no paths), so the pages can use them too; the file itself is `core/store.ts`.
 *
 *   on        whether the overlay is up while RigReady runs
 *   widgets   per widget id: where the user put it, and the options the user set
 *   aircraft  per setup id ("" when there is no setup): the aircraft or car the user chose
 *             for the labels, when RigReady's own choice was not the right one
 */

/** A share of the free room on a screen: 0..1 from the left and from the top. */
export const AtSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});
export type At = z.infer<typeof AtSchema>;

/**
 * Enough of a monitor to find it again after the monitor layout changed (see
 * `src/core/displays/identity.ts`), plus the name it had, to say which one is missing.
 */
export const StoredMonitorSchema = z.object({
  id: z.string().min(1),
  serial: z.string().optional(),
  usbSerial: z.string().optional(),
  name: z.string().default(''),
});
export type StoredMonitor = z.infer<typeof StoredMonitorSchema>;

export const StoredPlaceSchema = z.object({
  /** Absent: the main screen, whichever that is. */
  monitor: StoredMonitorSchema.optional(),
  at: AtSchema,
});
export type StoredPlace = z.infer<typeof StoredPlaceSchema>;

export const StoredWidgetSchema = z.object({
  /** Absent until the user places it: the widget's own default place on the main screen. */
  place: StoredPlaceSchema.optional(),
  /** As the user set them. Each widget kind reads its own (`core/widgets.ts`). */
  options: z.record(z.string(), z.unknown()).default({}),
});
export type StoredWidget = z.infer<typeof StoredWidgetSchema>;

export const StoredAircraftSchema = z.object({
  game: z.string(),
  aircraftId: z.string(),
});

export const OverlaySettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  on: z.boolean().default(false),
  widgets: z.record(z.string(), StoredWidgetSchema).default({}),
  aircraft: z.record(z.string(), StoredAircraftSchema).default({}),
});
export type OverlaySettings = z.infer<typeof OverlaySettingsSchema>;

/** What is in effect while the file cannot be read: off, nothing placed, nothing chosen. */
export const NO_SETTINGS: OverlaySettings = OverlaySettingsSchema.parse({});
