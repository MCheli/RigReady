import { controlProfileLines, profileFolderName } from '../../../core/iracingControls';
import { err, ok, type Result } from '../../../core/result';

/**
 * Setting the control profile iRacing loads for all cars: the `Global=` line of the
 * [ControlProfiles] section of Documents\iRacing\app.ini. Bytes in, bytes out; nothing here
 * touches a disk (profileSwitch.ts puts the file in place through FileStore).
 *
 * Only the value of that one line changes. Every other byte stays as it was: the other
 * lines, the line endings (iRacing writes CRLF), the cars' own lines, the `global=` of
 * [AutoLoadHUD], and anything after the value on the same line. The file is read as bytes,
 * one character per byte, so a byte that is not text survives as it is. Reading the result
 * goes through the same reader the rest of the app uses (src/core/iracingControls.ts).
 */

export interface GlobalProfileChange {
  /** The whole file after the change. */
  bytes: Uint8Array;
  /** The profile app.ini named for all cars before, as written there. */
  before: string;
  /** True when it already named exactly this profile: `bytes` equals the input. */
  same: boolean;
}

/** One character per byte, so positions in the text are positions in the file. */
const asText = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
};

const asBytes = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** The profile app.ini names for all cars, read as the rest of the app reads it. */
export function globalProfileOf(bytes: Uint8Array): string | undefined {
  return (
    controlProfileLines(asText(bytes)).find((l) => l.key.toLowerCase() === 'global')?.value ||
    undefined
  );
}

/**
 * A profile name RigReady will write into app.ini: one plain folder name in printable ASCII
 * (spaces inside are fine, iRacing uses them), with nothing the reader would take for the
 * start of a comment. iRacing's encoding of other characters in app.ini has not been seen.
 */
export function writableProfileName(name: string): boolean {
  return (
    profileFolderName(name) === name &&
    /^[\x20-\x7e]+$/.test(name) &&
    !name.includes(';') &&
    name.trim() === name
  );
}

function refuse(code: string, message: string, detail?: string): Result<never> {
  return err(`iracing-bindings.profile.${code}`, message, detail);
}

/** Where the value of the [ControlProfiles] Global line is: start and end in the file. */
function globalValueAt(text: string): { start: number; end: number } | undefined {
  let inSection = false;
  let at = 0;
  while (at < text.length) {
    const newline = text.indexOf('\n', at);
    const next = newline < 0 ? text.length : newline + 1;
    // The line without its ending, as the reader splits it.
    const line = text.slice(at, newline < 0 ? text.length : newline).replace(/\r$/, '');
    const section = /^\s*\[(.+)\]\s*$/.exec(line);
    if (section) {
      inSection = section[1]!.trim().toLowerCase() === 'controlprofiles';
    } else if (inSection && !/^\s*;/.test(line)) {
      const equals = line.indexOf('=');
      if (equals > 0 && line.slice(0, equals).trim().toLowerCase() === 'global') {
        // The value as the reader takes it: up to a tab or " ;" comment, without spaces round it.
        let end = line.length;
        const tab = line.indexOf('\t', equals + 1);
        if (tab >= 0) end = tab;
        const comment = /\s;/.exec(line.slice(equals + 1, end));
        if (comment) end = equals + 1 + comment.index;
        let start = equals + 1;
        while (start < end && /\s/.test(line[start]!)) start++;
        while (end > start && /\s/.test(line[end - 1]!)) end--;
        return { start: at + start, end: at + end };
      }
    }
    at = next;
  }
  return undefined;
}

/**
 * app.ini with `Global=` of [ControlProfiles] set to `profile`. Refuses, with the reason, a
 * file without that line (iRacing writes it the first time it runs with control profiles;
 * RigReady does not add a section of its own) and a name it cannot write exactly. Checks
 * its own result before handing it over: only the value changed, and the file reads back
 * with that profile for all cars and every other line as it was.
 */
export function withGlobalProfile(bytes: Uint8Array, profile: string): Result<GlobalProfileChange> {
  if (!writableProfileName(profile)) {
    return refuse(
      'name',
      `RigReady does not write the profile name “${profile}” into app.ini. Choose the profile in iRacing: Options, then Controls.`
    );
  }
  const text = asText(bytes);
  const where = globalValueAt(text);
  if (!where) {
    return refuse(
      'noGlobal',
      'app.ini names no control profile for all cars yet, so RigReady does not change it. Start iRacing once: it writes that line itself.'
    );
  }
  const before = text.slice(where.start, where.end);
  const out = text.slice(0, where.start) + profile + text.slice(where.end);
  const result = asBytes(out);

  // Checked as a stranger's file would be, not trusted because it was just made.
  const head = bytes.subarray(0, where.start);
  const tail = bytes.subarray(where.end);
  const sameRun = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((value, i) => value === b[i]);
  const linesBefore = controlProfileLines(text).filter((l) => l.key.toLowerCase() !== 'global');
  const linesAfter = controlProfileLines(out).filter((l) => l.key.toLowerCase() !== 'global');
  if (
    !sameRun(result.subarray(0, where.start), head) ||
    !sameRun(result.subarray(where.start + profile.length), tail) ||
    globalProfileOf(result) !== profile ||
    JSON.stringify(linesAfter) !== JSON.stringify(linesBefore)
  ) {
    return refuse('reread', 'The changed app.ini did not read back. Nothing was changed.');
  }
  return ok({ bytes: result, before, same: before === profile });
}
