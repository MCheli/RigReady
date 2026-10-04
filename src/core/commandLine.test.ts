import { describe, expect, it } from 'vitest';
import { commandArgs, parseCommandLine, resolveSetup } from './commandLine';

describe('the command line', () => {
  it('reads --fly, --make-ready and --setup with the setup as the next argument', () => {
    expect(parseCommandLine(['C:\\RigReady.exe', '--fly', 'DCS F/A-18C'])).toEqual({
      kind: 'command',
      command: { action: 'fly', setup: 'DCS F/A-18C' },
    });
    expect(parseCommandLine(['RigReady.exe', '--make-ready', 'dcs-f-a-18c'])).toEqual({
      kind: 'command',
      command: { action: 'makeReady', setup: 'dcs-f-a-18c' },
    });
    expect(parseCommandLine(['RigReady.exe', '--setup', 'iRacing GT3'])).toEqual({
      kind: 'command',
      command: { action: 'select', setup: 'iRacing GT3' },
    });
  });

  it('reads the one-value form a shortcut carries, quoted or not', () => {
    expect(parseCommandLine(['RigReady.exe', '--fly=dcs-f-a-18c'])).toEqual({
      kind: 'command',
      command: { action: 'fly', setup: 'dcs-f-a-18c' },
    });
    expect(parseCommandLine(['RigReady.exe', '--setup="DCS UH-1H"'])).toEqual({
      kind: 'command',
      command: { action: 'select', setup: 'DCS UH-1H' },
    });
    // What commandArgs writes, parseCommandLine reads back.
    for (const command of [
      { action: 'fly', setup: 'dcs-f-a-18c' },
      { action: 'makeReady', setup: 'DCS F/A-18C' },
      { action: 'select', setup: 'a' },
    ] as const) {
      expect(parseCommandLine(['RigReady.exe', ...commandArgs(command)])).toEqual({
        kind: 'command',
        command,
      });
    }
    expect(commandArgs({ action: 'fly', setup: 'dcs-f-a-18c' })).toEqual(['--fly=dcs-f-a-18c']);
  });

  it('leaves everything else alone: the program, the app folder, Chromium switches, --hidden', () => {
    expect(parseCommandLine([])).toEqual({ kind: 'none' });
    expect(parseCommandLine(['electron.exe', 'C:\\repo', '--hidden'])).toEqual({ kind: 'none' });
    expect(
      parseCommandLine([
        'electron.exe',
        '--inspect=0',
        '--remote-debugging-port=0',
        'C:\\repo',
        '--fly',
        'dcs-uh-1h',
        '--allow-file-access-from-files',
        '--original-process-start-time=13400000',
      ])
    ).toEqual({ kind: 'command', command: { action: 'fly', setup: 'dcs-uh-1h' } });
    // A flag that only starts the same way is not ours.
    expect(parseCommandLine(['RigReady.exe', '--flyby', 'x', '--setups=3'])).toEqual({
      kind: 'none',
    });
  });

  it('says what is wrong when the setup is missing or two actions are asked for', () => {
    expect(parseCommandLine(['RigReady.exe', '--fly'])).toEqual({
      kind: 'problem',
      message: '--fly needs a setup: RigReady.exe --fly "<setup>"',
    });
    // The next switch is not a setup.
    expect(parseCommandLine(['RigReady.exe', '--make-ready', '--hidden'])).toMatchObject({
      kind: 'problem',
      message: expect.stringContaining('--make-ready needs a setup'),
    });
    expect(parseCommandLine(['RigReady.exe', '--setup=', 'x'])).toMatchObject({ kind: 'problem' });
    expect(parseCommandLine(['RigReady.exe', '--fly=   '])).toMatchObject({ kind: 'problem' });
    expect(parseCommandLine(['RigReady.exe', '--fly', 'a', '--setup', 'b'])).toEqual({
      kind: 'problem',
      message: 'Use only one of --fly, --make-ready, --setup at a time.',
    });
    expect(parseCommandLine(['RigReady.exe', '--fly=a', '--fly=b'])).toMatchObject({
      kind: 'problem',
    });
  });
});

describe('which setup a command means', () => {
  const setups = [
    { id: 'dcs-f-a-18c', name: 'DCS F/A-18C' },
    { id: 'dcs-uh-1h', name: 'DCS UH-1H' },
    { id: 'huey', name: 'Sunday flight' },
    { id: 'huey-2', name: 'Sunday flight' },
  ];

  it('is found by id, then by name, whatever the capitals', () => {
    expect(resolveSetup('dcs-uh-1h', setups)).toEqual({ ok: true, setup: setups[1] });
    expect(resolveSetup('DCS-UH-1H', setups)).toEqual({ ok: true, setup: setups[1] });
    expect(resolveSetup('dcs f/a-18c', setups)).toEqual({ ok: true, setup: setups[0] });
    expect(resolveSetup('  DCS F/A-18C ', setups)).toEqual({ ok: true, setup: setups[0] });
    // An id wins over another setup's name.
    expect(resolveSetup('huey', setups)).toEqual({ ok: true, setup: setups[2] });
  });

  it('is never guessed: an unknown name and a name two setups share are both refused', () => {
    expect(resolveSetup('F-16', setups)).toEqual({
      ok: false,
      reason: 'unknown',
      message: 'There is no setup "F-16".',
    });
    expect(resolveSetup('Sunday flight', setups)).toEqual({
      ok: false,
      reason: 'ambiguous',
      message: '2 setups are named "Sunday flight". Use the id of the one you mean: huey, huey-2.',
    });
    expect(resolveSetup('anything', [])).toMatchObject({ ok: false, reason: 'unknown' });
  });
});
