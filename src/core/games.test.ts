import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../tests/helpers';
import { gameRunning } from './games';

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
