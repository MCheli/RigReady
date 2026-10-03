import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { KnownFolders } from '../../core/ports';
import { ok, type Result } from '../../core/result';
import { steamLibraryPaths } from '../../core/vdf';
import {
  CoTaskMemFree,
  HKEY_CURRENT_USER,
  HKEY_LOCAL_MACHINE,
  RegGetValueW,
  SHGetKnownFolderPath,
  guidBuffer,
  wstrAt,
} from './win32';

const FOLDERID_Profile = '{5E6C858F-0E22-4760-9AFE-EA3317B67173}';
const FOLDERID_Documents = '{FDD39AD0-238F-46AF-ADB4-6C85480369C7}';
const FOLDERID_SavedGames = '{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}';
const FOLDERID_RoamingAppData = '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}';
const FOLDERID_LocalAppData = '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}';
const RRF_RT_REG_SZ = 0x2;
const RRF_RT_REG_EXPAND_SZ = 0x4;
const RRF_NOEXPAND = 0x10000000;

function knownFolder(guid: string): string | undefined {
  const out: [bigint | null] = [null];
  const hr = SHGetKnownFolderPath(guidBuffer(guid), 0, null, out);
  if (hr !== 0 || !out[0]) return undefined;
  const value = wstrAt(out[0]);
  CoTaskMemFree(out[0]);
  return value;
}

export function readRegistryString(
  hive: bigint,
  subKey: string,
  value: string
): string | undefined {
  const buffer = Buffer.alloc(4096);
  const size = [buffer.length];
  const status = RegGetValueW(
    hive,
    subKey,
    value,
    RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ | RRF_NOEXPAND,
    null,
    buffer,
    size
  );
  if (status !== 0) return undefined;
  return buffer.toString('utf16le', 0, Math.max(0, size[0]! - 2)).replace(/\0+$/, '');
}

/**
 * The only place user paths are computed.
 *
 * When USERPROFILE has been redirected (isolated test runs), every folder is derived
 * from the environment so nothing can reach the real profile. Otherwise Windows is
 * asked, which honors relocated Documents / Saved Games folders.
 */
export class WindowsKnownFolders implements KnownFolders {
  private readonly redirected: boolean;

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {
    const real = knownFolder(FOLDERID_Profile);
    this.redirected =
      !real || path.resolve(real).toLowerCase() !== path.resolve(this.home()).toLowerCase();
  }

  home(): string {
    return this.env['USERPROFILE'] ?? os.homedir();
  }

  private resolve(guid: string, fallback: string): string {
    if (this.redirected) return fallback;
    return knownFolder(guid) ?? fallback;
  }

  documents(): string {
    return this.resolve(FOLDERID_Documents, path.join(this.home(), 'Documents'));
  }

  savedGames(): string {
    return this.resolve(FOLDERID_SavedGames, path.join(this.home(), 'Saved Games'));
  }

  appData(): string {
    const fallback = this.env['APPDATA'] ?? path.join(this.home(), 'AppData', 'Roaming');
    return this.resolve(FOLDERID_RoamingAppData, fallback);
  }

  localAppData(): string {
    const fallback = this.env['LOCALAPPDATA'] ?? path.join(this.home(), 'AppData', 'Local');
    return this.resolve(FOLDERID_LocalAppData, fallback);
  }

  dataRoot(): string {
    const override = this.env['RIGREADY_HOME'];
    return override && override.length > 0
      ? path.resolve(override)
      : path.join(this.home(), '.rigready');
  }

  async steamLibraries(): Promise<Result<string[]>> {
    const install =
      readRegistryString(HKEY_CURRENT_USER, 'Software\\Valve\\Steam', 'SteamPath') ??
      readRegistryString(HKEY_LOCAL_MACHINE, 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
    if (!install) return ok([]);
    const root = path.resolve(install);
    const found = new Map<string, string>([[root.toLowerCase(), root]]);
    try {
      const text = await fs.readFile(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      for (const library of steamLibraryPaths(text)) {
        const resolved = path.resolve(library);
        found.set(resolved.toLowerCase(), resolved);
      }
    } catch {
      // No library file: the install folder itself is the only library.
    }
    return ok([...found.values()]);
  }
}
