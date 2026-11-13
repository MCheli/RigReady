import { describe, expect, it } from 'vitest';
import {
  DEVICE_KINDS,
  DEVICE_USES,
  GEAR_KINDS,
  KIND_ICON,
  KIND_NAME,
  deviceKind,
  playedWith,
} from './gearKind';

describe('what kind of gear a name is', () => {
  it('tells flight gear, racing gear and the rest from the name Windows gives', () => {
    expect(deviceKind('WINWING Orion Throttle Base II')).toBe('throttle');
    expect(deviceKind('T-Pendular-Rudder')).toBe('pedals');
    expect(deviceKind('FANATEC ClubSport Wheel Base DD+')).toBe('wheel');
    expect(deviceKind('TrackIR software')).toBe('tracker');
    expect(deviceKind('Stream Deck app')).toBe('deck');
    expect(deviceKind('Virtual Xbox 360 Controller')).toBe('other');
    expect(GEAR_KINDS).not.toContain('keyboard');
    expect(GEAR_KINDS).not.toContain('other');
  });
});

describe('CFG-PROFILE-017: what a game is played with', () => {
  it('a flight sim reads sticks and a head tracker and no wheel; a racing sim the other way round', () => {
    const flight = playedWith({ kind: 'flight' });
    expect(flight.gear).toEqual(expect.arrayContaining(['stick', 'throttle', 'pedals', 'tracker']));
    expect(flight.gear).not.toContain('wheel');
    expect(flight.gear).not.toContain('shifter');
    expect(flight).toMatchObject({ helpers: true, microphone: true, gamepad: false });

    const racing = playedWith({ kind: 'racing' });
    expect(racing.gear).toEqual(expect.arrayContaining(['wheel', 'pedals', 'shifter', 'deck']));
    expect(racing.gear).not.toContain('stick');
    expect(racing.gear).not.toContain('throttle');
    // A head tracker is the user's call for a racing sim: offered, not ticked.
    expect(racing.gear).not.toContain('tracker');
  });

  it('what the game module says wins, and what it leaves out is what a game of its kind uses', () => {
    expect(
      playedWith({
        kind: 'flight',
        playedWith: { gear: ['stick'], helpers: false, microphone: false, gamepad: true },
      })
    ).toEqual({ gear: ['stick'], helpers: false, microphone: false, gamepad: true });
    const partly = playedWith({ kind: 'racing', playedWith: { microphone: false } });
    expect(partly).toMatchObject({ helpers: true, microphone: false, gamepad: false });
    expect(partly.gear).toContain('wheel');
  });

  it('with no game the family of the connected gear decides, and with neither nothing is ruled out', () => {
    expect(playedWith(undefined, 'racing').gear).toContain('wheel');
    expect(playedWith({}, 'flight').gear).toContain('stick');
    const unknown = playedWith(undefined);
    expect(unknown).toEqual({ helpers: true, microphone: true, gamepad: false });
    expect('gear' in unknown).toBe(false);
  });

  it('hands out its own list: changing the answer does not change the next one', () => {
    playedWith({ kind: 'flight' }).gear!.push('wheel');
    expect(playedWith({ kind: 'flight' }).gear).not.toContain('wheel');
  });
});

describe('DEV-017: the kinds a device can be said to be', () => {
  it('every kind has a picture and a word of its own, and every kind of sim gear is one of them', () => {
    for (const kind of DEVICE_KINDS) {
      expect(KIND_ICON[kind], kind).toMatch(/^mdi-/);
      expect(KIND_NAME[kind], kind).toMatch(/^[A-Z]/);
    }
    expect(new Set(Object.values(KIND_NAME)).size).toBe(DEVICE_KINDS.length);
    for (const gear of GEAR_KINDS) expect(DEVICE_KINDS).toContain(gear);
    // What a name nobody knows reads as is a kind too: "something else".
    expect(deviceKind('Arduino Leonardo')).toBe('other');
    expect(DEVICE_KINDS).toContain('other');
    expect(DEVICE_USES).toEqual(['flight', 'racing', 'both']);
  });
});
