import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ok } from '../../../core/result';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { GameSummary } from '../contract';

const UNINSTALL =
  'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{2CB193B9-1B9D-4A84-BC70-0948145BA4BA}_is1';

describe('game modules', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const get = (a: WiredApp, gameId: string): Promise<GameSummary> =>
    a.invoke<GameSummary>('games:get', { gameId });
  const steamApps = (a: WiredApp): string =>
    path.join(a.home, 'Program Files (x86)', 'Steam', 'steamapps');

  it('finds iRacing from its uninstall entry, its version file and the Documents folder', async () => {
    app = await wiredApp('racing-fresh');
    const game = await get(app, 'iracing');
    const install = path.join(app.home, 'Program Files (x86)', 'iRacing');
    expect(game.installs).toEqual([
      {
        source: 'standalone',
        installDir: install,
        launch: {
          exe: path.join(install, 'ui', 'iRacingUI.exe'),
          args: [],
          cwd: path.join(install, 'ui'),
        },
      },
    ]);
    expect(game.version).toEqual({ version: '2026.04.21.01' });
    const documents = path.join(app.ports.folders.documents(), 'iRacing');
    expect(game.configLocations).toEqual([
      { id: 'documents', label: 'Documents\\iRacing', path: documents },
    ]);
    expect(game.trackedFiles.map((f) => path.basename(f.path))).toEqual([
      'iRacing',
      'controls.cfg',
      'joyCalib.yaml',
      'app.ini',
      'core.ini',
      'camera.ini',
      'rendererDX11Monitor.ini',
    ]);
    expect(game.facts).toContain(
      'Also in your Steam library: that entry only starts this install of iRacing.'
    );
    expect(game.kind).toBe('racing');
    const variables = await app.wiring.context.games.get('iracing')!.pathVariables!(app.ctx);
    expect(variables.ok && variables.value).toEqual({
      IRACING_USER: documents,
      IRACING_INSTALL: install,
    });
  });

  it('suggests the custom controls of every car for tracking', async () => {
    app = await wiredApp('racing-fresh');
    const car = path.join(app.ports.folders.documents(), 'iRacing', 'setups', 'mx5 mx52016');
    await fs.mkdir(car, { recursive: true });
    await fs.writeFile(path.join(car, 'controls.cfg'), 'x');
    await fs.writeFile(path.join(car, 'joyCalib.yaml'), 'x');
    const tracked = (await get(app, 'iracing')).trackedFiles;
    expect(
      tracked
        .filter((f) => f.label.startsWith('Custom controls for mx5 mx52016'))
        .map((f) => path.basename(f.path))
    ).toEqual(['controls.cfg', 'joyCalib.yaml']);
  });

  it('follows a redirected Documents folder', async () => {
    app = await wiredApp('racing-fresh');
    const onedrive = path.join(app.home, 'OneDrive', 'Documents');
    await fs.mkdir(path.join(onedrive, 'iRacing'), { recursive: true });
    app.ports.folders.documents = () => onedrive;
    expect((await get(app, 'iracing')).configLocations[0]!.path).toBe(
      path.join(onedrive, 'iRacing')
    );
  });

  it('says iRacing is not installed, and accepts a folder the user chooses only when it holds iRacing', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [
      { op: 'removeRegistryKey', hive: 'HKLM', key: UNINSTALL },
      { op: 'removeFile', path: 'Program Files (x86)/iRacing' },
    ]);
    const missing = await get(app, 'iracing');
    expect(missing.installs).toEqual([]);
    expect(missing.manualFolder).toEqual({
      label: 'the iRacing folder (it contains ui\\iRacingUI.exe)',
    });

    const elsewhere = path.join(app.home, 'Games', 'iRacing');
    await fs.mkdir(path.join(elsewhere, 'ui'), { recursive: true });
    app.ports.dialogs.script.open.push([path.join(app.home, 'Games')]);
    await expect(app.invoke('games:chooseFolder', { gameId: 'iracing' })).rejects.toThrow(
      'does not contain ui'
    );
    app.ports.dialogs.script.open.push([]);
    expect(await app.invoke('games:chooseFolder', { gameId: 'iracing' })).toMatchObject({
      chosen: false,
    });

    await fs.writeFile(path.join(elsewhere, 'ui', 'iRacingUI.exe'), '');
    app.ports.dialogs.script.open.push([elsewhere]);
    const chosen = await app.invoke<{ chosen: boolean; game: GameSummary }>('games:chooseFolder', {
      gameId: 'iracing',
    });
    expect(chosen.chosen).toBe(true);
    expect(chosen.game.installs[0]).toMatchObject({ source: 'standalone', installDir: elsewhere });
    expect(chosen.game.manualFolder!.chosen).toBe(elsewhere);
    const forgotten = await app.invoke<GameSummary>('games:forgetFolder', { gameId: 'iracing' });
    expect(forgotten.installs).toEqual([]);
  });

  it('finds Le Mans Ultimate in a second Steam library with its UserData', async () => {
    app = await wiredApp('racing-fresh');
    const library = path.join(app.home, 'D', 'SteamLibrary');
    const install = path.join(library, 'steamapps', 'common', 'Le Mans Ultimate');
    await fs.mkdir(path.join(install, 'UserData', 'player'), { recursive: true });
    await fs.mkdir(path.join(install, 'UserData', 'Log'), { recursive: true });
    await fs.writeFile(path.join(install, 'Le Mans Ultimate.exe'), '');
    await fs.writeFile(path.join(install, 'UserData', 'player', 'direct input.json'), '{}');
    await fs.writeFile(path.join(install, 'UserData', 'player', 'keyboard.json'), '{}');
    await fs.writeFile(path.join(install, 'UserData', 'Config_DX11.ini'), '');
    await fs.writeFile(
      path.join(install, 'UserData', 'Log', 'trace_2026.txt'),
      'start\nLMU-Retail:1.3000 UTC=x SteamBuild=1\n'
    );
    await fs.rename(
      path.join(steamApps(app), 'appmanifest_2399420.acf'),
      path.join(library, 'steamapps', 'appmanifest_2399420.acf')
    );
    app.ports.folders.steamLibraries = async () =>
      ok([path.join(app!.home, 'Program Files (x86)', 'Steam'), library]);
    const game = await get(app, 'lmu');
    expect(game.installs[0]).toMatchObject({ source: 'steam', installDir: install });
    expect(game.installs[0]!.launch!.args).toEqual(['-applaunch', '2399420']);
    expect(game.configLocations.map((l) => l.path)).toEqual([
      path.join(install, 'UserData', 'player'),
      path.join(install, 'UserData'),
    ]);
    const tracked = game.trackedFiles.map((f) => path.relative(install, f.path));
    expect(tracked).toEqual([
      'UserData',
      path.join('UserData', 'player', 'direct input.json'),
      path.join('UserData', 'player', 'keyboard.json'),
      path.join('UserData', 'Config_DX11.ini'),
    ]);
    expect(tracked.some((t) => t.includes('Log'))).toBe(false);
    expect(game.facts).toEqual(['Last run as version 1.3000 (game log).']);
  });

  it('reports a Steam update waiting from the app manifest', async () => {
    app = await wiredApp('racing-fresh');
    expect((await get(app, 'lmu')).version).toEqual({
      version: 'Build 25611540',
      updatePending: false,
    });
    await mutate(app, [{ op: 'setSteamBuild', appId: '2399420', stateFlags: 6 }]);
    expect((await get(app, 'lmu')).version).toEqual({
      version: 'Build 25611540',
      updatePending: true,
    });
  });

  it('BeamNG: tracked inputmaps and settings, last-run version and the migration warning', async () => {
    app = await wiredApp('racing-fresh');
    let game = await get(app, 'beamng');
    expect(game.trackedFiles.map((f) => f.label)).toEqual([
      'BeamNG.drive settings and bindings',
      'Bindings and force feedback (inputmaps, including per-vehicle)',
      'Graphics, display and audio (settings.json)',
      'Gameplay (cloud\\settings.json)',
    ]);
    expect(game.facts).toEqual(['Last run as 0.38.5.']);
    const install = game.installs[0]!.installDir;
    await fs.writeFile(
      path.join(install, 'integrity.json'),
      '{ "buildinfo": "x", "integritydata": [], "version": "0.39.4.0" }'
    );
    game = await get(app, 'beamng');
    expect(game.version).toEqual({ version: '0.39.4', updatePending: false });
    expect(game.facts).toContain(
      'Last run as 0.38.5; 0.39.4 is installed. The next start updates your user folder, so back it up first.'
    );
  });

  it('Microsoft Flight Simulator 2024: Steam install, settings, and controller profiles as files', async () => {
    app = await wiredApp('racing-fresh');
    const remote = path.join(
      app.home,
      'Program Files (x86)',
      'Steam',
      'userdata',
      '123',
      '2537590',
      'remote'
    );
    await fs.mkdir(remote, { recursive: true });
    await fs.writeFile(path.join(remote, 'inputprofile_0095024352'), 'binary');
    const game = await get(app, 'msfs2024');
    expect(game.installs[0]).toMatchObject({ source: 'steam' });
    expect(game.kind).toBe('flight');
    expect(game.configLocations.map((l) => l.id)).toEqual(['steam', 'controls-1']);
    expect(game.trackedFiles.map((f) => path.basename(f.path))).toEqual([
      'UserCfg.opt',
      'FlightSimulator2024.CFG',
      'inputprofile_0095024352',
    ]);
    expect(game.facts[0]).toMatch(/^Add-ons and the Community folder are in .*Packages\.$/);
    expect(game.notes[0]).toContain('cannot list what is bound');
  });

  it('Microsoft Flight Simulator 2024: the Microsoft Store edition is found by its package folder', async () => {
    app = await wiredApp('racing-fresh');
    await mutate(app, [
      { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/appmanifest_2537590.acf' },
    ]);
    expect((await get(app, 'msfs2024')).installs).toEqual([]);
    const cache = path.join(
      app.ports.folders.localAppData(),
      'Packages',
      'Microsoft.Limitless_8wekyb3d8bbwe',
      'LocalCache'
    );
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, 'UserCfg.opt'), 'Version 66\n');
    const game = await get(app, 'msfs2024');
    expect(game.installs).toEqual([{ source: 'store', installDir: path.dirname(cache) }]);
    expect(game.version).toEqual({ version: 'unknown' });
    expect(game.configLocations.map((l) => l.id)).toContain('store');
  });

  it('Assetto Corsa, EVO and Rally are found in Steam with their settings', async () => {
    app = await wiredApp('racing-fresh');
    const ac = await get(app, 'assetto-corsa');
    expect(ac.installs[0]!.source).toBe('steam');
    expect(ac.trackedFiles.map((f) => path.basename(f.path))).toEqual([
      'cfg',
      'controls.ini',
      'video.ini',
    ]);
    const vars = await app.wiring.context.games.get('assetto-corsa')!.pathVariables!(app.ctx);
    expect(vars.ok && Object.keys(vars.value)).toEqual(['AC_USER', 'AC_INSTALL']);
    expect((await get(app, 'assetto-corsa-evo')).installs[0]!.launch!.args).toEqual([
      '-applaunch',
      '3058630',
    ]);
    const rally = await get(app, 'assetto-corsa-rally');
    expect(rally.installs).toHaveLength(1);
    const saved = path.join(app.ports.folders.localAppData(), 'acr', 'Saved', 'SaveGames');
    await fs.mkdir(saved, { recursive: true });
    await fs.writeFile(path.join(saved, 'EnhancedInputUserSettings.sav'), 'x');
    expect((await get(app, 'assetto-corsa-rally')).trackedFiles.map((f) => f.label)).toEqual([
      'Bindings (EnhancedInputUserSettings.sav)',
    ]);
  });

  it('launches a standalone game directly and a Steam game through Steam', async () => {
    app = await wiredApp('racing-fresh');
    expect(await app.invoke('games:launch', { gameId: 'iracing' })).toEqual({
      message: 'Started iRacing.',
    });
    expect(app.ports.processes.started.at(-1)!.exe).toMatch(/iRacingUI\.exe$/);
    expect((await get(app, 'iracing')).running).toBe(true);
    expect(await app.invoke('games:launch', { gameId: 'lmu' })).toEqual({
      message: 'Asked Steam to start Le Mans Ultimate.',
    });
    expect(app.ports.processes.started.at(-1)).toMatchObject({ args: ['-applaunch', '2399420'] });
    expect(path.basename(app.ports.processes.started.at(-1)!.exe).toLowerCase()).toBe('steam.exe');
    await mutate(app, [
      { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/appmanifest_2537590.acf' },
    ]);
    await expect(app.invoke('games:launch', { gameId: 'msfs2024' })).rejects.toThrow(
      'does not know how to start'
    );
    await expect(app.invoke('games:get', { gameId: 'nope' })).rejects.toThrow(
      'does not know a game'
    );
  });
});
