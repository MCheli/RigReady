import { err, ok, type Result } from './result';

/**
 * System-wide hotkeys: which key combinations RigReady accepts, how one is written down, and
 * how a key press in the window becomes one. Pure; the Hotkeys port does the registering.
 */

/** The hotkey that brings RigReady forward and runs Make ready for the setup in use. */
export const MAKE_READY_HOTKEY = 'makeReady';

export interface Hotkey {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The Windows key. */
  win: boolean;
  /** The one key that is not a modifier, by its name: "R", "5", "F9", "Num3", "Up", "Space". */
  key: string;
}

const NAMED = ['Space', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete'] as const;
const ARROWS = ['Up', 'Down', 'Left', 'Right'] as const;

/** A key's name in the one spelling RigReady uses; undefined when it is not a key a hotkey may end in. */
function keyName(text: string): string | undefined {
  const token = text.trim();
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  const f = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
  if (f) return `F${f[1]}`;
  const num = /^num(?:pad)?([0-9])$/i.exec(token);
  if (num) return `Num${num[1]}`;
  const lower = token.toLowerCase();
  return [...NAMED, ...ARROWS].find((name) => name.toLowerCase() === lower);
}

const MODIFIERS: Record<string, keyof Omit<Hotkey, 'key'>> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  commandorcontrol: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  win: 'win',
  windows: 'win',
  super: 'win',
  meta: 'win',
};

const NEEDS_MODIFIER =
  'Hold Ctrl, Alt or the Windows key with it, so it cannot be pressed by accident while typing or flying.';

function checked(hotkey: Hotkey): Result<Hotkey> {
  if (!hotkey.ctrl && !hotkey.alt && !hotkey.win) return err('hotkey.invalid', NEEDS_MODIFIER);
  return ok(hotkey);
}

/** Reads a hotkey as it is written: "Ctrl+Alt+R", "ctrl + shift + F9", "Control+Num3". */
export function parseHotkey(text: string): Result<Hotkey> {
  const hotkey: Hotkey = { ctrl: false, alt: false, shift: false, win: false, key: '' };
  const tokens = text
    .split('+')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return err('hotkey.invalid', 'Press a key combination.');
  for (const token of tokens) {
    const modifier = MODIFIERS[token.toLowerCase()];
    if (modifier) {
      hotkey[modifier] = true;
      continue;
    }
    const key = keyName(token);
    if (!key) {
      return err(
        'hotkey.invalid',
        `"${token}" cannot be part of a hotkey.`,
        'Use a letter, a digit, a function key, a number pad digit, an arrow, Space, Home, End, Page Up, Page Down, Insert or Delete.'
      );
    }
    if (hotkey.key) return err('hotkey.invalid', 'A hotkey ends in one key, not two.');
    hotkey.key = key;
  }
  if (!hotkey.key) {
    return err('hotkey.invalid', 'A hotkey needs a key besides Ctrl, Alt, Shift and Windows.');
  }
  return checked(hotkey);
}

/** How a hotkey is stored and shown: "Ctrl+Alt+R". Always the same order. */
export function hotkeyText(hotkey: Hotkey): string {
  return [
    ...(hotkey.ctrl ? ['Ctrl'] : []),
    ...(hotkey.alt ? ['Alt'] : []),
    ...(hotkey.shift ? ['Shift'] : []),
    ...(hotkey.win ? ['Win'] : []),
    hotkey.key,
  ].join('+');
}

/** A stored hotkey as a person reads it best: "Ctrl + Alt + R". */
export function hotkeyShown(text: string): string {
  return text.split('+').join(' + ');
}

/**
 * The same hotkey as Electron's accelerator, which is how it is handed to Windows:
 * "Control+Alt+R", "Control+num3", "Super+F9".
 */
export function hotkeyAccelerator(hotkey: Hotkey): string {
  const num = /^Num([0-9])$/.exec(hotkey.key);
  return [
    ...(hotkey.ctrl ? ['Control'] : []),
    ...(hotkey.alt ? ['Alt'] : []),
    ...(hotkey.shift ? ['Shift'] : []),
    ...(hotkey.win ? ['Super'] : []),
    num ? `num${num[1]}` : hotkey.key,
  ].join('+');
}

/** What a key press in the window says, as far as a hotkey needs: KeyboardEvent's own fields. */
export interface KeyPress {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** The physical key: "KeyR", "Digit5", "F9", "Numpad3", "ArrowUp", "Space". */
  code: string;
}

const CODES: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/**
 * The hotkey a key press makes. Undefined while only modifiers are down (the user is still
 * holding Ctrl and reaching for the key); an error for a combination RigReady does not take.
 */
export function hotkeyFromPress(press: KeyPress): Result<Hotkey> | undefined {
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(press.code)) return undefined;
  const code = press.code;
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^Digit([0-9])$/.exec(code);
  const pad = /^Numpad([0-9])$/.exec(code);
  const key = letter
    ? letter[1]
    : digit
      ? digit[1]
      : pad
        ? `Num${pad[1]}`
        : keyName(CODES[code] ?? code);
  if (!key) {
    return err(
      'hotkey.invalid',
      'That key cannot be a hotkey.',
      'Use a letter, a digit, a function key, a number pad digit, an arrow, Space, Home, End, Page Up, Page Down, Insert or Delete.'
    );
  }
  return checked({
    ctrl: press.ctrlKey,
    alt: press.altKey,
    shift: press.shiftKey,
    win: press.metaKey,
    key,
  });
}
