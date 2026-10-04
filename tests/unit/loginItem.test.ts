import { describe, expect, it } from 'vitest';
import { loginEntryEnabled, runEntryProgram } from '../../src/core/loginItem';

/** Start with Windows, read from the Run entry itself. */
describe('the start-with-Windows entry', () => {
  it('names the program of a Run entry, quoted or not, with or without a space in its path', () => {
    expect(
      runEntryProgram(
        '"C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\RigReady\\RigReady.exe" --hidden'
      )
    ).toBe('C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\RigReady\\RigReady.exe');
    expect(runEntryProgram('C:\\Apps\\RigReady\\RigReady.exe --hidden')).toBe(
      'C:\\Apps\\RigReady\\RigReady.exe'
    );
    expect(runEntryProgram('C:\\My Apps\\RigReady.exe --hidden')).toBe('C:\\My Apps\\RigReady.exe');
    expect(runEntryProgram('C:\\Apps\\RigReady.exe')).toBe('C:\\Apps\\RigReady.exe');
    expect(runEntryProgram('"C:\\Apps\\broken')).toBe('C:\\Apps\\broken');
    expect(runEntryProgram('steam -silent')).toBe('steam');
  });

  it('is on only when the entry starts this very program and Task Manager has not switched it off', () => {
    const exe = 'C:\\Users\\Jane Doe\\AppData\\Local\\Programs\\RigReady\\RigReady.exe';
    const entry = `"${exe}" --hidden`;
    expect(loginEntryEnabled(undefined, undefined, exe)).toBe(false);
    expect(loginEntryEnabled('', undefined, exe)).toBe(false);
    // A path with a space in it: the case Electron's own summary gets wrong.
    expect(loginEntryEnabled(entry, undefined, exe)).toBe(true);
    expect(loginEntryEnabled(entry.toUpperCase(), undefined, exe)).toBe(true);
    // Another copy of RigReady (an old install, a test build) owns the entry: not this one.
    expect(loginEntryEnabled('"C:\\Other\\RigReady.exe" --hidden', undefined, exe)).toBe(false);
    // StartupApproved: 02... enabled, 03... disabled by the user in Task Manager.
    expect(loginEntryEnabled(entry, '020000000000000000000000', exe)).toBe(true);
    expect(loginEntryEnabled(entry, '0300000094a3c9b7d5a1dc01', exe)).toBe(false);
    expect(loginEntryEnabled(entry, '0600000000000000', exe)).toBe(true);
    expect(loginEntryEnabled(entry, '07', exe)).toBe(false);
    expect(loginEntryEnabled(entry, 'zz', exe)).toBe(true);
  });
});
