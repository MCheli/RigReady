import { z } from 'zod';

/**
 * RigReady's DCS screen setup: which monitors carry the main 3D view and where each
 * cockpit display (LEFT_MFCD, RIGHT_MFCD, ...) is drawn, per aircraft, turned into a
 * MonitorSetup Lua file (docs/research/dcs.md section 3).
 *
 * Coordinates in the file are relative to the DCS window, which spans the bounding box of
 * every monitor the setup uses and opens at the top-left of the main display.
 *
 * Pure: the editor uses the same code to preview the file while the user drags.
 */

export const MONITOR_SETUP_NAME = 'RigReady';
/** What options.lua must say to pick the file: DCS stores the file stem in lower case. */
export const MONITOR_SETUP_OPTION = MONITOR_SETUP_NAME.toLowerCase();

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bezel crop, in pixels inward from each edge of the monitor. */
export const CropSchema = z.object({
  left: z.number().int().min(0).default(0),
  top: z.number().int().min(0).default(0),
  right: z.number().int().min(0).default(0),
  bottom: z.number().int().min(0).default(0),
});
export type Crop = z.infer<typeof CropSchema>;
export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

/** A viewport name DCS asks for: a Lua identifier such as LEFT_MFCD. */
export const ViewportNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'A display name is letters, digits and _');

export const PlacementSchema = z.object({
  name: ViewportNameSchema,
  displayId: z.string().min(1),
  crop: CropSchema.default(NO_CROP),
});
export type Placement = z.infer<typeof PlacementSchema>;

/** DCS unit type names: "FA-18C_hornet", "F-16C_50", "UH-1H". */
export const UnitSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 _.+-]{0,63}$/);

export const AircraftScreensSchema = z.object({
  unit: UnitSchema,
  label: z.string().min(1).max(60),
  placements: z.array(PlacementSchema).default([]),
});
export type AircraftScreens = z.infer<typeof AircraftScreensSchema>;

/** One monitor as the setup saw it: where it was on the desktop when the file was made. */
export const DesktopDisplaySchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  rotation: z.number().int().default(0),
  primary: z.boolean().default(false),
});
export type DesktopDisplay = z.infer<typeof DesktopDisplaySchema>;

export const ScreenSetupSchema = z.object({
  /** The monitors the main 3D view spans. */
  mainDisplayIds: z.array(z.string().min(1)).min(1),
  aircraft: z.array(AircraftScreensSchema).default([]),
  /** The monitor arrangement the coordinates are for. */
  desktop: z.array(DesktopDisplaySchema).min(1),
  /** Where that arrangement came from, for the user: "Current monitors", "Flying". */
  desktopLabel: z.string().default('Current monitors'),
});
export type ScreenSetup = z.infer<typeof ScreenSetupSchema>;

export interface KnownDisplay {
  name: string;
  label: string;
}

export interface KnownAircraft {
  unit: string;
  label: string;
  displays: KnownDisplay[];
}

/**
 * Aircraft whose exportable displays are known. F/A-18C from its cockpit scripts
 * (docs/research/dcs.md 3.3); the others from SimAppPro's aircraft list.
 */
export const KNOWN_AIRCRAFT: KnownAircraft[] = [
  {
    unit: 'FA-18C_hornet',
    label: 'F/A-18C Hornet',
    displays: [
      { name: 'LEFT_MFCD', label: 'Left DDI' },
      { name: 'RIGHT_MFCD', label: 'Right DDI' },
      { name: 'CENTER_MFCD', label: 'AMPCD' },
    ],
  },
  {
    unit: 'F-16C_50',
    label: 'F-16C Viper',
    displays: [
      { name: 'LEFT_MFCD', label: 'Left MFD' },
      { name: 'RIGHT_MFCD', label: 'Right MFD' },
    ],
  },
  {
    unit: 'A-10C_2',
    label: 'A-10C II',
    displays: [
      { name: 'LEFT_MFCD', label: 'Left MFCD' },
      { name: 'RIGHT_MFCD', label: 'Right MFCD' },
    ],
  },
];

/** Aircraft with no exportable display: the main view is all they use. */
export const MAIN_VIEW_ONLY: Record<string, string> = { 'UH-1H': 'UH-1H Huey' };

export function displayLabel(unit: string, name: string): string {
  return (
    KNOWN_AIRCRAFT.find((a) => a.unit === unit)?.displays.find((d) => d.name === name)?.label ??
    name
  );
}

export function cropRect(display: Rect, crop: Crop): Rect {
  return {
    x: display.x + crop.left,
    y: display.y + crop.top,
    width: display.width - crop.left - crop.right,
    height: display.height - crop.top - crop.bottom,
  };
}

export function boundingBox(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  return {
    x: minX,
    y: minY,
    width: Math.max(...rects.map((r) => r.x + r.width)) - minX,
    height: Math.max(...rects.map((r) => r.y + r.height)) - minY,
  };
}

export const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

export interface PlacedViewport {
  name: string;
  /** Desktop coordinates. */
  desktop: Rect;
  /** Coordinates in the file: relative to the DCS window. */
  file: Rect;
  displayId: string;
  /** Labels of the aircraft that use it here. */
  aircraft: string[];
}

export interface GeneratedSetup {
  lua: string;
  /** The DCS window: what options.lua width and height must be, and where it starts. */
  window: Rect;
  center: PlacedViewport;
  /** Displays drawn for every aircraft (the first aircraft wins a name it shares). */
  viewports: PlacedViewport[];
  /** Per aircraft, the names it places somewhere other than the shared default. */
  overrides: { unit: string; label: string; viewports: PlacedViewport[] }[];
  /** Things that make the setup unusable; it must not be written while any exist. */
  errors: string[];
  /** Things worth knowing that do not stop it working. */
  warnings: string[];
}

const fmt = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(14)));

function luaRect(name: string, rect: Rect, indent: string, extra: string[] = []): string {
  const fields = [
    `x = ${fmt(rect.x)};`,
    `y = ${fmt(rect.y)};`,
    `width = ${fmt(rect.width)};`,
    `height = ${fmt(rect.height)};`,
    ...extra,
  ];
  return `${indent}${name} =\n${indent}{\n${fields.map((f) => `${indent}\t${f}`).join('\n')}\n${indent}}`;
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const luaString = (text: string): string =>
  `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/[\r\n]+/g, ' ')}'`;

/** Turns the setup into the Lua file, checking it against the monitors it was made for. */
export function generateSetup(setup: ScreenSetup): GeneratedSetup {
  const errors: string[] = [];
  const warnings: string[] = [];
  const displays = new Map(setup.desktop.map((d) => [d.id, d]));
  const name = (id: string): string => displays.get(id)?.name || 'a monitor';

  const mains = setup.mainDisplayIds.map((id) => displays.get(id)).filter((d) => d !== undefined);
  if (mains.length !== setup.mainDisplayIds.length) {
    errors.push('A monitor chosen for the main view is not part of this monitor layout.');
  }
  const mainBox = mains.length > 0 ? boundingBox(mains) : { x: 0, y: 0, width: 1, height: 1 };

  const used: Rect[] = [...mains];
  const placed: { aircraft: AircraftScreens; placement: Placement; desktop: Rect }[] = [];
  for (const aircraft of setup.aircraft) {
    const seen = new Set<string>();
    for (const placement of aircraft.placements) {
      if (seen.has(placement.name)) {
        errors.push(`${aircraft.label}: ${placement.name} is placed twice.`);
        continue;
      }
      seen.add(placement.name);
      const display = displays.get(placement.displayId);
      if (!display) {
        errors.push(
          `${aircraft.label}: the monitor for ${displayLabel(aircraft.unit, placement.name)} is not part of this monitor layout.`
        );
        continue;
      }
      const rect = cropRect(display, placement.crop);
      if (rect.width < 16 || rect.height < 16) {
        errors.push(
          `${aircraft.label}: the crop leaves almost nothing of ${displayLabel(aircraft.unit, placement.name)} on ${name(display.id)}.`
        );
        continue;
      }
      if (mains.some((m) => m.id === display.id)) {
        warnings.push(
          `${aircraft.label}: ${displayLabel(aircraft.unit, placement.name)} is drawn over the main view on ${name(display.id)}.`
        );
      }
      used.push(display);
      placed.push({ aircraft, placement, desktop: rect });
    }
  }

  const window = boundingBox(used);
  if (window.x !== 0 || window.y !== 0) {
    warnings.push(
      `The monitors this setup uses start at ${window.x},${window.y}, not at the top-left of the main Windows display. DCS opens its window at 0,0, so make the top-left monitor of this setup the main display.`
    );
  }
  const relative = (rect: Rect): Rect => ({ ...rect, x: rect.x - window.x, y: rect.y - window.y });

  const label = (a: AircraftScreens): string => a.label;
  const center: PlacedViewport = {
    name: 'Center',
    desktop: mainBox,
    file: relative(mainBox),
    displayId: setup.mainDisplayIds[0] ?? '',
    aircraft: setup.aircraft.map(label),
  };

  // Shared defaults: the first aircraft to place a name decides where it goes for everyone.
  const defaults = new Map<string, PlacedViewport>();
  const overrides = new Map<string, PlacedViewport[]>();
  for (const { aircraft, placement, desktop } of placed) {
    const existing = defaults.get(placement.name);
    if (!existing) {
      defaults.set(placement.name, {
        name: placement.name,
        desktop,
        file: relative(desktop),
        displayId: placement.displayId,
        aircraft: [aircraft.label],
      });
    } else if (sameRect(existing.desktop, desktop)) {
      existing.aircraft.push(aircraft.label);
    } else {
      const own = overrides.get(aircraft.unit) ?? [];
      own.push({
        name: placement.name,
        desktop,
        file: relative(desktop),
        displayId: placement.displayId,
        aircraft: [aircraft.label],
      });
      overrides.set(aircraft.unit, own);
    }
  }
  const viewports = [...defaults.values()];
  const perUnit = setup.aircraft
    .filter((a) => overrides.has(a.unit))
    .map((a) => ({ unit: a.unit, label: a.label, viewports: overrides.get(a.unit)! }));

  const described = setup.aircraft.filter((a) => a.placements.length > 0).map(label);
  const description = described.length
    ? `Main view on ${mains.map((m) => m.name || 'monitor').join(' + ')}; cockpit displays for ${described.join(', ')}`
    : `Main view on ${mains.map((m) => m.name || 'monitor').join(' + ')}`;

  // Plain table data (no function calls, no references) unless per-aircraft overrides are
  // needed, so the file can be read back with the strict data parser.
  const centerFields = [
    'viewDx = 0;',
    'viewDy = 0;',
    `aspect = ${fmt(center.file.width / center.file.height)};`,
  ];
  const lines: string[] = [
    '-- Written by RigReady from your monitor layout. Change it in RigReady (Configure > DCS World > Screens):',
    '-- RigReady notices edits made here and asks before replacing them.',
    `name = ${luaString(MONITOR_SETUP_NAME)}`,
    `Description = ${luaString(description)}`,
    '',
    'Viewports =',
    '{',
    luaRect('Center', center.file, '\t', centerFields),
    '}',
    luaRect('UIMainView', center.file, '', centerFields),
    luaRect('GU_MAIN_VIEWPORT', center.file, '', centerFields),
  ];
  for (const viewport of viewports) {
    lines.push('', `-- ${viewport.aircraft.join(', ')}`, luaRect(viewport.name, viewport.file, ''));
  }
  if (perUnit.length > 0) {
    // DCS calls this with the unit type when a cockpit loads (see its 3Cameras.lua sample).
    lines.push('', 'local by_unit =', '{');
    for (const unit of perUnit) {
      lines.push(`\t[${luaString(unit.unit)}] = -- ${unit.label}`, '\t{');
      for (const viewport of unit.viewports)
        lines.push(`${luaRect(viewport.name, viewport.file, '\t\t')},`);
      lines.push('\t},');
    }
    lines.push('}');
    lines.push(
      'local shared =',
      '{',
      ...viewports.map((v) => `${luaRect(v.name, v.file, '\t')},`),
      '}',
      'function reconfigure_for_unit(unit_type)',
      '\tfor name, viewport in pairs(shared) do _G[name] = viewport end',
      '\tfor name, viewport in pairs(by_unit[unit_type] or {}) do _G[name] = viewport end',
      'end'
    );
  }
  return {
    lua: lines.join('\n') + '\n',
    window,
    center,
    viewports,
    overrides: perUnit,
    errors,
    warnings,
  };
}

/** "USB_Monitor (2 of 3)" when several monitors share a name, numbered left to right. */
export function monitorLabels(displays: DesktopDisplay[]): Map<string, string> {
  const ordered = [...displays].sort((a, b) => a.x - b.x || a.y - b.y);
  const totals = new Map<string, number>();
  for (const d of ordered) totals.set(d.name, (totals.get(d.name) ?? 0) + 1);
  const seen = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const d of ordered) {
    const n = (seen.get(d.name) ?? 0) + 1;
    seen.set(d.name, n);
    const name = d.name || 'Monitor';
    labels.set(
      d.id,
      (totals.get(d.name) ?? 1) > 1 ? `${name} (${n} of ${totals.get(d.name)})` : name
    );
  }
  return labels;
}

/** The crop that turns a monitor into the given rectangle on it (the rectangle is clamped to the monitor). */
export function cropFor(display: Rect, rect: Rect): Crop {
  const x = Math.max(display.x, Math.min(rect.x, display.x + display.width));
  const y = Math.max(display.y, Math.min(rect.y, display.y + display.height));
  const right = Math.min(display.x + display.width, rect.x + rect.width);
  const bottom = Math.min(display.y + display.height, rect.y + rect.height);
  return {
    left: Math.round(x - display.x),
    top: Math.round(y - display.y),
    right: Math.round(display.x + display.width - Math.max(right, x)),
    bottom: Math.round(display.y + display.height - Math.max(bottom, y)),
  };
}

/** The monitor a rectangle lies entirely on, if any. */
export function displayContaining<T extends Rect>(rect: Rect, displays: T[]): T | undefined {
  return displays.find((d) => contains(d, rect));
}
