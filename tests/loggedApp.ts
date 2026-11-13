import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { createLogger, createRedactor, logFile } from '../src/core/logger';
import type { Result } from '../src/core/result';
import { discoverFeatures, wireFeatures, type Wiring } from '../src/main/bootstrap';
import { RotatingFileSink } from '../src/platform/node';
import type { SeedOptions } from '../src/platform/fake';
import { scenarioRig, type TestRig } from './helpers';

/**
 * Every feature wired on a scenario rig as `wiredApp` does, with the log as the app keeps
 * it: the real logger, the real redactor, at the normal level, into the real log file under
 * the data folder. For tests that ask what a support export would say after something
 * failed: the log, Copy diagnostics and Export diagnostics are read back as text.
 */
export interface LoggedApp {
  rig: TestRig;
  wiring: Wiring;
  events: { channel: string; payload: unknown }[];
  /** Calls an IPC channel as the window would; the answer comes back as it is, failed or not. */
  invoke<T = unknown>(channel: string, input?: unknown): Promise<Result<T>>;
  /** The log file as it stands on disk. */
  logText(): Promise<string>;
  /** Copy diagnostics, as the button does: the text that lands on the clipboard. */
  copied(): Promise<string>;
  /** Export diagnostics, as the button does: every file of the zip, by its name, as text. */
  exported(): Promise<Record<string, string>>;
  close(): Promise<void>;
}

export async function loggedApp(scenario: string, options: SeedOptions = {}): Promise<LoggedApp> {
  const rig = await scenarioRig(scenario, options);
  const file = logFile(rig.ports.folders.dataRoot());
  const sink = new RotatingFileSink(file);
  const events: LoggedApp['events'] = [];
  const wiring = wireFeatures({
    features: discoverFeatures(),
    ports: rig.ports,
    log: createLogger(sink, rig.clock, 'info', 'app', { redact: createRedactor([rig.home]) }),
    send: (channel, payload) => void events.push({ channel, payload }),
  });
  const invoke = async <T>(channel: string, input?: unknown): Promise<Result<T>> => {
    const handler = wiring.handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return (await handler(input)) as Result<T>;
  };
  let exports = 0;
  return {
    rig,
    wiring,
    events,
    invoke,
    async logText() {
      await sink.close();
      return fs.readFile(file, 'utf8').catch(() => '');
    },
    async copied() {
      await sink.close();
      const done = await invoke('diagnostics:copy');
      if (!done.ok) throw new Error(done.error.message);
      return rig.ports.clipboard.copied.at(-1) ?? '';
    },
    async exported() {
      await sink.close();
      const target = path.join(rig.home, 'Documents', `support-${++exports}`);
      rig.ports.dialogs.script.save.push(target);
      const done = await invoke<{ saved: boolean; path: string }>('diagnostics:export');
      if (!done.ok) throw new Error(done.error.message);
      if (!done.value.saved) throw new Error('The export was not saved.');
      const entries = unzipSync(new Uint8Array(await fs.readFile(done.value.path)));
      return Object.fromEntries(
        Object.entries(entries).map(([name, data]) => [name, new TextDecoder().decode(data)])
      );
    },
    async close() {
      for (const feature of wiring.features) await feature.dispose?.();
      await sink.close();
      await rig.cleanup();
    },
  };
}
