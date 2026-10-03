import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type {
  ConfigLocation,
  GameInstall,
  GameModule,
  TrackedFileSuggestion,
} from '../../../core/games';
import { ok } from '../../../core/result';
import { steamRoot } from '../../../core/steam';
import {
  existingFiles,
  manualInstall,
  steamInstall,
  steamVersion,
  type GameModuleExtras,
} from '../core/helpers';

/**
 * Microsoft Flight Simulator 2024. Steam edition (app 2537590) keeps its settings in
 * %APPDATA%\Microsoft Flight Simulator 2024; the Microsoft Store edition in the
 * Microsoft.Limitless package's LocalCache. Controller profiles of the Steam edition are
 * Steam Cloud files (userdata\<account>\2537590\remote\inputprofile_*) in a binary format.
 */

const APP_ID = '2537590';
const EXE = 'FlightSimulator2024.exe';
const STORE_PACKAGE = 'Microsoft.Limitless_8wekyb3d8bbwe';

const steamUserFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.appData(), 'Microsoft Flight Simulator 2024');
const storeUserFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.localAppData(), 'Packages', STORE_PACKAGE, 'LocalCache');

async function findInstalls(ctx: CheckContext): Promise<GameInstall[]> {
  const installs: GameInstall[] = [];
  // The manifest is enough: the Steam edition streams most of its content.
  const steam = await steamInstall(ctx, APP_ID);
  if (steam.ok && steam.value) installs.push(steam.value.install);
  if (await ctx.ports.files.exists(storeUserFolder(ctx))) {
    // Store apps are started by Windows from their package; there is no exe to run directly.
    installs.push({
      source: 'store',
      installDir: path.join(ctx.ports.folders.localAppData(), 'Packages', STORE_PACKAGE),
    });
  }
  if (installs.length === 0) {
    const manual = await manualInstall(ctx, 'msfs2024', EXE);
    if (manual) installs.push(manual);
  }
  return installs;
}

/** Steam Cloud folders holding the controller profiles, one per Steam account on this PC. */
async function inputProfileFolders(ctx: CheckContext): Promise<string[]> {
  const root = await steamRoot(ctx.ports.registry);
  if (!root) return [];
  const users = await ctx.ports.files.list(path.join(root, 'userdata'));
  const found: string[] = [];
  for (const user of users.ok ? users.value : []) {
    const remote = path.join(root, 'userdata', user, APP_ID, 'remote');
    if (await ctx.ports.files.exists(remote)) found.push(remote);
  }
  return found;
}

const msfs2024: GameModule = {
  id: 'msfs2024',
  name: 'Microsoft Flight Simulator 2024',

  detect: async (ctx) => ok(await findInstalls(ctx)),

  async configLocations(ctx) {
    const locations: ConfigLocation[] = [];
    if (await ctx.ports.files.exists(steamUserFolder(ctx))) {
      locations.push({
        id: 'steam',
        label: 'Settings (Steam edition)',
        path: steamUserFolder(ctx),
      });
    }
    if (await ctx.ports.files.exists(storeUserFolder(ctx))) {
      locations.push({
        id: 'store',
        label: 'Settings (Microsoft Store edition)',
        path: storeUserFolder(ctx),
      });
    }
    for (const [index, folder] of (await inputProfileFolders(ctx)).entries()) {
      locations.push({
        id: `controls-${index + 1}`,
        label: 'Controller profiles (Steam Cloud)',
        path: folder,
      });
    }
    return ok(locations);
  },

  async trackedFiles(ctx) {
    const suggestions: TrackedFileSuggestion[] = [];
    for (const dir of [steamUserFolder(ctx), storeUserFolder(ctx)]) {
      suggestions.push(
        { label: 'Graphics and paths (UserCfg.opt)', path: path.join(dir, 'UserCfg.opt') },
        {
          label: 'General options (FlightSimulator2024.CFG)',
          path: path.join(dir, 'FlightSimulator2024.CFG'),
        },
        { label: 'Cameras (Cameras.CFG)', path: path.join(dir, 'Cameras.CFG') },
        { label: 'SimConnect (SimConnect.xml)', path: path.join(dir, 'SimConnect.xml') }
      );
    }
    for (const folder of await inputProfileFolders(ctx)) {
      const names = await ctx.ports.files.list(folder);
      for (const name of names.ok ? names.value : []) {
        if (/^inputprofile_/i.test(name)) {
          suggestions.push({
            label: `Controller profile (${name})`,
            path: path.join(folder, name),
          });
        }
      }
    }
    return ok(await existingFiles(ctx, suggestions));
  },

  async installedVersion(ctx, install) {
    if (install.source === 'steam') return steamVersion(ctx, APP_ID);
    return ok({ version: 'unknown' });
  },

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    if (await ctx.ports.files.exists(steamUserFolder(ctx)))
      variables['MSFS2024_USER'] = steamUserFolder(ctx);
    else if (await ctx.ports.files.exists(storeUserFolder(ctx)))
      variables['MSFS2024_USER'] = storeUserFolder(ctx);
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'flight',
  manualFolder: {
    exe: EXE,
    label: 'the Flight Simulator 2024 folder (it contains FlightSimulator2024.exe)',
  },
  processes: [EXE],
  notes: [
    'Controller bindings are kept as Steam Cloud profiles in a binary format: RigReady backs them up as whole files but cannot list what is bound.',
    'The Microsoft Store edition is started from the Start menu; RigReady cannot launch it directly.',
  ],
  async facts(ctx) {
    for (const dir of [steamUserFolder(ctx), storeUserFolder(ctx)]) {
      const file = path.join(dir, 'UserCfg.opt');
      if (!(await ctx.ports.files.exists(file))) continue;
      const text = await ctx.ports.files.readText(file);
      const match = text.ok ? /^InstalledPackagesPath\s+"([^"]+)"/m.exec(text.value) : null;
      if (match) return [`Add-ons and the Community folder are in ${match[1]}.`];
    }
    return [];
  },
};

export default msfs2024;
