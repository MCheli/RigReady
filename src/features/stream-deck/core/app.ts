import type { Ports } from '../../../core/ports';
import { closeTogether, forceCanHelp, stillRunningText } from '../../../core/processes';
import { err, ok, type Result } from '../../../core/result';
import { findExe, findUninstallEntry, isAppProcess } from './detect';
import { CANNOT_CLOSE, STILL_RUNNING } from './model';

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

/** How long the app is given to quit after it was asked: it saves its profiles first. */
export const QUIT_WAIT_MS = 15_000;

/**
 * Quits the Stream Deck app. It is asked politely first; it is only ended when `force`
 * is set, because the app saves profiles when it quits.
 *
 * All of its processes are asked together and the process list decides (closeTogether).
 * When it stays open the error says why, and its code says whether force can still help:
 * STILL_RUNNING when it can, CANNOT_CLOSE when it was used already or Windows did not let
 * RigReady near the app. What to do next is for the caller to add: it knows its own buttons.
 */
export async function closeApp(
  ports: Ports,
  options: { force?: boolean } = {}
): Promise<Result<{ closed: boolean }>> {
  const processes = await ports.processes.list();
  if (!processes.ok) return processes;
  const targets = processes.value.filter(isAppProcess);
  const force = options.force ?? false;
  const closed = await closeTogether(ports.processes, targets, { waitMs: QUIT_WAIT_MS, force });
  if (closed.state === 'failed') return { ok: false, error: closed.error };
  if (closed.state === 'stillRunning') {
    return err(
      forceCanHelp(closed.why, force) ? STILL_RUNNING : CANNOT_CLOSE,
      stillRunningText('Stream Deck', closed.why)
    );
  }
  // Every process that was asked is gone. One by this name now is the app started again.
  const after = await isAppRunning(ports);
  if (!after.ok) return after;
  if (after.value) {
    return err(force ? CANNOT_CLOSE : STILL_RUNNING, 'Stream Deck is still running.');
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
