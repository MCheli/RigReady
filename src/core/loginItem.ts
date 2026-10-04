/** The per-user key Windows starts programs from at sign-in, and where Task Manager switches them off. */
export const RUN_KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const STARTUP_APPROVED_KEY =
  'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run';

/** The program a Run entry starts: `"C:\a b\x.exe" --hidden` and `C:\a\x.exe --hidden` both name x.exe. */
export function runEntryProgram(entry: string): string {
  const text = entry.trim();
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    return end < 0 ? text.slice(1) : text.slice(1, end);
  }
  const exe = /^(.*?\.exe)(?:\s|$)/i.exec(text);
  return exe ? exe[1]! : (text.split(/\s+/)[0] ?? '');
}

/**
 * Whether Windows will start this program at sign-in: its Run entry is there, starts
 * this very program, and is not switched off in Task Manager > Startup apps (the
 * StartupApproved value, whose first byte is odd when the entry is disabled).
 *
 * Read from the registry values themselves: Electron's own summary does not find the
 * entry when the program's path has a space in it ("C:\Users\Jane Doe\...").
 */
export function loginEntryEnabled(
  runEntry: string | undefined,
  startupApprovedHex: string | undefined,
  exe: string
): boolean {
  if (!runEntry) return false;
  if (runEntryProgram(runEntry).toLowerCase() !== exe.toLowerCase()) return false;
  if (startupApprovedHex && startupApprovedHex.length >= 2) {
    const first = Number.parseInt(startupApprovedHex.slice(0, 2), 16);
    if (Number.isFinite(first) && first % 2 === 1) return false;
  }
  return true;
}
