import { describe, expect, it } from 'vitest';
import { oneLine } from './gate';

describe('what an answer says in the record, in one line', () => {
  it('counts one thing in the singular: "1 setup", never "1 setups"', () => {
    expect(oneLine({ setups: [{ id: 'a' }] })).toBe('1 setup');
    expect(oneLine({ setups: [{ id: 'a' }, { id: 'b' }] })).toBe('2 setups');
    expect(oneLine({ setups: [] })).toBe('0 setups');
    expect(oneLine([1])).toBe('1 item');
    expect(oneLine([1, 2, 3])).toBe('3 items');
    expect(oneLine({ a: 1 })).toBe('1 field');
    expect(oneLine({ a: 1, b: 2 })).toBe('2 fields');
  });

  it('knows the plain English plurals, and leaves a word that is not one alone', () => {
    expect(oneLine({ entries: [1] })).toBe('1 entry');
    expect(oneLine({ matches: [1] })).toBe('1 match');
    expect(oneLine({ boxes: [1] })).toBe('1 box');
    expect(oneLine({ devices: [1] })).toBe('1 device');
    expect(oneLine({ aircraft: [1] })).toBe('1 aircraft');
    expect(oneLine({ glass: [1] })).toBe('1 glass');
  });

  it('prefers what the answer says about itself', () => {
    expect(oneLine(null)).toBe('Done');
    expect(oneLine(undefined)).toBe('Done');
    expect(oneLine('Stood down')).toBe('Stood down');
    expect(oneLine({ headline: 'Closed 1 app', steps: [] })).toBe('Closed 1 app');
    expect(oneLine({ message: 'Launched DCS.exe' })).toBe('Launched DCS.exe');
    expect(oneLine({ ready: true })).toBe('Ready');
    expect(oneLine({ ready: false })).toBe('Not ready');
    expect(oneLine(7)).toBe('7');
    expect(oneLine('x'.repeat(300))).toHaveLength(200);
  });
});
