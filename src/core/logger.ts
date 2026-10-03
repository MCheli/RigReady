import type { Clock, LogSink } from './ports';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
  /** A logger that prefixes every line with a scope, e.g. the feature id. */
  child(scope: string): Logger;
}

function render(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return ` ${data.stack ?? data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

export function createLogger(
  sink: LogSink,
  clock: Clock,
  level: LogLevel = 'info',
  scope = 'app'
): Logger {
  const write = (lvl: LogLevel, message: string, data?: unknown): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    sink.write(
      `${clock.now().toISOString()} ${lvl.toUpperCase().padEnd(5)} [${scope}] ${message}${render(data)}\n`
    );
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (s) => createLogger(sink, clock, level, s),
  };
}

export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};
