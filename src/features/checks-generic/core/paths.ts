import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameRegistry } from '../../../core/games';
import { allPathVariables, expandPath, variableOf } from '../../../core/pathVariables';
import { err, type Result } from '../../../core/result';

/** What a path variable means, in words, for "DCS user folder not found". */
const LABELS: Record<string, string> = {
  USER: 'Your user folder',
  DOCUMENTS: 'Documents folder',
  SAVED_GAMES: 'Saved Games folder',
  APPDATA: 'AppData folder',
  LOCALAPPDATA: 'Local AppData folder',
  PROGRAM_FILES: 'Program Files folder',
  PROGRAM_FILES_X86: 'Program Files (x86) folder',
  RIGREADY_HOME: 'RigReady data folder',
  STEAM: 'Steam library',
  DCS_USER: 'DCS user folder',
  DCS_INSTALL: 'DCS install',
  IRACING_USER: 'iRacing user folder',
  LMU_USER: 'Le Mans Ultimate user folder',
  BEAMNG_USER: 'BeamNG.drive user folder',
};

export const variableLabel = (name: string): string => LABELS[name] ?? `{${name}}`;

/** A stored path ({DCS_USER}/Config/options.lua or an absolute one) made absolute for this PC. */
export async function resolveStored(
  stored: string,
  ctx: CheckContext,
  games: GameRegistry
): Promise<Result<string>> {
  const variable = variableOf(stored);
  const expanded = expandPath(stored, variable ? await allPathVariables(ctx, games) : {});
  if (!expanded.ok && expanded.error.code === 'path.variable' && variable) {
    return err(
      'path.variable',
      `${variableLabel(variable)} not found`,
      ctx.profile?.install
        ? `This setup uses the install at ${ctx.profile.install}, which is gone. Choose another install in the setup, or install it again.`
        : `{${variable}} is not available on this PC: the program that provides it was not detected.`
    );
  }
  return expanded;
}

export const fileName = (stored: string): string =>
  path.win32.basename(stored.replace(/\//g, '\\')) || stored;

/** The last `count` lines of program output. */
export function lastLines(text: string, count: number): string {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  return lines.slice(-count).join('\n');
}

/** "2026-10-03 14:05" in local time. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
