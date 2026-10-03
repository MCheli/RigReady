import path from 'node:path';
import type { CheckContext } from './checks/registry';
import type { GameRegistry } from './games';
import type { KnownFolders } from './ports';
import { err, ok, type Result } from './result';

/**
 * Path variables make stored paths portable: a profile or a backup says
 * "{DCS_USER}/Config/options.lua" instead of "C:\Users\Owner\Saved Games\DCS\Config\options.lua",
 * and it still means the right file on another PC or under another Windows account.
 *
 * Stored form: {NAME} followed by forward slashes. Names are upper-case letters, digits
 * and underscores.
 */
export type PathVariables = Record<string, string>;

const VARIABLE = /^\{([A-Z][A-Z0-9_]*)\}(?:[\\/](.*))?$/;

/** The variables every PC has. STEAM (the first Steam library) is present only when Steam is. */
export async function standardPathVariables(ports: {
  folders: KnownFolders;
}): Promise<PathVariables> {
  const { folders } = ports;
  const variables: PathVariables = {
    USER: folders.home(),
    DOCUMENTS: folders.documents(),
    SAVED_GAMES: folders.savedGames(),
    APPDATA: folders.appData(),
    LOCALAPPDATA: folders.localAppData(),
    PROGRAM_FILES: folders.programFiles(),
    PROGRAM_FILES_X86: folders.programFilesX86(),
    RIGREADY_HOME: folders.dataRoot(),
  };
  const libraries = await folders.steamLibraries();
  if (libraries.ok && libraries.value[0]) variables['STEAM'] = libraries.value[0];
  return variables;
}

/**
 * The standard variables plus those of every game module (DCS_USER, DCS_INSTALL, ...).
 * A game module that fails or finds nothing simply contributes no variables.
 */
export async function allPathVariables(
  ctx: CheckContext,
  games: GameRegistry
): Promise<PathVariables> {
  const variables = await standardPathVariables(ctx.ports);
  for (const module of games.all()) {
    if (!module.pathVariables) continue;
    try {
      // A setup that names an install of its game gets that install's folders.
      const install = ctx.profile?.game === module.id ? ctx.profile.install : undefined;
      const own = await module.pathVariables(ctx, install);
      if (own.ok) Object.assign(variables, own.value);
    } catch (e) {
      ctx.log.error(`path variables of ${module.id} threw`, e);
    }
  }
  return variables;
}

/** The variable a stored path starts with, when it starts with one. */
export function variableOf(stored: string): string | undefined {
  return VARIABLE.exec(stored)?.[1];
}

/** "{DCS_USER}/Config/options.lua" to an absolute path. A path without a variable must already be absolute. */
export function expandPath(stored: string, variables: PathVariables): Result<string> {
  const match = VARIABLE.exec(stored);
  if (!match) {
    if (stored.includes('{') || stored.includes('}')) {
      return err('path.variable', `The path uses a variable in an unsupported way: ${stored}`);
    }
    if (!path.isAbsolute(stored))
      return err('path.relative', `The path must be absolute: ${stored}`);
    return ok(path.resolve(stored));
  }
  const [, name, rest] = match;
  const base = variables[name!];
  if (base === undefined) {
    return err('path.variable', `Unknown path variable {${name}}.`, name);
  }
  const resolved = path.resolve(base, ...(rest ?? '').split(/[\\/]/).filter((part) => part !== ''));
  // "{USER}/../../Windows" must not climb out of the folder the variable names.
  const inside =
    resolved.toLowerCase() === path.resolve(base).toLowerCase() ||
    resolved.toLowerCase().startsWith(path.resolve(base).toLowerCase() + path.sep);
  if (!inside) return err('path.outside', `The path leaves {${name}}: ${stored}`);
  return ok(resolved);
}

/**
 * An absolute path in stored form, using the variable with the longest matching folder:
 * C:\Users\Owner\Saved Games\DCS\Config becomes {DCS_USER}/Config rather than
 * {SAVED_GAMES}/DCS/Config. A path under no variable is returned unchanged.
 */
export function collapsePath(absolute: string, variables: PathVariables): string {
  const target = path.resolve(absolute);
  let best: { name: string; base: string } | undefined;
  for (const [name, value] of Object.entries(variables)) {
    const base = path.resolve(value);
    const matches =
      target.toLowerCase() === base.toLowerCase() ||
      target.toLowerCase().startsWith(base.toLowerCase() + path.sep);
    if (matches && (!best || base.length > best.base.length)) best = { name, base };
  }
  if (!best) return absolute;
  const rest = target.slice(best.base.length).split(path.sep).filter(Boolean).join('/');
  return rest ? `{${best.name}}/${rest}` : `{${best.name}}`;
}
