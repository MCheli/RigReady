import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { AircraftInfo } from './aircraft';
import { KNOWN_AIRCRAFT, ViewportNameSchema } from './screens';

/**
 * Which cockpit displays an installed module can draw on another screen, read from its own
 * cockpit scripts (docs/research/dcs.md 3.3). A display that can be exported asks the
 * monitor setup for its rectangle by name when the cockpit loads:
 *
 *   try_find_assigned_viewport("LEFT_MFCD")             -- F/A-18C, F-16C, A-10C, F-15E
 *   try_find_assigned_viewport("ABRIS", "RIGHT_MFCD")   -- Ka-50: its own name, then a fallback
 *   find_viewport("F14_JESTER_MENU")                     -- F-14: looked up directly
 *
 * The scripts are programs and are never run: this is a text scan for those calls with a
 * literal name, with comments removed first. A name built at run time is not found, and a
 * module whose scripts are compiled finds nothing; the built-in table covers the aircraft it
 * knows for that case.
 */

/** Names that are the main view, not a cockpit display. */
const MAIN_VIEWS = new Set(['center', 'gu_main_viewport', 'uimainview']);

/** Lua comments out (block and line). Strings are kept; a "--" inside a string is rare here. */
const stripComments = (text: string): string =>
  text.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');

const NAME = String.raw`(["'])([A-Za-z_][A-Za-z0-9_]{0,63})\1`;
const ASSIGNED = new RegExp(
  String.raw`\btry_find_assigned_viewport\s*\(\s*${NAME}(?:\s*,\s*(["'])([A-Za-z_][A-Za-z0-9_]{0,63})\3)?`,
  'g'
);
const FIND = new RegExp(String.raw`\bfind_viewport\s*\(\s*${NAME}`, 'g');

export interface ScannedViewport {
  name: string;
  /** The name DCS uses instead when the monitor setup does not define this one (Ka-50). */
  fallback?: string;
}

/** The viewport names one script asks for, in the order it asks. */
export function scanViewportNames(text: string): ScannedViewport[] {
  const code = stripComments(text);
  const found: { at: number; viewport: ScannedViewport }[] = [];
  for (const m of code.matchAll(ASSIGNED)) {
    found.push({
      at: m.index,
      viewport: { name: m[2]!, ...(m[4] ? { fallback: m[4] } : {}) },
    });
  }
  for (const m of code.matchAll(FIND)) found.push({ at: m.index, viewport: { name: m[2]! } });
  const out: ScannedViewport[] = [];
  for (const { viewport } of found.sort((a, b) => a.at - b.at)) {
    if (MAIN_VIEWS.has(viewport.name.toLowerCase())) continue;
    if (!ViewportNameSchema.safeParse(viewport.name).success) continue;
    if (!out.some((v) => v.name === viewport.name)) out.push(viewport);
  }
  return out;
}

const ORDER = ['LEFT_MFCD', 'CENTER_MFCD', 'RIGHT_MFCD', 'OUTER_LEFT_MFCD', 'OUTER_RIGHT_MFCD'];
const rank = (name: string): number => {
  const i = ORDER.indexOf(name);
  return i === -1 ? ORDER.length : i;
};

/** Left, centre, right first, then the rest by name: the order the editor lists them. */
export function sortViewports(names: string[]): string[] {
  return [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** Script files larger than this are not cockpit indicator scripts and are skipped. */
const MAX_SCRIPT_BYTES = 512 * 1024;

/**
 * Every exportable display a module folder's cockpit scripts name. A name that only appears
 * as another display's fallback (the Ka-50's RIGHT_MFCD behind ABRIS) is not listed on its own.
 */
export async function scanModuleDisplays(ctx: CheckContext, moduleDir: string): Promise<string[]> {
  const tree = await ctx.ports.files.listTree(path.join(moduleDir, 'Cockpit'), {
    include: ['*.lua'],
  });
  if (!tree.ok) return [];
  const names: string[] = [];
  const files = tree.value
    .filter((f) => f.size <= MAX_SCRIPT_BYTES)
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  // A module has a few hundred scripts: read them a batch at a time.
  for (let i = 0; i < files.length; i += 32) {
    const texts = await Promise.all(
      files.slice(i, i + 32).map((f) => ctx.ports.files.readText(f.path))
    );
    for (const text of texts) {
      if (!text.ok || !/find(?:_assigned)?_viewport/.test(text.value)) continue;
      for (const viewport of scanViewportNames(text.value)) {
        if (!names.includes(viewport.name)) names.push(viewport.name);
      }
    }
  }
  return sortViewports(names);
}

export interface CatalogEntry {
  unit: string;
  label: string;
  displays: string[];
}

/**
 * The aircraft the screen editor offers: every installed unit whose module names exportable
 * displays (the module's own scripts, or the built-in table when the scan finds none), sorted
 * by label. Without an install, the built-in table.
 */
export async function installedDisplayCatalog(
  ctx: CheckContext,
  installDir: string,
  aircraft: AircraftInfo[]
): Promise<CatalogEntry[]> {
  const byModule = new Map<string, string[]>();
  const out: CatalogEntry[] = [];
  for (const a of aircraft) {
    if (!a.module) continue;
    let scanned = byModule.get(a.module);
    if (!scanned) {
      scanned = await scanModuleDisplays(ctx, path.join(installDir, 'Mods', 'aircraft', a.module));
      byModule.set(a.module, scanned);
    }
    const builtIn = KNOWN_AIRCRAFT.find((k) => k.unit === a.unit)?.displays.map((d) => d.name);
    const displays = scanned.length ? scanned : (builtIn ?? []);
    if (displays.length) out.push({ unit: a.unit, label: a.label, displays });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The built-in table as a catalog: for a PC where no installed module was found. */
export function builtInCatalog(): CatalogEntry[] {
  return KNOWN_AIRCRAFT.map((a) => ({
    unit: a.unit,
    label: a.label,
    displays: a.displays.map((d) => d.name),
  })).sort((a, b) => a.label.localeCompare(b.label));
}

const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The aircraft a setup's name is about ("DCS F/A-18C" is the Hornet), by the longest
 * aircraft name or unit found in it. Undefined when none is.
 */
export function aircraftNamedIn(name: string, catalog: CatalogEntry[]): string | undefined {
  const haystack = normalize(name);
  let best: { unit: string; length: number } | undefined;
  for (const entry of catalog) {
    const keys = [
      entry.label,
      entry.label.split(/\s+/)[0] ?? '',
      entry.unit,
      entry.unit.split('_')[0] ?? '',
    ].map(normalize);
    for (const key of keys) {
      if (key.length >= 3 && haystack.includes(key) && key.length > (best?.length ?? 0)) {
        best = { unit: entry.unit, length: key.length };
      }
    }
  }
  return best?.unit;
}
