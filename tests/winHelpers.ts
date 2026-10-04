import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

/** Small Windows facts the packaged, installer and rig smoke tests share. Read-only. */

const run = promisify(execFile);

/**
 * The execution level a program's embedded manifest asks Windows for: "asInvoker" (run
 * as whoever started it, never a UAC prompt), "highestAvailable" or "requireAdministrator".
 */
export async function executionLevel(exe: string): Promise<string | undefined> {
  const bytes = await fs.readFile(exe);
  const levels = new Set<string>();
  let at = 0;
  for (;;) {
    at = bytes.indexOf('<requestedExecutionLevel', at);
    if (at < 0) break;
    const level = /level="(\w+)"/.exec(bytes.subarray(at, at + 200).toString('latin1'))?.[1];
    if (level) levels.add(level);
    at += 1;
  }
  if (levels.size === 0) return undefined;
  // More than one manifest in a file would be a surprise worth seeing.
  return [...levels].sort().join('+');
}

/** True when this process runs with administrator rights (a high or system integrity token). */
export async function isElevated(): Promise<boolean> {
  // By full path: a Unix-like shell on the PATH brings a whoami of its own.
  const whoami = path.join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32', 'whoami.exe');
  const { stdout } = await run(whoami, ['/groups']);
  return /S-1-16-(12288|16384)/.test(stdout);
}

/** Whether a program with this image name is running. */
export async function processRunning(imageName: string): Promise<boolean> {
  const { stdout } = await run('tasklist', [
    '/FI',
    `IMAGENAME eq ${imageName}`,
    '/NH',
    '/FO',
    'CSV',
  ]);
  return stdout.toLowerCase().includes(imageName.toLowerCase());
}
