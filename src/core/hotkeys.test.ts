import { describe, expect, it } from 'vitest';
import {
  hotkeyAccelerator,
  hotkeyFromPress,
  hotkeyShown,
  hotkeyText,
  parseHotkey,
  type Hotkey,
  type KeyPress,
} from './hotkeys';

const press = (code: string, held: Partial<KeyPress> = {}): KeyPress => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  code,
  ...held,
});

const parsed = (text: string): Hotkey => {
  const result = parseHotkey(text);
  if (!result.ok) throw new Error(`${text}: ${result.error.message}`);
  return result.value;
};

describe('a hotkey as it is written', () => {
  it('is read whatever the spelling, and written back in one', () => {
    expect(parsed('Ctrl+Alt+R')).toEqual({
      ctrl: true,
      alt: true,
      shift: false,
      win: false,
      key: 'R',
    });
    expect(hotkeyText(parsed('alt + ctrl + r'))).toBe('Ctrl+Alt+R');
    expect(hotkeyText(parsed('Control+Shift+f9'))).toBe('Ctrl+Shift+F9');
    expect(hotkeyText(parsed('Win+5'))).toBe('Win+5');
    expect(hotkeyText(parsed('super + numpad3'))).toBe('Win+Num3');
    expect(hotkeyText(parsed('CommandOrControl+Alt+pageup'))).toBe('Ctrl+Alt+PageUp');
    expect(hotkeyText(parsed('ctrl+alt+shift+win+space'))).toBe('Ctrl+Alt+Shift+Win+Space');
    for (const key of ['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'Insert', 'Delete', 'F24']) {
      expect(hotkeyText(parsed(`Ctrl+${key.toLowerCase()}`))).toBe(`Ctrl+${key}`);
    }
    // What is written is read back the same.
    for (const text of ['Ctrl+Alt+R', 'Alt+F1', 'Ctrl+Shift+Num0', 'Win+Space']) {
      expect(hotkeyText(parsed(text))).toBe(text);
    }
  });

  it('is handed to Windows as an accelerator', () => {
    expect(hotkeyAccelerator(parsed('Ctrl+Alt+R'))).toBe('Control+Alt+R');
    expect(hotkeyAccelerator(parsed('Ctrl+Shift+Num3'))).toBe('Control+Shift+num3');
    expect(hotkeyAccelerator(parsed('Win+F9'))).toBe('Super+F9');
    expect(hotkeyAccelerator(parsed('Ctrl+Alt+Shift+Win+Up'))).toBe('Control+Alt+Shift+Super+Up');
  });

  it('is shown with room between the keys', () => {
    expect(hotkeyShown('Ctrl+Alt+R')).toBe('Ctrl + Alt + R');
    expect(hotkeyShown(hotkeyText(parsed('win+num3')))).toBe('Win + Num3');
  });

  it('is refused when it could be pressed by accident, has no key, has two, or names no key', () => {
    const refused = (text: string): string => {
      const result = parseHotkey(text);
      if (result.ok) throw new Error(`${text} was accepted`);
      expect(result.error.code).toBe('hotkey.invalid');
      return result.error.message;
    };
    // A bare key, or Shift alone with it, is typed and pressed in a game all the time.
    expect(refused('R')).toMatch(/Hold Ctrl, Alt or the Windows key/);
    expect(refused('F5')).toMatch(/Hold Ctrl, Alt or the Windows key/);
    expect(refused('Shift+R')).toMatch(/Hold Ctrl, Alt or the Windows key/);
    expect(refused('Ctrl+Alt')).toBe('A hotkey needs a key besides Ctrl, Alt, Shift and Windows.');
    expect(refused('Ctrl+A+B')).toBe('A hotkey ends in one key, not two.');
    expect(refused('Ctrl+Escape')).toBe('"Escape" cannot be part of a hotkey.');
    expect(refused('Ctrl+F25')).toBe('"F25" cannot be part of a hotkey.');
    expect(refused('')).toBe('Press a key combination.');
    expect(refused(' + ')).toBe('Press a key combination.');
  });
});

describe('a hotkey as it is pressed in the window', () => {
  it('is the keys held and the key pressed', () => {
    const made = (code: string, held: Partial<KeyPress>): string => {
      const result = hotkeyFromPress(press(code, held));
      if (!result?.ok) throw new Error(`${code} was not taken`);
      return hotkeyText(result.value);
    };
    expect(made('KeyR', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+R');
    expect(made('Digit5', { metaKey: true })).toBe('Win+5');
    expect(made('F9', { ctrlKey: true, shiftKey: true })).toBe('Ctrl+Shift+F9');
    expect(made('Numpad3', { altKey: true })).toBe('Alt+Num3');
    expect(made('ArrowUp', { ctrlKey: true })).toBe('Ctrl+Up');
    expect(made('ArrowLeft', { ctrlKey: true })).toBe('Ctrl+Left');
    expect(made('Space', { ctrlKey: true, altKey: true })).toBe('Ctrl+Alt+Space');
    expect(made('PageDown', { altKey: true })).toBe('Alt+PageDown');
  });

  it('waits while only Ctrl, Alt, Shift or Windows are down', () => {
    for (const code of [
      'ControlLeft',
      'ControlRight',
      'AltLeft',
      'ShiftRight',
      'MetaLeft',
      'OSLeft',
    ]) {
      expect(hotkeyFromPress(press(code, { ctrlKey: true }))).toBeUndefined();
    }
  });

  it('says why a combination is not taken', () => {
    expect(hotkeyFromPress(press('KeyR'))).toMatchObject({
      ok: false,
      error: { code: 'hotkey.invalid', message: expect.stringContaining('Hold Ctrl, Alt') },
    });
    expect(hotkeyFromPress(press('KeyR', { shiftKey: true }))).toMatchObject({ ok: false });
    expect(hotkeyFromPress(press('Escape', { ctrlKey: true }))).toMatchObject({
      ok: false,
      error: { message: 'That key cannot be a hotkey.' },
    });
    expect(hotkeyFromPress(press('Semicolon', { ctrlKey: true }))).toMatchObject({ ok: false });
  });
});
