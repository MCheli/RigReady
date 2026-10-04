import path from 'node:path';
import type { Clock, LogSink } from './ports';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** A logger that prefixes every line with a scope, e.g. the feature id. */
  child(scope: string): Logger;
}

/** Where the log lives: <data root>/logs/rigready.log, with rigready.log.1 ... as it rotates. */
export const LOG_FILE_NAME = 'rigready.log';
export const logFolder = (dataRoot: string): string => path.join(dataRoot, 'logs');
export const logFile = (dataRoot: string): string => path.join(logFolder(dataRoot), LOG_FILE_NAME);
/** The newest log file is at most this big, and this many older ones are kept (5 files in all). */
export const LOG_MAX_BYTES = 5_000_000;
export const LOG_KEEP_OLDER = 4;

/** A level name from the environment or a settings file; anything else is undefined. */
export function parseLogLevel(value: unknown): LogLevel | undefined {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (LOG_LEVELS as readonly string[]).includes(text) ? (text as LogLevel) : undefined;
}

/** The longest single text a log line carries; longer ones (a file's content, a page of output) are cut. */
export const LOG_MAX_TEXT = 600;

// Whatever the caller passes, these never reach the log.
const SECRETS: [RegExp, string][] = [
  // Anthropic keys (sk-ant-api03-...), and anything else in the same "sk-" family.
  [/\bsk-ant-[A-Za-z0-9_-]{4,}/g, 'sk-ant-***'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-***'],
  // Credentials in request headers and JSON bodies.
  [
    /((?:x-api-key|authorization|api[-_]?key|password|token)\\?["']?\s*[:=]\s*\\?["']?)(?:Bearer\s+)?[^\s"'\\,;}]{4,}/gi,
    '$1***',
  ],
];

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A folder as it may be written in a log line: with \, with \\ (inside JSON) or with /. */
function folderPattern(folder: string): string {
  return folder
    .replace(/[\\/]+$/, '')
    .split(/[\\/]+/)
    .map(escapeRegex)
    .join('(?:\\\\{1,2}|/)');
}

/**
 * What every log line and every diagnostics text goes through:
 *
 * - secrets (the Anthropic key, authorization headers, passwords) are masked whatever the caller passed;
 * - the user's home folder is written as `~`, and any other `X:\Users\<name>` folder as `X:\Users\~`,
 *   so the Windows user name is not in the log while the rest of the path, which is what
 *   support needs, stays;
 * - `homes` are further folders to write as `~` (a home that is not under \Users).
 */
export function createRedactor(homes: string[] = []): (text: string) => string {
  const known = [...new Set(homes.filter((home) => home.replace(/[\\/]+$/, '').length > 3))]
    .sort((a, b) => b.length - a.length)
    .map((home) => new RegExp(folderPattern(home), 'gi'));
  // The name ends at the next separator; a name with spaces only counts when a separator follows.
  const anyUser =
    /\b([A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/))(?!Public\b|Default\b|~)(?:[^\\/"'\s:*?<>|]+(?: [^\\/"'\s:*?<>|]+)+(?=[\\/])|[^\\/"'\s:*?<>|]+)/gi;
  return (text) => {
    let out = text;
    for (const [pattern, replacement] of SECRETS) out = out.replace(pattern, replacement);
    for (const home of known) out = out.replace(home, '~');
    return out.replace(anyUser, '$1~');
  };
}

const cut = (text: string): string =>
  text.length > LOG_MAX_TEXT
    ? `${text.slice(0, LOG_MAX_TEXT)}... (${text.length - LOG_MAX_TEXT} more characters not logged)`
    : text;

/** Data for a log line: long texts cut, binary data counted instead of dumped, cycles survived. */
function compact(value: unknown, depth = 0, seen = new Set<unknown>()): unknown {
  if (typeof value === 'string') return cut(value);
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return '[function]';
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return cut(value.stack ?? value.message);
  if (ArrayBuffer.isView(value)) return `[${value.byteLength} bytes]`;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (seen.has(value)) return '[circular]';
  if (depth >= 6) return '[...]';
  seen.add(value);
  let out: unknown;
  if (Array.isArray(value)) {
    out = value.slice(0, 50).map((item) => compact(item, depth + 1, seen));
    if (value.length > 50) (out as unknown[]).push(`... ${value.length - 50} more`);
  } else {
    const record: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 50)) {
      record[key] = compact(item, depth + 1, seen);
    }
    out = record;
  }
  seen.delete(value);
  return out;
}

function render(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return ` ${cut(data.stack ?? data.message)}`;
  // A text (a stack, a program's output) is written as it is, so it reads as lines.
  if (typeof data === 'string') return ` ${cut(data)}`;
  try {
    return ` ${JSON.stringify(compact(data))}`;
  } catch {
    // Something JSON cannot write (a getter that throws): its text form still says what it was.
    return ` ${cut(String(data))}`;
  }
}

export interface LoggerOptions {
  /** Applied to every line. Default: createRedactor(), which masks secrets and user folders. */
  redact?: (line: string) => string;
}

/**
 * The one logger. Lines are `<ISO time> <LEVEL> [scope] message {data}`; the sink writes
 * them without blocking the caller. `level` may be a function so the level can change
 * while the app runs (the "detailed log" setting).
 */
export function createLogger(
  sink: LogSink,
  clock: Clock,
  level: LogLevel | (() => LogLevel) = 'info',
  scope = 'app',
  options: LoggerOptions = {}
): Logger {
  const redact = options.redact ?? createRedactor();
  const threshold = typeof level === 'function' ? level : () => level;
  const write = (lvl: LogLevel, message: string, data?: unknown): void => {
    if (ORDER[lvl] < ORDER[threshold()]) return;
    // One entry is one line, so the log can be read back entry by entry.
    const body = redact(`${message}${render(data)}`).replace(/\r?\n/g, '\n    ');
    sink.write(`${clock.now().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${body}\n`);
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (s) => createLogger(sink, clock, level, s, { redact }),
  };
}

export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};

/**
 * A sink that keeps lines until the real one exists: the logger is needed before the
 * data root (and so the log file) is known, and nothing logged that early may be lost.
 */
export class DeferredSink implements LogSink {
  private pending: string[] = [];
  private target: LogSink | undefined;

  write(line: string): void {
    if (this.target) this.target.write(line);
    else if (this.pending.length < 2000) this.pending.push(line);
  }

  attach(target: LogSink): void {
    this.target = target;
    for (const line of this.pending.splice(0)) target.write(line);
  }
}

export interface LogEntry {
  /** ISO time. */
  time: string;
  level: LogLevel;
  scope: string;
  /** The message with its data; continuation lines (a stack) joined with line breaks. */
  text: string;
}

const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z) (DEBUG|INFO|WARN|ERROR)\s+\[([^\]]*)\] ?(.*)$/;

/** Reads log text back into entries, oldest first. Lines that are not log lines are kept as text of the entry before. */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match) {
      entries.push({
        time: match[1]!,
        level: match[2]!.toLowerCase() as LogLevel,
        scope: match[3]!,
        text: match[4]!,
      });
    } else if (line.trim().length > 0 && entries.length > 0) {
      entries[entries.length - 1]!.text += `\n${line.replace(/^ {4}/, '')}`;
    }
  }
  return entries;
}

/** Entries at or above a level. */
export function filterLog(entries: LogEntry[], minimum: LogLevel): LogEntry[] {
  return entries.filter((entry) => ORDER[entry.level] >= ORDER[minimum]);
}
