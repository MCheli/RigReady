import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../src/core/result';
import { NodeShell, programStart, type ProgramStart } from '../../src/platform/node';
import {
  commandLine,
  environmentBlock,
  launchHidden,
  quoteArgument,
} from '../../src/platform/windows/hiddenLaunch';
import { tempDir } from '../helpers';

/** Shell.launch with hidden: true on Windows: a program that runs on, with no window at all. */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function waitForFile(file: string, ms = 15_000): Promise<string> {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const text = await fs.readFile(file, 'utf8');
      if (text.includes('done')) return text;
    } catch {
      // not written yet
    }
    if (Date.now() > until) throw new Error(`${file} was not written`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('hidden launch', () => {
  it('quotes arguments the way Windows programs read them back', () => {
    expect(quoteArgument('plain')).toBe('plain');
    expect(quoteArgument('')).toBe('""');
    expect(quoteArgument('two words')).toBe('"two words"');
    expect(quoteArgument('C:\\My Scripts\\')).toBe('"C:\\My Scripts\\\\"');
    expect(quoteArgument('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteArgument('a\\"b')).toBe('"a\\\\\\"b"');
    expect(quoteArgument('C:\\plain\\path')).toBe('C:\\plain\\path');
  });

  it('builds one command line: arguments quoted, a finished cmd.exe line passed on as written', () => {
    expect(commandLine({ exe: 'C:\\Tools\\a.exe', args: ['x y', 'z'] })).toBe(
      'C:\\Tools\\a.exe "x y" z'
    );
    const batch = programStart('C:\\My Scripts\\go.cmd', ['a & b'], {
      ComSpec: 'C:\\Win Dir\\cmd.exe',
    });
    expect(commandLine(batch)).toBe(
      '"C:\\Win Dir\\cmd.exe" /d /s /c "C:\\My^ Scripts\\go.cmd ^"a^ ^&^ b^""'
    );
  });

  it('writes the environment as a sorted, double-terminated block', () => {
    const block = environmentBlock({ b: '2', A: '1', skipped: undefined }).toString('utf16le');
    expect(block).toBe('A=1\0b=2\0\0');
    expect(environmentBlock({}).toString('utf16le')).toBe('\0\0');
  });

  it('really starts a batch file with every argument as one literal value, its environment and its folder', async () => {
    const dir = await tempDir();
    cleanups.push(dir.cleanup);
    const out = path.join(dir.dir, 'out.txt');
    const script = path.join(dir.dir, 'my script.cmd');
    await fs.writeFile(
      script,
      '@echo off\r\n>"%~dp0out.txt" (\r\necho first=%~1\r\necho second=%~2\r\necho name=%RIGREADY_PROFILE_NAME%\r\necho cwd=%CD%\r\necho done\r\n)\r\n'
    );
    const started = launchHidden(programStart(script, ['a b', 'c d, e']), {
      cwd: dir.dir,
      env: { ...process.env, RIGREADY_PROFILE_NAME: 'DCS F/A-18C' },
    });
    expect(started.ok).toBe(true);
    expect(started.ok && started.value.pid).toBeGreaterThan(0);
    const text = await waitForFile(out);
    expect(text).toContain('first=a b');
    expect(text).toContain('second=c d, e');
    expect(text).toContain('name=DCS F/A-18C');
    expect(text.toLowerCase()).toContain(`cwd=${dir.dir.toLowerCase()}`);
  });

  it('a program that is not there is an error, not a throw', () => {
    const result = launchHidden(
      { exe: 'C:\\No Such Folder\\nothing.exe', args: [] },
      { cwd: process.cwd(), env: process.env }
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('shell.launch');
    expect(!result.ok && result.error.message).toContain('nothing.exe');
  });

  it('Shell.launch uses it for a hidden start only, and gives it the merged environment and the program’s folder', async () => {
    const calls: { start: ProgramStart; cwd: string; env: NodeJS.ProcessEnv }[] = [];
    const shell = new NodeShell((start, options) => {
      calls.push({ start, ...options });
      return ok({ pid: 4242 });
    });
    const hidden = await shell.launch('C:\\Scripts\\go.cmd', ['a b'], {
      hidden: true,
      env: { RIGREADY_GAME: 'dcs' },
    });
    expect(hidden).toEqual({ ok: true, value: { pid: 4242 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.start.verbatim).toBe(true);
    expect(calls[0]!.cwd).toBe('C:\\Scripts');
    expect(calls[0]!.env['RIGREADY_GAME']).toBe('dcs');
    expect(calls[0]!.env['SystemRoot'] ?? calls[0]!.env['SYSTEMROOT']).toBeDefined();
    // A batch file is still refused an argument with a quote before anything is started.
    const refused = await shell.launch('C:\\Scripts\\go.cmd', ['say "hi"'], { hidden: true });
    expect(!refused.ok && refused.error.code).toBe('shell.argument');
    expect(calls).toHaveLength(1);
    // Not hidden: the ordinary detached start (here of a program that does not exist).
    const shown = await shell.launch('C:\\No Such Folder\\nothing.exe', []);
    expect(shown.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
