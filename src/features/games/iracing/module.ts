import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, GameModule, TrackedFileSuggestion } from '../../../core/games';
import { ok } from '../../../core/result';
import { readSteamApp } from '../../../core/steam';
import {
  existingFiles,
  existingLocations,
  manualInstall,
  readFirstLine,
  type GameModuleExtras,
} from '../core/helpers';

/**
 * iRacing. The real install is the standalone one under Program Files (x86); the Steam
 * entry (app 266410) is a 2 KB stub of batch files that start the standalone UI.
 * See docs/research/racing.md section 2.
 */

const UNINSTALL_ROOTS = [
  'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
];
const DISPLAY_NAME = 'iRacing.com Race Simulation';
const UI_EXE = path.join('ui', 'iRacingUI.exe');

/** InstallLocation of the iRacing installer's uninstall entry. Its DisplayVersion is stale; never use it. */
async function registryInstallDir(ctx: CheckContext): Promise<string | undefined> {
  for (const root of UNINSTALL_ROOTS) {
    const keys = await ctx.ports.registry.listKeys('HKLM', root);
    if (!keys.ok) continue;
    for (const key of keys.value) {
      const values = await ctx.ports.registry.listValues('HKLM', `${root}\\${key}`);
      if (!values.ok) continue;
      const name = values.value['DisplayName'];
      const location = values.value['InstallLocation'];
      if (name?.type === 'string' && name.value === DISPLAY_NAME && location?.type === 'string') {
        if (location.value.trim()) return path.resolve(location.value.trim());
      }
    }
  }
  return undefined;
}

export const userFolder = (ctx: CheckContext): string =>
  path.join(ctx.ports.folders.documents(), 'iRacing');

async function findInstall(ctx: CheckContext): Promise<GameInstall | undefined> {
  const candidates = [
    await registryInstallDir(ctx),
    path.join(ctx.ports.folders.programFilesX86(), 'iRacing'),
  ].filter((dir): dir is string => dir !== undefined);
  for (const dir of candidates) {
    const exe = path.join(dir, UI_EXE);
    if (await ctx.ports.files.exists(exe)) {
      // The UI is the launcher: it signs in and starts the simulator with session parameters.
      return {
        source: 'standalone',
        installDir: dir,
        launch: { exe, args: [], cwd: path.dirname(exe) },
      };
    }
  }
  return manualInstall(ctx, 'iracing', UI_EXE);
}

/** What is worth keeping in Documents\iRacing; replays, telemetry and logs are not. */
export const IRACING_INCLUDE = [
  'controls.cfg',
  'joyCalib.yaml',
  '*.ini',
  'profiles/**',
  'scripts/**',
  'setups/**',
];

const iracing: GameModule = {
  id: 'iracing',
  name: 'iRacing',
  processes: ['iRacingUI.exe', 'iRacingSim64DX11.exe'],
  closeBeforeRestore: {
    // The UI does not touch these files; the simulator writes them when it exits.
    processes: ['iRacingSim64DX11.exe'],
    why: 'iRacing writes these files when the simulator exits, which would undo the restore.',
  },

  async detect(ctx) {
    const install = await findInstall(ctx);
    return ok(install ? [install] : []);
  },

  async configLocations(ctx) {
    return ok(
      await existingLocations(ctx, [
        { id: 'documents', label: 'Documents\\iRacing', path: userFolder(ctx) },
      ])
    );
  },

  async trackedFiles(ctx) {
    const dir = userFolder(ctx);
    const suggestions: TrackedFileSuggestion[] = [
      {
        label: 'iRacing settings and bindings',
        path: dir,
        kind: 'folder',
        include: IRACING_INCLUDE,
        description:
          'Bindings, calibration, options, graphics, HUD profiles, radio scripts and car setups. Replays and telemetry are left out.',
      },
      { label: 'Bindings (controls.cfg)', path: path.join(dir, 'controls.cfg') },
      {
        label: 'Wheel and pedal calibration (joyCalib.yaml)',
        path: path.join(dir, 'joyCalib.yaml'),
      },
      { label: 'Audio, force feedback and options (app.ini)', path: path.join(dir, 'app.ini') },
      { label: 'Network and telemetry (core.ini)', path: path.join(dir, 'core.ini') },
      { label: 'Cameras (camera.ini)', path: path.join(dir, 'camera.ini') },
      { label: 'Fuel (fueldata.ini)', path: path.join(dir, 'fueldata.ini') },
      { label: 'HUD profiles', path: path.join(dir, 'profiles') },
      { label: 'Radio scripts', path: path.join(dir, 'scripts') },
    ];
    const names = await ctx.ports.files.list(dir);
    for (const name of names.ok ? names.value : []) {
      if (/^rendererDX11.*\.ini$/i.test(name)) {
        suggestions.push({ label: `Graphics (${name})`, path: path.join(dir, name) });
      }
    }
    // "Use custom controls for this car" keeps a controls.cfg and joyCalib.yaml per car.
    const cars = await ctx.ports.files.list(path.join(dir, 'setups'));
    for (const car of cars.ok ? cars.value : []) {
      for (const file of ['controls.cfg', 'joyCalib.yaml']) {
        suggestions.push({
          label: `Custom controls for ${car} (${file})`,
          path: path.join(dir, 'setups', car, file),
        });
      }
    }
    return ok(await existingFiles(ctx, suggestions));
  },

  async installedVersion(ctx, install) {
    const version =
      (await readFirstLine(ctx, path.join(install.installDir, 'version_system.txt'))) ??
      (await readFirstLine(ctx, path.join(install.installDir, 'updater', 'version.txt')));
    // iRacing updates itself from its UI; nothing on disk says an update is waiting.
    return ok({ version: version ?? 'unknown' });
  },

  async pathVariables(ctx) {
    const variables: Record<string, string> = {};
    if (await ctx.ports.files.exists(userFolder(ctx))) variables['IRACING_USER'] = userFolder(ctx);
    const install = await findInstall(ctx);
    if (install) variables['IRACING_INSTALL'] = install.installDir;
    return ok(variables);
  },
};

export const extras: GameModuleExtras = {
  kind: 'racing',
  manualFolder: { exe: UI_EXE, label: 'the iRacing folder (it contains ui\\iRacingUI.exe)' },
  notes: [
    'iRacing updates itself from its own UI; RigReady shows the installed build but cannot tell whether an update is waiting.',
    'The simulator rewrites its .ini files when it exits, so restore them only while iRacing is closed.',
  ],
  async facts(ctx) {
    const facts: string[] = [];
    // A Steam entry for iRacing is a launcher stub; worth saying so, never counted as an install.
    const app = await readSteamApp(ctx.ports, '266410');
    if (app.ok && app.value) {
      facts.push('Also in your Steam library: that entry only starts this install of iRacing.');
    }
    const logs = await ctx.ports.files.listEntries(path.join(userFolder(ctx), 'logs'));
    const updates = (logs.ok ? logs.value : []).filter((e) => /^updater_.*\.txt$/i.test(e.name));
    const newest = updates.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    if (newest) {
      facts.push(
        `Last updated ${new Date(newest.mtimeMs).toISOString().slice(0, 10)} (updater log).`
      );
    }
    return facts;
  },
};

export default iracing;
