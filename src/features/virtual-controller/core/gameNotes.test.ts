import { describe, expect, it } from 'vitest';
import { BUILTIN_PROFILES } from './builtins';
import { gameNoteCount, gameNoteText, separateGameNotes, withoutGameNotes } from './gameNotes';
import { PadProfileSchema, type PadProfile } from './profile';

const SOURCE = {
  device: { name: 'A stick', guid: '806DDF00-B756-11F0-8023-444553540000' },
  input: 'JOY_BTN1',
};

const ace = (): PadProfile => structuredClone(BUILTIN_PROFILES[0]!);

describe('notes for one game', () => {
  it('says which game a note is about', () => {
    expect(gameNoteText({ game: 'Ace Combat 8' }, 'Lock on')).toBe('In Ace Combat 8: Lock on');
    expect(gameNoteText({}, 'Lock on')).toBe('In the game: Lock on');
  });

  it('counts the parts with a note: sticks, triggers, a split throttle and buttons', () => {
    expect(gameNoteCount(PadProfileSchema.parse({ id: 'x', name: 'X' }))).toBe(0);
    const profile = PadProfileSchema.parse({
      id: 'x',
      name: 'X',
      game: 'Some game',
      sticks: { lx: { gameHint: 'Turns' } },
      triggers: { lt: { gameHint: 'Brakes' }, rt: { hint: 'Throttle pedal' } },
      throttle: { gameHint: 'Speed' },
      buttons: { a: { gameHint: 'Fires' }, b: { hint: 'A thumb button' } },
    });
    expect(gameNoteCount(profile)).toBe(4);
  });

  it('removes the game and its notes and keeps everything else', () => {
    const before = ace();
    before.buttons.rs = { ...before.buttons.rs, source: SOURCE };
    before.throttle = {
      invert: false,
      split: 0.5,
      deadzone: 0.05,
      curve: 1,
      hint: 'Throttle',
      gameHint: 'Speed',
    };
    const kept = JSON.stringify(before);
    const after = withoutGameNotes(before);
    expect(after.game).toBeUndefined();
    expect(gameNoteCount(after)).toBe(0);
    expect(after.name).toBe(before.name);
    expect(after.sticks.lx.hint).toBe('Roll: the stick left and right');
    expect(after.sticks.ly.invert).toBe(true);
    expect(after.triggers.rt).toEqual({ ...before.triggers.rt, gameHint: undefined });
    expect(after.throttle).toEqual({
      invert: false,
      split: 0.5,
      deadzone: 0.05,
      curve: 1,
      hint: 'Throttle',
    });
    expect(after.buttons.rs).toEqual({ hint: 'A button under your thumb', source: SOURCE });
    expect(PadProfileSchema.safeParse(after).success).toBe(true);
    // The profile handed in is not changed: the page keeps it until the user saves.
    expect(JSON.stringify(before)).toBe(kept);
  });

  it('turns the earlier Ace Combat 8 hints of a copy into notes for that game', () => {
    const old = PadProfileSchema.parse({
      id: 'my-flight-stick-to-gamepad',
      name: 'My flight stick to gamepad',
      buttons: {
        a: { hint: 'Fire the gun or missile, as set in the game', source: SOURCE },
        b: { hint: 'Special weapon' },
        rs: { hint: 'Lock on (R3 in the Standard layout)' },
        start: { hint: 'Pause and the menu' },
        y: { hint: 'My own words' },
      },
    });
    const now = separateGameNotes(old);
    expect(now.game).toBe('Ace Combat 8');
    // The mapping stays; the hint moves to the note; hints that were not the game's stay.
    expect(now.buttons.a).toEqual({
      source: SOURCE,
      gameHint: 'Fire the gun or missile, as set in the game',
    });
    expect(now.buttons.b).toEqual({ gameHint: 'Special weapon' });
    expect(now.buttons.rs).toEqual({ gameHint: 'Lock on (R3 in the Standard layout)' });
    expect(now.buttons.start).toEqual({ hint: 'Pause and the menu' });
    expect(now.buttons.y).toEqual({ hint: 'My own words' });
    expect(gameNoteCount(now)).toBe(3);
    // Done once: the result is left as it is.
    expect(separateGameNotes(now)).toBe(now);
  });

  it('leaves any other profile as it is', () => {
    // Fewer than three of those hints: these could be the user's own words.
    const few = PadProfileSchema.parse({
      id: 'x',
      name: 'X',
      buttons: { b: { hint: 'Special weapon' }, left: { hint: 'Change weapon' } },
    });
    expect(separateGameNotes(few)).toBe(few);
    // Already says which game it is for.
    const named = PadProfileSchema.parse({
      id: 'y',
      name: 'Y',
      game: 'Another game',
      buttons: {
        b: { hint: 'Special weapon' },
        left: { hint: 'Change weapon' },
        right: { hint: 'Change weapon' },
      },
    });
    expect(separateGameNotes(named)).toBe(named);
    for (const builtin of BUILTIN_PROFILES) expect(separateGameNotes(builtin)).toBe(builtin);
  });
});
