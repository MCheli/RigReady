import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameRegistry } from '../../../core/games';
import { err, ok, type Result } from '../../../core/result';
import type { InputDevice } from '../../../shared/models';

/** What racing code needs: the ports, and the game registry for every game path. */
export interface RacingContext extends CheckContext {
  games: GameRegistry;
}

export type RacingGameId = 'iracing' | 'lmu' | 'beamng' | 'assetto-corsa';

/** Racing games with a page of their own, and the processes that hold their files. */
export const RACING_GAMES: {
  id: RacingGameId;
  name: string;
  /** Running = the game is open (any of these). */
  processes: string[];
  /** Restoring files is refused while one of these runs: it would overwrite them. */
  blocking: string[];
  why: string;
}[] = [
  {
    id: 'iracing',
    name: 'iRacing',
    processes: ['iRacingSim64DX11.exe', 'iRacingUI.exe'],
    blocking: ['iRacingSim64DX11.exe'],
    why: 'iRacing writes its settings when the simulator exits and would undo the change.',
  },
  {
    id: 'lmu',
    name: 'Le Mans Ultimate',
    processes: ['Le Mans Ultimate.exe', 'start_protected_game.exe'],
    blocking: ['Le Mans Ultimate.exe', 'start_protected_game.exe'],
    why: 'Le Mans Ultimate rewrites its player files when it starts and exits.',
  },
  {
    id: 'beamng',
    name: 'BeamNG.drive',
    processes: ['BeamNG.drive.exe'],
    blocking: ['BeamNG.drive.exe'],
    why: 'BeamNG.drive saves its bindings and settings while it runs and on exit.',
  },
  {
    id: 'assetto-corsa',
    name: 'Assetto Corsa',
    processes: ['AssettoCorsa.exe', 'acs.exe', 'Content Manager.exe'],
    blocking: ['acs.exe', 'AssettoCorsa.exe', 'Content Manager.exe'],
    why: 'Assetto Corsa and Content Manager write controls.ini when you change controls.',
  },
];

export const racingGame = (id: RacingGameId): (typeof RACING_GAMES)[number] =>
  RACING_GAMES.find((g) => g.id === id)!;

/** The first install of a game, or undefined when the game is not on this PC. */
export async function installOf(
  ctx: RacingContext,
  gameId: string
): Promise<GameInstall | undefined> {
  const module = ctx.games.get(gameId);
  if (!module) return undefined;
  const installs = await module.detect(ctx);
  return installs.ok ? installs.value[0] : undefined;
}

/** A config location of a game by its id ("documents", "player", "user", "cfg"). */
export async function locationOf(
  ctx: RacingContext,
  gameId: string,
  locationId: string
): Promise<string | undefined> {
  const module = ctx.games.get(gameId);
  if (!module) return undefined;
  const locations = await module.configLocations(ctx);
  if (!locations.ok) return undefined;
  return locations.value.find((l) => l.id === locationId)?.path;
}

/** Names of the running processes, lower case. Empty when the list cannot be read. */
export async function runningNames(ctx: CheckContext): Promise<Set<string>> {
  const list = await ctx.ports.processes.list();
  return new Set((list.ok ? list.value : []).map((p) => p.name.toLowerCase()));
}

export async function isRunning(ctx: CheckContext, names: string[]): Promise<boolean> {
  const running = await runningNames(ctx);
  return names.some((n) => running.has(n.toLowerCase()));
}

/** Refuses with a clear reason while the game that owns the files is open. */
export async function refuseWhileRunning(
  ctx: CheckContext,
  gameId: RacingGameId
): Promise<Result<void>> {
  const game = racingGame(gameId);
  if (await isRunning(ctx, game.blocking)) {
    return err('racing.gameRunning', `Close ${game.name} first. ${game.why}`);
  }
  return ok(undefined);
}

/**
 * The game controllers DirectInput sees now (the same list games see). Undefined when
 * they cannot be read, so callers never mistake "unknown" for "unplugged".
 */
export async function liveControllers(ctx: CheckContext): Promise<InputDevice[] | undefined> {
  const started = await ctx.ports.input.start();
  return started.ok ? started.value : undefined;
}

export const cleanGuid = (g: string): string => g.replace(/[{}]/g, '').toUpperCase();
