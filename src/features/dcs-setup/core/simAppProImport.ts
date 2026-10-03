import { z } from 'zod';
import {
  KNOWN_AIRCRAFT,
  type AircraftScreens,
  type DesktopDisplay,
  type Placement,
  type Rect,
} from './screens';

/**
 * Reads SimAppPro's MFD plan (%APPDATA%\SimAppPro\GameExtendDisplay\MFD\DCS_config.json,
 * docs/research/hardware-and-tools.md 1a) into a RigReady screen setup, so the owner does
 * not have to place every display again. Only this file is read; SimAppPro's config.json
 * holds account credentials and is never touched.
 */

const MonitorSchema = z.object({
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
});

const TailorSchema = z.object({
  left: z.number().default(0),
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
});

const InstrumentSchema = z.object({
  id: z.array(z.string()).default([]),
  gameConfigKey: z.string().optional(),
  name: z.string().optional(),
  tailorMonitor: TailorSchema.default({ left: 0, top: 0, right: 0, bottom: 0 }),
});

const ConfigSchema = z.object({
  currentMod: z.string().optional(),
  mainMonitorInfoById: z.record(z.string(), MonitorSchema).default({}),
  usbMonitorInfoById: z.record(z.string(), MonitorSchema).default({}),
  gameViewports: z
    .record(z.string(), z.object({ id: z.array(z.string()).default([]) }))
    .default({}),
  modsInfo: z
    .record(
      z.string(),
      z.object({ instruments: z.record(z.string(), InstrumentSchema).default({}) })
    )
    .default({}),
});

/** SimAppPro's module names and the DCS unit type each one flies as. */
export const SIMAPPPRO_UNITS: Record<string, { unit: string; label: string }> = {
  'FA-18C': { unit: 'FA-18C_hornet', label: 'F/A-18C Hornet' },
  'F-16C': { unit: 'F-16C_50', label: 'F-16C Viper' },
  'A-10C': { unit: 'A-10C', label: 'A-10C' },
  'A-10C_2': { unit: 'A-10C_2', label: 'A-10C II' },
  'AH-64D': { unit: 'AH-64D_BLK_II', label: 'AH-64D Apache' },
  AV8BNA: { unit: 'AV8BNA', label: 'AV-8B Harrier' },
  F14: { unit: 'F-14B', label: 'F-14B Tomcat' },
  'JF-17': { unit: 'JF-17', label: 'JF-17 Thunder' },
  'Ka-50': { unit: 'Ka-50', label: 'Ka-50 Black Shark' },
  'M-2000C': { unit: 'M-2000C', label: 'Mirage 2000C' },
  'MIG-21bis': { unit: 'MiG-21Bis', label: 'MiG-21bis' },
  'F-15E': { unit: 'F-15ESE', label: 'F-15E Strike Eagle' },
  'F-5E': { unit: 'F-5E-3', label: 'F-5E Tiger II' },
};

export interface SimAppProPlan {
  /** Aircraft with at least one display placed, the current one first. */
  aircraft: AircraftScreens[];
  mainDisplayIds: string[];
  /** Displays SimAppPro placed on a monitor that is not in this layout. */
  unmatched: string[];
  /** Every aircraft SimAppPro knows and the display names DCS asks for. */
  catalog: { unit: string; label: string; displays: string[] }[];
}

const rectOf = (m: z.infer<typeof MonitorSchema>): Rect => ({
  x: m.left,
  y: m.top,
  width: m.width,
  height: m.height,
});

function findDisplay(rect: Rect, desktop: DesktopDisplay[]): DesktopDisplay | undefined {
  return desktop.find(
    (d) => d.x === rect.x && d.y === rect.y && d.width === rect.width && d.height === rect.height
  );
}

/** Parses DCS_config.json against a monitor layout. Fails only when the file is not SimAppPro's plan. */
export function importSimAppPro(
  json: unknown,
  desktop: DesktopDisplay[]
): { ok: true; plan: SimAppProPlan } | { ok: false; message: string } {
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, message: "SimAppPro's MFD settings are not in a format RigReady knows." };
  }
  const config = parsed.data;
  const monitors = new Map<string, Rect>();
  for (const [id, m] of Object.entries(config.mainMonitorInfoById)) monitors.set(id, rectOf(m));
  for (const [id, m] of Object.entries(config.usbMonitorInfoById)) monitors.set(id, rectOf(m));

  const unmatched: string[] = [];
  const displayFor = (id: string, what: string): DesktopDisplay | undefined => {
    const rect = monitors.get(id);
    const display = rect ? findDisplay(rect, desktop) : undefined;
    if (!display) {
      unmatched.push(
        rect
          ? `${what}: SimAppPro's screen ${id} (${rect.width}x${rect.height} at ${rect.x},${rect.y}) is not in this monitor layout`
          : `${what}: SimAppPro's screen ${id} is unknown`
      );
    }
    return display;
  };

  const centerIds = config.gameViewports['Center']?.id ?? [];
  const mainDisplayIds = centerIds
    .map((id) => displayFor(id, 'Main view')?.id)
    .filter((id): id is string => id !== undefined);

  const order = Object.keys(config.modsInfo).sort((a, b) =>
    a === config.currentMod ? -1 : b === config.currentMod ? 1 : a.localeCompare(b)
  );
  const aircraft: AircraftScreens[] = [];
  const catalog: SimAppProPlan['catalog'] = [];
  for (const mod of order) {
    const known = SIMAPPPRO_UNITS[mod] ?? { unit: mod, label: mod };
    const instruments = Object.entries(config.modsInfo[mod]!.instruments);
    catalog.push({
      ...known,
      displays: instruments.map(([key, i]) => i.gameConfigKey ?? key),
    });
    const placements: Placement[] = [];
    for (const [key, instrument] of instruments) {
      const monitorId = instrument.id[0];
      if (!monitorId) continue;
      const name = instrument.gameConfigKey ?? key;
      const display = displayFor(monitorId, `${known.label} ${name}`);
      if (!display) continue;
      const t = instrument.tailorMonitor;
      // SimAppPro stores right and bottom as negative offsets from the far edge.
      placements.push({
        name,
        displayId: display.id,
        crop: {
          left: Math.max(0, Math.round(t.left)),
          top: Math.max(0, Math.round(t.top)),
          right: Math.max(0, Math.round(-t.right)),
          bottom: Math.max(0, Math.round(-t.bottom)),
        },
      });
    }
    if (placements.length > 0) aircraft.push({ ...known, placements });
  }
  return { ok: true, plan: { aircraft, mainDisplayIds, unmatched, catalog } };
}

/** Known aircraft plus whatever SimAppPro knows, without duplicates. */
export function aircraftCatalog(
  simAppPro: SimAppProPlan['catalog'] = []
): { unit: string; label: string; displays: string[] }[] {
  const out = KNOWN_AIRCRAFT.map((a) => ({
    unit: a.unit,
    label: a.label,
    displays: a.displays.map((d) => d.name),
  }));
  for (const entry of simAppPro) {
    if (!out.some((a) => a.unit === entry.unit) && entry.displays.length > 0) out.push(entry);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
