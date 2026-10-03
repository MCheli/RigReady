import path from 'node:path';
import type { FileStore } from '../../../core/ports';

/**
 * Which aircraft (input profiles) exist. The folder under Saved Games\DCS\Config\Input
 * is the profile key an aircraft module declares in its entry.lua, not its display
 * name (docs/research/dcs.md 1.1): "FA-18C_hornet" -> <module>\Input\FA-18C.
 */

export interface AircraftProfile {
  /** The profile key and Saved Games folder name: FA-18C_hornet, UH-1H. */
  id: string;
  /** Display name from the module's name.lua: "F/A-18C". Falls back to the id. */
  name: string;
  /** The module's input folder in the install, when it exists. */
  folder?: string;
}

const PROFILES_BLOCK = /InputProfiles\s*=\s*\{([\s\S]*?)\}/;
const PROFILE_ENTRY =
  /\[\s*["']([^"']+)["']\s*\]\s*=\s*current_mod_path\s*\.\.\s*["']([^"']+)["']/g;

/** The InputProfiles of one entry.lua: profile key -> folder relative to the module. */
export function inputProfilesOf(entryLua: string): { id: string; relative: string }[] {
  const block = PROFILES_BLOCK.exec(entryLua)?.[1];
  if (!block) return [];
  return [...block.matchAll(PROFILE_ENTRY)].map((m) => ({ id: m[1]!, relative: m[2]! }));
}

/** DCS removes these characters from the profile key to get the folder name. */
export function profileFolderName(id: string): string {
  return id.replace(/[*/?<>|\\:"]/g, '');
}

function displayName(nameLua: string | undefined, fallback: string): string {
  if (!nameLua) return fallback;
  const match = /return\s+(?:_\(\s*)?(['"])(.*?)\1/.exec(nameLua);
  return match?.[2] || fallback;
}

/** Every aircraft input profile declared by the modules under the given `Mods\aircraft` folders. */
export async function discoverAircraft(
  files: FileStore,
  modRoots: string[]
): Promise<AircraftProfile[]> {
  const found = new Map<string, AircraftProfile>();
  for (const root of modRoots) {
    const modules = await files.listEntries(root);
    if (!modules.ok) continue;
    for (const module of modules.value.filter((m) => m.isDirectory)) {
      const entry = await files.readText(path.join(module.path, 'entry.lua'));
      if (!entry.ok) continue;
      for (const { id, relative } of inputProfilesOf(entry.value)) {
        if (found.has(id)) continue;
        const folder = path.join(module.path, relative);
        const exists = await files.exists(folder);
        const name = exists ? await files.readText(path.join(folder, 'name.lua')) : undefined;
        found.set(id, {
          id,
          name: displayName(name?.ok ? name.value : undefined, id),
          ...(exists ? { folder } : {}),
        });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
