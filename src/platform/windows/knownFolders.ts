import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { KnownFolders, Registry } from '../../core/ports';
import type { Result } from '../../core/result';
import { findSteamLibraries } from '../../core/steam';
import { WindowsRegistry } from './registry';
import { CoTaskMemFree, SHGetKnownFolderPath, guidBuffer, wstrAt } from './win32';

const FOLDERID_Profile = '{5E6C858F-0E22-4760-9AFE-EA3317B67173}';
const FOLDERID_Documents = '{FDD39AD0-238F-46AF-ADB4-6C85480369C7}';
const FOLDERID_SavedGames = '{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}';
const FOLDERID_Desktop = '{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}';
const FOLDERID_RoamingAppData = '{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}';
const FOLDERID_LocalAppData = '{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}';

function knownFolder(guid: string): string | undefined {
  const out: [bigint | null] = [null];
  const hr = SHGetKnownFolderPath(guidBuffer(guid), 0, null, out);
  if (hr !== 0 || !out[0]) return undefined;
  const value = wstrAt(out[0]);
  CoTaskMemFree(out[0]);
  return value;
}

/**
 * The user folders the environment names, for the log's redaction before the ports exist:
 * the real profile folder, and the one an isolated run was given.
 */
export function userFoldersInEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env['USERPROFILE'], env['HOME']].filter((home): home is string => !!home);
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

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly registry: Registry = new WindowsRegistry()
  ) {
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

  /** Windows is asked, so a Desktop kept in OneDrive is found; a redirected run stays under its home. */
  desktop(): string {
    return this.resolve(FOLDERID_Desktop, path.join(this.home(), 'Desktop'));
  }

  appData(): string {
    const fallback = this.env['APPDATA'] ?? path.join(this.home(), 'AppData', 'Roaming');
    return this.resolve(FOLDERID_RoamingAppData, fallback);
  }

  localAppData(): string {
    const fallback = this.env['LOCALAPPDATA'] ?? path.join(this.home(), 'AppData', 'Local');
    return this.resolve(FOLDERID_LocalAppData, fallback);
  }

  machineName(): string {
    return os.hostname();
  }
  dataRoot(): string {
    const override = this.env['RIGREADY_HOME'];
    return override && override.length > 0
      ? path.resolve(override)
      : path.join(this.home(), '.rigready');
  }

  programFiles(): string {
    return this.env['ProgramW6432'] ?? this.env['ProgramFiles'] ?? 'C:\\Program Files';
  }

  programFilesX86(): string {
    return this.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  }

  programData(): string {
    return this.env['ProgramData'] ?? 'C:\\ProgramData';
  }

  windows(): string {
    return this.env['SystemRoot'] ?? this.env['windir'] ?? 'C:\\Windows';
  }

  steamLibraries(): Promise<Result<string[]>> {
    return findSteamLibraries(this.registry, (file) => fs.readFile(file, 'utf8'));
  }
}
