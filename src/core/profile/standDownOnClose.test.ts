import { describe, expect, it } from 'vitest';
import {
  standDownOnClose,
  standDownSeconds,
  standDownWaitText,
  withStandDownOnClose,
} from './standDownOnClose';

describe('stand down when the game closes, per setup', () => {
  it('a setup saved before this existed gets the defaults: on, one minute', () => {
    expect(standDownOnClose({ extensions: {} })).toEqual({ enabled: true, seconds: 60 });
    // Other features keep their own data in the setup; that says nothing about this.
    expect(standDownOnClose({ extensions: { backup: { items: [] } } })).toEqual({
      enabled: true,
      seconds: 60,
    });
  });

  it('reads the switch and the length the setup holds', () => {
    expect(
      standDownOnClose({
        extensions: { fly: { standDownOnClose: false, standDownAfterSeconds: 300 } },
      })
    ).toEqual({ enabled: false, seconds: 300 });
    // One of the two said: the other keeps its default.
    expect(standDownOnClose({ extensions: { fly: { standDownOnClose: false } } })).toEqual({
      enabled: false,
      seconds: 60,
    });
    expect(standDownOnClose({ extensions: { fly: { standDownAfterSeconds: 10 } } })).toEqual({
      enabled: true,
      seconds: 10,
    });
  });

  it('a value a hand edit got wrong falls back to its default, the other is kept', () => {
    expect(
      standDownOnClose({
        extensions: { fly: { standDownOnClose: 'nope', standDownAfterSeconds: 120 } },
      })
    ).toEqual({ enabled: true, seconds: 120 });
    for (const wrong of [0, 1, -5, 7200, 2.5, 'soon', null]) {
      expect(
        standDownOnClose({
          extensions: { fly: { standDownOnClose: false, standDownAfterSeconds: wrong } },
        })
      ).toEqual({ enabled: false, seconds: 60 });
    }
    for (const wrong of ['yes', 5, null, [true]]) {
      expect(standDownOnClose({ extensions: { fly: wrong } })).toEqual({
        enabled: true,
        seconds: 60,
      });
    }
  });

  it('writes the answer into the setup and keeps what else is there', () => {
    const before = {
      id: 'x',
      extensions: { backup: { items: [] }, fly: { somethingElse: 1, standDownOnClose: true } },
    };
    const after = withStandDownOnClose(before, { enabled: false, seconds: 30 });
    expect(after).toEqual({
      id: 'x',
      extensions: {
        backup: { items: [] },
        fly: { somethingElse: 1, standDownOnClose: false, standDownAfterSeconds: 30 },
      },
    });
    // The setup handed in is not changed.
    expect(before.extensions.fly).toEqual({ somethingElse: 1, standDownOnClose: true });
    expect(standDownOnClose(after)).toEqual({ enabled: false, seconds: 30 });
    // An entry that was not a list of settings is replaced by one.
    expect(
      withStandDownOnClose({ extensions: { fly: 'broken' } }, { enabled: true, seconds: 60 })
        .extensions
    ).toEqual({ fly: { standDownOnClose: true, standDownAfterSeconds: 60 } });
  });

  it('keeps a length inside the limits', () => {
    expect(standDownSeconds(1)).toBe(5);
    expect(standDownSeconds(90_000)).toBe(3600);
    expect(standDownSeconds(12.4)).toBe(12);
    expect(standDownSeconds(Number.NaN)).toBe(60);
    expect(
      standDownOnClose(withStandDownOnClose({ extensions: {} }, { enabled: true, seconds: 0 }))
    ).toEqual({ enabled: true, seconds: 5 });
  });

  it('says a length in words', () => {
    expect(standDownWaitText(0)).toBe('0 seconds');
    expect(standDownWaitText(1)).toBe('1 second');
    expect(standDownWaitText(10)).toBe('10 seconds');
    expect(standDownWaitText(60)).toBe('1 minute');
    expect(standDownWaitText(90)).toBe('1 minute 30 seconds');
    expect(standDownWaitText(600)).toBe('10 minutes');
  });
});
