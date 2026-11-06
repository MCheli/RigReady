import { describe, expect, it } from 'vitest';
import { variableSubtitle, withVariable } from './insertVariable';

/** CFG-PROFILE-015: the Variables menu beside a path field. */

const ALL = [
  { name: 'USER', label: 'Your user folder', path: 'C:\\Users\\Owner' },
  { name: 'SAVED_GAMES', label: 'Saved Games folder', path: 'C:\\Users\\Owner\\Saved Games' },
  { name: 'DCS_USER', label: 'DCS user folder', path: 'C:\\Users\\Owner\\Saved Games\\DCS' },
  { name: 'DCS_INSTALL', label: 'DCS install', path: 'D:\\Games\\DCS World' },
  { name: 'AC_USER', label: 'Assetto Corsa user folder' },
];
const by = (name: string) => ALL.find((v) => v.name === name)!;

describe('choosing a variable for a path field', () => {
  it('says the same file through the chosen variable when its folder holds it', () => {
    expect(withVariable('{DCS_USER}/Config/options.lua', by('SAVED_GAMES'), ALL)).toBe(
      '{SAVED_GAMES}/DCS/Config/options.lua'
    );
    expect(withVariable('{SAVED_GAMES}/DCS/Config/options.lua', by('DCS_USER'), ALL)).toBe(
      '{DCS_USER}/Config/options.lua'
    );
    expect(withVariable('{DCS_USER}', by('USER'), ALL)).toBe('{USER}/Saved Games/DCS');
    expect(withVariable('{DCS_USER}/', by('SAVED_GAMES'), ALL)).toBe('{SAVED_GAMES}/DCS');
  });

  it('swaps the variable and keeps the rest when the chosen folder does not hold the file', () => {
    expect(withVariable('{DCS_USER}/Config/options.lua', by('DCS_INSTALL'), ALL)).toBe(
      '{DCS_INSTALL}/Config/options.lua'
    );
    // A variable that does not resolve here: the rest is kept as it is.
    expect(withVariable('{DCS_USER}/Config', by('AC_USER'), ALL)).toBe('{AC_USER}/Config');
    expect(withVariable('{AC_USER}/cfg/controls.ini', by('DCS_USER'), ALL)).toBe(
      '{DCS_USER}/cfg/controls.ini'
    );
    // The same variable again changes nothing but the slashes.
    expect(withVariable('{DCS_USER}\\Config', by('DCS_USER'), ALL)).toBe('{DCS_USER}/Config');
  });

  it('collapses an absolute path below the variable, and replaces one that is not', () => {
    expect(
      withVariable('C:\\Users\\Owner\\Saved Games\\DCS\\Config\\Input', by('DCS_USER'), ALL)
    ).toBe('{DCS_USER}/Config/Input');
    expect(withVariable('c:/users/owner/saved games/dcs', by('SAVED_GAMES'), ALL)).toBe(
      '{SAVED_GAMES}/dcs'
    );
    expect(withVariable('D:\\Elsewhere\\x.lua', by('DCS_USER'), ALL)).toBe('{DCS_USER}/');
    expect(withVariable('\\\\server\\share\\x.lua', by('AC_USER'), ALL)).toBe('{AC_USER}/');
  });

  it('puts the variable in front of relative text, and alone in an empty field', () => {
    expect(withVariable('Config\\options.lua', by('DCS_USER'), ALL)).toBe(
      '{DCS_USER}/Config/options.lua'
    );
    expect(withVariable('', { name: 'STEAM', label: 'Steam library' }, ALL)).toBe('{STEAM}/');
    expect(withVariable('   ', by('USER'), ALL)).toBe('{USER}/');
  });

  it('describes a variable with where it points, or that it is not here', () => {
    expect(variableSubtitle(by('DCS_USER'))).toBe(
      'DCS user folder: C:\\Users\\Owner\\Saved Games\\DCS'
    );
    expect(variableSubtitle(by('AC_USER'))).toBe('Assetto Corsa user folder, not on this PC');
  });
});
