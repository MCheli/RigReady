import { describe, expect, it } from 'vitest';
import { fold, fuzzyMatch, highlight, matchCommand, wordMatch } from './fuzzy';

const score = (needle: string, text: string): number =>
  fuzzyMatch(needle, text)?.score ?? -Infinity;

describe('fuzzy matching', () => {
  it('finds the typed letters in order, whatever their case, and says where', () => {
    expect(fuzzyMatch('mr', 'Make ready')?.positions).toEqual([0, 5]);
    expect(fuzzyMatch('MAKE', 'Make ready')?.positions).toEqual([0, 1, 2, 3]);
    expect(fuzzyMatch('usb', 'USB map')?.positions).toEqual([0, 1, 2]);
    // In order only: the letters are all there, but not in this order.
    expect(fuzzyMatch('rm', 'Make ready')).toBeUndefined();
    expect(fuzzyMatch('xyz', 'Make ready')).toBeUndefined();
    expect(fuzzyMatch('', 'Make ready')).toBeUndefined();
    expect(fuzzyMatch('make ready and more', 'Make ready')).toBeUndefined();
  });

  it('prefers letters that stand together and at the starts of words', () => {
    // "mon" is the start of Monitors and scattered in "Make ready now".
    expect(score('mon', 'Monitors')).toBeGreaterThan(score('mon', 'Make one'));
    // Word starts beat letters inside words.
    expect(score('sd', 'Stand down')).toBeGreaterThan(score('sd', 'Misdirect'));
    // The whole text typed beats a text that only starts with it, which beats one that contains it.
    expect(score('fly', 'Fly')).toBeGreaterThan(score('fly', 'Fly screen'));
    expect(score('fly', 'Fly screen')).toBeGreaterThan(score('fly', 'Butterfly'));
    // The shorter of two equal matches comes first.
    expect(score('back', 'Backups')).toBeGreaterThan(score('back', 'Backups and snapshots'));
  });

  it('picks the best way to place the letters, not the first', () => {
    // The first "s" and "d" are in "Stand"; the better reading is the two word starts.
    expect(fuzzyMatch('sd', 'Stand down')?.positions).toEqual([0, 6]);
    expect(fuzzyMatch('f18', 'F/A-18C Hornet')?.positions).toEqual([0, 4, 5]);
    expect(fuzzyMatch('dev', 'DCS bindings: Device IDs')?.positions).toEqual([14, 15, 16]);
    // The word that is typed out whole, not its first letters borrowed from the word before.
    expect(fuzzyMatch('controls', 'common controls')?.positions).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14,
    ]);
  });

  it('drops a match made only of letters scattered inside words', () => {
    expect(fuzzyMatch('ae', 'Make ready')).toBeUndefined();
    expect(fuzzyMatch('kd', 'Make ready')).toBeUndefined();
    // A letter at the start of a word carries a weak match; it ranks far below a good one.
    expect(score('kr', 'Make ready')).toBeLessThan(score('mr', 'Make ready') / 2);
    // One letter finds what starts with it, not everything that contains it.
    expect(fuzzyMatch('a', 'Audio')).toBeDefined();
    expect(fuzzyMatch('a', 'Stand down')).toBeUndefined();
    // Letters inside a word still match when they follow each other.
    expect(fuzzyMatch('udio', 'Audio')).toBeDefined();
    expect(fuzzyMatch('onit', 'Monitors')).toBeDefined();
  });

  it('ignores accents and spaces in what is typed', () => {
    expect(fold('Señal ÉCRAN')).toBe('senal ecran');
    expect(fuzzyMatch('ecran', 'Écran principal')?.positions).toEqual([0, 1, 2, 3, 4]);
    expect(fuzzyMatch('make ready', 'Make ready')?.positions).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9]);
  });

  it('cuts a text into the pieces that were found and the rest', () => {
    expect(highlight('Make ready', [0, 5])).toEqual([
      { text: 'M', hit: true },
      { text: 'ake ', hit: false },
      { text: 'r', hit: true },
      { text: 'eady', hit: false },
    ]);
    expect(highlight('Fly', [])).toEqual([{ text: 'Fly', hit: false }]);
    expect(highlight('Fly', [0, 1, 2])).toEqual([{ text: 'Fly', hit: true }]);
  });
});

describe('matching the start of a word', () => {
  it('finds the letters together at the start of a word, and nowhere else', () => {
    expect(wordMatch('mon', 'Identify monitors')?.positions).toEqual([9, 10, 11]);
    expect(wordMatch('mon', 'monitorsetup')).toBeDefined();
    expect(wordMatch('f18', 'f18c')).toBeDefined();
    // Inside a word, or spread over two words: not a word of the text.
    expect(wordMatch('mon', 'common controls')).toBeUndefined();
    expect(wordMatch('mon', 'migration')).toBeUndefined();
    expect(wordMatch('mr', 'Make ready')).toBeUndefined();
    expect(wordMatch('zzz', 'Make ready')).toBeUndefined();
  });
});

describe('matching a command', () => {
  const layout = {
    title: 'Apply layout: Flying',
    group: 'Monitors',
    hint: '3 differences',
    keywords: ['arrange', 'screens'],
  };

  it('tries everything typed against the title as one word', () => {
    expect(matchCommand('apply flying', layout)?.positions).toEqual([
      0, 1, 2, 3, 4, 14, 15, 16, 17, 18, 19,
    ]);
    expect(matchCommand('  ', layout)).toBeUndefined();
  });

  it('finds every word somewhere: title, keyword, group or hint, in any order', () => {
    // "monitors" is the group, "flying" is in the title: only the title letters are marked.
    const found = matchCommand('monitors flying', layout);
    expect(found?.positions).toEqual([14, 15, 16, 17, 18, 19]);
    expect(matchCommand('flying monitors', layout)).toBeDefined();
    expect(matchCommand('screens', layout)?.positions).toEqual([]);
    // One word that is nowhere: no match, however good the others are.
    expect(matchCommand('flying racing', layout)).toBeUndefined();
  });

  it('reads a space as a space: words typed apart prefer the title that has them apart', () => {
    const page = { title: 'Backups' };
    const action = { title: 'Back up now' };
    expect(matchCommand('back up', action)!.score).toBeGreaterThan(
      matchCommand('back up', page)!.score
    );
    expect(matchCommand('backup', page)!.score).toBeGreaterThan(
      matchCommand('backup', action)!.score
    );
  });

  it('takes a keyword, the heading or the hint only by the start of a word', () => {
    const copy = { title: 'DCS bindings: Copy', keywords: ['common controls'] };
    expect(matchCommand('common', copy)).toBeDefined();
    expect(matchCommand('controls', copy)).toBeDefined();
    // "mon" is inside "common": the command is not about monitors.
    expect(matchCommand('mon', copy)).toBeUndefined();
    expect(matchCommand('diff', layout)).toBeDefined();
    expect(matchCommand('ferences', layout)).toBeUndefined();
  });

  it('counts a word in the title for more than the same word elsewhere', () => {
    const page = { title: 'Monitors', group: 'Go to' };
    const action = { title: 'Identify', group: 'Monitors' };
    expect(matchCommand('monitors', page)!.score).toBeGreaterThan(
      matchCommand('monitors', action)!.score
    );
    // "identify" starts the title of one command and is a whole keyword of another.
    const identify = { title: 'Identify monitors' };
    const find = { title: 'Find a device', keywords: ['identify', 'which'] };
    expect(matchCommand('identify', identify)!.score).toBeGreaterThan(
      matchCommand('identify', find)!.score
    );
    expect(matchCommand('ident', identify)!.score).toBeGreaterThan(
      matchCommand('ident', find)!.score
    );
  });
});
