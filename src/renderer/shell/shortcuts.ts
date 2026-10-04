import { MODE_NAMES } from '../../shared/feature';

/**
 * The keyboard shortcuts of the app shell: one table, used by the key handler and by the
 * overlay that lists them ("?"), so the list can never promise a key that does nothing.
 */

export type ShortcutId = 'palette' | 'help' | 'fly' | 'configure';

export interface Shortcut {
  id: ShortcutId;
  /** The keys as they are printed on the keyboard, in the order they are held. */
  keys: string[];
  /** What it does, as the overlay says it. */
  label: string;
  /** For aria-keyshortcuts on the control that does the same. */
  aria: string;
}

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'palette',
    keys: ['Ctrl', 'K'],
    label: 'Find a page or run a command',
    aria: 'Control+K',
  },
  { id: 'fly', keys: ['Ctrl', '1'], label: `Go to ${MODE_NAMES.fly}`, aria: 'Control+1' },
  {
    id: 'configure',
    keys: ['Ctrl', '2'],
    label: `Go to ${MODE_NAMES.configure}`,
    aria: 'Control+2',
  },
  { id: 'help', keys: ['?'], label: 'Show the keyboard shortcuts', aria: '?' },
];

/** What the palette itself answers to, for the same overlay. */
export const PALETTE_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['↑', '↓'], label: 'Move through the list' },
  { keys: ['Enter'], label: 'Open the page or run the command' },
  { keys: ['Esc'], label: 'Close, and go back to where you were' },
];

/**
 * What the window itself answers to, through its menu (which is never shown): the keys of
 * any Windows program for the size of the text and for the full screen. The shell does not
 * handle them; it lists them, and tests/e2e/shell.e2e.ts proves the menu holds each one
 * under the key printed here. `role` is the menu's own name for it.
 */
export const WINDOW_KEYS: { keys: string[]; label: string; role: string }[] = [
  { keys: ['Ctrl', '+'], label: 'Larger text', role: 'zoomin' },
  { keys: ['Ctrl', '−'], label: 'Smaller text', role: 'zoomout' },
  { keys: ['Ctrl', '0'], label: 'Text back to its normal size', role: 'resetzoom' },
  { keys: ['F11'], label: 'Full screen, and back', role: 'togglefullscreen' },
];

export const shortcut = (id: ShortcutId): Shortcut => SHORTCUTS.find((s) => s.id === id)!;

/** A window narrower than this on screen is a pop-out panel, not the app's own window. */
export const PANEL_MAX_WIDTH = 720;

/**
 * Whether this window is a pop-out panel (the quick look in a small window that stays on
 * top): one tool, where the shell's keys have nothing to act on. The address it was opened
 * with says so, and so does its width on screen. That is the width of the window, not of
 * the page: the page gets narrower as the text gets larger (Ctrl and +), and the shell's
 * keys must work at every text size.
 */
export function isPanelWindow(outerWidth: number, query: Record<string, unknown>): boolean {
  return query['popped'] === '1' || outerWidth < PANEL_MAX_WIDTH;
}

export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * The shortcut a key press means, if any. `typing` is true while the focus is in a text
 * field: a "?" typed there is a question mark, while the Ctrl shortcuts still work.
 */
export function shortcutFor(press: KeyPress, typing: boolean): ShortcutId | undefined {
  if (press.altKey || press.metaKey) return undefined;
  if (press.ctrlKey) {
    if (press.shiftKey) return undefined;
    const key = press.key.toLowerCase();
    if (key === 'k') return 'palette';
    if (key === '1') return 'fly';
    if (key === '2') return 'configure';
    return undefined;
  }
  // Shift is part of how "?" is typed on most layouts, so it is not looked at.
  if (press.key === '?' && !typing) return 'help';
  return undefined;
}

/** What `typing` is asked of: enough of an element to tell a text field. */
export interface FocusTarget {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?(name: string): string | null;
}

/** Whether keys pressed now go into a text field. */
export function isTyping(target: FocusTarget | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target.getAttribute?.('type') ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'file'].includes(type);
  }
  if (target.isContentEditable === true) return true;
  const role = target.getAttribute?.('role');
  return role === 'textbox' || role === 'combobox' || role === 'searchbox';
}
