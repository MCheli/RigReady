import { shallowRef, type ShallowRef } from 'vue';
import type { CommandShell, PaletteCommand } from '../../shared/feature';
import type { Timers, ToastCenter } from './toast';

/**
 * Runs a command from the palette and says what happened. A page is opened and nothing
 * more is said. An action that takes a moment gets a toast that shows it is running; when
 * it is done the toast becomes what the feature reported: its words, never a "done" of the
 * shell's own. A command that throws is reported as not finished, with the error.
 */
export interface Runner {
  run(command: PaletteCommand): Promise<void>;
  /** The ids of the commands running now. One is not started a second time meanwhile. */
  running: ShallowRef<ReadonlySet<string>>;
}

/** A command quicker than this never shows that it is running: only what it did. */
export const BUSY_AFTER_MS = 200;

export function createRunner(
  shell: CommandShell,
  toasts: ToastCenter,
  timers: Timers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
): Runner {
  const running = shallowRef<ReadonlySet<string>>(new Set());
  const mark = (id: string, on: boolean): void => {
    const next = new Set(running.value);
    if (on) next.add(id);
    else next.delete(id);
    running.value = next;
  };

  return {
    running,
    async run(command) {
      if (command.to !== undefined) {
        await shell.go(command.to);
        return;
      }
      if (!command.run || running.value.has(command.id)) return;
      mark(command.id, true);
      let toast: number | undefined;
      let line = `${command.title}…`;
      const waiting = timers.set(() => {
        toast = toasts.show({ tone: 'busy', text: line });
      }, BUSY_AFTER_MS);
      const say = (patch: Parameters<ToastCenter['update']>[1] & { text: string }): void => {
        timers.clear(waiting);
        if (toast === undefined) toasts.show({ tone: 'info', ...patch });
        else toasts.update(toast, patch);
      };
      try {
        const outcome = await command.run({
          ...shell,
          progress: (text) => {
            line = text;
            if (toast !== undefined) toasts.update(toast, { text });
          },
        });
        if (outcome) {
          say({
            tone: outcome.tone,
            text: outcome.text,
            detail: outcome.detail,
            action: outcome.action,
          });
        } else {
          // Nothing to report (the command opened one of the shell's panels, say).
          timers.clear(waiting);
          if (toast !== undefined) toasts.dismiss(toast);
        }
      } catch (e) {
        say({
          tone: 'bad',
          text: `${command.title} did not finish.`,
          detail: e instanceof Error ? e.message : String(e),
          action: undefined,
        });
      } finally {
        mark(command.id, false);
      }
    },
  };
}
