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
