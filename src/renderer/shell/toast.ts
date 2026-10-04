import { shallowRef, type ShallowRef } from 'vue';
import type { CommandOutcome } from '../../shared/feature';

/**
 * Toasts: the one way the shell says what a command did. Each has a tone with its own icon
 * and words (status is never colour alone), goes away by itself after a while, and stays
 * while the pointer or the focus is on it. A toast with the tone `busy` shows that a command
 * is still running; it never goes away by itself and turns into the outcome when there is one.
 */

export type ToastTone = CommandOutcome['tone'] | 'busy';

export interface Toast {
  id: number;
  tone: ToastTone;
  text: string;
  detail?: string;
  action?: { label: string; to: string };
}

/** How long a toast stays, by tone. Something that went wrong is given more time to be read. */
export const TOAST_MS: Record<ToastTone, number> = {
  ok: 6000,
  info: 6000,
  warn: 10_000,
  bad: 14_000,
  busy: 0,
};

/** More than this many at once and the oldest one that is not busy goes. */
export const TOASTS_SHOWN = 4;

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface ToastCenter {
  list: ShallowRef<Toast[]>;
  show(toast: Omit<Toast, 'id'>): number;
  /** Changes a toast in place (a busy toast becomes the outcome) and restarts its time. */
  update(id: number, patch: Partial<Omit<Toast, 'id'>>): void;
  dismiss(id: number): void;
  /** The pointer or the focus is on it: it stays. */
  hold(id: number): void;
  /** The pointer and the focus have left: its time starts again. */
  release(id: number): void;
}

export function createToasts(
  timers: Timers = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
): ToastCenter {
  const list = shallowRef<Toast[]>([]);
  const running = new Map<number, unknown>();
  const held = new Set<number>();
  let next = 0;

  function stop(id: number): void {
    const handle = running.get(id);
    if (handle !== undefined) timers.clear(handle);
    running.delete(id);
  }

  function start(id: number): void {
    stop(id);
    const toast = list.value.find((t) => t.id === id);
    if (!toast || held.has(id)) return;
    const ms = TOAST_MS[toast.tone];
    if (ms > 0)
      running.set(
        id,
        timers.set(() => dismiss(id), ms)
      );
  }

  function dismiss(id: number): void {
    stop(id);
    held.delete(id);
    list.value = list.value.filter((t) => t.id !== id);
  }

  return {
    list,
    show(toast) {
      const id = ++next;
      list.value = [...list.value, { ...toast, id }];
      while (list.value.length > TOASTS_SHOWN) {
        // Never the one that was just shown, and never one that is still working if another can go.
        const others = list.value.filter((t) => t.id !== id);
        const oldest = others.find((t) => t.tone !== 'busy') ?? others[0]!;
        dismiss(oldest.id);
      }
      start(id);
      return id;
    },
    update(id, patch) {
      if (!list.value.some((t) => t.id === id)) return;
      list.value = list.value.map((t) => {
        if (t.id !== id) return t;
        const merged: Toast = { ...t, ...patch };
        // An outcome without a second line or a button does not keep those of the toast it replaces.
        if ('detail' in patch && patch.detail === undefined) delete merged.detail;
        if ('action' in patch && patch.action === undefined) delete merged.action;
        return merged;
      });
      start(id);
    },
    dismiss,
    hold(id) {
      held.add(id);
      stop(id);
    },
    release(id) {
      held.delete(id);
      start(id);
    },
  };
}

/** The shell's own toasts. */
export const toasts = createToasts();
