import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from './builtins';
import { afterSave, stable } from './editing';
import type { PadProfile } from './profile';

/** A profile of the user's own, as the editor holds it. */
const mine = (): PadProfile => ({
  ...(JSON.parse(JSON.stringify(BUILTIN_PROFILES[0])) as PadProfile),
  id: 'my-stick',
  name: 'My stick',
});

describe('the virtual controller editor once a save has answered', () => {
  it('shows what main saved when nothing was changed while the save ran', () => {
    const onScreen = mine();
    const sent = stable(onScreen);
    // Main's copy is the one kept (it is the profile as read back).
    const saved = { ...mine(), name: 'My stick' };
    const next = afterSave(onScreen, sent, saved);
    expect(next.changedMeanwhile).toBe(false);
    expect(next.shown).toBe(saved);
    expect(stable(next.shown)).toBe(next.savedCopy);
  });

  it('keeps a change made while the save ran, and it still reads as unsaved', () => {
    const onScreen = mine();
    const sent = stable(onScreen);
    const saved = JSON.parse(sent) as PadProfile;
    // Typed into the name field and moved a deadzone slider after Save was pressed.
    onScreen.name = 'My stick for Ace Combat';
    onScreen.sticks.lx.deadzone = 0.2;
    const next = afterSave(onScreen, sent, saved);
    expect(next.changedMeanwhile).toBe(true);
    expect(next.shown).toBe(onScreen);
    expect(next.shown.name).toBe('My stick for Ace Combat');
    expect(next.shown.sticks.lx.deadzone).toBe(0.2);
    // What the bar compares with is what was saved, so the page is still dirty.
    expect(next.savedCopy).toBe(stable(saved));
    expect(stable(next.shown)).not.toBe(next.savedCopy);
  });

  it('does not take the order the parts were touched in for a change', () => {
    const onScreen = mine();
    const sent = stable(onScreen);
    const reordered = Object.fromEntries(Object.entries(onScreen).reverse()) as PadProfile;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(onScreen));
    expect(afterSave(reordered, sent, mine()).changedMeanwhile).toBe(false);
  });
});
