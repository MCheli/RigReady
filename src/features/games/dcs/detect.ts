import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { ConfigLocation, GameInstall, GameVersion } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import { readSteamApp } from '../../../core/steam';

/**
 * Where DCS World is installed and where each install keeps its user files. See
 * docs/research/dcs.md section 7: the Steam edition lives in a Steam library and writes
 * to Saved Games\DCS; standalone installs are recorded under Eagle Dynamics registry keys
 * and may name their own Saved Games folder in dcs_variant.txt.
 */

export const DCS_STEAM_APP_ID = '223750';

/** Registry keys the standalone installer writes, with the value that holds the folder. */
const STANDALONE_KEYS = [
  'Software\\Eagle Dynamics\\DCS World',
  'Software\\Eagle Dynamics\\DCS World OpenBeta',
] as const;

const sameDir = (a: string, b: string): boolean =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** The Saved Games folder name for an install: "DCS", or "DCS.<variant>" from dcs_variant.txt. */
export async function userFolderName(ctx: CheckContext, installDir: string): Promise<string> {
  const variantFile = path.join(installDir, 'dcs_variant.txt');
  if (!(await ctx.ports.files.exists(variantFile))) return 'DCS';
  const text = await ctx.ports.files.readText(variantFile);
  const variant = text.ok ? text.value.replace(/^﻿/, '').trim() : '';
  // A variant is a folder-name suffix; anything that could leave Saved Games is ignored.
  return /^[A-Za-z0-9_.-]{1,40}$/.test(variant) && !variant.includes('..')
    ? `DCS.${variant}`
    : 'DCS';
}

/** steam.exe in the Steam folder (the first library, spelled as on disk), else as the registry has it. */
async function steamExe(ctx: CheckContext, libraries: string[]): Promise<string | undefined> {
  const candidates = libraries[0] ? [path.join(libraries[0], 'steam.exe')] : [];
  const value = await ctx.ports.registry.getValue('HKCU', 'Software\\Valve\\Steam', 'SteamExe');
  if (value.ok && value.value?.type === 'string' && value.value.value) {
    candidates.push(path.resolve(value.value.value));
  }
  for (const exe of candidates) if (await ctx.ports.files.exists(exe)) return exe;
  return undefined;
}

async function steamInstalls(ctx: CheckContext): Promise<Result<GameInstall[]>> {
  const libraries = await ctx.ports.folders.steamLibraries();
  if (!libraries.ok) return libraries;
  // The app manifest names the install folder; DCSWorld is the default when it is unreadable.
  const app = await readSteamApp(ctx.ports, DCS_STEAM_APP_ID);
  const candidates: string[] = [];
  if (app.ok && app.value) candidates.push(app.value.installDir);
  for (const library of libraries.value) {
    candidates.push(path.join(library, 'steamapps', 'common', 'DCSWorld'));
  }
  const launcher = await steamExe(ctx, libraries.value);
  const installs: GameInstall[] = [];
  for (const installDir of candidates) {
    if (installs.some((i) => sameDir(i.installDir, installDir))) continue;
    const exe = path.join(installDir, 'bin', 'DCS.exe');
    if (!(await ctx.ports.files.exists(exe))) continue;
    installs.push({
      source: 'steam',
      installDir,
      // Through Steam, so Steam applies a queued update and authorises the game first.
      launch: launcher
        ? { exe: launcher, args: ['-applaunch', DCS_STEAM_APP_ID] }
        : { exe, args: [], cwd: path.join(installDir, 'bin') },
      userDir: path.join(ctx.ports.folders.savedGames(), await userFolderName(ctx, installDir)),
    });
  }
  return ok(installs);
}

async function standaloneInstalls(ctx: CheckContext): Promise<GameInstall[]> {
  const installs: GameInstall[] = [];
  for (const hive of ['HKCU', 'HKLM'] as const) {
    for (const key of STANDALONE_KEYS) {
      const value = await ctx.ports.registry.getValue(hive, key, 'Path');
      if (!value.ok || value.value?.type !== 'string' || !value.value.value.trim()) continue;
      const installDir = path.resolve(value.value.value.trim());
      if (installs.some((i) => sameDir(i.installDir, installDir))) continue;
      const exe = path.join(installDir, 'bin', 'DCS.exe');
      // A key left behind by an uninstall points at a folder that is gone: ignore it.
      if (!(await ctx.ports.files.exists(exe))) continue;
      installs.push({
        source: 'standalone',
        installDir,
        launch: { exe, args: [], cwd: path.join(installDir, 'bin') },
        userDir: path.join(ctx.ports.folders.savedGames(), await userFolderName(ctx, installDir)),
      });
    }
  }
  return installs;
}

/** Every DCS install: Steam (all libraries) first, then standalone. */
export async function detectInstalls(ctx: CheckContext): Promise<Result<GameInstall[]>> {
  const steam = await steamInstalls(ctx);
  if (!steam.ok) return steam;
  const standalone = await standaloneInstalls(ctx);
  return ok([
    ...steam.value,
    ...standalone.filter((s) => !steam.value.some((i) => sameDir(i.installDir, s.installDir))),
  ]);
}

/** A stable id for a Saved Games folder: "DCS" -> "dcs", "DCS.openbeta" -> "dcs-openbeta". */
export function locationId(folderName: string): string {
  return folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '');
}

/**
 * Every Saved Games\DCS* folder that exists: those of the installs first (in install
 * order), then any other (left over from an earlier install, useful after a reinstall).
 */
export async function userLocations(
  ctx: CheckContext,
  installs: GameInstall[]
): Promise<Result<ConfigLocation[]>> {
  const savedGames = ctx.ports.folders.savedGames();
  const names = await ctx.ports.files.listEntries(savedGames);
  if (!names.ok) return names;
  const existing = names.value.filter((e) => e.isDirectory && /^DCS(\.[^\\/]+)?$/i.test(e.name));
  const ordered: string[] = [];
  for (const install of installs) {
    if (!install.userDir) continue;
    const match = existing.find((e) => sameDir(e.path, install.userDir!));
    if (match && !ordered.includes(match.name)) ordered.push(match.name);
  }
  for (const entry of existing.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ordered.includes(entry.name)) ordered.push(entry.name);
  }
  return ok(
    ordered.map((name) => ({
      id: locationId(name),
      label: `Saved Games\\${name}`,
      path: path.join(savedGames, name),
    }))
  );
}

/** The version of one install: the Steam build, or what a standalone install's autoupdate.cfg says. */
export async function installVersion(
  ctx: CheckContext,
  install: GameInstall
): Promise<Result<GameVersion>> {
  if (install.source === 'steam') {
    const app = await readSteamApp(ctx.ports, DCS_STEAM_APP_ID);
    if (!app.ok) return app;
    if (!app.value || !app.value.buildId) {
      return err('dcs.version', 'Steam has no build number for DCS World.');
    }
    return ok({
      version: `Steam build ${app.value.buildId}`,
      updatePending: app.value.updatePending,
    });
  }
  const file = path.join(install.installDir, 'autoupdate.cfg');
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return err('dcs.version', 'This DCS install has no readable autoupdate.cfg.');
  try {
    const parsed = JSON.parse(text.value.replace(/^﻿/, '')) as Record<string, unknown>;
    const version = typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
    const branch = typeof parsed['branch'] === 'string' ? parsed['branch'] : undefined;
    if (!version) return err('dcs.version', 'autoupdate.cfg does not name a version.');
    return ok({ version: branch ? `${version} (${branch})` : version });
  } catch (e) {
    return err('dcs.version', 'autoupdate.cfg is not readable.', String(e));
  }
}
