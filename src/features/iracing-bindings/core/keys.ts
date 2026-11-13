import { iracingKeyKnown, iracingPunctuationCode } from './names';

/**
 * Which iRacing key a key press is, for binding a key by pressing it. iRacing has its own
 * key codes (docs/research/racing.md 2.4), and this never guesses one: a key whose code
 * was not checked against a real file, or that a keyboard layout puts somewhere else, is
 * refused with a note to bind it in iRacing. Pure, so the page and its test share it.
 */

/** The fields of a browser KeyboardEvent this needs. */
export interface KeyPress {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

export type KeyCapture =
  | { kind: 'key'; keyCode: number; modifiers: number }
  /** Shift, Ctrl or Alt alone: keep waiting for the key that goes with it. */
  | { kind: 'waiting' }
  | { kind: 'refused'; why: string };

const SHIFT = 0x03;
const CTRL = 0x0c;
const ALT = 0x30;

/** Keys that are the same on every layout, by the name the browser gives the key. */
const NAMED: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Insert: 45,
  Delete: 46,
};

/** Punctuation keys of a US keyboard: what each types alone and with Shift. */
const US_PUNCTUATION: Record<string, [string, string]> = {
  Backquote: ['`', '~'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
};

/** What Shift types on the digit keys of a US keyboard, 0 to 9. */
const US_SHIFTED_DIGITS = ')!@#$%^&*(';

const OTHER_LAYOUT =
  'RigReady binds this key only as a US keyboard has it. Bind it in iRacing instead.';

const refused = (why: string): KeyCapture => ({ kind: 'refused', why });

/** The character a key types fits the key's US place, with or without Shift. */
const types = (press: KeyPress, plain: string, shifted: string): boolean =>
  press.key === (press.shiftKey ? shifted : plain);

function codeOf(press: KeyPress): number | string {
  const { key, code } = press;
  // Letters go by what the key types: iRacing stores the letter, wherever the layout has it.
  if (/^[a-z]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) {
    const n = Number(digit[1]);
    return types(press, String(n), US_SHIFTED_DIGITS[n]!) ? 48 + n : OTHER_LAYOUT;
  }
  const fn = /^F(\d{1,2})$/.exec(code);
  if (fn && key === code) {
    const n = Number(fn[1]);
    // iRacing's table has F1 to F16.
    if (n >= 1 && n <= 16) return 196 + n;
  }
  if (code.startsWith('Numpad')) {
    // iRacing names number pad keys by what they do with Num Lock off; which code it
    // stores for which state was never checked.
    return 'RigReady does not bind number pad keys yet. Bind this one in iRacing.';
  }
  const named = NAMED[code];
  if (named !== undefined && (key === code || (code === 'Space' && key === ' '))) return named;
  const punctuation = US_PUNCTUATION[code];
  if (punctuation) {
    if (!types(press, punctuation[0], punctuation[1])) return OTHER_LAYOUT;
    // iRacing stores the key as it is without Shift, and Shift as a modifier.
    return iracingPunctuationCode(punctuation[0]) ?? OTHER_LAYOUT;
  }
  return 'RigReady cannot bind this key. Bind it in iRacing instead.';
}

export function iracingKeyOf(press: KeyPress): KeyCapture {
  if (['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS'].includes(press.key)) {
    return { kind: 'waiting' };
  }
  if (press.metaKey) return refused('The Windows key cannot be part of an iRacing binding.');
  const keyCode = codeOf(press);
  if (typeof keyCode === 'string') return refused(keyCode);
  if (!iracingKeyKnown(keyCode)) return refused(OTHER_LAYOUT);
  const modifiers =
    (press.shiftKey ? SHIFT : 0) | (press.ctrlKey ? CTRL : 0) | (press.altKey ? ALT : 0);
  return { kind: 'key', keyCode, modifiers };
}
