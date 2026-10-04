import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type {
  ConfigLocation,
  GameInstall,
  GameModule,
  TrackedFileSuggestion,
} from '../../../core/games';
import { ok } from '../../../core/result';
import {
  existingFiles,
  manualInstall,
  steamInstall,
  steamVersion,
  type GameModuleExtras,
} from '../core/helpers';

/**
 * BeamNG.drive (Steam app 284160). The user folder is chosen by startup.ini next to the
 * game, then the old registry override, then %LOCALAPPDATA%\BeamNG\BeamNG.drive\current
 * (0.37 and later) or %LOCALAPPDATA%\BeamNG.drive\<version> (before 0.37).
 * See docs/research/racing.md section 4.
 */

const APP_ID = '284160';
const EXE = 'BeamNG.drive.exe';

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID, EXE);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'beamng', EXE);
}

export interface BeamngUserFolder {
  /** The folder the game uses now, when it can be determined and exists. */
  current?: string;
  source?: 'startup.ini' | 'registry' | 'default' | 'version folder';
  /** Version folders of earlier releases (pre-0.37 layout), newest first. */
  older: { version: string; path: string }[];
}

/** "UserPath = ..." from startup.ini; relative paths are relative to the ini's folder. */
async function startupIniPath(ctx: CheckContext, installDir: string): Promise<string | undefined> {
  const ini = path.join(installDir, 'startup.ini');
  if (!(await ctx.ports.files.exists(ini))) return undefined;
  const text = await ctx.ports.files.readText(ini);
  if (!text.ok) return undefined;
  for (const line of text.value.split(/\r?\n/)) {
    const match = /^\s*UserPath\s*=\s*(.*?)\s*$/i.exec(line);
    if (!match) continue;
    const value = match[1]!;
    if (!value) return undefined;
    return path.isAbsolute(value) ? path.resolve(value) : path.resolve(installDir, value);
  }
  return undefined;
}

const versionKey = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
function compareVersions(a: string, b: string): number {
  const x = versionKey(a);
  const y = versionKey(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export async function beamngUserFolder(
  ctx: CheckContext,
  installDir?: string
): Promise<BeamngUserFolder> {
  const local = ctx.ports.folders.localAppData();
  const legacyRoot = path.join(local, 'BeamNG.drive');
  const names = await ctx.ports.files.list(legacyRoot);
  const older = (names.ok ? names.value : [])
    .filter((name) => /^\d+\.\d+(\.\d+)*$/.test(name))
    .sort((a, b) => compareVersions(b, a))
    .map((version) => ({ version, path: path.join(legacyRoot, version) }));

  const dir = installDir ?? (await findInstall(ctx))?.installDir;
  if (dir) {
    const fromIni = await startupIniPath(ctx, dir);
    if (fromIni && (await ctx.ports.files.exists(fromIni))) {
      return { current: fromIni, source: 'startup.ini', older };
    }
  }
  const override = await ctx.ports.registry.getValue(
    'HKCU',
    'Software\\BeamNG\\BeamNG.drive',
    'userpath_override'
  );
  if (override.ok && override.value?.type === 'string' && override.value.value.trim()) {
    const value = path.resolve(override.value.value.trim());
    if (await ctx.ports.files.exists(value)) return { current: value, source: 'registry', older };
  }
  const current = path.join(local, 'BeamNG', 'BeamNG.drive', 'current');
  if (await ctx.ports.files.exists(current)) return { current, source: 'default', older };
  // Before 0.37 the newest version folder was the one in use.
  const newest = older[0];
  if (newest) return { current: newest.path, source: 'version folder', older: older.slice(1) };
  return { older };
}

/** Version from the game's integrity.json ("version": "0.39.4.0"), when present. */
async function installedBuild(ctx: CheckContext, installDir: string): Promise<string | undefined> {
  const file = path.join(installDir, 'integrity.json');
  if (!(await ctx.ports.files.exists(file))) return undefined;
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return undefined;
  return /"version"\s*:\s*"(\d+(?:\.\d+)+)"/.exec(text.value)?.[1];
}

/** "version = 0.38.5.0" from %LOCALAPPDATA%\BeamNG\BeamNG.drive.ini: the version that last ran. */
async function lastRunVersion(ctx: CheckContext): Promise<string | undefined> {
  const file = path.join(ctx.ports.folders.localAppData(), 'BeamNG', 'BeamNG.drive.ini');
  if (!(await ctx.ports.files.exists(file))) return undefined;
  const text = await ctx.ports.files.readText(file);
  if (!text.ok) return undefined;
  return /^\s*version\s*=\s*([0-9.]+)/im.exec(text.value)?.[1];
}

const short = (v: string): string => v.replace(/(\.0)+$/, '');

const beamng: GameModule = {
  id: 'beamng',
  name: 'BeamNG.drive',
  processes: [EXE],
  closeBeforeRestore: {
    why: 'BeamNG.drive saves its bindings and settings while it runs and when it exits.',
  },

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  async configLocations(ctx) {
    const folder = await beamngUserFolder(ctx);
    const locations: ConfigLocation[] = [];
    if (folder.current) {
      locations.push({ id: 'user', label: 'User folder', path: folder.current });
    }
    for (const old of folder.older) {
      locations.push({
        id: `legacy-${old.version}`,
        label: `User folder of ${old.version}`,
        path: old.path,
      });
    }
    return ok(locations);
  },

  async trackedFiles(ctx) {
    const folder = await beamngUserFolder(ctx);
    if (!folder.current) return ok([]);
    const settings = path.join(folder.current, 'settings');
    const suggestions: TrackedFileSuggestion[] = [
      {
        label: 'BeamNG.drive settings and bindings',
        path: settings,
        kind: 'folder',
        description:
          'The whole settings folder: bindings and force feedback per controller, graphics, audio, gameplay and the UI layout.',
      },
      {
        label: 'Bindings and force feedback (inputmaps, including per-vehicle)',
        path: path.join(settings, 'inputmaps'),
      },
      {
        label: 'Graphics, display and audio (settings.json)',
        path: path.join(settings, 'settings.json'),
      },
      {
        label: 'Gameplay (cloud\\settings.json)',
        path: path.join(settings, 'cloud', 'settings.json'),
      },
      {
        label: 'Engine settings (game-settings.cs)',
        path: path.join(settings, 'game-settings.cs'),
      },
      { label: 'Post effects', path: path.join(settings, 'postfxSettings.postfx') },
      { label: 'UI apps layout', path: path.join(settings, 'ui_apps') },
    ];
    return ok(await existingFiles(ctx, suggestions));
  },

  async installedVersion(ctx, install) {
    const steam = await steamVersion(ctx, APP_ID);
    const build = await installedBuild(ctx, install.installDir);
    if (!build) return steam;
    return ok({
      version: short(build),
      ...(steam.ok && steam.value.updatePending !== undefined
        ? { updatePending: steam.value.updatePending }
        : {}),
    });
  },

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    const install = await findInstall(ctx);
    if (install) variables['BEAMNG_INSTALL'] = install.installDir;
    const folder = await beamngUserFolder(ctx, install?.installDir);
    if (folder.current) variables['BEAMNG_USER'] = folder.current;
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: { exe: EXE, label: 'the BeamNG.drive folder (it contains BeamNG.drive.exe)' },
  notes: [
    'Bindings are stored per controller model (vendor and product id), so moving the wheel to another USB port does not break them.',
  ],
  async facts(ctx) {
    const facts: string[] = [];
    const install = await findInstall(ctx);
    const folder = await beamngUserFolder(ctx, install?.installDir);
    if (folder.current && folder.source !== 'default') {
      const how =
        folder.source === 'startup.ini'
          ? 'set in startup.ini'
          : folder.source === 'registry'
            ? 'set by the old registry override'
            : 'the newest version folder';
      facts.push(`User folder ${how}.`);
    }
    if (folder.older.length > 0) {
      facts.push(
        `Older user folders: ${folder.older.map((o) => o.version).join(', ')}. Their bindings can be copied into the current one.`
      );
    }
    const last = await lastRunVersion(ctx);
    const build = install ? await installedBuild(ctx, install.installDir) : undefined;
    if (last && build && compareVersions(short(build), short(last)) > 0) {
      facts.push(
        `Last run as ${short(last)}; ${short(build)} is installed. The next start updates your user folder, so back it up first.`
      );
    } else if (last) {
      facts.push(`Last run as ${short(last)}.`);
    }
    return facts;
  },
};

export default beamng;
