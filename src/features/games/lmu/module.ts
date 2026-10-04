import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameModule, TrackedFileSuggestion } from '../../../core/games';
import { ok } from '../../../core/result';
import {
  existingFiles,
  existingLocations,
  manualInstall,
  steamInstall,
  steamVersion,
  type GameModuleExtras,
} from '../core/helpers';

/**
 * Le Mans Ultimate (Steam app 2399420). Its settings live in UserData inside the game
 * folder, not in Documents. See docs/research/racing.md section 3.
 */

const APP_ID = '2399420';
const EXE = 'Le Mans Ultimate.exe';

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const steam = await steamInstall(ctx, APP_ID, EXE);
  if (steam.ok && steam.value) return steam.value.install;
  return manualInstall(ctx, 'lmu', EXE);
}

export async function userData(ctx: CheckContext): Promise<string | undefined> {
  const install = await findInstall(ctx);
  return install ? path.join(install.installDir, 'UserData') : undefined;
}

/** "LMU-Retail:1.3000" from the newest trace log: the version that last ran. */
async function lastRunVersion(ctx: CheckContext, dir: string): Promise<string | undefined> {
  const entries = await ctx.ports.files.listEntries(path.join(dir, 'Log'));
  const traces = (entries.ok ? entries.value : [])
    .filter((e) => !e.isDirectory && /^trace.*\.txt$/i.test(e.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const newest = traces[0];
  if (!newest) return undefined;
  const text = await ctx.ports.files.readText(newest.path);
  if (!text.ok) return undefined;
  return /LMU-Retail:([0-9.]+)/.exec(text.value)?.[1];
}

/** What is worth keeping in UserData: the player files, car setups and the display mode. */
export const LMU_INCLUDE = [
  'player/*.json',
  'player/*.gal',
  'player/Settings/**',
  'Config_DX11*.ini',
];
export const LMU_EXCLUDE = ['Log/**'];

const lmu: GameModule = {
  id: 'lmu',
  name: 'Le Mans Ultimate',
  processes: [EXE, 'start_protected_game.exe'],
  closeBeforeRestore: {
    why: 'Le Mans Ultimate rewrites its player files when it starts and when it exits.',
  },

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  async configLocations(ctx) {
    const dir = await userData(ctx);
    if (!dir) return ok([]);
    return ok(
      await existingLocations(ctx, [
        {
          id: 'player',
          label: 'UserData\\player (bindings and settings)',
          path: path.join(dir, 'player'),
        },
        { id: 'userdata', label: 'UserData', path: dir },
      ])
    );
  },

  async trackedFiles(ctx) {
    const dir = await userData(ctx);
    if (!dir) return ok([]);
    const player = path.join(dir, 'player');
    const suggestions: TrackedFileSuggestion[] = [
      {
        label: 'Le Mans Ultimate settings and bindings',
        path: dir,
        kind: 'folder',
        include: LMU_INCLUDE,
        exclude: LMU_EXCLUDE,
        description:
          'Every player file (bindings, force feedback, keyboard, game settings), car setups and the display mode. Logs are left out.',
      },
      {
        label: 'Bindings and force feedback (direct input.json)',
        path: path.join(player, 'direct input.json'),
      },
      {
        label: 'Control options (current controls.json)',
        path: path.join(player, 'current controls.json'),
      },
      {
        label: 'Game, graphics and sound (Settings.JSON)',
        path: path.join(player, 'Settings.JSON'),
      },
      { label: 'Multiplayer (Multiplayer.JSON)', path: path.join(player, 'Multiplayer.JSON') },
      {
        label: 'Plugins (CustomPluginVariables.JSON)',
        path: path.join(player, 'CustomPluginVariables.JSON'),
      },
      { label: 'Favourite setups', path: path.join(player, 'FavoriteAndFixedSetups.gal') },
      { label: 'Car setups (per track)', path: path.join(player, 'Settings') },
    ];
    const names = await ctx.ports.files.list(player);
    for (const name of names.ok ? names.value : []) {
      if (/^keyboard.*\.json$/i.test(name)) {
        suggestions.push({ label: `Keyboard (${name})`, path: path.join(player, name) });
      }
    }
    const top = await ctx.ports.files.list(dir);
    for (const name of top.ok ? top.value : []) {
      if (/^Config_DX11.*\.ini$/i.test(name)) {
        suggestions.push({ label: `Display mode (${name})`, path: path.join(dir, name) });
      }
    }
    return ok(await existingFiles(ctx, suggestions));
  },

  installedVersion: (ctx) => steamVersion(ctx, APP_ID),

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    const install = await findInstall(ctx);
    if (install) {
      variables['LMU_INSTALL'] = install.installDir;
      const dir = path.join(install.installDir, 'UserData');
      if (await ctx.ports.files.exists(dir)) variables['LMU_USER'] = dir;
    }
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: {
    exe: EXE,
    label: 'the Le Mans Ultimate folder (it contains Le Mans Ultimate.exe)',
  },
  notes: [
    'Le Mans Ultimate is started through Steam so its anti-cheat and sign-in work.',
    'Its settings live inside the game folder (UserData), so uninstalling the game can delete them: keep a backup.',
    'The game rewrites its player files every time it starts, so restore them only while it is closed.',
  ],
  async facts(ctx) {
    const dir = await userData(ctx);
    if (!dir) return [];
    const version = await lastRunVersion(ctx, dir);
    return version ? [`Last run as version ${version} (game log).`] : [];
  },
};

export default lmu;
