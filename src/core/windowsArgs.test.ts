import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { joinWindowsArgs, splitWindowsArgs } from './windowsArgs';

const TRICKY = [
  ['--launch=dcs-f-a-18c'],
  ['--launch', 'DCS F/A-18C'],
  ['C:\\Program Files\\RigReady\\RigReady.exe', '--launch=x'],
  ['C:\\some dir\\', 'trailing backslash before the closing quote'],
  ['say "hello"', 'a\\"b', '\\\\server\\share\\'],
  ['', 'empty before', ''],
  ['x & calc.exe', '$(whoami)', '%PATH%', 'a|b', 'a^b', '100%'],
  ['tab\there', 'ünïcödé', '日本語 の 名前'],
  ['\\', '\\\\', '"', '""', '\\"'],
];

describe('the arguments a Windows shortcut stores', () => {
  it('writes plain values as they are and quotes only what needs it', () => {
    expect(joinWindowsArgs(['--launch=dcs-f-a-18c'])).toBe('--launch=dcs-f-a-18c');
    expect(joinWindowsArgs(['--launch', 'DCS F/A-18C'])).toBe('--launch "DCS F/A-18C"');
    expect(joinWindowsArgs(['C:\\repo', '--setup=a'])).toBe('C:\\repo --setup=a');
    expect(joinWindowsArgs(['C:\\some dir\\'])).toBe('"C:\\some dir\\\\"');
    expect(joinWindowsArgs(['say "hi"'])).toBe('"say \\"hi\\""');
    expect(joinWindowsArgs([''])).toBe('""');
    expect(joinWindowsArgs([])).toBe('');
  });

  it('reads back exactly the values that were written, whatever is in them', () => {
    for (const args of TRICKY) {
      expect(splitWindowsArgs(joinWindowsArgs(args)), JSON.stringify(args)).toEqual(args);
    }
  });

  it('reads what a person typed into a shortcut by hand', () => {
    expect(splitWindowsArgs('')).toEqual([]);
    expect(splitWindowsArgs('   ')).toEqual([]);
    expect(splitWindowsArgs('  --launch   "DCS F/A-18C"  ')).toEqual(['--launch', 'DCS F/A-18C']);
    expect(splitWindowsArgs('--launch="DCS F/A-18C"')).toEqual(['--launch=DCS F/A-18C']);
    expect(splitWindowsArgs('"C:\\some dir\\app" --hidden')).toEqual([
      'C:\\some dir\\app',
      '--hidden',
    ]);
    // Two quotes inside quotes are one quote; an unclosed quote runs to the end.
    expect(splitWindowsArgs('"a ""b"" c"')).toEqual(['a "b" c']);
    expect(splitWindowsArgs('"never closed')).toEqual(['never closed']);
    expect(splitWindowsArgs('a\\\\b c\\d')).toEqual(['a\\\\b', 'c\\d']);
  });

  it.runIf(process.platform === 'win32')(
    'a real program started with the written text gets the same values',
    () => {
      // Node itself is the program: it prints the arguments Windows handed it.
      const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
      for (const args of TRICKY) {
        const line = joinWindowsArgs(['-e', script, '--', ...args]);
        const ran = spawnSync(process.execPath, [line], {
          // The whole command line is ours: the program's own path is quoted the same way.
          argv0: joinWindowsArgs([process.execPath]),
          windowsVerbatimArguments: true,
          encoding: 'utf8',
        });
        expect(ran.status, ran.stderr).toBe(0);
        expect(JSON.parse(ran.stdout), JSON.stringify(args)).toEqual(args);
      }
    }
  );
});
