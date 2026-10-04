import path from 'node:path';
import { z } from 'zod';
import type { CheckContext } from '../../../core/checks/registry';
import type {
  ConfigLocation,
  GameInstall,
  GameVersion,
  TrackedFileSuggestion,
} from '../../../core/games';
import { JsonStore } from '../../../core/jsonStore';
import { ok, type Result } from '../../../core/result';
import { readSteamApp, steamRoot, type SteamApp } from '../../../core/steam';
import type { LaunchTarget } from '../../../shared/models';

/**
 * What a game module can say beyond the GameModule interface. A module file exports
 * it as `export const extras`; only the games feature reads it.
 */
export interface GameModuleExtras {
  /** Offer "Choose folder…" when the game is not found; the folder must contain this file. */
  manualFolder?: { exe: string; label: string };
  /** Plain-language facts shown on the game's page (what RigReady can and cannot read). */
  notes?: string[];
  /** Short product family, shown as a chip: "Racing", "Flight". */
  kind?: 'racing' | 'flight';
  /** Facts about this PC worth a line on the game's page ("Last run with 0.38.5"). */
  facts?(ctx: CheckContext): Promise<string[]>;
}

/** Folders the user pointed RigReady at for games it could not find by itself. */
export const ManualFoldersSchema = z.object({
  folders: z.record(z.string(), z.string()).default({}),
});

export function manualFolderStore(ctx: CheckContext): JsonStore<typeof ManualFoldersSchema> {
  return new JsonStore(
    ctx.ports.files,
    path.join(ctx.ports.folders.dataRoot(), 'games', 'folders.json'),
    ManualFoldersSchema
  );
}

/** The folder chosen by hand for a game, when there is one and it still holds the game. */
export async function manualInstall(
  ctx: CheckContext,
  gameId: string,
  exe: string
): Promise<GameInstall | undefined> {
  const store = await manualFolderStore(ctx).read();
  if (!store.ok) return undefined;
  const dir = store.value.folders[gameId];
  if (!dir) return undefined;
  const full = path.join(dir, exe);
  if (!(await ctx.ports.files.exists(full))) return undefined;
  return { source: 'standalone', installDir: dir, launch: { exe: full, args: [], cwd: dir } };
}

/** How to start a Steam game: steam.exe -applaunch <appid>, never a shell string. */
export async function steamLaunch(
  ctx: CheckContext,
  appId: string
): Promise<LaunchTarget | undefined> {
  const registryRoot = await steamRoot(ctx.ports.registry);
  if (!registryRoot) return undefined;
  // The registry spells the folder in lower case; the library list as it is on disk.
  const libraries = await ctx.ports.folders.steamLibraries();
  const root =
    (libraries.ok ? libraries.value : []).find(
      (l) => l.toLowerCase() === registryRoot.toLowerCase()
    ) ?? registryRoot;
  const exe = path.join(root, 'steam.exe');
  if (!(await ctx.ports.files.exists(exe))) return undefined;
  return { exe, args: ['-applaunch', appId] };
}

/**
 * A Steam install of a game: the app manifest in any library. When `exe` is given the
 * file must also exist, so a half-removed game is not reported.
 */
export async function steamInstall(
  ctx: CheckContext,
  appId: string,
  exe?: string
): Promise<Result<{ install: GameInstall; app: SteamApp } | undefined>> {
  const app = await readSteamApp(ctx.ports, appId);
  if (!app.ok) return app;
  if (!app.value) return ok(undefined);
  const installed = (app.value.stateFlags & 4) !== 0 || app.value.updatePending;
  if (!installed) return ok(undefined);
  if (exe && !(await ctx.ports.files.exists(path.join(app.value.installDir, exe)))) {
    return ok(undefined);
  }
  const launch = await steamLaunch(ctx, appId);
  return ok({
    install: { source: 'steam', installDir: app.value.installDir, ...(launch ? { launch } : {}) },
    app: app.value,
  });
}

/** The installed Steam build and whether Steam has an update queued. */
export async function steamVersion(ctx: CheckContext, appId: string): Promise<Result<GameVersion>> {
  const app = await readSteamApp(ctx.ports, appId);
  if (!app.ok) return app;
  if (!app.value) return ok({ version: 'unknown' });
  return ok({
    version: `Build ${app.value.buildId}`,
    updatePending: app.value.updatePending,
  });
}

/** Locations that exist on this PC. */
export async function existingLocations(
  ctx: CheckContext,
  candidates: ConfigLocation[]
): Promise<ConfigLocation[]> {
  const found: ConfigLocation[] = [];
  for (const candidate of candidates) {
    if (await ctx.ports.files.exists(candidate.path)) found.push(candidate);
  }
  return found;
}

/** Suggestions whose file or folder exists on this PC. */
export async function existingFiles(
  ctx: CheckContext,
  candidates: TrackedFileSuggestion[]
): Promise<TrackedFileSuggestion[]> {
  const found: TrackedFileSuggestion[] = [];
  for (const candidate of candidates) {
    if (await ctx.ports.files.exists(candidate.path)) found.push(candidate);
  }
  return found;
}

/** First line of a small text file, trimmed; undefined when missing or empty. */
export async function readFirstLine(ctx: CheckContext, file: string): Promise<string | undefined> {
  if (!(await ctx.ports.files.exists(file))) return undefined;
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return undefined;
  const line = text.value.split(/\r?\n/)[0]?.trim();
  return line ? line : undefined;
}
