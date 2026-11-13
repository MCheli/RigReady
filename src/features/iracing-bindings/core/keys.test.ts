import { describe, expect, it } from 'vitest';
import { iracingKeyOf, type KeyPress } from './keys';
import { iracingKeyKnown, iracingKeyLabel } from './names';

/** A key press as the browser reports it; modifiers are named in the third argument. */
function press(key: string, code: string, held = ''): KeyPress {
  return {
    key,
    code,
    shiftKey: held.includes('shift'),
    ctrlKey: held.includes('ctrl'),
    altKey: held.includes('alt'),
    metaKey: held.includes('win'),
  };
}
/** The key as the page would show it, or why it was refused. */
function shown(p: KeyPress): string {
  const got = iracingKeyOf(p);
  if (got.kind === 'key') return iracingKeyLabel(got.keyCode, got.modifiers);
  return got.kind === 'waiting' ? '(waiting)' : `refused: ${got.why}`;
}

describe('which iRacing key a key press is', () => {
  it('takes a letter by what the key types, in either case', () => {
    expect(iracingKeyOf(press('h', 'KeyH'))).toEqual({ kind: 'key', keyCode: 72, modifiers: 0 });
    expect(iracingKeyOf(press('H', 'KeyH', 'shift'))).toEqual({
      kind: 'key',
      keyCode: 72,
      modifiers: 0x03,
    });
    // A layout that has the letter somewhere else: the letter counts, not the place.
    expect(shown(press('a', 'KeyQ'))).toBe('A');
    expect(shown(press('z', 'KeyY'))).toBe('Z');
    for (const letter of 'abcdefghijklmnopqrstuvwxyz') {
      expect(shown(press(letter, `Key${letter.toUpperCase()}`))).toBe(letter.toUpperCase());
    }
  });

  it('stores Shift, Ctrl and Alt the way iRacing does: two bits each', () => {
    expect(iracingKeyOf(press('w', 'KeyW', 'ctrl'))).toMatchObject({ modifiers: 0x0c });
    expect(iracingKeyOf(press('w', 'KeyW', 'alt'))).toMatchObject({ modifiers: 0x30 });
    expect(iracingKeyOf(press('W', 'KeyW', 'shift'))).toMatchObject({ modifiers: 0x03 });
    // The recorded file has Ctrl+Alt+W as 0x3c.
    expect(iracingKeyOf(press('w', 'KeyW', 'ctrl alt'))).toMatchObject({ modifiers: 0x3c });
    expect(iracingKeyOf(press('W', 'KeyW', 'ctrl alt shift'))).toMatchObject({ modifiers: 0x3f });
    expect(shown(press('W', 'KeyW', 'ctrl alt shift'))).toBe('Ctrl+Alt+Shift+W');
  });

  it('takes the digit keys of the top row, with and without Shift', () => {
    for (let n = 0; n <= 9; n++) {
      expect(iracingKeyOf(press(String(n), `Digit${n}`))).toEqual({
        kind: 'key',
        keyCode: 48 + n,
        modifiers: 0,
      });
      expect(iracingKeyOf(press(')!@#$%^&*('[n]!, `Digit${n}`, 'shift'))).toEqual({
        kind: 'key',
        keyCode: 48 + n,
        modifiers: 0x03,
      });
    }
    expect(shown(press('1', 'Digit1', 'ctrl'))).toBe('Ctrl+1');
    expect(shown(press('!', 'Digit1', 'shift'))).toBe('Shift+1');
  });

  it('takes F1 to F16 and no further', () => {
    for (let n = 1; n <= 16; n++) {
      expect(iracingKeyOf(press(`F${n}`, `F${n}`))).toEqual({
        kind: 'key',
        keyCode: 196 + n,
        modifiers: 0,
      });
    }
    expect(shown(press('F5', 'F5', 'shift'))).toBe('Shift+F5');
    expect(shown(press('F17', 'F17'))).toMatch(/^refused: RigReady cannot bind this key/);
    expect(shown(press('F0', 'F0'))).toMatch(/^refused:/);
  });

  it('takes the keys that are the same on every keyboard', () => {
    const named: [string, string, string][] = [
      ['Backspace', 'Backspace', 'Backspace'],
      ['Tab', 'Tab', 'Tab'],
      ['Enter', 'Enter', 'Enter'],
      [' ', 'Space', 'Space'],
      ['PageUp', 'PageUp', 'Page Up'],
      ['PageDown', 'PageDown', 'Page Down'],
      ['End', 'End', 'End'],
      ['Home', 'Home', 'Home'],
      ['ArrowLeft', 'ArrowLeft', 'Left'],
      ['ArrowUp', 'ArrowUp', 'Up'],
      ['ArrowRight', 'ArrowRight', 'Right'],
      ['ArrowDown', 'ArrowDown', 'Down'],
      ['Insert', 'Insert', 'Insert'],
      ['Delete', 'Delete', 'Delete'],
    ];
    for (const [key, code, label] of named) expect(shown(press(key, code)), code).toBe(label);
    expect(shown(press('PageUp', 'PageUp', 'ctrl'))).toBe('Ctrl+Page Up');
    expect(iracingKeyOf(press(' ', 'Space'))).toEqual({ kind: 'key', keyCode: 32, modifiers: 0 });
  });

  it('takes US punctuation as the key without Shift, and Shift as a modifier', () => {
    const keys: [string, string, string][] = [
      ['Backquote', '`', '~'],
      ['Minus', '-', '_'],
      ['Equal', '=', '+'],
      ['BracketLeft', '[', '{'],
      ['BracketRight', ']', '}'],
      ['Backslash', '\\', '|'],
      ['Semicolon', ';', ':'],
      ['Quote', "'", '"'],
      ['Comma', ',', '<'],
      ['Period', '.', '>'],
      ['Slash', '/', '?'],
    ];
    for (const [code, plain, shifted] of keys) {
      expect(shown(press(plain, code)), code).toBe(plain);
      expect(shown(press(shifted, code, 'shift')), code).toBe(`Shift+${plain}`);
    }
    // The recorded file has "=" as 114.
    expect(iracingKeyOf(press('=', 'Equal'))).toEqual({ kind: 'key', keyCode: 114, modifiers: 0 });
    expect(iracingKeyOf(press('+', 'Equal', 'shift'))).toEqual({
      kind: 'key',
      keyCode: 114,
      modifiers: 0x03,
    });
  });

  it('waits when only Shift, Ctrl, Alt or the Windows key is down', () => {
    expect(iracingKeyOf(press('Shift', 'ShiftLeft', 'shift'))).toEqual({ kind: 'waiting' });
    expect(iracingKeyOf(press('Control', 'ControlRight', 'ctrl'))).toEqual({ kind: 'waiting' });
    expect(iracingKeyOf(press('Alt', 'AltLeft', 'alt'))).toEqual({ kind: 'waiting' });
    expect(iracingKeyOf(press('AltGraph', 'AltRight', 'ctrl alt'))).toEqual({ kind: 'waiting' });
    expect(iracingKeyOf(press('Meta', 'MetaLeft', 'win'))).toEqual({ kind: 'waiting' });
  });

  it('refuses what it cannot be sure of, and says to bind it in iRacing', () => {
    // The Windows key held with another key.
    expect(shown(press('h', 'KeyH', 'win'))).toBe(
      'refused: The Windows key cannot be part of an iRacing binding.'
    );
    // Number pad keys: which code iRacing stores for which Num Lock state was never checked.
    for (const [key, code] of [
      ['5', 'Numpad5'],
      ['ArrowUp', 'Numpad8'],
      ['Enter', 'NumpadEnter'],
      ['+', 'NumpadAdd'],
      ['.', 'NumpadDecimal'],
    ]) {
      expect(shown(press(key!, code!)), code).toBe(
        'refused: RigReady does not bind number pad keys yet. Bind this one in iRacing.'
      );
    }
    // Another layout: the key in the place of "2" types something else, the key in the
    // place of ";" types a letter iRacing files under another code.
    const otherLayout =
      'refused: RigReady binds this key only as a US keyboard has it. Bind it in iRacing instead.';
    expect(shown(press('é', 'Digit2'))).toBe(otherLayout);
    expect(shown(press('"', 'Digit2', 'shift'))).toBe(otherLayout);
    expect(shown(press('2', 'Digit2', 'shift'))).toBe(otherLayout);
    expect(shown(press('ö', 'Semicolon'))).toBe(otherLayout);
    expect(shown(press('-', 'Slash'))).toBe(otherLayout);
    expect(shown(press('ß', 'Minus'))).toBe(otherLayout);
    // Keys with no checked code.
    const cannot = 'refused: RigReady cannot bind this key. Bind it in iRacing instead.';
    for (const [key, code] of [
      ['Escape', 'Escape'],
      ['CapsLock', 'CapsLock'],
      ['PrintScreen', 'PrintScreen'],
      ['Pause', 'Pause'],
      ['ContextMenu', 'ContextMenu'],
      ['AudioVolumeUp', 'AudioVolumeUp'],
      ['<', 'IntlBackslash'],
      ['Dead', 'BracketLeft2'],
      ['Unidentified', ''],
    ]) {
      expect(shown(press(key!, code!)), code).toBe(cannot);
    }
    // A dead key in a punctuation place is another layout, not a guess.
    expect(shown(press('Dead', 'BracketLeft'))).toBe(otherLayout);
  });

  it('only ever gives a code iRacing has a name for, whatever is pressed', () => {
    const keys = ['a', 'Z', '1', '!', ' ', 'F1', 'F16', 'F24', 'Enter', 'Dead', 'é', '', 'Process'];
    const codes = ['KeyA', 'Digit1', 'Space', 'F1', 'F16', 'Enter', 'Numpad1', 'Quote', '', 'Fn'];
    let bound = 0;
    for (const key of keys) {
      for (const code of codes) {
        for (const held of ['', 'shift', 'ctrl alt', 'shift ctrl alt']) {
          const got = iracingKeyOf(press(key, code, held));
          if (got.kind === 'refused') expect(got.why.length).toBeGreaterThan(20);
          if (got.kind !== 'key') continue;
          bound++;
          expect(iracingKeyKnown(got.keyCode), `${key} ${code}`).toBe(true);
          expect(got.modifiers & ~0x3f).toBe(0);
          for (const pair of [0x03, 0x0c, 0x30]) {
            expect([0, pair]).toContain(got.modifiers & pair);
          }
        }
      }
    }
    expect(bound).toBeGreaterThan(20);
  });
});
