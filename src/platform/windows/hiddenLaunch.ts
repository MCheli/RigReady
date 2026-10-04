import koffi from 'koffi';
import { err, ok, type Result } from '../../core/result';
import type { ProgramStart } from '../node';
import { CloseHandle } from './win32';

/**
 * Starts a program that keeps running on its own, with no window at all.
 *
 * Node's own way (detached + windowsHide) starts the program without a console, so the
 * first console program it runs (a batch file's `ping`, `xcopy`, ...) gets a new console
 * window on screen. Here the program is created with CREATE_NO_WINDOW: it has a console
 * that has no window, everything it starts shares it, and nothing ever appears. It is
 * not tied to RigReady's lifetime, as a launched program must not be.
 */

const kernel32 = koffi.load('kernel32.dll');
const CreateProcessW = kernel32.func(
  'int32_t CreateProcessW(str16 application, void *commandLine, void *processAttributes, void *threadAttributes, int32_t inheritHandles, uint32_t flags, void *environment, str16 currentDirectory, void *startupInfo, void *processInformation)'
);
const GetLastError = kernel32.func('uint32_t GetLastError()');

const CREATE_NEW_PROCESS_GROUP = 0x00000200;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_NO_WINDOW = 0x08000000;
const STARTF_USESHOWWINDOW = 0x1;
const SW_HIDE = 0;
const STARTUPINFO_SIZE = 104; // STARTUPINFOW on x64
const PROCESS_INFORMATION_SIZE = 24;

/** One argument the way CommandLineToArgvW (and every C runtime) reads it back. */
export function quoteArgument(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[ \t"]/.test(arg)) return arg;
  if (!/["\\]/.test(arg)) return `"${arg}"`;
  let out = '"';
  let slashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      slashes++;
    } else if (ch === '"') {
      // Backslashes before a quote are doubled, and the quote itself is escaped.
      out += '\\'.repeat(slashes * 2 + 1) + '"';
      slashes = 0;
    } else {
      out += '\\'.repeat(slashes) + ch;
      slashes = 0;
    }
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

/** The command line for a program start; a verbatim one (cmd.exe's) is passed on as written. */
export function commandLine(start: ProgramStart): string {
  const args = start.verbatim ? start.args : start.args.map(quoteArgument);
  return [quoteArgument(start.exe), ...args].join(' ');
}

/** A Windows environment block: NAME=value entries, each ended by a NUL, sorted, then one more NUL. */
export function environmentBlock(env: NodeJS.ProcessEnv): Buffer {
  const entries = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined && entry[0].length > 0)
    .sort(([a], [b]) => a.toUpperCase().localeCompare(b.toUpperCase()));
  const text = entries.map(([name, value]) => `${name}=${value}\0`).join('') + '\0';
  return Buffer.from(text.length === 1 ? '\0\0' : text, 'utf16le');
}

export function launchHidden(
  start: ProgramStart,
  options: { cwd: string; env: NodeJS.ProcessEnv }
): Result<{ pid: number | undefined }> {
  // CreateProcessW may write into the command line, so it gets a buffer of its own.
  const line = Buffer.from(commandLine(start) + '\0', 'utf16le');
  const startup = Buffer.alloc(STARTUPINFO_SIZE);
  startup.writeUInt32LE(STARTUPINFO_SIZE, 0);
  startup.writeUInt32LE(STARTF_USESHOWWINDOW, 60);
  startup.writeUInt16LE(SW_HIDE, 64);
  const information = Buffer.alloc(PROCESS_INFORMATION_SIZE);
  const created = CreateProcessW(
    null,
    line,
    null,
    null,
    0,
    CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_NEW_PROCESS_GROUP,
    environmentBlock(options.env),
    options.cwd,
    startup,
    information
  ) as number;
  if (created === 0) {
    const code = GetLastError() as number;
    return err(
      'shell.launch',
      `Could not start ${start.exe}.`,
      code === 2 || code === 3 ? 'ENOENT: the program was not found' : `Windows error ${code}`
    );
  }
  CloseHandle(information.readBigInt64LE(0));
  CloseHandle(information.readBigInt64LE(8));
  return ok({ pid: information.readUInt32LE(16) });
}
