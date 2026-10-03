import type { CheckContext } from './checks/registry';
import type { Result } from './result';

/**
 * Something worth backing up that a feature knows about: a game's settings, a tool's
 * profiles. The backup page lists every suggestion with one-click add.
 *
 * Game modules suggest through GameModule.trackedFiles; anything that is not a game
 * (Stream Deck, TrackIR, Fanatec, ...) registers a source from its feature's main.ts:
 *
 *   ctx.backupSources.register({
 *     id: 'stream-deck',
 *     label: 'Stream Deck',
 *     async suggest(ctx) {
 *       return ok([{ label: 'Stream Deck profiles', path: '{APPDATA}/Elgato/StreamDeck/ProfilesV3',
 *         kind: 'folder', exclude: ['*.png'] }]);
 *     },
 *   });
 */
export interface BackupSuggestion {
  /** Shown in lists: "DCS bindings". */
  label: string;
  /** Stored form with a path variable: "{DCS_USER}/Config/Input". */
  path: string;
  kind: 'file' | 'folder';
  /** Glob patterns on paths below a folder (see FileStore.listTree). */
  include?: string[];
  exclude?: string[];
  /** Game module id, when it belongs to a game. */
  game?: string;
  /** One line on what it holds. */
  description?: string;
}

export interface BackupSource {
  id: string;
  label: string;
  /** Only suggestions whose folder or file exists on this PC. */
  suggest(ctx: CheckContext): Promise<Result<BackupSuggestion[]>>;
}

export class BackupSourceRegistry {
  private sources = new Map<string, BackupSource>();

  register(source: BackupSource): void {
    if (this.sources.has(source.id))
      throw new Error(`Backup source registered twice: ${source.id}`);
    this.sources.set(source.id, source);
  }

  all(): BackupSource[] {
    return [...this.sources.values()];
  }
}
