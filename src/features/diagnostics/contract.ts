import { z } from 'zod';
import { LOG_LEVELS } from '../../core/logger';
import { channel, defineContract, noInput } from '../../shared/ipc';

export const LogLevelSchema = z.enum(LOG_LEVELS);

export const LogEntrySchema = z.object({
  time: z.string(),
  level: LogLevelSchema,
  scope: z.string(),
  text: z.string(),
});
export type LogEntryView = z.infer<typeof LogEntrySchema>;

export const ErrorReportSchema = z.object({
  id: z.string(),
  time: z.string(),
  source: z.enum(['main', 'window', 'process']),
  message: z.string(),
  detail: z.string().optional(),
  count: z.number().int(),
});
export type ErrorReportView = z.infer<typeof ErrorReportSchema>;

const SectionError = z.string().optional();

export const OverviewSchema = z.object({
  app: z.object({
    version: z.string(),
    /** Electron, Chromium and Node versions; absent outside the app (unit tests). */
    electron: z.string().optional(),
    chrome: z.string().optional(),
    node: z.string(),
    /** "Windows 11 Pro 10.0.26200 (x64)". */
    os: z.string(),
  }),
  dataRoot: z.string(),
  logFolder: z.string(),
  log: z.object({
    level: LogLevelSchema,
    /** True when RIGREADY_LOG_LEVEL decides the level, so the setting cannot change it. */
    fixedByEnvironment: z.boolean(),
  }),
  games: z.object({
    error: SectionError,
    found: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        installs: z.array(z.object({ source: z.string(), installDir: z.string() })),
        /** Why this game could not be looked for, when detection itself failed. */
        error: z.string().optional(),
      })
    ),
    /** Names of the games RigReady knows that are not on this PC. */
    notFound: z.array(z.string()),
  }),
  devices: z.object({
    error: SectionError,
    /** Game controllers and other input devices; hubs and the rest are only counted. */
    controllers: z.array(
      z.object({ name: z.string(), vendorId: z.string(), productId: z.string() })
    ),
    usbDevices: z.number().int(),
    hubs: z.number().int(),
  }),
  monitors: z.object({
    error: SectionError,
    list: z.array(z.string()),
  }),
  /** RigReady's own files under the data root. */
  dataFiles: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      file: z.string(),
      ok: z.boolean(),
      summary: z.string(),
    })
  ),
});
export type Overview = z.infer<typeof OverviewSchema>;

export const LogViewSchema = z.object({
  /** Newest last. */
  entries: z.array(LogEntrySchema),
  /** Entries in the log file that are older than the ones returned. */
  older: z.number().int(),
  file: z.string(),
  /** False until the first line has been written. */
  exists: z.boolean(),
});
export type LogView = z.infer<typeof LogViewSchema>;

export const diagnosticsContract = defineContract(
  'diagnostics',
  {
    overview: channel(noInput, OverviewSchema),
    /** The newest entries of the log file. */
    log: channel(
      z.object({ limit: z.number().int().min(1).max(2000).default(400) }).optional(),
      LogViewSchema
    ),
    setLogLevel: channel(z.object({ level: LogLevelSchema }), z.object({ level: LogLevelSchema })),
    /** Puts the diagnostics text (versions, hardware, recent log; personal details removed) on the clipboard. */
    copy: channel(noInput, z.object({ characters: z.number().int() })),
    openLogFolder: channel(noInput, z.object({ opened: z.boolean() })),
    /** Asks where to save, then writes the diagnostics zip. `saved: false` when the user cancelled. */
    export: channel(
      noInput,
      z.object({
        saved: z.boolean(),
        path: z.string().optional(),
        files: z.array(z.string()).default([]),
        bytes: z.number().int().default(0),
      })
    ),
    /** Unexpected errors the user has not dismissed yet, oldest first. */
    errors: channel(noInput, z.array(ErrorReportSchema)),
    /** An unexpected error in the window (an exception nobody caught, a failed component). */
    report: channel(
      z.object({ message: z.string().max(2000), detail: z.string().max(20_000).optional() }),
      ErrorReportSchema
    ),
    dismissErrors: channel(
      z.object({ ids: z.array(z.string()).optional() }).optional(),
      z.object({ remaining: z.number().int() })
    ),
    /** "Copy details" of one error. */
    copyError: channel(z.object({ id: z.string() }), z.object({ characters: z.number().int() })),
  },
  {
    /** An unexpected error was reported (from main, the window or a helper process). */
    error: ErrorReportSchema,
  }
);
