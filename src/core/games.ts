import type { CheckContext } from './checks/registry';
import type { GamePlayedWith } from './gearKind';
import type { Ports } from './ports';
import type { Result } from './result';
import type { GameKind, LaunchTarget } from '../shared/models';

export interface GameInstall {
  /** How it was found. */
  source: 'steam' | 'standalone' | 'store';
  installDir: string;
  /** How to start it, when known. */
  launch?: LaunchTarget;
  /**
   * The per-user folder this install reads and writes (DCS: Saved Games\DCS or
   * Saved Games\DCS.<variant>), for games that keep one per install.
   */
  userDir?: string;
}

export interface GameVersion {
  /** Whatever identifies the build: "2.9.15.9408", a Steam build id, ... */
  version: string;
  /** True when the launcher has an update queued and the game may not start until it is applied. */
  updatePending?: boolean;
}

export interface ConfigLocation {
  id: string;
  label: string;
  path: string;
}

export interface TrackedFileSuggestion {
  label: string;
  /** Absolute, or stored form with a path variable ("{DCS_USER}/Config/Input"). */
  path: string;
  /** Optional, for the backup feature: a folder's include/exclude globs (see FileStore.listTree). */
  kind?: 'file' | 'folder';
  include?: string[];
  exclude?: string[];
  description?: string;
}

/** Marker for the binding feature to extend; game modules that manage bindings provide one. */
export interface BindingManager {
  /** Folders (one per aircraft/car) that hold binding files. */
  bindingRoots(ctx: CheckContext): Promise<Result<ConfigLocation[]>>;
}

/**
 * One per game, in src/features/games/<game>/module.ts. This is the only place a
 * game's paths are known; there are no path tables anywhere else.
 */
export interface GameModule {
  id: string;
  name: string;
  /**
   * The family of sims it belongs to. A setup for the game keeps, by default, the gear
   * and helper apps of that family and leaves the other family's out.
   */
  kind?: GameKind;
  /**
   * What the game is played with, where that is narrower than its kind: which gear it
   * reads, whether it takes helper programs or a microphone, whether it reads a gamepad
   * and not sim gear. Optional, and so is every part of it; a new setup starts from it
   * (see core/gearKind).
   */
  playedWith?: GamePlayedWith;
  /** Every installation found: all Steam libraries, standalone, Store. */
  detect(ctx: CheckContext): Promise<Result<GameInstall[]>>;
  /** Where the game keeps per-user configuration. */
  configLocations(ctx: CheckContext): Promise<Result<ConfigLocation[]>>;
  /** Files worth tracking and backing up. */
  trackedFiles?(ctx: CheckContext): Promise<Result<TrackedFileSuggestion[]>>;
  /**
   * The installed version of one install (DCS: autoupdate.cfg; Steam games: the app
   * manifest's build id via core/steam.ts), for "updated since you last verified".
   */
  installedVersion?(ctx: CheckContext, install: GameInstall): Promise<Result<GameVersion>>;
  /**
   * Path variables this game adds, e.g. { DCS_USER: <Saved Games>\\DCS, DCS_INSTALL: ... }.
   * Only variables whose folder exists on this PC. See core/pathVariables.ts.
   *
   * `installDir` is the install a setup chose (Profile.gameInstall): the variables then
   * describe that install, and the result is an error when it is no longer there. The
   * wrong install's folders are never handed out in its place.
   */
  pathVariables?(ctx: CheckContext, installDir?: string): Promise<Result<Record<string, string>>>;
  /**
   * What each variable of `pathVariables` means, in words ({ DCS_USER: 'DCS user folder' }).
   * Every variable the module can hand out is listed here, so that a setup may name it on a
   * PC where the game is not installed, and the editor can offer it. core/pathVariables.ts
   * `knownPathVariables` collects them; tests/unit/pathVariablesAudit.test.ts checks that no
   * variable is handed out without a label.
   */
  pathVariableLabels?: Record<string, string>;
  /**
   * Image names that mean the game is running ("DCS.exe"). Used to tell whether a game
   * started through Steam is up, and by backup: the game must be closed before a restore.
   */
  processes?: string[];
  /**
   * What has to be closed before this game's files are restored, and why, in a sentence
   * the user reads ("iRacing writes these files when the simulator exits."). Without it,
   * `processes` is used with a general reason. `processes` here narrows the list when
   * only some of the game's programs write the files (iRacing: the simulator, not its UI).
   */
  closeBeforeRestore?: { processes?: string[]; why: string };
  bindings?: BindingManager;
}

/**
 * Whether one of the game's programs (`processes`, "DCS.exe" and "DCS_mt.exe" for DCS) is
 * running now. The one definition every feature that refuses to write a game's files while
 * it runs goes by, so that they cannot disagree. Image names are compared without regard to
 * case. False when the list of programs cannot be read, and for a module that names none.
 */
export async function gameRunning(
  ctx: { ports: Pick<Ports, 'processes'> },
  module: Pick<GameModule, 'processes'> | undefined
): Promise<boolean> {
  const names = new Set((module?.processes ?? []).map((name) => name.toLowerCase()));
  if (names.size === 0) return false;
  const processes = await ctx.ports.processes.list();
  return processes.ok && processes.value.some((p) => names.has(p.name.toLowerCase()));
}

/**
 * Games the user adds on the Games page have ids that start with this, so that a game
 * RigReady ships later can never take the id of one the user made ("user-star-hauler").
 */
export const USER_GAME_PREFIX = 'user-';

/** Whether a game id names a game the user added (on this PC or the one a setup came from). */
export function isUserGame(id: string | undefined): boolean {
  return id !== undefined && id.startsWith(USER_GAME_PREFIX);
}

/** What a setup for a game the user added is called for when this PC does not have that game. */
export const ANOTHER_GAME = 'Another game';

/**
 * The name a setup's game goes by, for showing: the game module's name, the name typed for
 * "Another game", and for a game the user added that this PC does not have (its entry was
 * taken out of games/custom.json by hand), "Another game" rather than its id. Undefined for
 * a setup without a game. An id of a game this version does not know is shown as it is.
 */
export function setupGameName(
  setup: { game?: string; gameName?: string },
  games: Pick<GameRegistry, 'get'>
): string | undefined {
  if (!setup.game) return undefined;
  if (setup.game === 'other') return setup.gameName;
  const module = games.get(setup.game);
  if (module) return module.name;
  return isUserGame(setup.game) ? (setup.gameName ?? ANOTHER_GAME) : setup.game;
}

/**
 * A setup for a game the user added, on a PC that does not have that game (it was removed
 * here, or the setup was shared from another PC): it becomes a setup for "Another game"
 * with that game's name, which is what it would have been without it. Its checklist,
 * launch target and actions are kept as they are.
 */
export function asAnotherGame<P extends { game?: string; gameName?: string; gameInstall?: string }>(
  setup: P,
  name: string
): P {
  const next: P = { ...setup, game: 'other', gameName: name.trim().slice(0, 80) };
  delete next.gameInstall;
  return next;
}

export class GameRegistry {
  private modules = new Map<string, GameModule>();

  register(module: GameModule): void {
    if (this.modules.has(module.id)) throw new Error(`Game module registered twice: ${module.id}`);
    this.modules.set(module.id, module);
  }

  /**
   * Takes a game out again: only games the user added come and go while the app runs (they
   * are added, edited and removed on the Games page). True when it was there.
   */
  unregister(id: string): boolean {
    if (!isUserGame(id)) throw new Error(`Only a game the user added can be removed: ${id}`);
    return this.modules.delete(id);
  }

  get(id: string): GameModule | undefined {
    return this.modules.get(id);
  }

  all(): GameModule[] {
    return [...this.modules.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
