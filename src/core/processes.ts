import type { CloseOptions, ProcessProvider } from './ports';
import { err, type Result } from './result';

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
