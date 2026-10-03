import type { CheckContext } from './checks/registry';
import type { Result } from './result';
import type { LaunchTarget } from '../shared/models';

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
   */
  pathVariables?(ctx: CheckContext): Promise<Result<Record<string, string>>>;
  bindings?: BindingManager;
}

export class GameRegistry {
  private modules = new Map<string, GameModule>();

  register(module: GameModule): void {
    if (this.modules.has(module.id)) throw new Error(`Game module registered twice: ${module.id}`);
    this.modules.set(module.id, module);
  }

  get(id: string): GameModule | undefined {
    return this.modules.get(id);
  }

  all(): GameModule[] {
    return [...this.modules.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
