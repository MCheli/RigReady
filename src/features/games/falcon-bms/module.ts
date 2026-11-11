import path from 'node:path';
import type { CheckContext } from '../../../core/checks/registry';
import type { GameInstall, TrackedFileSuggestion } from '../../../core/games';
import { readSteamApp } from '../../../core/steam';
import { filesIn, simpleGame } from '../core/simpleGame';

/**
 * Falcon BMS, the free Falcon 4.0 conversion by Benchmark Sims. It is not sold on Steam; it
 * needs Falcon 4.0 (Steam app 429530, or another edition) to install. Its installer writes
 * HKLM\SOFTWARE\WOW6432Node\Benchmark Sims\Falcon BMS <version> with the install folder in
 * baseDir; the game is <baseDir>\Bin\x64\Falcon BMS.exe and it is started through
 * <baseDir>\Launcher.exe. Settings, keyfiles and the axis setup are in <baseDir>\User\Config.
 * Sources: docs/research/game-modules-2026-11.md section 4.
 */

const ROOT = 'SOFTWARE\\WOW6432Node\\Benchmark Sims';
const EXE = path.join('Bin', 'x64', 'Falcon BMS.exe');
const FALCON4_APP_ID = '429530';

interface BmsInstall {
  version: string;
  install: GameInstall;
}

/** Every Falcon BMS version whose registry key points at a folder that holds the game. */
async function registryInstalls(ctx: CheckContext): Promise<BmsInstall[]> {
  const keys = await ctx.ports.registry.listKeys('HKLM', ROOT);
  const found: BmsInstall[] = [];
  for (const key of keys.ok ? keys.value : []) {
    const version = /^Falcon BMS (.+)$/.exec(key)?.[1];
    if (!version) continue;
    const base = await ctx.ports.registry.getValue('HKLM', `${ROOT}\\${key}`, 'baseDir');
    if (!base.ok || base.value?.type !== 'string' || !base.value.value.trim()) continue;
    const dir = path.resolve(base.value.value.trim());
    if (!(await ctx.ports.files.exists(path.join(dir, EXE)))) continue;
    const launcher = path.join(dir, 'Launcher.exe');
    const launch = (await ctx.ports.files.exists(launcher))
      ? { exe: launcher, args: [], cwd: dir }
      : { exe: path.join(dir, EXE), args: [], cwd: path.join(dir, 'Bin', 'x64') };
    found.push({ version, install: { source: 'standalone', installDir: dir, launch } });
  }
  // The newest version first, so Launch starts it.
  return found.sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
}

const config = (install: GameInstall): string => path.join(install.installDir, 'User', 'Config');

const { module, extras } = simpleGame({
  id: 'falcon-bms',
  name: 'Falcon BMS',
  kind: 'flight',
  exe: EXE,
  otherInstalls: async (ctx) => (await registryInstalls(ctx)).map((b) => b.install),
  processes: ['Falcon BMS.exe'],
  closeWhy:
    'Falcon BMS and its launcher write the settings, keyfile and axis setup while they run, which could undo the restore.',

  async otherVersion(ctx, install) {
    const match = (await registryInstalls(ctx)).find(
      (b) => b.install.installDir.toLowerCase() === install.installDir.toLowerCase()
    );
    return match?.version;
  },

  async locations(_ctx, installs) {
    return installs.map((install, index) => ({
      id: `config-${index + 1}`,
      label: 'User\\Config (settings, keyfiles and axis setup)',
      path: config(install),
    }));
  },

  async tracked(ctx, installs) {
    const suggestions: TrackedFileSuggestion[] = [];
    for (const install of installs) {
      const dir = config(install);
      suggestions.push(
        {
          label: 'Falcon BMS settings, keyfiles and axis setup',
          path: dir,
          kind: 'folder',
          include: ['*.cfg', '*.key', '*.dat', '*.cal', '*.pop', '*.ini', '*.txt'],
          exclude: ['Backup/**'],
          description:
            'The settings files, every keyfile, the axis setup (axismapping.dat, joystick.cal), the controller order (DeviceSorting.txt) and the pilot files (*.pop). The Backup folder the launcher keeps is left out.',
        },
        { label: 'Settings (Falcon BMS.cfg)', path: path.join(dir, 'Falcon BMS.cfg') },
        {
          label: 'Your settings (Falcon BMS User.cfg)',
          path: path.join(dir, 'Falcon BMS User.cfg'),
        },
        { label: 'Axis setup (axismapping.dat)', path: path.join(dir, 'axismapping.dat') },
        {
          label: 'Controller order (DeviceSorting.txt)',
          path: path.join(dir, 'DeviceSorting.txt'),
        },
        { label: 'Axis calibration (joystick.cal)', path: path.join(dir, 'joystick.cal') },
        ...(await filesIn(ctx, dir, /\.key$/i, (name) => `Keyfile (${name})`))
      );
    }
    return suggestions;
  },

  manualLabel: 'the Falcon BMS folder (it contains Bin\\x64\\Falcon BMS.exe)',
  notes: [
    'Falcon BMS is found through the registry key its installer writes, and started through its Launcher.',
    'DeviceSorting.txt and axismapping.dat follow your controllers by their Windows ids; RigReady backs them up but does not repair them when an id changes.',
  ],
  async facts(ctx) {
    const falcon = await readSteamApp(ctx.ports, FALCON4_APP_ID);
    return falcon.ok && falcon.value
      ? ['Falcon 4.0, which Falcon BMS needs to install, is in your Steam library.']
      : [];
  },
});

export { extras };
export default module;
