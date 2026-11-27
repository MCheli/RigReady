import { describe, expect, it } from 'vitest';
import { GAME_KEYS, gameKeyByNumbers, gameKeyOf, keyName } from './keys';

/**
 * The table of keys as the game numbers them, against every pair of numbers seen in the
 * owner's saved keyboard maps and the one key the game was seen to write (F7): Rewired's
 * number for the key, and Unity's KeyCode (docs/research/nuclear-option.md, "Keys").
 */
const SEEN: [element: number, keyCode: number, dom: string][] = [
  [1, 97, 'KeyA'],
  [2, 98, 'KeyB'],
  [4, 100, 'KeyD'],
  [5, 101, 'KeyE'],
  [6, 102, 'KeyF'],
  [7, 103, 'KeyG'],
  [12, 108, 'KeyL'],
  [13, 109, 'KeyM'],
  [14, 110, 'KeyN'],
  [17, 113, 'KeyQ'],
  [18, 114, 'KeyR'],
  [19, 115, 'KeyS'],
  [20, 116, 'KeyT'],
  [22, 118, 'KeyV'],
  [23, 119, 'KeyW'],
  [24, 120, 'KeyX'],
  [39, 258, 'Numpad2'],
  [41, 260, 'Numpad4'],
  [42, 261, 'Numpad5'],
  [43, 262, 'Numpad6'],
  [45, 264, 'Numpad8'],
  [54, 32, 'Space'],
  [55, 8, 'Backspace'],
  [56, 9, 'Tab'],
  [58, 13, 'Enter'],
  [60, 27, 'Escape'],
  [71, 44, 'Comma'],
  [88, 127, 'Delete'],
  [89, 273, 'ArrowUp'],
  [90, 274, 'ArrowDown'],
  [96, 280, 'PageUp'],
  [97, 281, 'PageDown'],
  [99, 283, 'F2'],
  [100, 284, 'F3'],
  [101, 285, 'F4'],
  [104, 288, 'F7'],
  [106, 290, 'F9'],
  [107, 291, 'F10'],
  [117, 304, 'ShiftLeft'],
  [119, 306, 'ControlLeft'],
];

describe('the keys as Nuclear Option numbers them', () => {
  it('has every pair of numbers that was seen, under the key the browser names', () => {
    for (const [element, keyCode, dom] of SEEN) {
      expect(gameKeyOf(dom), dom).toEqual({ element, keyCode, dom });
      expect(gameKeyByNumbers(element, keyCode)?.dom, dom).toBe(dom);
    }
  });

  it('gives each key one number, one KeyCode and one name, and each of them once', () => {
    for (const field of ['element', 'keyCode', 'dom'] as const) {
      expect(new Set(GAME_KEYS.map((k) => k[field])).size, field).toBe(GAME_KEYS.length);
    }
  });

  it('follows Unity’s KeyCode list where no pair was seen: the runs between the keys that were', () => {
    const numbers = (dom: string): [number, number] => {
      const key = gameKeyOf(dom)!;
      return [key.element, key.keyCode];
    };
    // Ten digits between Z (26) and keypad 0 (37).
    expect(numbers('KeyZ')).toEqual([26, 122]);
    expect(numbers('Digit0')).toEqual([27, 48]);
    expect(numbers('Digit9')).toEqual([36, 57]);
    expect(numbers('Numpad0')).toEqual([37, 256]);
    expect(numbers('Numpad9')).toEqual([46, 265]);
    // The keypad's signs, up to Space (54).
    expect(numbers('NumpadDecimal')).toEqual([47, 266]);
    expect(numbers('NumpadAdd')).toEqual([51, 270]);
    expect(numbers('NumpadEnter')).toEqual([52, 271]);
    // The punctuation between Comma (71) and Delete (88).
    expect(numbers('Minus')).toEqual([72, 45]);
    expect(numbers('Period')).toEqual([73, 46]);
    expect(numbers('Slash')).toEqual([74, 47]);
    expect(numbers('Semicolon')).toEqual([76, 59]);
    expect(numbers('Equal')).toEqual([78, 61]);
    expect(numbers('BracketLeft')).toEqual([82, 91]);
    expect(numbers('Backslash')).toEqual([83, 92]);
    expect(numbers('BracketRight')).toEqual([84, 93]);
    expect(numbers('Backquote')).toEqual([87, 96]);
    expect(numbers('Quote')).toEqual([66, 39]);
    // The arrows and the block above them, the function keys, the locks and the modifiers.
    expect(numbers('ArrowRight')).toEqual([91, 275]);
    expect(numbers('ArrowLeft')).toEqual([92, 276]);
    expect(numbers('Insert')).toEqual([93, 277]);
    expect(numbers('Home')).toEqual([94, 278]);
    expect(numbers('End')).toEqual([95, 279]);
    expect(numbers('F1')).toEqual([98, 282]);
    expect(numbers('F12')).toEqual([109, 293]);
    expect(numbers('NumLock')).toEqual([113, 300]);
    expect(numbers('CapsLock')).toEqual([114, 301]);
    expect(numbers('ScrollLock')).toEqual([115, 302]);
    expect(numbers('ShiftRight')).toEqual([116, 303]);
    expect(numbers('ControlRight')).toEqual([118, 305]);
    expect(numbers('AltRight')).toEqual([120, 307]);
    expect(numbers('AltLeft')).toEqual([121, 308]);
    expect(numbers('Pause')).toEqual([59, 19]);
  });

  it('knows no key it has no numbers for, and names every key it has', () => {
    expect(gameKeyOf('IntlBackslash')).toBeUndefined();
    expect(gameKeyOf('MetaLeft')).toBeUndefined();
    expect(gameKeyByNumbers(104, 289)).toBeUndefined();
    for (const key of GAME_KEYS) expect(keyName(key.keyCode), key.dom).not.toMatch(/^Key \d+$/);
  });
});
