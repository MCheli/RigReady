import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type {
  ConfigLocation,
  GameInstall,
  GameModule,
  TrackedFileSuggestion,
} from '../../../core/games';
import { ok } from '../../../core/result';
import { steamRoot } from '../../../core/steam';
import {
  existingFiles,
  existingLocations,
  manualInstall,
  steamInstall,
  steamVersion,
  type GameModuleExtras,
} from './helpers';

/**
 * A game module of the common kind: found in Steam (and, when the spec says how, in a
 * standalone or Store install), launched through Steam or its own program, with settings
 * folders and files to back up. The games added in November 2026 are built on it; each
 * module file still holds that game's own ids and paths, and nothing else does.
 * Sources for every id and path are in docs/research/game-modules-2026-11.md.
 */
export interface SimpleGameSpec {
  id: string;
  name: string;
  /** Absent for a game that is neither (a game the user added can be). */
  kind?: 'flight' | 'racing';
  /** Steam app id, when the game is sold on Steam. */
  steamAppId?: string;
  /**
   * The game's program, relative to its folder. The folder chosen by hand must contain it.
   * Absent when the game cannot be pointed at by hand (a game the user added names its
   * program itself).
   */
  exe?: string;
  /** Also require `exe` in a Steam install (only when its place in the Steam folder is known). */
  steamNeedsExe?: boolean;
  /** Installs found another way: the publisher's launcher, a standalone installer, the Store. */
  otherInstalls?(ctx: CheckContext): Promise<GameInstall[]>;
  /** Image names that mean the game is running. */
  processes: string[];
  /** Why the game must be closed before its files are restored, in one sentence. */
  closeWhy: string;
  /** Candidate settings folders; only those that exist are shown. */
  locations(ctx: CheckContext, installs: GameInstall[]): Promise<ConfigLocation[]>;
  /** Candidate files and folders worth backing up; only those that exist are offered. */
  tracked(ctx: CheckContext, installs: GameInstall[]): Promise<TrackedFileSuggestion[]>;
  /** Version of an install that is not a Steam one. */
  otherVersion?(ctx: CheckContext, install: GameInstall): Promise<string | undefined>;
  /** What to choose when the game is pointed at by hand ("the X-Plane 12 folder"); needs `exe`. */
  manualLabel?: string;
  notes: string[];
  facts?(ctx: CheckContext, installs: GameInstall[]): Promise<string[]>;
}

export function simpleGame(spec: SimpleGameSpec): { module: GameModule; extras: GameModuleExtras } {
  async function findInstalls(ctx: CheckContext): Promise<GameInstall[]> {
    const installs: GameInstall[] = [];
    if (spec.steamAppId) {
      const steam = await steamInstall(
        ctx,
        spec.steamAppId,
        spec.steamNeedsExe ? spec.exe : undefined
      );
      if (steam.ok && steam.value) installs.push(steam.value.install);
    }
    for (const other of spec.otherInstalls ? await spec.otherInstalls(ctx) : []) {
      const same = installs.some(
        (i) =>
          path.resolve(i.installDir).toLowerCase() === path.resolve(other.installDir).toLowerCase()
      );
      if (!same) installs.push(other);
    }
    if (installs.length === 0 && spec.exe && spec.manualLabel) {
      const manual = await manualInstall(ctx, spec.id, spec.exe);
      if (manual) installs.push(manual);
    }
    return installs;
  }

  const module: GameModule = {
    id: spec.id,
    name: spec.name,
    ...(spec.kind ? { kind: spec.kind } : {}),
    processes: spec.processes,
    closeBeforeRestore: { why: spec.closeWhy },

    detect: async (ctx) => ok(await findInstalls(ctx)),

    async configLocations(ctx) {
      const candidates = await spec.locations(ctx, await findInstalls(ctx));
      return ok(
        await existingLocations(
          ctx,
          unique(candidates, (c) => c.path)
        )
      );
    },

    async trackedFiles(ctx) {
      const candidates = await spec.tracked(ctx, await findInstalls(ctx));
      return ok(
        await existingFiles(
          ctx,
          unique(candidates, (c) => c.path)
        )
      );
    },

    async installedVersion(ctx, install) {
      if (install.source === 'steam' && spec.steamAppId) return steamVersion(ctx, spec.steamAppId);
      const version = spec.otherVersion ? await spec.otherVersion(ctx, install) : undefined;
      return ok({ version: version ?? 'unknown' });
    },
  };

  const extras: GameModuleExtras = {
    ...(spec.kind ? { kind: spec.kind } : {}),
    ...(spec.exe && spec.manualLabel
      ? { manualFolder: { exe: spec.exe, label: spec.manualLabel } }
      : {}),
    notes: spec.notes,
    ...(spec.facts ? { facts: async (ctx) => spec.facts!(ctx, await findInstalls(ctx)) } : {}),
  };
  return { module, extras };
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = path.resolve(key(item)).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** One suggestion per file in `dir` whose name matches, labelled by `label(name)`. */
export async function filesIn(
  ctx: CheckContext,
  dir: string,
  pattern: RegExp,
  label: (name: string) => string,
  description?: string
): Promise<TrackedFileSuggestion[]> {
  const entries = await ctx.ports.files.listEntries(dir);
  return (entries.ok ? entries.value : [])
    .filter((e) => !e.isDirectory && pattern.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      label: label(e.name),
      path: path.join(dir, e.name),
      kind: 'file' as const,
      ...(description ? { description } : {}),
    }));
}

/** Steam Cloud folders of a game (userdata\<account>\<appid>\remote), one per Steam account. */
export async function steamCloudFolders(ctx: CheckContext, appId: string): Promise<string[]> {
  const root = await steamRoot(ctx.ports.registry);
  if (!root) return [];
  const users = await ctx.ports.files.list(path.join(root, 'userdata'));
  const found: string[] = [];
  for (const user of users.ok ? users.value : []) {
    const remote = path.join(root, 'userdata', user, appId, 'remote');
    if (await ctx.ports.files.exists(remote)) found.push(remote);
  }
  return found;
}

/** A Microsoft Store install, recognised by its package folder; Windows starts it, not RigReady. */
export async function storeInstall(ctx: CheckContext, packageName: string): Promise<GameInstall[]> {
  const dir = path.join(ctx.ports.folders.localAppData(), 'Packages', packageName);
  return (await ctx.ports.files.exists(dir)) ? [{ source: 'store', installDir: dir }] : [];
}

/** A program in a folder, as a standalone install started directly. */
export async function standaloneAt(
  ctx: CheckContext,
  dir: string,
  exe: string
): Promise<GameInstall | undefined> {
  const full = path.join(dir, exe);
  if (!(await ctx.ports.files.exists(full))) return undefined;
  return {
    source: 'standalone',
    installDir: dir,
    launch: { exe: full, args: [], cwd: path.dirname(full) },
  };
}
