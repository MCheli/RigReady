import type { Ports } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import { findExe, findUninstallEntry, isAppProcess } from './detect';

/** Injected so tests do not wait in real time. */
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function appExe(ports: Ports): Promise<string | undefined> {
  const entry = await findUninstallEntry(ports.registry, /^(Elgato )?Stream Deck$/i);
  return findExe(ports, entry.ok ? entry.value : undefined);
}

export async function isAppRunning(ports: Ports): Promise<Result<boolean>> {
  const processes = await ports.processes.list();
  if (!processes.ok) return processes;
  return ok(processes.value.some(isAppProcess));
}

/**
 * Quits the Stream Deck app. It is asked politely first; it is only ended when `force`
 * is set, because the app saves profiles when it quits.
 */
export async function closeApp(
  ports: Ports,
  options: { force?: boolean } = {}
): Promise<Result<{ closed: boolean }>> {
  const processes = await ports.processes.list();
  if (!processes.ok) return processes;
  const targets = processes.value.filter(isAppProcess);
  for (const target of targets) {
    const closed = await ports.processes.close(target.pid, {
      waitMs: 15_000,
      force: options.force ?? false,
    });
    if (!closed.ok) {
      if (closed.error.code === 'process.stillRunning') {
        return err(
          'streamDeck.stillRunning',
          'Stream Deck did not quit when asked.',
          'It may still be running in the notification area. Quit it there (right-click its icon, then Quit Stream Deck), or let RigReady end it.'
        );
      }
      return closed;
    }
  }
  const after = await isAppRunning(ports);
  if (!after.ok) return after;
  if (after.value) {
    return err('streamDeck.stillRunning', 'Stream Deck is still running.');
  }
  return ok({ closed: targets.length > 0 });
}

/** Starts the Stream Deck app and waits until it is running. */
export async function startApp(
  ports: Ports,
  sleep: Sleep = realSleep,
  args: string[] = [],
  timeoutMs = 15_000
): Promise<Result<string>> {
  const exe = await appExe(ports);
  if (!exe) {
    return err('streamDeck.notInstalled', 'The Stream Deck app is not installed on this PC.');
  }
  const running = await isAppRunning(ports);
  if (running.ok && running.value && args.length === 0) return ok('Stream Deck is already running');
  const started = await ports.processes.start({ exe, args });
  if (!started.ok) return started;
  const deadline = ports.clock.now().getTime() + timeoutMs;
  for (;;) {
    const now = await isAppRunning(ports);
    if (now.ok && now.value) return ok('Started Stream Deck');
    if (ports.clock.now().getTime() >= deadline) break;
    await sleep(250);
  }
  return err('streamDeck.notStarted', 'Stream Deck was started but is not running.');
}
