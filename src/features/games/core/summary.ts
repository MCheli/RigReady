import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameModule, GameRegistry } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import type { ProcessInfo } from '../../../shared/models';
import type { GameSummary } from '../contract';
import { manualFolderStore, type GameModuleExtras } from './helpers';

export type ExtrasById = Map<string, GameModuleExtras>;

/** Asks one game module what it finds on this machine. A module that fails reports a problem instead. */
export async function summarizeGame(
  module: GameModule,
  extras: GameModuleExtras | undefined,
  ctx: CheckContext,
  processes: ProcessInfo[] = []
): Promise<GameSummary> {
  const summary: GameSummary = {
    id: module.id,
    name: module.name,
    ...(extras?.kind ? { kind: extras.kind } : {}),
    installs: [],
    running: false,
    configLocations: [],
    trackedFiles: [],
    notes: extras?.notes ?? [],
    facts: [],
    problems: [],
  };
  try {
    const installs = await module.detect(ctx);
    if (installs.ok) summary.installs = installs.value;
    else summary.problems.push(installs.error.message);
    const first = summary.installs[0];
    if (first && module.installedVersion) {
      const version = await module.installedVersion(ctx, first);
      if (version.ok) summary.version = version.value;
    }
    const locations = await module.configLocations(ctx);
    if (locations.ok) summary.configLocations = locations.value;
    else summary.problems.push(locations.error.message);
    if (module.trackedFiles) {
      const tracked = await module.trackedFiles(ctx);
      if (tracked.ok) summary.trackedFiles = tracked.value;
      else summary.problems.push(tracked.error.message);
    }
    const names = new Set(
      [...(module.processes ?? []), ...(extras?.processes ?? [])].map((p) => p.toLowerCase())
    );
    summary.running = processes.some((p) => names.has(p.name.toLowerCase()));
    if (extras?.facts) summary.facts = await extras.facts(ctx);
    if (extras?.manualFolder) {
      const store = await manualFolderStore(ctx).read();
      const chosen = store.ok ? store.value.folders[module.id] : undefined;
      summary.manualFolder = { label: extras.manualFolder.label, ...(chosen ? { chosen } : {}) };
    }
  } catch (e) {
    ctx.log.error(`game module ${module.id} threw`, e);
    summary.problems.push(e instanceof Error ? e.message : String(e));
  }
  return summary;
}

/** Every game module. One module failing does not hide the others. */
export async function summarizeGames(
  games: GameRegistry,
  ctx: CheckContext,
  extras: ExtrasById = new Map()
): Promise<GameSummary[]> {
  const processes = await ctx.ports.processes.list();
  const running = processes.ok ? processes.value : [];
  const summaries: GameSummary[] = [];
  for (const module of games.all()) {
    summaries.push(await summarizeGame(module, extras.get(module.id), ctx, running));
  }
  return summaries;
}

export async function summarizeOne(
  games: GameRegistry,
  extras: ExtrasById,
  ctx: CheckContext,
  gameId: string
): Promise<Result<GameSummary>> {
  const module = games.get(gameId);
  if (!module) return err('games.unknown', `RigReady does not know a game called "${gameId}".`);
  const processes = await ctx.ports.processes.list();
  return ok(
    await summarizeGame(module, extras.get(gameId), ctx, processes.ok ? processes.value : [])
  );
}

/**
 * Remembers a folder the user picked for a game, after checking that it holds the
 * game's program; refuses a folder that does not.
 */
export async function rememberFolder(
  ctx: CheckContext,
  gameId: string,
  extras: GameModuleExtras | undefined,
  folder: string
): Promise<Result<void>> {
  if (!extras?.manualFolder) {
    return err('games.noManualFolder', 'This game cannot be pointed at by hand.');
  }
  const exe = path.join(folder, extras.manualFolder.exe);
  if (!(await ctx.ports.files.exists(exe))) {
    return err(
      'games.wrongFolder',
      `That folder does not contain ${extras.manualFolder.exe}. Choose ${extras.manualFolder.label}.`
    );
  }
  const saved = await manualFolderStore(ctx).update((current) => ({
    folders: { ...current.folders, [gameId]: folder },
  }));
  return saved.ok ? ok(undefined) : saved;
}

export async function forgetFolder(ctx: CheckContext, gameId: string): Promise<Result<void>> {
  const saved = await manualFolderStore(ctx).update((current) => {
    const folders = { ...current.folders };
    delete folders[gameId];
    return { folders };
  });
  return saved.ok ? ok(undefined) : saved;
}

/** Starts the game's first install. Steam launches are handed to Steam, which starts the game itself. */
export async function launchGame(
  ctx: CheckContext,
  summary: GameSummary
): Promise<Result<{ message: string }>> {
  const install = summary.installs.find((i) => i.launch);
  if (!install?.launch) {
    return err('games.noLaunch', `RigReady does not know how to start ${summary.name} on this PC.`);
  }
  const started = await ctx.ports.processes.start(install.launch);
  if (!started.ok) return started;
  const exe = path.win32.basename(install.launch.exe);
  if (install.source === 'steam') {
    return ok({ message: `Asked Steam to start ${summary.name}.` });
  }
  const list = await ctx.ports.processes.list();
  const running = list.ok && list.value.some((p) => p.name.toLowerCase() === exe.toLowerCase());
  return running
    ? ok({ message: `Started ${summary.name}.` })
    : err('games.notStarted', `${exe} was started but is not running.`);
}
