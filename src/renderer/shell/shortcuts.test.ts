import { describe, expect, it } from 'vitest';
import {
  isTyping,
  PALETTE_KEYS,
  shortcut,
  shortcutFor,
  SHORTCUTS,
  type KeyPress,
} from './shortcuts';

const press = (key: string, held: Partial<KeyPress> = {}): KeyPress => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...held,
});

describe('keyboard shortcuts of the shell', () => {
  it('Ctrl+K opens the palette, Ctrl+1 and Ctrl+2 change mode, with either case of the letter', () => {
    expect(shortcutFor(press('k', { ctrlKey: true }), false)).toBe('palette');
    expect(shortcutFor(press('K', { ctrlKey: true }), false)).toBe('palette');
    expect(shortcutFor(press('1', { ctrlKey: true }), false)).toBe('fly');
    expect(shortcutFor(press('2', { ctrlKey: true }), false)).toBe('configure');
  });

  it('the Ctrl shortcuts work while typing in a field; "?" there is a question mark', () => {
    expect(shortcutFor(press('k', { ctrlKey: true }), true)).toBe('palette');
    expect(shortcutFor(press('1', { ctrlKey: true }), true)).toBe('fly');
    expect(shortcutFor(press('?', { shiftKey: true }), true)).toBeUndefined();
    expect(shortcutFor(press('?', { shiftKey: true }), false)).toBe('help');
    // A layout where "?" needs no Shift.
    expect(shortcutFor(press('?'), false)).toBe('help');
  });

  it('nothing else is taken: plain letters, other Ctrl keys, and anything with Alt, Shift+Ctrl or the Windows key', () => {
    expect(shortcutFor(press('k'), false)).toBeUndefined();
    expect(shortcutFor(press('1'), false)).toBeUndefined();
    expect(shortcutFor(press('3', { ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('c', { ctrlKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('k', { ctrlKey: true, shiftKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('k', { ctrlKey: true, altKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('k', { metaKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('?', { altKey: true }), false)).toBeUndefined();
    expect(shortcutFor(press('/'), false)).toBeUndefined();
  });

  it('the list shown by "?" is the table the key handler reads: every entry answers to its keys', () => {
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual(['configure', 'fly', 'help', 'palette']);
    for (const entry of SHORTCUTS) {
      const key = entry.keys[entry.keys.length - 1]!;
      const held = { ctrlKey: entry.keys.includes('Ctrl') };
      expect(shortcutFor(press(key, held), false), entry.label).toBe(entry.id);
      expect(entry.label.length).toBeGreaterThan(8);
      expect(shortcut(entry.id)).toBe(entry);
    }
    expect(PALETTE_KEYS.map((k) => k.keys.join(' '))).toEqual(['↑ ↓', 'Enter', 'Esc']);
  });
});

describe('whether keys go into a text field', () => {
  const element = (
    tagName: string,
    attributes: Record<string, string> = {},
    isContentEditable = false
  ) => ({
    tagName,
    isContentEditable,
    getAttribute: (name: string) => attributes[name] ?? null,
  });

  it('a text input, a textarea, a select and anything editable are typing', () => {
    expect(isTyping(element('INPUT'))).toBe(true);
    expect(isTyping(element('INPUT', { type: 'search' }))).toBe(true);
    expect(isTyping(element('INPUT', { type: 'number' }))).toBe(true);
    expect(isTyping(element('TEXTAREA'))).toBe(true);
    expect(isTyping(element('SELECT'))).toBe(true);
    expect(isTyping(element('DIV', {}, true))).toBe(true);
    expect(isTyping(element('DIV', { role: 'textbox' }))).toBe(true);
    expect(isTyping(element('DIV', { role: 'combobox' }))).toBe(true);
  });

  it('a checkbox, a button, a link and nothing at all are not', () => {
    expect(isTyping(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTyping(element('INPUT', { type: 'RADIO' }))).toBe(false);
    expect(isTyping(element('BUTTON'))).toBe(false);
    expect(isTyping(element('A'))).toBe(false);
    expect(isTyping(element('DIV', { role: 'button' }))).toBe(false);
    expect(isTyping(null)).toBe(false);
    expect(isTyping(undefined)).toBe(false);
    expect(isTyping({})).toBe(false);
  });
});
