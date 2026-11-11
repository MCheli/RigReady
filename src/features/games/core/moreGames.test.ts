import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { TrackedFileSuggestion } from '../../../core/games';
import type { GameSummary } from '../contract';

/**
 * The game modules added in November 2026, on fixtures/scenarios/generic-more-sims.yaml (a
 * generic PC with two Steam libraries, a standalone X-Plane 11 and Falcon BMS). Sources for
 * every id and path: docs/research/game-modules-2026-11.md.
 */
describe('more game modules', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const get = (a: WiredApp, gameId: string): Promise<GameSummary> =>
    a.invoke<GameSummary>('games:get', { gameId });
  const steam = (a: WiredApp): string => path.join(a.home, 'Program Files (x86)', 'Steam');
  const library2 = (a: WiredApp): string => path.join(a.home, 'Games', 'SteamLibrary');
  const names = (game: GameSummary): string[] =>
    game.trackedFiles.map((f) => path.basename(f.path));
  /** What the module itself suggests, with the folder globs the summary leaves out. */
  const moduleTracked = async (a: WiredApp, gameId: string): Promise<TrackedFileSuggestion[]> => {
    const tracked = await a.wiring.context.games.get(gameId)!.trackedFiles!(a.ctx);
    if (!tracked.ok) throw new Error(tracked.error.message);
    return tracked.value;
  };

  it('lists every new game, found where the fixture put it, and F1 24 as not found', async () => {
    app = await wiredApp('generic-more-sims');
    const games = await app.invoke<GameSummary[]>('games:list');
    const found = Object.fromEntries(
      games.filter((g) => g.installs.length > 0).map((g) => [g.id, g.installs[0]!.source])
    );
    expect(found).toEqual({
      msfs2020: 'steam',
      'x-plane-12': 'steam',
      'x-plane-11': 'standalone',
      'il2-great-battles': 'steam',
      'falcon-bms': 'standalone',
      acc: 'steam',
      rfactor2: 'steam',
      ams2: 'steam',
      'ea-wrc': 'steam',
      'f1-25': 'steam',
      'dirt-rally-2': 'steam',
      raceroom: 'steam',
    });
    const f1_24 = games.find((g) => g.id === 'f1-24')!;
    expect(f1_24).toMatchObject({ installs: [], problems: [], kind: 'racing' });
    expect(f1_24.manualFolder?.label).toContain('F1_24.exe');
    for (const game of games) expect(game.problems, game.id).toEqual([]);
    const kinds = Object.fromEntries(games.map((g) => [g.id, g.kind]));
    for (const id of ['msfs2020', 'x-plane-12', 'x-plane-11', 'il2-great-battles', 'falcon-bms']) {
      expect(kinds[id], id).toBe('flight');
    }
    for (const id of [
      'acc',
      'rfactor2',
      'ams2',
      'ea-wrc',
      'f1-25',
      'f1-24',
      'dirt-rally-2',
      'raceroom',
    ]) {
      expect(kinds[id], id).toBe('racing');
    }
  });

  it('launches each Steam game through Steam with its own app id', async () => {
    app = await wiredApp('generic-more-sims');
    const ids: Record<string, string> = {
      msfs2020: '1250410',
      'x-plane-12': '2014780',
      'il2-great-battles': '307960',
      acc: '805550',
      rfactor2: '365960',
      ams2: '1066890',
      'ea-wrc': '1849250',
      'f1-25': '3059520',
      'dirt-rally-2': '690790',
      raceroom: '211500',
    };
    for (const [gameId, appId] of Object.entries(ids)) {
      const game = await get(app, gameId);
      expect(game.installs[0]!.launch, gameId).toEqual({
        exe: path.join(steam(app), 'steam.exe'),
        args: ['-applaunch', appId],
      });
      expect(game.version?.version, gameId).toMatch(/^Build \d+$/);
    }
    // The second library is found as well.
    expect((await get(app, 'rfactor2')).installs[0]!.installDir).toBe(
      path.join(library2(app), 'steamapps', 'common', 'rFactor 2')
    );
    expect(await app.invoke('games:launch', { gameId: 'acc' })).toEqual({
      message: 'Asked Steam to start Assetto Corsa Competizione.',
    });
    expect(app.ports.processes.started.at(-1)).toMatchObject({ args: ['-applaunch', '805550'] });
  });

  it('Microsoft Flight Simulator (2020): Steam settings, Steam Cloud profiles, and the Store edition', async () => {
    app = await wiredApp('generic-more-sims');
    const game = await get(app, 'msfs2020');
    expect(game.configLocations.map((l) => l.id)).toEqual(['steam', 'controls-1']);
    expect(names(game)).toEqual(['UserCfg.opt', 'FlightSimulator.CFG', 'remote']);
    expect(game.facts).toEqual(['Add-ons and the Community folder are in D:\\MSFS\\Packages.']);
    await mutate(app, [
      { op: 'removeFile', path: 'Program Files (x86)/Steam/steamapps/appmanifest_1250410.acf' },
    ]);
    expect((await get(app, 'msfs2020')).installs).toEqual([]);
    const cache = path.join(
      app.ports.folders.localAppData(),
      'Packages',
      'Microsoft.FlightSimulator_8wekyb3d8bbwe',
      'LocalCache'
    );
    await fs.mkdir(cache, { recursive: true });
    await fs.writeFile(path.join(cache, 'UserCfg.opt'), 'Version 66\n');
    const store = await get(app, 'msfs2020');
    expect(store.installs).toEqual([{ source: 'store', installDir: path.dirname(cache) }]);
    expect(store.version).toEqual({ version: 'unknown' });
    expect(store.configLocations.map((l) => l.id)).toContain('store');
    await expect(app.invoke('games:launch', { gameId: 'msfs2020' })).rejects.toThrow(
      'does not know how to start'
    );
  });

  it('X-Plane: preferences and control profiles in Steam, and a standalone install from its install list', async () => {
    app = await wiredApp('generic-more-sims');
    const xp12 = await get(app, 'x-plane-12');
    const prefs = path.join(
      steam(app),
      'steamapps',
      'common',
      'X-Plane 12',
      'Output',
      'preferences'
    );
    expect(xp12.configLocations.map((l) => l.path)).toEqual([prefs]);
    expect((await moduleTracked(app, 'x-plane-12'))[0]).toMatchObject({
      path: prefs,
      kind: 'folder',
      include: ['*.prf', 'control profiles/**'],
    });
    expect(names(xp12)).toEqual([
      'preferences',
      'control profiles',
      'X-Plane Keys.prf',
      'X-Plane.prf',
    ]);

    const xp11 = await get(app, 'x-plane-11');
    const dir = path.join(app.home, 'Games', 'X-Plane 11');
    expect(xp11.installs).toEqual([
      {
        source: 'standalone',
        installDir: dir,
        launch: { exe: path.join(dir, 'X-Plane.exe'), args: [], cwd: dir },
      },
    ]);
    expect(names(xp11)).toEqual(['preferences', 'X-Plane.prf']);
    expect(await app.invoke('games:launch', { gameId: 'x-plane-11' })).toEqual({
      message: 'Started X-Plane 11.',
    });
    expect(app.ports.processes.started.at(-1)!.exe).toBe(path.join(dir, 'X-Plane.exe'));

    // A line in the install list whose folder no longer holds X-Plane is ignored.
    await fs.rm(path.join(dir, 'X-Plane.exe'));
    expect((await get(app, 'x-plane-11')).installs).toEqual([]);
  });

  it('IL-2 Great Battles: the bindings in the data input folder and the options file', async () => {
    app = await wiredApp('generic-more-sims');
    const game = await get(app, 'il2-great-battles');
    expect(game.configLocations.map((l) => l.label)).toEqual(['data\\input (bindings)']);
    expect(names(game)).toEqual([
      'input',
      'current.actions',
      'current.map',
      'current.responses',
      'devices.txt',
      'startup.cfg',
    ]);
    // Without the game program the Steam entry is not counted as installed.
    await mutate(app, [
      {
        op: 'removeFile',
        path: 'Games/SteamLibrary/steamapps/common/IL-2 Sturmovik Battle of Stalingrad/bin/game/Il-2.exe',
      },
    ]);
    expect((await get(app, 'il2-great-battles')).installs).toEqual([]);
  });

  it('Falcon BMS: found through its registry key, started through its launcher, its config folder backed up', async () => {
    app = await wiredApp('generic-more-sims');
    const game = await get(app, 'falcon-bms');
    const dir = path.join(app.home, 'Games', 'Falcon BMS 4.38');
    expect(game.installs).toEqual([
      {
        source: 'standalone',
        installDir: dir,
        launch: { exe: path.join(dir, 'Launcher.exe'), args: [], cwd: dir },
      },
    ]);
    expect(game.version).toEqual({ version: '4.38' });
    expect((await moduleTracked(app, 'falcon-bms'))[0]).toMatchObject({
      path: path.join(dir, 'User', 'Config'),
      kind: 'folder',
      exclude: ['Backup/**'],
    });
    expect(names(game)).toEqual([
      'Config',
      'Falcon BMS.cfg',
      'axismapping.dat',
      'DeviceSorting.txt',
      'BMS - Full.key',
    ]);
    expect(game.facts).toEqual([
      'Falcon 4.0, which Falcon BMS needs to install, is in your Steam library.',
    ]);
    // A key whose folder no longer holds the game is not an install.
    await mutate(app, [{ op: 'removeFile', path: 'Games/Falcon BMS 4.38/Bin/x64/Falcon BMS.exe' }]);
    expect((await get(app, 'falcon-bms')).installs).toEqual([]);
  });

  it('Assetto Corsa Competizione, rFactor 2 and Automobilista 2: settings and bindings files', async () => {
    app = await wiredApp('generic-more-sims');
    const acc = await get(app, 'acc');
    expect(acc.configLocations.map((l) => l.path)).toEqual([
      path.join(app.ports.folders.documents(), 'Assetto Corsa Competizione', 'Config'),
    ]);
    expect(names(acc)).toEqual(['Config', 'controls.json', 'menuSettings.json', 'Setups']);

    const rf2 = await get(app, 'rfactor2');
    expect(rf2.configLocations.map((l) => l.id)).toEqual(['player', 'userdata']);
    expect((await moduleTracked(app, 'rfactor2'))[0]!.include).toContain('player/*');
    expect(names(rf2)).toEqual(['UserData', 'Controller.JSON', 'player.JSON', 'Config.ini']);

    const ams2 = await get(app, 'ams2');
    expect(names(ams2)).toEqual(['Automobilista 2', 'default.controllersettings.v1.03.sav']);
  });

  it('EA SPORTS WRC, F1 25, DiRT Rally 2.0 and RaceRoom: settings files, with what is not backed up said plainly', async () => {
    app = await wiredApp('generic-more-sims');
    const wrc = await get(app, 'ea-wrc');
    expect(names(wrc)).toEqual([
      'WindowsNoEditor',
      'GameUserSettings.ini',
      'EgoInput.ini',
      'config.json',
    ]);
    expect(wrc.notes.join(' ')).toContain('not in its backup');

    const f1 = await get(app, 'f1-25');
    expect(names(f1)).toEqual(['hardwaresettings', 'hardware_settings_config.xml']);

    const dirt = await get(app, 'dirt-rally-2');
    expect(dirt.configLocations.map((l) => l.id)).toEqual(['hardwaresettings', 'actionmaps']);
    expect(names(dirt)).toEqual([
      'hardwaresettings',
      'hardware_settings_config.xml',
      'actionmaps',
      'device_defines.xml',
    ]);

    const raceroom = await get(app, 'raceroom');
    expect(names(raceroom)).toEqual(['UserData']);
  });

  it('a game counts as running by its own program, and a folder chosen by hand must hold that program', async () => {
    app = await wiredApp('generic-more-sims');
    expect((await get(app, 'ams2')).running).toBe(false);
    await mutate(app, [{ op: 'startProcess', name: 'AMS2AVX.exe', path: 'C:/Games/AMS2AVX.exe' }]);
    expect((await get(app, 'ams2')).running).toBe(true);

    const chosen = path.join(app.home, 'Games', 'F1 24');
    await fs.mkdir(chosen, { recursive: true });
    app.ports.dialogs.script.open.push([chosen]);
    await expect(app.invoke('games:chooseFolder', { gameId: 'f1-24' })).rejects.toThrow(
      'does not contain F1_24.exe'
    );
    await fs.writeFile(path.join(chosen, 'F1_24.exe'), '');
    app.ports.dialogs.script.open.push([chosen]);
    const picked = await app.invoke<{ chosen: boolean; game: GameSummary }>('games:chooseFolder', {
      gameId: 'f1-24',
    });
    expect(picked.game.installs[0]).toMatchObject({ source: 'standalone', installDir: chosen });
  });
});
