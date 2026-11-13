import { describe, expect, it } from 'vitest';
import { distinctLabels, freeName, nameKey, nameTakenText } from './names';

describe('virtual controller profile names', () => {
  it('two names are one name when only capitals or spacing differ', () => {
    expect(nameKey('  My  HOTAS ')).toBe('my hotas');
    expect(nameKey('My HOTAS')).toBe(nameKey('my hotas'));
    expect(nameKey('My HOTAS')).not.toBe(nameKey('My HOTAS 2'));
  });

  it('keeps a free name and numbers a taken one', () => {
    expect(freeName('My HOTAS', [])).toBe('My HOTAS');
    expect(freeName('  My   HOTAS ', [])).toBe('My HOTAS');
    expect(freeName('My HOTAS', ['My HOTAS'])).toBe('My HOTAS 2');
    expect(freeName('my hotas', ['My HOTAS', 'My HOTAS 2'])).toBe('my hotas 3');
    // The copy of a numbered profile counts on from its number: never "My HOTAS 2 2".
    expect(freeName('My HOTAS 2', ['My HOTAS', 'My HOTAS 2'])).toBe('My HOTAS 3');
    expect(freeName('My HOTAS 2', ['My HOTAS', 'My HOTAS 2', 'My HOTAS 3'])).toBe('My HOTAS 4');
    // Any other number at the end is part of the name: a game's number is never counted on.
    expect(freeName('My Ace Combat 8', ['My Ace Combat 8'])).toBe('My Ace Combat 8 2');
    expect(freeName('My Ace Combat 8', ['My Ace Combat 8', 'My Ace Combat 8 2'])).toBe(
      'My Ace Combat 8 3'
    );
  });

  it('keeps a numbered name within the longest name a profile may have', () => {
    const long = 'x'.repeat(80);
    const numbered = freeName(long, [long]);
    expect(numbered).toBe(`${'x'.repeat(78)} 2`);
    expect(numbered.length).toBe(80);
    expect(freeName(long, [long, numbered])).toBe(`${'x'.repeat(78)} 3`);
  });

  it('says whose name is taken', () => {
    expect(nameTakenText({ id: 'my-hotas', name: 'My HOTAS' })).toBe(
      'Another profile is already called "My HOTAS". Give this one a different name.'
    );
    expect(nameTakenText({ id: 'starting-hotas', name: 'HOTAS to gamepad' })).toBe(
      'A starting point is already called "HOTAS to gamepad". Give this one a different name.'
    );
  });

  it('adds the id only to profiles that share a name', () => {
    expect(
      distinctLabels([
        { id: 'my-flight-stick-to-gamepad', name: 'My flight stick to gamepad' },
        { id: 'my-flight-stick-to-gamepad-2', name: 'My flight stick to gamepad' },
        { id: 'my-wheel', name: 'My wheel' },
      ])
    ).toEqual([
      {
        id: 'my-flight-stick-to-gamepad',
        name: 'My flight stick to gamepad (my-flight-stick-to-gamepad)',
      },
      {
        id: 'my-flight-stick-to-gamepad-2',
        name: 'My flight stick to gamepad (my-flight-stick-to-gamepad-2)',
      },
      { id: 'my-wheel', name: 'My wheel' },
    ]);
    expect(distinctLabels([])).toEqual([]);
  });
});
