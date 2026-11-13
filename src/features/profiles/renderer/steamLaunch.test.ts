import { describe, expect, it } from 'vitest';
import {
  launchKindOf,
  newSetupLaunch,
  steamAppOf,
  steamAppProblem,
  steamAppShown,
  steamLaunchFor,
} from './steamLaunch';

/** CFG-PROFILE-021: a setup made for a Steam game reads as "Through Steam" in the editor. */

const STEAM = 'C:\\Program Files (x86)\\Steam\\steam.exe';
const handoff = { exe: STEAM, args: ['-applaunch', '266410'] };

describe('the Launch section of a setup Steam starts', () => {
  it('knows steam.exe with a game number as a Steam launch, however the path is written', () => {
    expect(steamAppOf(handoff)).toBe('266410');
    expect(steamAppOf({ exe: 'D:/Steam/Steam.EXE', args: ['-applaunch', '223750'] })).toBe(
      '223750'
    );
    expect(steamAppOf({ exe: 'steam.exe', args: ['-applaunch', '1'] })).toBe('1');
  });

  it('leaves anything else a program: other arguments, no number, another program', () => {
    expect(steamAppOf(undefined)).toBeUndefined();
    expect(steamAppOf({ exe: STEAM, args: [] })).toBeUndefined();
    expect(steamAppOf({ exe: STEAM, args: ['-applaunch'] })).toBeUndefined();
    expect(steamAppOf({ exe: STEAM, args: ['-applaunch', 'dcs'] })).toBeUndefined();
    expect(steamAppOf({ exe: STEAM, args: ['-applaunch', '266410', '-vr'] })).toBeUndefined();
    expect(steamAppOf({ exe: STEAM, args: ['-silent', '266410'] })).toBeUndefined();
    expect(steamAppOf({ exe: 'C:\\Games\\steam.exe.bak\\game.exe', args: [] })).toBeUndefined();
    expect(steamAppOf({ exe: '', args: ['-applaunch', '1'] })).toBeUndefined();
  });

  it('says which of the three choices a setup is, and the number to show', () => {
    expect(launchKindOf({ launch: handoff })).toBe('steam');
    expect(steamAppShown({ launch: handoff })).toBe('266410');
    expect(launchKindOf({ steamAppId: '223750' })).toBe('steam');
    expect(steamAppShown({ steamAppId: '223750', launch: handoff })).toBe('223750');
    const program = { launch: { exe: 'C:\\Games\\RBR\\RichardBurnsRally.exe', args: [] } };
    expect(launchKindOf(program)).toBe('program');
    expect(steamAppShown(program)).toBe('');
    expect(launchKindOf({})).toBe('none');
  });

  it('saves a setup that hands over through steam.exe the same way, with the new number', () => {
    expect(steamLaunchFor({ launch: { ...handoff, cwd: 'C:\\x' } }, ' 2805730 ')).toEqual({
      launch: { exe: STEAM, args: ['-applaunch', '2805730'], cwd: 'C:\\x' },
    });
  });

  it('saves any other setup with a Steam app id, and nothing when no number is given', () => {
    expect(steamLaunchFor({}, '223750')).toEqual({ steamAppId: '223750' });
    expect(steamLaunchFor({ launch: { exe: 'C:\\Games\\game.exe', args: [] } }, '223750')).toEqual({
      steamAppId: '223750',
    });
    expect(steamLaunchFor({ steamAppId: '1', launch: handoff }, '2')).toEqual({ steamAppId: '2' });
    expect(steamLaunchFor({ launch: handoff }, '  ')).toEqual({});
  });

  it('never hands steam.exe something that is not a number', () => {
    // It goes as a Steam app id, which the setup refuses when it is saved.
    expect(steamLaunchFor({ launch: handoff }, '22375o')).toEqual({ steamAppId: '22375o' });
  });
});

describe('the Launch section of a new setup', () => {
  const program = { exe: 'C:\\Games\\RBR\\RichardBurnsRally.exe', args: ['-window'] };

  it('a game Steam starts is saved as it was found, with the number shown', () => {
    expect(newSetupLaunch('steam', handoff, '266410')).toEqual({ launch: handoff });
    expect(newSetupLaunch('steam', handoff, '223750')).toEqual({
      launch: { exe: STEAM, args: ['-applaunch', '223750'] },
    });
  });

  it('"Through Steam" for a game that came with a program, or with none, is a Steam app id', () => {
    expect(newSetupLaunch('steam', program, '223750')).toEqual({ steamAppId: '223750' });
    expect(newSetupLaunch('steam', undefined, '223750')).toEqual({ steamAppId: '223750' });
  });

  it('"A program" is saved as typed, also when it is steam.exe', () => {
    expect(newSetupLaunch('program', program, '223750')).toEqual({ launch: program });
    expect(newSetupLaunch('program', handoff, '')).toEqual({ launch: handoff });
  });

  it('saves no launch when what the choice needs is not filled in', () => {
    expect(newSetupLaunch('program', undefined, '223750')).toEqual({});
    expect(newSetupLaunch('steam', handoff, '')).toEqual({});
    expect(newSetupLaunch('none', program, '223750')).toEqual({});
  });

  it('says what is wrong with a Steam app id that is not a number', () => {
    expect(steamAppProblem('')).toBeUndefined();
    expect(steamAppProblem(' 223750 ')).toBeUndefined();
    expect(steamAppProblem('dcs')).toBe('A number, for example 223750.');
    expect(steamAppProblem('12345678901')).toBe('A number, for example 223750.');
  });
});
