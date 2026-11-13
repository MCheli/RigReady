import { describe, expect, it } from 'vitest';
import { overlayChoice, withOverlayChoice } from './setupChoice';

describe('the overlay switch a setup keeps', () => {
  it('says nothing until the user switches it, and then what was switched', () => {
    expect(overlayChoice({ extensions: {} })).toBeUndefined();
    expect(overlayChoice(withOverlayChoice({ extensions: {} }, false))).toBe(false);
    expect(overlayChoice(withOverlayChoice({ extensions: {} }, true))).toBe(true);
  });

  it('a value a hand edit got wrong says nothing, so the setup goes by its game', () => {
    for (const overlay of ['on', 1, null, [], { on: 'yes' }, { on: 1 }]) {
      expect(overlayChoice({ extensions: { overlay } }), JSON.stringify(overlay)).toBeUndefined();
    }
  });

  it('keeps what else the setup and its overlay entry hold', () => {
    const before = {
      id: 'x',
      extensions: { fly: { standDownOnClose: false }, overlay: { later: 3, on: true } },
    };
    expect(withOverlayChoice(before, false)).toEqual({
      id: 'x',
      extensions: { fly: { standDownOnClose: false }, overlay: { later: 3, on: false } },
    });
    // The setup it was made from is left as it was.
    expect(before.extensions.overlay.on).toBe(true);
    expect(withOverlayChoice({ extensions: { overlay: 'broken' } }, true).extensions).toEqual({
      overlay: { on: true },
    });
  });
});
