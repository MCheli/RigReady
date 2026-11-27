/**
 * Unity's KeyCode numbers as key names, for the keyboard map (Rewired stores the KeyCode
 * in `keyboardKeyCode`). The values are Unity's documented enum:
 * https://docs.unity3d.com/ScriptReference/KeyCode.html
 * A code that is not here is shown as "Key <code>".
 */

const NAMED: Record<number, string> = {
  8: 'Backspace',
  9: 'Tab',
  12: 'Clear',
  13: 'Enter',
  19: 'Pause',
  27: 'Esc',
  32: 'Space',
  39: "'",
  44: ',',
  45: '-',
  46: '.',
  47: '/',
  59: ';',
  61: '=',
  91: '[',
  92: '\\',
  93: ']',
  96: '`',
  127: 'Delete',
  266: 'Num .',
  267: 'Num /',
  268: 'Num *',
  269: 'Num -',
  270: 'Num +',
  271: 'Num Enter',
  272: 'Num =',
  273: 'Up',
  274: 'Down',
  275: 'Right',
  276: 'Left',
  277: 'Insert',
  278: 'Home',
  279: 'End',
  280: 'Page Up',
  281: 'Page Down',
  300: 'Num Lock',
  301: 'Caps Lock',
  302: 'Scroll Lock',
  303: 'RShift',
  304: 'LShift',
  305: 'RCtrl',
  306: 'LCtrl',
  307: 'RAlt',
  308: 'LAlt',
  316: 'Print Screen',
};

/** "W", "LShift", "Num 5", "F2"; "Key 999" for a code Unity's list does not have. */
export function keyName(code: number): string {
  if (code >= 97 && code <= 122) return String.fromCharCode(code - 32);
  if (code >= 48 && code <= 57) return String.fromCharCode(code);
  if (code >= 256 && code <= 265) return `Num ${code - 256}`;
  if (code >= 282 && code <= 296) return `F${code - 281}`;
  return NAMED[code] ?? `Key ${code}`;
}

/** Rewired's ModifierKey: 1 Control, 2 Alt, 3 Shift, 4 Command; 0 none. */
export function modifierName(modifier: number): string | undefined {
  return { 1: 'Ctrl', 2: 'Alt', 3: 'Shift', 4: 'Cmd' }[modifier];
}

/** Rewired's mouse elements, as it numbers them for its own mouse definition. */
export function mouseElementName(elementType: number, id: number): string {
  if (elementType === 0) {
    return (
      { 0: 'Mouse left-right', 1: 'Mouse up-down', 2: 'Mouse wheel' }[id] ?? `Mouse axis ${id}`
    );
  }
  const buttons: Record<number, string> = {
    3: 'Left mouse button',
    4: 'Right mouse button',
    5: 'Middle mouse button',
  };
  return buttons[id] ?? `Mouse button ${id}`;
}

/**
 * A key as the game's keyboard map knows it: Rewired's number for the key (its element id),
 * Unity's KeyCode beside it, and the browser's name for the physical key (KeyboardEvent.code),
 * by which the page says which key was pressed.
 *
 * Rewired numbers the keys in the order of Unity's KeyCode list, from A = 1. Seen in the
 * owner's saved keyboard maps for 40 keys (docs/research/nuclear-option.md, "Keys"), among
 * them at least one in every run below but the digits, the keypad's signs and three single
 * keys; the rest follow from the runs fitting exactly between the keys that were seen.
 */
export interface GameKey {
  element: number;
  keyCode: number;
  /** KeyboardEvent.code: "KeyA", "Digit1", "Numpad5", "F7", "ShiftLeft". */
  dom: string;
}

const run = (firstElement: number, firstKeyCode: number, dom: readonly string[]): GameKey[] =>
  dom.map((code, i) => ({ element: firstElement + i, keyCode: firstKeyCode + i, dom: code }));
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const digits = '0123456789'.split('');

export const GAME_KEYS: readonly GameKey[] = [
  ...run(
    1,
    97,
    letters.map((l) => `Key${l}`)
  ),
  ...run(
    27,
    48,
    digits.map((d) => `Digit${d}`)
  ),
  ...run(
    37,
    256,
    digits.map((d) => `Numpad${d}`)
  ),
  ...run(47, 266, [
    'NumpadDecimal',
    'NumpadDivide',
    'NumpadMultiply',
    'NumpadSubtract',
    'NumpadAdd',
    'NumpadEnter',
  ]),
  { element: 54, keyCode: 32, dom: 'Space' },
  { element: 55, keyCode: 8, dom: 'Backspace' },
  { element: 56, keyCode: 9, dom: 'Tab' },
  { element: 58, keyCode: 13, dom: 'Enter' },
  { element: 59, keyCode: 19, dom: 'Pause' },
  { element: 60, keyCode: 27, dom: 'Escape' },
  { element: 66, keyCode: 39, dom: 'Quote' },
  { element: 71, keyCode: 44, dom: 'Comma' },
  { element: 72, keyCode: 45, dom: 'Minus' },
  { element: 73, keyCode: 46, dom: 'Period' },
  { element: 74, keyCode: 47, dom: 'Slash' },
  { element: 76, keyCode: 59, dom: 'Semicolon' },
  { element: 78, keyCode: 61, dom: 'Equal' },
  { element: 82, keyCode: 91, dom: 'BracketLeft' },
  { element: 83, keyCode: 92, dom: 'Backslash' },
  { element: 84, keyCode: 93, dom: 'BracketRight' },
  { element: 87, keyCode: 96, dom: 'Backquote' },
  { element: 88, keyCode: 127, dom: 'Delete' },
  ...run(89, 273, [
    'ArrowUp',
    'ArrowDown',
    'ArrowRight',
    'ArrowLeft',
    'Insert',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ]),
  ...run(
    98,
    282,
    Array.from({ length: 12 }, (_, i) => `F${i + 1}`)
  ),
  ...run(113, 300, [
    'NumLock',
    'CapsLock',
    'ScrollLock',
    'ShiftRight',
    'ShiftLeft',
    'ControlRight',
    'ControlLeft',
    'AltRight',
    'AltLeft',
  ]),
];

const BY_DOM = new Map(GAME_KEYS.map((k) => [k.dom, k]));

/** The game's key for a physical key the browser names; undefined for one RigReady does not bind. */
export const gameKeyOf = (dom: string): GameKey | undefined => BY_DOM.get(dom);

/** Rewired's ModifierKey numbers, in the order the game writes them: Control, Alt, Shift. */
export const MODIFIERS = { ctrl: 1, alt: 2, shift: 3 } as const;
