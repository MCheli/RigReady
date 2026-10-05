import { describe, expect, it } from 'vitest';
import { claimsOnLoad } from './inUse';

const USED = '2026-10-03T18:00:00.000Z';

describe('a screen that loads does not choose the setup', () => {
  it('leaves the setup in use alone: it was chosen, and a reload must not choose again', () => {
    const profiles = [{ id: 'hornet' }, { id: 'huey', lastUsed: USED }];
    // The tray may have switched to the Hornet since "huey" was read as the one in use:
    // a check that claimed the Huey now would undo that.
    expect(claimsOnLoad(profiles, 'huey')).toBe(false);
  });

  it('notes a setup that was never in use, so the first one seen becomes the one used last', () => {
    expect(claimsOnLoad([{ id: 'hornet' }], 'hornet')).toBe(true);
    expect(claimsOnLoad([{ id: 'hornet' }, { id: 'huey' }], 'hornet')).toBe(true);
  });

  it('notes the setup shown in place of one that is gone only when it was never in use itself', () => {
    // The setup used last was deleted: the first of the others is shown.
    expect(claimsOnLoad([{ id: 'hornet', lastUsed: USED }, { id: 'gt3' }], 'hornet')).toBe(false);
    expect(claimsOnLoad([{ id: 'hornet' }, { id: 'gt3', lastUsed: USED }], 'hornet')).toBe(true);
  });

  it('claims nothing without a setup', () => {
    expect(claimsOnLoad([], undefined)).toBe(false);
    expect(claimsOnLoad([{ id: 'hornet' }], undefined)).toBe(false);
    expect(claimsOnLoad([{ id: 'hornet' }], 'gone')).toBe(false);
  });
});
