import path from 'node:path';
import { z } from 'zod';
import { readDataText } from './files/text';
import { LOG_LEVELS } from './logger';
import type { Clock, FileStore } from './ports';
import { err, ok, type Result } from './result';

/** The name under which the user's Anthropic API key is kept in ports.secrets. */
export const AI_KEY_SECRET = 'anthropic-api-key';

export const AppSettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Id of the named display layout Stand down goes back to. Unset: Stand down leaves the monitors alone. */
  deskLayoutId: z.string().optional(),
  startWithWindows: z.boolean().default(false),
  /** Closing the window hides it to the tray instead of quitting. */
  minimizeToTray: z.boolean().default(true),
  /** True while a key is stored in ports.secrets under AI_KEY_SECRET. The key itself is never here. */
  aiKeyPresent: z.boolean().default(false),
  retention: z
    .object({
      /** Automatic backups are kept at least this many days... */
      autoBackupDays: z.number().int().min(1).max(3650).default(30),
      /** ...and the newest this many actions are kept whatever their age. */
      autoBackupGroups: z.number().int().min(1).max(10_000).default(50),
    })
    .prefault({}),
  /** Seconds a newly applied monitor layout waits for "Keep" before it reverts. */
  displayRevertSeconds: z.number().int().min(5).max(120).default(15),
  /** Seconds one check may run before it is reported as timed out. */
  checkTimeoutSeconds: z.number().int().min(1).max(60).default(5),
  /** Largest import (a .rigready bundle or backup archive, unpacked) that is accepted. */
  importMaxMegabytes: z.number().int().min(1).max(4096).default(200),
  /** How much is written to the log. RIGREADY_LOG_LEVEL in the environment wins over this. */
  logLevel: z.enum(LOG_LEVELS).default('info'),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

/** A partial change: nested objects are merged one level deep. */
export const AppSettingsPatchSchema = z.object({
  deskLayoutId: z.string().nullable().optional(),
  startWithWindows: z.boolean().optional(),
  minimizeToTray: z.boolean().optional(),
  aiKeyPresent: z.boolean().optional(),
  retention: z
    .object({
      autoBackupDays: z.number().int().optional(),
      autoBackupGroups: z.number().int().optional(),
    })
    .optional(),
  displayRevertSeconds: z.number().int().optional(),
  checkTimeoutSeconds: z.number().int().optional(),
  importMaxMegabytes: z.number().int().optional(),
  logLevel: z.enum(LOG_LEVELS).optional(),
});
export type AppSettingsPatch = z.infer<typeof AppSettingsPatchSchema>;

export const defaultSettings = (): AppSettings => AppSettingsSchema.parse({});

/**
 * App settings as JSON at <data root>/settings.json. Missing fields get defaults; a
 * file that cannot be read as settings is set aside (never deleted) and defaults are
 * used, with a notice the UI can show.
 */
export class SettingsStore {
  private cached: AppSettings | undefined;
  private notice: string | undefined;
  private listeners = new Set<(settings: AppSettings) => void>();

  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string,
    private readonly clock: Clock
  ) {}

  get file(): string {
    return path.join(this.dataRoot, 'settings.json');
  }

  async get(): Promise<Result<AppSettings>> {
    if (this.cached) return ok(structuredClone(this.cached));
    if (!(await this.files.exists(this.file))) {
      this.cached = defaultSettings();
      return ok(structuredClone(this.cached));
    }
    // A file that cannot be read at all (locked, too large) is left alone and reported:
    // only content that is not settings is set aside.
    const text = await readDataText(this.files, this.file);
    if (!text.ok) return text;
    let parsed: ReturnType<typeof AppSettingsSchema.safeParse> | undefined;
    try {
      parsed = AppSettingsSchema.safeParse(JSON.parse(text.value));
    } catch {
      // Not JSON: handled below like any content that is not settings (set aside, defaults, notice).
      parsed = undefined;
    }
    if (parsed?.success) {
      this.cached = parsed.data;
      return ok(structuredClone(this.cached));
    }
    const stamp = this.clock.now().toISOString().replace(/[:.]/g, '-');
    const aside = path.join(this.dataRoot, `settings.corrupt-${stamp}.json`);
    // Byte for byte: the text above lost its byte order mark and anything that was not UTF-8.
    const original = await this.files.readBytes(this.file);
    if (!original.ok) return original;
    const kept = await this.files.write(aside, original.value, {
      reason: 'Unreadable settings file',
    });
    if (!kept.ok) return kept;
    this.cached = defaultSettings();
    this.notice = `The settings file could not be read, so defaults are in use. The old file was kept as ${aside}.`;
    const saved = await this.save(this.cached);
    if (!saved.ok) return saved;
    return ok(structuredClone(this.cached));
  }

  /** Set when get() had to fall back to defaults. Reading it clears it. */
  takeNotice(): string | undefined {
    const notice = this.notice;
    this.notice = undefined;
    return notice;
  }

  private async save(settings: AppSettings): Promise<Result<AppSettings>> {
    const written = await this.files.write(this.file, JSON.stringify(settings, null, 2) + '\n', {
      reason: 'Settings',
    });
    if (!written.ok) return written;
    return ok(settings);
  }

  async update(patch: AppSettingsPatch): Promise<Result<AppSettings>> {
    const current = await this.get();
    if (!current.ok) return current;
    const { deskLayoutId, retention, ...rest } = patch;
    const merged: Record<string, unknown> = { ...current.value };
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined) merged[key] = value;
    }
    if (retention) merged['retention'] = { ...current.value.retention, ...retention };
    if (deskLayoutId === null) delete merged['deskLayoutId'];
    else if (deskLayoutId !== undefined) merged['deskLayoutId'] = deskLayoutId;
    const next = AppSettingsSchema.safeParse(merged);
    if (!next.success) {
      return err('settings.invalid', 'That setting is not valid.', z.prettifyError(next.error));
    }
    const saved = await this.save(next.data);
    if (!saved.ok) return saved;
    this.cached = next.data;
    for (const listener of [...this.listeners]) listener(structuredClone(next.data));
    return ok(structuredClone(next.data));
  }

  /** Called after every successful update. Returns the unsubscribe function. */
  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
