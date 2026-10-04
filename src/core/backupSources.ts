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
 *     program: { name: 'Stream Deck', processes: ['StreamDeck.exe'], restart: true,
 *       why: 'Stream Deck writes its profiles when it quits.' },
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

/**
 * A program that keeps the files a source suggests open, or writes them when it quits:
 * it has to be closed before those files are restored, or the restore is lost.
 */
export interface HoldingProgram {
  /** "Stream Deck" */
  name: string;
  /** Image names; any of them running means the program is open. */
  processes: string[];
  /** One sentence the user reads: "Stream Deck writes its profiles when it quits." */
  why: string;
  /** Start it again after a restore that closed it (helper tools; a game is left closed). */
  restart?: boolean;
}

/**
 * Settings that are not files (registry values). A full backup stores them as data so
 * they can be read later; they are shown, never restored (the registry port is read-only).
 */
export interface BackupRecord {
  /** File-name safe: "fanatec-service". */
  id: string;
  /** "Fanatec driver settings" */
  label: string;
  /** Where it was read from, in words: "HKEY_CURRENT_USER\Software\Endor\FanatecService". */
  from: string;
  data: unknown;
  /**
   * The same settings, one line per value, for reading: the backup screens show these as
   * a table and keep `data` as the raw view. Optional: without it the table is derived
   * from `data` (key path and value, no friendly labels).
   */
  values?: BackupRecordValue[];
}

/** One stored setting of a record, as a person reads it. */
export interface BackupRecordValue {
  /** Heading the value is listed under: "Games › 5_0". Values without one come first. */
  group?: string;
  /** "Steam edition installed" */
  label: string;
  /** The name as stored ("IsSteamInstalled"), when the label is not it. */
  name?: string;
  /** Readable text; long binary data already shortened by the source. */
  value: string;
}

export interface BackupSource {
  id: string;
  label: string;
  /**
   * Suggestions for this PC. Paths may be absolute or in stored form; ones that do not
   * exist here are left out by the backup page.
   */
  suggest(ctx: CheckContext): Promise<Result<BackupSuggestion[]>>;
  /** The program that must be closed before the suggested files are restored. */
  program?: HoldingProgram;
  /** Settings kept outside files, added to every full backup as a record. */
  records?(ctx: CheckContext): Promise<Result<BackupRecord[]>>;
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
