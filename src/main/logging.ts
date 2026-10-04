import path from 'node:path';
import {
  createLogger,
  createRedactor,
  DeferredSink,
  logFile,
  parseLogLevel,
  type Logger,
  type LogLevel,
} from '../core/logger';
import type { Clock } from '../core/ports';
import type { SettingsStore } from '../core/settings';
import { RotatingFileSink } from '../platform/node';
import { userFoldersInEnvironment } from '../platform/windows/knownFolders';

/**
 * The app's log. The logger exists before the data root is known (the platform needs one
 * while it is being created); what is logged that early is kept and written once the
 * file is opened.
 *
 * Level: RIGREADY_LOG_LEVEL (debug, info, warn, error) wins; otherwise the "detailed
 * log" setting; otherwise info.
 */
export interface AppLogging {
  log: Logger;
  /** Opens <data root>/logs/rigready.log and writes what was logged so far. */
  open(dataRoot: string, homes: string[]): void;
  /** Follows the log level setting, now and when it changes. */
  follow(settings: SettingsStore): Promise<void>;
  /** Resolves when everything logged so far is on disk. */
  flush(): Promise<void>;
}

export function startLogging(clock: Clock, env: NodeJS.ProcessEnv = process.env): AppLogging {
  const fromEnv = parseLogLevel(env['RIGREADY_LOG_LEVEL']);
  let level: LogLevel = fromEnv ?? 'info';
  const sink = new DeferredSink();
  let file: RotatingFileSink | undefined;
  // The real user folder and the one this run was given: neither is spelled out in the log.
  const homes = userFoldersInEnvironment(env);
  let redact = createRedactor(homes);
  const log = createLogger(sink, clock, () => level, 'app', { redact: (line) => redact(line) });
  return {
    log,
    open(dataRoot, moreHomes) {
      redact = createRedactor([...homes, ...moreHomes.map((home) => path.resolve(home))]);
      file = new RotatingFileSink(logFile(dataRoot));
      sink.attach(file);
    },
    async follow(settings) {
      if (fromEnv) return;
      const apply = (wanted: LogLevel): void => {
        if (wanted === level) return;
        level = wanted;
        log.info(`log level is now ${wanted}`);
      };
      settings.onChange((next) => apply(next.logLevel));
      const current = await settings.get();
      if (current.ok) apply(current.value.logLevel);
    },
    flush: () => file?.close() ?? Promise.resolve(),
  };
}
