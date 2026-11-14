import { describe, expect, it } from 'vitest';
import type { DisplayMode } from '../../shared/models';
import { unrotatedModes } from './modes';

const mode = (width: number, height: number, refreshHz: number): DisplayMode => ({
  width,
  height,
  refreshHz,
});

describe('the modes Windows lists, unrotated', () => {
  it('leaves the modes of a landscape monitor as they are, largest first', () => {
    const listed = [mode(1920, 1080, 60), mode(2560, 1440, 60), mode(2560, 1440, 165)];
    const expected = [mode(2560, 1440, 165), mode(2560, 1440, 60), mode(1920, 1080, 60)];
    expect(unrotatedModes(listed, 0)).toEqual(expected);
    // Unknown orientation: taken as listed.
    expect(unrotatedModes(listed, undefined)).toEqual(expected);
  });

  it('turns back the modes of a portrait monitor: a 1024x768 screen sideways lists 768x1024', () => {
    expect(unrotatedModes([mode(768, 1024, 60)], 1)).toEqual([mode(1024, 768, 60)]);
  });

  it('turns back both portrait orientations, and leaves landscape flipped alone', () => {
    expect(unrotatedModes([mode(768, 1024, 60)], 3)).toEqual([mode(1024, 768, 60)]);
    expect(unrotatedModes([mode(1024, 768, 60)], 2)).toEqual([mode(1024, 768, 60)]);
  });

  it('keeps every size and refresh rate of a sideways list once, unrotated, largest then fastest', () => {
    const listed = [
      mode(1080, 1920, 60),
      mode(1440, 2560, 60),
      mode(1440, 2560, 144),
      mode(1080, 1920, 144),
      mode(1440, 2560, 60),
      mode(0, 0, 0),
      mode(600, 800, 75),
    ];
    expect(unrotatedModes(listed, 1)).toEqual([
      mode(2560, 1440, 144),
      mode(2560, 1440, 60),
      mode(1920, 1080, 144),
      mode(1920, 1080, 60),
      mode(800, 600, 75),
    ]);
  });
});
