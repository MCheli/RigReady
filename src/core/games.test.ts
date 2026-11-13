import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../tests/helpers';
import { asAnotherGame, GameRegistry, gameRunning, setupGameName } from './games';
import { ok } from './result';

/**
 * The one definition of "the game is running" that every feature refusing to write a game's
 * files goes by: the module's image names, matched without regard to case.
 */

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

describe('gameRunning', () => {
  it('gameRunning: any of the module’s image names, in any case; false without a list or a module', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const sim = { processes: ['Imaginary.exe', 'ImaginarySim.exe'] };
    expect(await gameRunning(rig, sim)).toBe(false);
    await mutate(rig, [
      { op: 'startProcess', name: 'imaginarysim.EXE', path: 'C:\\Sim\\bin\\imaginarysim.EXE' },
    ]);
    expect(await gameRunning(rig, sim)).toBe(true);
    expect(await gameRunning(rig, { processes: ['Imaginary.exe'] })).toBe(false);
    expect(await gameRunning(rig, { processes: [] })).toBe(false);
    expect(await gameRunning(rig, {})).toBe(false);
    expect(await gameRunning(rig, undefined)).toBe(false);
    // When the list of programs cannot be read, nothing is known to be running.
    await mutate(rig, [{ op: 'failProvider', port: 'processes', message: 'no list today' }]);
    expect(await gameRunning(rig, sim)).toBe(false);
  });
});

describe('setupGameName', () => {
  it('names a setup’s game by its module, its typed name, or “Another game” for a game the user added that is gone; never by a user- id', () => {
    const games = new GameRegistry();
    games.register({
      id: 'user-star-hauler',
      name: 'Star Hauler',
      detect: async () => ok([]),
      configLocations: async () => ok([]),
    });
    expect(setupGameName({}, games)).toBeUndefined();
    expect(setupGameName({ game: 'other', gameName: 'Rally Pro' }, games)).toBe('Rally Pro');
    expect(setupGameName({ game: 'user-star-hauler' }, games)).toBe('Star Hauler');
    expect(setupGameName({ game: 'user-gone' }, games)).toBe('Another game');
    expect(setupGameName({ game: 'user-gone', gameName: 'Gone Game' }, games)).toBe('Gone Game');
    // A game a newer RigReady knows is named by its id, as before.
    expect(setupGameName({ game: 'future-sim' }, games)).toBe('future-sim');
    expect(asAnotherGame({ game: 'user-gone', gameInstall: 'D:\\Gone' }, '  Gone Game ')).toEqual({
      game: 'other',
      gameName: 'Gone Game',
    });
  });
});
