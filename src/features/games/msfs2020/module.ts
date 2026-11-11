import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { TrackedFileSuggestion } from '../../../core/games';
import { simpleGame, steamCloudFolders, storeInstall } from '../core/simpleGame';

/**
 * Microsoft Flight Simulator (2020). Steam edition: app 1250410, settings in
 * %APPDATA%\Microsoft Flight Simulator, controller profiles as Steam Cloud files in
 * userdata\<account>\1250410\remote. Microsoft Store edition: package
 * Microsoft.FlightSimulator_8wekyb3d8bbwe, settings in its LocalCache.
 * Sources: docs/research/game-modules-2026-11.md section 1.
 */

const APP_ID = '1250410';
const EXE = 'FlightSimulator.exe';
const STORE_PACKAGE = 'Microsoft.FlightSimulator_8wekyb3d8bbwe';

const steamUserFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.appData(), 'Microsoft Flight Simulator');
const storeUserFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.localAppData(), 'Packages', STORE_PACKAGE, 'LocalCache');

const { module, extras } = simpleGame({
  id: 'msfs2020',
  name: 'Microsoft Flight Simulator (2020)',
  kind: 'flight',
  steamAppId: APP_ID,
  // The manifest is enough: like 2024, the Steam edition streams much of its content.
  exe: EXE,
  otherInstalls: (ctx) => storeInstall(ctx, STORE_PACKAGE),
  processes: [EXE],
  closeWhy:
    'Flight Simulator writes its options when it exits, and Steam Cloud syncs the controller profiles while it runs.',

  async locations(ctx) {
    return [
      { id: 'steam', label: 'Settings (Steam edition)', path: steamUserFolder(ctx) },
      { id: 'store', label: 'Settings (Microsoft Store edition)', path: storeUserFolder(ctx) },
      ...(await steamCloudFolders(ctx, APP_ID)).map((folder, index) => ({
        id: `controls-${index + 1}`,
        label: 'Controller profiles (Steam Cloud)',
        path: folder,
      })),
    ];
  },

  async tracked(ctx) {
    const suggestions: TrackedFileSuggestion[] = [];
    for (const dir of [steamUserFolder(ctx), storeUserFolder(ctx)]) {
      suggestions.push(
        { label: 'Graphics and paths (UserCfg.opt)', path: path.join(dir, 'UserCfg.opt') },
        {
          label: 'General options (FlightSimulator.CFG)',
          path: path.join(dir, 'FlightSimulator.CFG'),
        }
      );
    }
    for (const folder of await steamCloudFolders(ctx, APP_ID)) {
      suggestions.push({
        label: 'Controller profiles (Steam Cloud)',
        path: folder,
        kind: 'folder',
        description:
          'The files Steam Cloud keeps for the game on this PC, the controller profiles among them. Backed up as they are.',
      });
    }
    return suggestions;
  },

  manualLabel: 'the Flight Simulator folder (it contains FlightSimulator.exe)',
  notes: [
    'Controller bindings of the Steam edition are Steam Cloud files: RigReady backs them up as they are but cannot list what is bound.',
    'The Microsoft Store edition is started from the Start menu; RigReady cannot launch it directly. Its controller profiles are kept by the Xbox app and are not backed up.',
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
});

export { extras };
export default module;
