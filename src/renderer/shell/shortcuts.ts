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
  { id: 'fly', keys: ['Ctrl', '1'], label: 'Go to Fly', aria: 'Control+1' },
  { id: 'configure', keys: ['Ctrl', '2'], label: 'Go to Configure', aria: 'Control+2' },
  { id: 'help', keys: ['?'], label: 'Show the keyboard shortcuts', aria: '?' },
];

/** What the palette itself answers to, for the same overlay. */
export const PALETTE_KEYS: { keys: string[]; label: string }[] = [
  { keys: ['↑', '↓'], label: 'Move through the list' },
  { keys: ['Enter'], label: 'Open the page or run the command' },
  { keys: ['Esc'], label: 'Close, and go back to where you were' },
];

export const shortcut = (id: ShortcutId): Shortcut => SHORTCUTS.find((s) => s.id === id)!;

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
