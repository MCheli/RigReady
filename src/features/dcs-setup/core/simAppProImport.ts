import { z } from 'zod';
import { builtInCatalog, type CatalogEntry } from './cockpitDisplays';
import {
  displayLabel,
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

/**
 * One of SimAppPro's screens the plan uses, and the monitor of the layout RigReady takes
 * it for. SimAppPro knows a screen only by where it was on the desktop when the plan was
 * saved (and by a Windows display number that changes whenever a monitor is turned on or
 * off), so a plan from before the screens were put in another order points at the wrong
 * ones. The pairing is therefore shown to the user whenever it is not certain.
 */
export interface PlanScreen {
  /** SimAppPro's own id for the screen ("002"). */
  planId: string;
  /** Where the plan has it; absent when the plan names a screen it does not describe. */
  rect?: Rect;
  /** True when the plan puts the main view on it. */
  main: boolean;
  /** What the plan shows on it, in the user's words: "Main view", "Left DDI". */
  shows: string[];
  /** The aircraft those displays are for; absent for the main view. */
  aircraft?: string;
  /** The monitor of the layout it is paired with, when there is one. */
  displayId?: string;
  /** chosen: by the user. name: by the name the user gave the monitor. position: where the plan has it. left: the one that was left. */
  how: 'chosen' | 'name' | 'position' | 'left' | 'none';
  /** False when the user must look at this pairing before the setup is used. */
  certain: boolean;
  /** Why this pairing, in one or two plain sentences. */
  note: string;
}

export interface SimAppProPlan {
  /** Aircraft with at least one display placed, the current one first. */
  aircraft: AircraftScreens[];
  mainDisplayIds: string[];
  /** Displays SimAppPro placed on a monitor that is not in this layout. */
  unmatched: string[];
  /** Every aircraft SimAppPro knows and the display names DCS asks for. */
  catalog: { unit: string; label: string; displays: string[] }[];
  /** Every screen the plan uses with the monitor it is paired with, the main view first. */
  screens: PlanScreen[];
  /** True when every pairing is certain: nothing for the user to check first. */
  certain: boolean;
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

export type Side = 'left' | 'centre' | 'right';
const SIDE_WORDS: Record<string, Side> = {
  left: 'left',
  right: 'right',
  centre: 'centre',
  center: 'centre',
  middle: 'centre',
  mid: 'centre',
};

/**
 * The side a name speaks of, when it speaks of exactly one: "MFD left" and LEFT_MFCD are
 * left, "MFD centre" and CENTER_MFCD are centre. "Left of the right one" is none.
 */
export function sideOf(name: string): Side | undefined {
  const sides = new Set<Side>();
  for (const word of name.toLowerCase().split(/[^a-z]+/)) {
    const side = SIDE_WORDS[word];
    if (side) sides.add(side);
  }
  return sides.size === 1 ? [...sides][0] : undefined;
}

const sameSize = (a: { width: number; height: number }, b: { width: number; height: number }) =>
  a.width === b.width && a.height === b.height;

interface PlanUse {
  planId: string;
  rect?: Rect;
  main: boolean;
  shows: string[];
  aircraft?: string;
  /** The side its displays are named for, taken from the first aircraft that says. */
  side?: Side;
}

/**
 * Pairs SimAppPro's screens with the monitors of a layout.
 *
 * 1. What the user chose (`chosen`), when given.
 * 2. Names: a screen whose displays are named for a side (LEFT_MFCD) goes to the one
 *    monitor of its size the user named for that side ("MFD left"). The user's own names
 *    say which screen is which today; the plan's positions say where a screen was when
 *    SimAppPro saved them.
 * 3. Position: the monitor at exactly the plan's place and size.
 * 4. The one monitor of the right size that is left for the one screen that is left.
 *
 * A pairing is certain only when the name and the plan's position agree, or when the
 * position fits and no other monitor of the layout has that size. Everything else is for
 * the user to check.
 */
export function pairScreens(
  uses: PlanUse[],
  desktop: DesktopDisplay[],
  chosen: Record<string, string | null> = {}
): PlanScreen[] {
  const label = (d: DesktopDisplay): string => d.name || 'a monitor';
  const claimed = new Set<string>();
  const paired = new Map<string, PlanScreen>();
  const where = (rect: Rect): string => `${rect.width} x ${rect.height} at ${rect.x},${rect.y}`;
  const pair = (
    use: PlanUse,
    display: DesktopDisplay | undefined,
    how: PlanScreen['how'],
    certain: boolean,
    note: string
  ): void => {
    if (display) claimed.add(display.id);
    paired.set(use.planId, {
      planId: use.planId,
      ...(use.rect ? { rect: use.rect } : {}),
      main: use.main,
      shows: use.shows,
      ...(use.aircraft ? { aircraft: use.aircraft } : {}),
      ...(display ? { displayId: display.id } : {}),
      how,
      certain,
      note,
    });
  };
  const open = (): PlanUse[] => uses.filter((use) => !paired.has(use.planId));
  const free = (): DesktopDisplay[] => desktop.filter((d) => !claimed.has(d.id));

  // What the automatic pairing would be, to keep its reason where the user left it alone.
  const automatic =
    Object.keys(chosen).length > 0
      ? new Map(pairScreens(uses, desktop).map((screen) => [screen.planId, screen]))
      : undefined;
  for (const use of uses) {
    if (!(use.planId in chosen)) continue;
    const want = chosen[use.planId];
    const display = want ? desktop.find((d) => d.id === want) : undefined;
    const proposed = automatic?.get(use.planId);
    if (proposed && proposed.displayId === display?.id && proposed.how !== 'none') {
      paired.set(use.planId, proposed);
      if (display) claimed.add(display.id);
    } else if (display) {
      pair(use, display, 'chosen', true, 'You chose this screen.');
    } else {
      pair(use, undefined, 'chosen', true, 'Left out: you chose no screen for it.');
    }
  }

  // Names.
  for (const use of open()) {
    if (!use.side || !use.rect) continue;
    const rect = use.rect;
    const rivals = uses.filter((u) => u.side === use.side && u.rect && sameSize(u.rect, rect));
    const named = desktop.filter((d) => sameSize(d, rect) && sideOf(d.name) === use.side);
    const display = named[0];
    if (rivals.length !== 1 || named.length !== 1 || !display || claimed.has(display.id)) continue;
    const there = findDisplay(rect, desktop);
    if (there?.id === display.id) {
      pair(use, display, 'name', true, "SimAppPro's plan and the name you gave the screen agree.");
    } else if (there) {
      pair(
        use,
        display,
        'name',
        false,
        `Matched by the name you gave the screen. SimAppPro's plan has it where ${label(there)} is now, so the plan is from before the screens were put in this order.`
      );
    } else {
      pair(
        use,
        display,
        'name',
        false,
        `Matched by the name you gave the screen. SimAppPro's plan has it at ${rect.x},${rect.y}, where this layout has no screen.`
      );
    }
  }

  // Position.
  for (const use of open()) {
    const display = use.rect ? findDisplay(use.rect, desktop) : undefined;
    if (!display || claimed.has(display.id)) continue;
    const alike = desktop.filter((d) => sameSize(d, display)).length;
    if (alike === 1) {
      pair(
        use,
        display,
        'position',
        true,
        'The only screen of this size, and where the plan has it.'
      );
    } else {
      pair(
        use,
        display,
        'position',
        false,
        `Matched by position alone. ${alike} screens of this layout are the same size, and SimAppPro's plan does not say which is which.`
      );
    }
  }

  // The one that is left.
  for (const use of open()) {
    if (!use.rect) continue;
    const rect = use.rect;
    const waiting = open().filter((u) => u.rect && sameSize(u.rect, rect));
    const left = free().filter((d) => sameSize(d, rect));
    if (waiting.length === 1 && left.length === 1) {
      pair(use, left[0], 'left', false, 'The one screen of this size that was left over.');
    }
  }

  for (const use of open()) {
    pair(
      use,
      undefined,
      'none',
      false,
      use.rect
        ? `No screen of this layout fits. SimAppPro's plan has it as ${where(use.rect)}.`
        : "SimAppPro's plan names this screen but does not describe it."
    );
  }
  return uses.map((use) => paired.get(use.planId)!);
}

/**
 * Parses DCS_config.json against a monitor layout. Fails only when the file is not
 * SimAppPro's plan. `chosen` is the user's own pairing (SimAppPro's screen id to a monitor
 * id of the layout, or null to leave the screen out) and wins over what RigReady would pair.
 */
export function importSimAppPro(
  json: unknown,
  desktop: DesktopDisplay[],
  chosen: Record<string, string | null> = {}
): { ok: true; plan: SimAppProPlan } | { ok: false; message: string } {
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, message: "SimAppPro's MFD settings are not in a format RigReady knows." };
  }
  const config = parsed.data;
  const monitors = new Map<string, Rect>();
  for (const [id, m] of Object.entries(config.mainMonitorInfoById)) monitors.set(id, rectOf(m));
  for (const [id, m] of Object.entries(config.usbMonitorInfoById)) monitors.set(id, rectOf(m));

  const centerIds = config.gameViewports['Center']?.id ?? [];
  const order = Object.keys(config.modsInfo).sort((a, b) =>
    a === config.currentMod ? -1 : b === config.currentMod ? 1 : a.localeCompare(b)
  );

  // Every screen the plan uses: the main view's first, then in the order the aircraft use them.
  const uses = new Map<string, PlanUse>();
  const use = (planId: string): PlanUse => {
    let found = uses.get(planId);
    if (!found) {
      const rect = monitors.get(planId);
      found = { planId, ...(rect ? { rect } : {}), main: false, shows: [] };
      uses.set(planId, found);
    }
    return found;
  };
  for (const id of centerIds) {
    const main = use(id);
    main.main = true;
    main.shows = ['Main view'];
  }
  for (const mod of order) {
    const known = SIMAPPPRO_UNITS[mod] ?? { unit: mod, label: mod };
    const onScreen = new Map<string, string[]>();
    for (const [key, instrument] of Object.entries(config.modsInfo[mod]!.instruments)) {
      const planId = instrument.id[0];
      if (!planId) continue;
      onScreen.set(planId, [...(onScreen.get(planId) ?? []), instrument.gameConfigKey ?? key]);
    }
    for (const [planId, names] of onScreen) {
      const screen = use(planId);
      if (!screen.main && screen.shows.length === 0) {
        screen.shows = names.map((name) => displayLabel(known.unit, name));
        screen.aircraft = known.label;
      }
      if (!screen.side && !screen.main) {
        const sides = new Set(names.map(sideOf));
        const side = sides.size === 1 ? [...sides][0] : undefined;
        if (side) screen.side = side;
      }
    }
  }
  const screens = pairScreens([...uses.values()], desktop, chosen);
  const byPlanId = new Map(screens.map((screen) => [screen.planId, screen]));
  const byId = new Map(desktop.map((d) => [d.id, d]));

  const unmatched: string[] = [];
  const displayFor = (id: string, what: string): DesktopDisplay | undefined => {
    const screen = byPlanId.get(id);
    const display = screen?.displayId ? byId.get(screen.displayId) : undefined;
    // A screen the user left out on purpose is not a problem to report.
    if (!display && screen?.how !== 'chosen') {
      const rect = monitors.get(id);
      unmatched.push(
        rect
          ? `${what}: SimAppPro's screen ${id} (${rect.width}x${rect.height} at ${rect.x},${rect.y}) is not in this monitor layout`
          : `${what}: SimAppPro's screen ${id} is unknown`
      );
    }
    return display;
  };

  const mainDisplayIds = centerIds
    .map((id) => displayFor(id, 'Main view')?.id)
    .filter((id): id is string => id !== undefined);

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
  return {
    ok: true,
    plan: {
      aircraft,
      mainDisplayIds,
      unmatched,
      catalog,
      screens,
      certain: screens.every((screen) => screen.certain),
    },
  };
}

/**
 * The aircraft the editor offers (the installed ones, core/cockpitDisplays.ts, or the
 * built-in table) plus what SimAppPro's plan knows, without duplicates. When the installed
 * units are known, SimAppPro's other aircraft (modules not on this PC) are left out.
 */
export function aircraftCatalog(
  simAppPro: SimAppProPlan['catalog'] = [],
  base: CatalogEntry[] = builtInCatalog(),
  installed?: Set<string>
): CatalogEntry[] {
  const out = base.map((a) => ({ ...a, displays: [...a.displays] }));
  for (const entry of simAppPro) {
    if (entry.displays.length === 0 || out.some((a) => a.unit === entry.unit)) continue;
    if (installed && installed.size > 0 && !installed.has(entry.unit)) continue;
    out.push(entry);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
