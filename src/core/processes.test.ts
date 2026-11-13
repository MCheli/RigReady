import { describe, expect, it } from 'vitest';
import type { CloseOptions, ProcessProvider } from './ports';
import {
  closeTogether,
  stillRunningText,
  stillRunningWhy,
  type StillRunningWhy,
} from './processes';
import { err, ok, type Result } from './result';

type Closed = Result<{ outcome: 'closed' | 'terminated' }>;

/**
 * A program as Windows shows it: a list of processes, and what each does when asked to
 * close. Nothing here is a real process.
 */
function program(
  pids: number[],
  onClose: (pid: number, running: number[], options: CloseOptions) => Closed
): { provider: ProcessProvider; running: number[]; asked: number[]; order: string[] } {
  const running = [...pids];
  const asked: number[] = [];
  const order: string[] = [];
  const provider: ProcessProvider = {
    list: async () => ok(running.map((pid) => ({ pid, name: 'coach.exe' }))),
    start: async () => ok({ pid: undefined }),
    stop: async () => ok(undefined),
    close: async (pid, options = {}) => {
      asked.push(pid);
      order.push(`ask ${pid}`);
      // Every one is asked before any of them answers, as on the real machine.
      await Promise.resolve();
      order.push(`answer ${pid}`);
      return onClose(pid, running, options);
    },
  };
  return { provider, running, asked, order };
}

const gone = (pid: number): Closed =>
  err('process.stop', `Could not open process ${pid} to close it.`);
const stays = (pid: number, why?: StillRunningWhy): Closed =>
  err('process.stillRunning', `Process ${pid} did not close.`, why);
const remove = (running: number[], ...pids: number[]): void => {
  for (const pid of pids) {
    const at = running.indexOf(pid);
    if (at >= 0) running.splice(at, 1);
  }
};
const targets = (...pids: number[]): { pid: number }[] => pids.map((pid) => ({ pid }));
const POLITE = { waitMs: 10_000, force: false };

describe('closeTogether: a program of several processes is one program', () => {
  it('a helper with no window comes first in the list: the owner of the window is still asked, and the program counts as closed when all of it is gone', async () => {
    // 11 and 12 are helpers without a window; 10 owns the window and takes them with it.
    const app = program([11, 10, 12], (pid, running) => {
      if (pid === 10) {
        remove(running, 10, 11, 12);
        return ok({ outcome: 'closed' });
      }
      return stays(pid, 'noWindow');
    });
    expect(await closeTogether(app.provider, targets(11, 10, 12), POLITE)).toEqual({
      state: 'closed',
      terminated: false,
    });
    expect(app.asked).toEqual([11, 10, 12]);
    // All three were asked before the first answer was waited for.
    expect(app.order.slice(0, 3)).toEqual(['ask 11', 'ask 10', 'ask 12']);
  });

  it('a helper that is already gone when it is asked is no failure', async () => {
    const app = program([10, 11], (pid, running) => {
      if (pid === 10) {
        remove(running, 10, 11);
        return ok({ outcome: 'closed' });
      }
      return gone(pid);
    });
    expect(await closeTogether(app.provider, targets(10, 11), POLITE)).toEqual({
      state: 'closed',
      terminated: false,
    });
  });

  it('a program that only goes to the tray is still running, and the reason is the one of the process that was asked', async () => {
    const app = program([11, 10], (pid) => stays(pid, pid === 10 ? 'ignored' : 'noWindow'));
    expect(await closeTogether(app.provider, targets(11, 10), POLITE)).toEqual({
      state: 'stillRunning',
      why: 'ignored',
    });
    expect(app.running).toEqual([11, 10]);
  });

  it('says so when Windows did not let it be asked, and when it has no window at all', async () => {
    const elevated = program([10, 11], (pid) => stays(pid, pid === 10 ? 'refused' : 'noWindow'));
    expect(await closeTogether(elevated.provider, targets(10, 11), POLITE)).toEqual({
      state: 'stillRunning',
      why: 'refused',
    });
    const windowless = program([10], (pid) => stays(pid, 'noWindow'));
    expect(await closeTogether(windowless.provider, targets(10), POLITE)).toEqual({
      state: 'stillRunning',
      why: 'noWindow',
    });
    // A provider that gives no reason: none is made up.
    const silent = program([10], (pid) => stays(pid));
    expect(await closeTogether(silent.provider, targets(10), POLITE)).toEqual({
      state: 'stillRunning',
      why: undefined,
    });
  });

  it('believes the process list, not the answer: "closed" about a process that is still there is still running', async () => {
    const app = program([10], () => ok({ outcome: 'closed' }));
    expect(await closeTogether(app.provider, targets(10), POLITE)).toEqual({
      state: 'stillRunning',
      why: undefined,
    });
  });

  it('with force, says that it had to be terminated', async () => {
    const seen: CloseOptions[] = [];
    const app = program([10, 11], (pid, running, options) => {
      seen.push(options);
      remove(running, pid);
      return ok({ outcome: pid === 10 ? 'terminated' : 'closed' });
    });
    expect(
      await closeTogether(app.provider, targets(10, 11), { waitMs: 2000, force: true })
    ).toEqual({ state: 'closed', terminated: true });
    expect(seen).toEqual([
      { waitMs: 2000, force: true },
      { waitMs: 2000, force: true },
    ]);
  });

  it('a program Windows does not let RigReady stop, forced or not, is still running and "refused"', async () => {
    const app = program([10], (pid) =>
      err('process.stop', `Windows refused to stop process ${pid}.`)
    );
    expect(await closeTogether(app.provider, targets(10), { waitMs: 10, force: true })).toEqual({
      state: 'stillRunning',
      why: 'refused',
    });
    const unopened = program([10], gone);
    expect(
      await closeTogether(unopened.provider, targets(10), { waitMs: 10, force: true })
    ).toEqual({ state: 'stillRunning', why: 'refused' });
  });

  it('passes on another failure when the process is still there', async () => {
    const app = program([10], () => err('process.hung', 'Windows did not answer.'));
    expect(await closeTogether(app.provider, targets(10), POLITE)).toEqual({
      state: 'failed',
      error: { code: 'process.hung', message: 'Windows did not answer.' },
    });
  });

  it('when the list cannot be read afterwards, each answer stands', async () => {
    const closes = program([10], (pid, running) => {
      remove(running, pid);
      return ok({ outcome: 'closed' });
    });
    closes.provider.list = async () => err('process.list', 'Could not list running programs.');
    expect(await closeTogether(closes.provider, targets(10), POLITE)).toEqual({
      state: 'closed',
      terminated: false,
    });
    const refuses = program([10], (pid) => stays(pid, 'ignored'));
    refuses.provider.list = async () => err('process.list', 'Could not list running programs.');
    expect(await closeTogether(refuses.provider, targets(10), POLITE)).toEqual({
      state: 'stillRunning',
      why: 'ignored',
    });
    // "Could not open the process" may then be about a process that had already gone:
    // nothing is said about it that is not known.
    const unknown = program([10], gone);
    unknown.provider.list = async () => err('process.list', 'Could not list running programs.');
    expect(await closeTogether(unknown.provider, targets(10), POLITE)).toEqual({
      state: 'failed',
      error: { code: 'process.stop', message: 'Could not open process 10 to close it.' },
    });
  });
});

describe('why a program is still running, in plain words', () => {
  it('reads the reason from a still-running error only', () => {
    const error = (code: string, detail?: string) => ({
      code,
      message: 'm',
      ...(detail ? { detail } : {}),
    });
    expect(stillRunningWhy(error('process.stillRunning', 'ignored'))).toBe('ignored');
    expect(stillRunningWhy(error('process.stillRunning', 'noWindow'))).toBe('noWindow');
    expect(stillRunningWhy(error('process.stillRunning', 'refused'))).toBe('refused');
    expect(stillRunningWhy(error('process.stillRunning', 'something else'))).toBeUndefined();
    expect(stillRunningWhy(error('process.stillRunning'))).toBeUndefined();
    expect(stillRunningWhy(error('process.stop', 'ignored'))).toBeUndefined();
  });

  it('names the program and says what happened', () => {
    expect(stillRunningText('coach.exe', 'ignored')).toBe(
      'coach.exe is still running: it was asked to close and stayed open. Some apps only go to the tray when asked.'
    );
    expect(stillRunningText('coach.exe', 'noWindow')).toBe(
      'coach.exe is still running: it has no window, so it could not be asked to close.'
    );
    expect(stillRunningText('coach.exe', 'refused')).toBe(
      'coach.exe is still running: Windows did not let RigReady close it. It may be running as administrator.'
    );
    expect(stillRunningText('coach.exe', undefined)).toBe(
      'coach.exe is still running: it did not close when asked.'
    );
  });
});
