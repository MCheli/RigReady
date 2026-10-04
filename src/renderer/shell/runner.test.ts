import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandOutcome, CommandShell, PaletteCommand } from '../../shared/feature';
import { BUSY_AFTER_MS, createRunner } from './runner';
import { createToasts } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function harness() {
  const went: string[] = [];
  const shell: CommandShell = {
    client: () => {
      throw new Error('no client in this test');
    },
    go: async (to) => {
      went.push(to);
    },
    route: () => '/fly',
    machineChanged: () => undefined,
    progress: () => undefined,
  };
  const toasts = createToasts();
  return { went, toasts, runner: createRunner(shell, toasts) };
}

/** A command that finishes when the test says so. */
function held(id = 'x.slow', title = 'Back up now') {
  let finish: (outcome: CommandOutcome | void) => void = () => undefined;
  let fail: (error: unknown) => void = () => undefined;
  let shell: CommandShell | undefined;
  const command: PaletteCommand = {
    id,
    title,
    run: (given) =>
      new Promise((resolve, reject) => {
        shell = given;
        finish = resolve;
        fail = reject;
      }),
  };
  return {
    command,
    finish: (outcome?: CommandOutcome) => finish(outcome),
    fail: (error: unknown) => fail(error),
    progress: (text: string) => shell!.progress(text),
  };
}

describe('running a command from the palette', () => {
  it('a page is opened, and nothing is said', async () => {
    const { runner, went, toasts } = harness();
    await runner.run({ id: 'page:/configure/safety', title: 'Safety', to: '/configure/safety' });
    expect(went).toEqual(['/configure/safety']);
    vi.advanceTimersByTime(BUSY_AFTER_MS * 2);
    expect(toasts.list.value).toEqual([]);
  });

  it('a quick action shows only what it did, in the words it reported', async () => {
    const { runner, toasts } = harness();
    await runner.run({
      id: 'diagnostics.copy',
      title: 'Copy the diagnostics report',
      run: async () => ({
        tone: 'ok',
        text: 'The report is on the clipboard',
        detail: '9,120 characters',
      }),
    });
    expect(toasts.list.value).toHaveLength(1);
    expect(toasts.list.value[0]).toMatchObject({
      tone: 'ok',
      text: 'The report is on the clipboard',
      detail: '9,120 characters',
    });
    // The "still running" toast never appears afterwards.
    vi.advanceTimersByTime(BUSY_AFTER_MS * 2);
    expect(toasts.list.value).toHaveLength(1);
  });

  it('an action that takes a moment shows that it is running, with its progress, then becomes the outcome', async () => {
    const { runner, toasts } = harness();
    const slow = held();
    const done = runner.run(slow.command);
    expect(toasts.list.value).toEqual([]);
    expect(runner.running.value.has('x.slow')).toBe(true);
    vi.advanceTimersByTime(BUSY_AFTER_MS);
    expect(toasts.list.value).toMatchObject([{ tone: 'busy', text: 'Back up now…' }]);
    slow.progress('Backing up… 3 of 9 files');
    expect(toasts.list.value).toMatchObject([{ tone: 'busy', text: 'Backing up… 3 of 9 files' }]);
    const id = toasts.list.value[0]!.id;
    slow.finish({
      tone: 'warn',
      text: 'Backed up 9 files',
      detail: '1 file was skipped.',
      action: { label: 'Open Backups', to: '/configure/backups' },
    });
    await done;
    // The same toast, changed in place.
    expect(toasts.list.value).toEqual([
      {
        id,
        tone: 'warn',
        text: 'Backed up 9 files',
        detail: '1 file was skipped.',
        action: { label: 'Open Backups', to: '/configure/backups' },
      },
    ]);
    expect(runner.running.value.has('x.slow')).toBe(false);
  });

  it('progress reported before the toast is up is what the toast then shows', async () => {
    const { runner, toasts } = harness();
    const slow = held();
    const done = runner.run(slow.command);
    slow.progress('Checking the setup…');
    vi.advanceTimersByTime(BUSY_AFTER_MS);
    expect(toasts.list.value).toMatchObject([{ tone: 'busy', text: 'Checking the setup…' }]);
    slow.finish({ tone: 'ok', text: 'Ready' });
    await done;
    expect(toasts.list.value).toMatchObject([{ tone: 'ok', text: 'Ready' }]);
    expect(toasts.list.value[0]).not.toHaveProperty('detail');
  });

  it('an action with nothing to report leaves nothing behind, quick or slow', async () => {
    const { runner, toasts } = harness();
    await runner.run({ id: 'shell.about', title: 'About', run: async () => undefined });
    vi.advanceTimersByTime(BUSY_AFTER_MS * 2);
    expect(toasts.list.value).toEqual([]);
    const slow = held();
    const done = runner.run(slow.command);
    vi.advanceTimersByTime(BUSY_AFTER_MS);
    expect(toasts.list.value).toHaveLength(1);
    slow.finish();
    await done;
    expect(toasts.list.value).toEqual([]);
  });

  it('an action that throws is reported as not finished, with the error: never as done', async () => {
    const { runner, toasts } = harness();
    await runner.run({
      id: 'x.broken',
      title: 'Apply layout: Flying',
      run: async () => {
        throw new Error('The driver did not answer.');
      },
    });
    expect(toasts.list.value).toMatchObject([
      {
        tone: 'bad',
        text: 'Apply layout: Flying did not finish.',
        detail: 'The driver did not answer.',
      },
    ]);
    const slow = held('x.slow', 'Make ready');
    const done = runner.run(slow.command);
    vi.advanceTimersByTime(BUSY_AFTER_MS);
    slow.fail('plain text');
    await done;
    expect(toasts.list.value[1]).toMatchObject({
      tone: 'bad',
      text: 'Make ready did not finish.',
      detail: 'plain text',
    });
    expect(runner.running.value.size).toBe(0);
  });

  it('a command that is running is not started a second time; another one is', async () => {
    const { runner } = harness();
    let starts = 0;
    const slow = held();
    const counted: PaletteCommand = {
      ...slow.command,
      run: (shell) => {
        starts++;
        return slow.command.run!(shell);
      },
    };
    const first = runner.run(counted);
    await runner.run(counted);
    expect(starts).toBe(1);
    const other = held('x.other', 'Identify monitors');
    const second = runner.run(other.command);
    expect([...runner.running.value].sort()).toEqual(['x.other', 'x.slow']);
    slow.finish({ tone: 'ok', text: 'One' });
    other.finish({ tone: 'ok', text: 'Two' });
    await Promise.all([first, second]);
    // Finished: it can be run again.
    const again = runner.run(counted);
    expect(starts).toBe(2);
    slow.finish();
    await again;
  });

  it('a command with neither a page nor an action does nothing at all', async () => {
    const { runner, toasts, went } = harness();
    await runner.run({ id: 'x.nothing', title: 'Nothing' });
    vi.advanceTimersByTime(BUSY_AFTER_MS * 2);
    expect(went).toEqual([]);
    expect(toasts.list.value).toEqual([]);
  });
});
