import type { CheckContext } from './checks/registry';
import type { Result } from './result';
import type { LaunchTarget } from '../shared/models';

export interface GameInstall {
  /** How it was found. */
  source: 'steam' | 'standalone' | 'store';
  installDir: string;
  /** How to start it, when known. */
  launch?: LaunchTarget;
}

export interface ConfigLocation {
  id: string;
  label: string;
  path: string;
}

export interface TrackedFileSuggestion {
  label: string;
  path: string;
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
