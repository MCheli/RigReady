import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';

/**
 * Installed aircraft: every module folder under <DCS>\Mods\aircraft, read from its
 * entry.lua by pattern (it is a program; it is not run), plus aircraft that only have
 * binding folders in Saved Games (useful after a reinstall or with a module removed).
 */

export interface AircraftInfo {
  /** DCS unit type: the name binding folders, kneeboards and MonitorSetup use. */
  unit: string;
  label: string;
  /** Module folder under Mods\aircraft; absent for bindings-only aircraft. */
  module?: string;
  /** Saved Games\DCS\Config\Input\<unit> exists. */
  hasBindings: boolean;
}

/** Lua comments out, strings kept: good enough for entry.lua, which has no "--" inside strings. */
const stripComments = (text: string): string =>
  text.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');

export function parseEntryLua(text: string): { displayName?: string; units: string[] } {
  const code = stripComments(text);
  const displayName = /displayName\s*=\s*_?\s*\(?\s*["']([^"']+)["']/.exec(code)?.[1];
  const units: string[] = [];
  // Flaming Cliffs aircraft use MAC_flyable, everything else make_flyable.
  for (const match of code.matchAll(/(?:make|MAC)_flyable\s*\(\s*["']([^"']+)["']/g)) {
    if (!units.includes(match[1]!)) units.push(match[1]!);
  }
  return { ...(displayName ? { displayName } : {}), units };
}

export async function listAircraft(
  ctx: CheckContext,
  installDir: string | undefined,
  userDir: string | undefined
): Promise<AircraftInfo[]> {
  const out: AircraftInfo[] = [];
  const bindingDirs = new Set<string>();
  if (userDir) {
    const entries = await ctx.ports.files.listEntries(path.join(userDir, 'Config', 'Input'));
    for (const entry of entries.ok ? entries.value : []) {
      if (entry.isDirectory && !entry.name.includes('.')) bindingDirs.add(entry.name.toLowerCase());
    }
  }
  if (installDir) {
    const modules = await ctx.ports.files.listEntries(path.join(installDir, 'Mods', 'aircraft'));
    for (const module of modules.ok ? modules.value : []) {
      if (!module.isDirectory) continue;
      const text = await ctx.ports.files.readText(path.join(module.path, 'entry.lua'));
      if (!text.ok) continue;
      const entry = parseEntryLua(text.value);
      const name = entry.displayName ?? module.name;
      for (const unit of entry.units) {
        out.push({
          unit,
          label: entry.units.length > 1 ? `${name} (${unit})` : name,
          module: module.name,
          hasBindings: bindingDirs.has(unit.toLowerCase()),
        });
      }
    }
  }
  for (const dir of bindingDirs) {
    if (out.some((a) => a.unit.toLowerCase() === dir)) continue;
    // Keep the folder's own spelling.
    const entries = await ctx.ports.files.listEntries(path.join(userDir!, 'Config', 'Input'));
    const spelled = entries.ok
      ? entries.value.find((e) => e.name.toLowerCase() === dir)?.name
      : dir;
    out.push({ unit: spelled ?? dir, label: spelled ?? dir, hasBindings: true });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
