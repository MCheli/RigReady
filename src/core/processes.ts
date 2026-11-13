import type { ProcessInfo } from '../shared/models';
import type { CloseOptions, ProcessProvider } from './ports';
import { err, type Result, type RigError } from './result';

/**
 * Why a program is still running after it was asked to close. A provider says it in the
 * `detail` of its `process.stillRunning` error:
 *
 *  - ignored: its window was asked, the way the X button asks, and the program kept
 *    running. Many apps only go to the tray when asked.
 *  - noWindow: it has no window, so there was nothing to ask.
 *  - refused: Windows did not deliver the request to any of its windows. This is what
 *    happens when the program runs as administrator and RigReady does not. (Forcing such
 *    a program fails as well: see closeTogether.)
 *
 * Anything else in `detail`, or nothing, means the provider does not know.
 */
export type StillRunningWhy = 'ignored' | 'noWindow' | 'refused';
const WHYS: readonly string[] = ['ignored', 'noWindow', 'refused'];

export function stillRunningWhy(error: RigError): StillRunningWhy | undefined {
  return error.code === 'process.stillRunning' && WHYS.includes(error.detail ?? '')
    ? (error.detail as StillRunningWhy)
    : undefined;
}

/** "trophi.ai.exe is still running: ..." with the reason in plain words. */
export function stillRunningText(name: string, why: StillRunningWhy | undefined): string {
  const reason =
    why === 'ignored'
      ? 'it was asked to close and stayed open. Some apps only go to the tray when asked.'
      : why === 'noWindow'
        ? 'it has no window, so it could not be asked to close.'
        : why === 'refused'
          ? 'Windows did not let RigReady close it. It may be running as administrator.'
          : 'it did not close when asked.';
  return `${name} is still running: ${reason}`;
}

export type ClosedTogether =
  /** None of them is running any more. */
  | { state: 'closed'; terminated: boolean }
  /** At least one still is, although every one of them was asked. */
  | { state: 'stillRunning'; why: StillRunningWhy | undefined }
  /** Closing failed in another way, and at least one is still running. */
  | { state: 'failed'; error: RigError };

/**
 * Closes one program that may be several processes. Every Chromium or Electron app is: one
 * process owns the window, and its helpers have none and exit when it does.
 *
 * All of them are asked at once, and the outcome is what the process list shows afterwards,
 * not each answer by itself. Asked one after the other, a helper that comes first in the
 * list has no window to ask, waits out its whole time, and the program is reported as
 * still running before the process that owns the window was asked at all. And a helper
 * that is already gone when its turn comes answers "could not open the process", which is
 * no failure when the program has closed.
 *
 * When something is left, the reason is the one of the process that could be asked: that
 * is the one the user can do something about.
 */
export async function closeTogether(
  processes: ProcessProvider,
  targets: Pick<ProcessInfo, 'pid'>[],
  options: { waitMs: number; force: boolean }
): Promise<ClosedTogether> {
  const answers = await Promise.all(
    targets.map(async (target) => ({
      pid: target.pid,
      answer: await processes.close(target.pid, options),
    }))
  );
  const after = await processes.list();
  // When the list cannot be read, each answer stands.
  const running = after.ok ? new Set(after.value.map((p) => p.pid)) : undefined;
  const left = answers.filter(({ pid, answer }) => (running ? running.has(pid) : !answer.ok));
  if (left.length === 0) {
    return {
      state: 'closed',
      terminated: answers.some((a) => a.answer.ok && a.answer.value.outcome === 'terminated'),
    };
  }
  const errors = left.flatMap(({ answer }) => (answer.ok ? [] : [answer.error]));
  // "Could not open the process" or "Windows refused to stop it" about a process the list
  // still shows: Windows did not let RigReady close it. (Without the list, the same answer
  // may be about a process that had already gone, so it is passed on as it is.)
  const refused = (error: RigError): boolean =>
    running !== undefined && error.code === 'process.stop';
  const other = errors.find((error) => error.code !== 'process.stillRunning' && !refused(error));
  if (other) return { state: 'failed', error: other };
  const whys = errors.map((error) => (refused(error) ? 'refused' : stillRunningWhy(error)));
  return {
    state: 'stillRunning',
    why: (['ignored', 'refused', 'noWindow'] as const).find((why) => whys.includes(why)),
  };
}

/**
 * A ProcessProvider that believes what it sees, not what it is told: after a close or a
 * stop that the machine reported as done, the process list is read again, and a process
 * that is still there makes the call fail with `process.stillRunning`.
 *
 * Every feature gets its processes port through this (src/main/bootstrap.ts), so "Closed
 * TrackIR" can never be said about a program that is still running (NFR-006). Starting is
 * left as it is: whether a program "is running" after a start depends on which image name
 * the caller waits for, so callers poll the list themselves (process.launch, Launch).
 */
export function verifiedProcesses(inner: ProcessProvider): ProcessProvider {
  const stillThere = async (pid: number): Promise<boolean> => {
    const list = await inner.list();
    // When the list cannot be read, the provider's own answer stands.
    return list.ok && list.value.some((p) => p.pid === pid);
  };
  return {
    list: () => inner.list(),
    start: (target) => inner.start(target),
    async stop(pid: number): Promise<Result<void>> {
      const stopped = await inner.stop(pid);
      if (!stopped.ok) return stopped;
      if (await stillThere(pid)) {
        return err('process.stillRunning', `Process ${pid} is still running after being stopped.`);
      }
      return stopped;
    },
    async close(
      pid: number,
      options?: CloseOptions
    ): Promise<Result<{ outcome: 'closed' | 'terminated' }>> {
      const closed = await inner.close(pid, options);
      if (!closed.ok) return closed;
      if (await stillThere(pid)) {
        return err(
          'process.stillRunning',
          `Process ${pid} is still running although Windows reported it closed.`
        );
      }
      return closed;
    },
  };
}
