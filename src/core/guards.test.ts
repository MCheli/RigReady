import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, wiredApp, type TestRig, type WiredApp } from '../../tests/helpers';
import { ok } from './result';
import { broadFolderReason, protectedProgramFileReason, protectedProgramReason } from './guards';
import { runningHolders } from './runningPrograms';

/**
 * GAME-ADD-003 and GAME-ADD-004: what a game the user adds may name. A settings folder is
 * where backups read and restores write, a program name is what is closed before a restore.
 */

let rig: TestRig | undefined;
let app: WiredApp | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
  await app?.cleanup();
  app = undefined;
});

describe('folders too broad to be a game’s settings folder', () => {
  it('refuses a drive root, Windows, Program Files, the user folder, RigReady’s folder and a whole Steam library; takes a game’s own folder', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const { folders } = rig.ports;
    const reason = (folder: string) => broadFolderReason(rig!.ports, folder);
    const library = path.join(folders.programFilesX86(), 'Steam');

    expect(await reason('C:\\')).toBe('it is a whole drive');
    expect(await reason('D:/')).toBe('it is a whole drive');
    expect(await reason('C:\\Windows')).toBe('it is part of Windows');
    expect(await reason('C:\\Windows\\System32\\drivers')).toBe('it is part of Windows');
    expect(await reason(folders.programFiles())).toBe('it holds every installed program');
    expect(await reason(folders.programFilesX86())).toBe('it holds every installed program');
    expect(await reason(folders.programData())).toBe('it holds the data of every program');
    expect(await reason(folders.home())).toBe('it holds your whole user folder');
    // The folder above the user folder holds every user's.
    expect(await reason(path.dirname(folders.home()))).toBe('it holds your whole user folder');
    expect(await reason(folders.dataRoot())).toBe("it is RigReady's own folder");
    expect(await reason(path.join(folders.dataRoot(), 'games'))).toBe(
      "it is RigReady's own folder"
    );
    for (const shared of [
      folders.documents(),
      folders.savedGames(),
      folders.desktop(),
      folders.appData(),
      folders.localAppData(),
      path.dirname(folders.appData()),
    ]) {
      expect(await reason(shared)).toMatch(/^it holds the files of many programs/);
    }
    expect(await reason(library)).toBe('it holds a whole Steam library');
    expect(await reason(path.join(library, 'steamapps'))).toBe('it holds a whole Steam library');
    expect(await reason(path.join(library, 'steamapps', 'common'))).toBe(
      'it holds a whole Steam library'
    );
    expect(await reason('\\\\server\\share\\games')).toBe(
      'it is not a folder on a drive of this PC'
    );
    expect(await reason('\\\\?\\C:\\Games')).toBe('it is not a folder on a drive of this PC');
    expect(await reason('Games\\Star Hauler')).toBe('it is not a folder on a drive of this PC');

    // A game's own folder, wherever it is.
    for (const fine of [
      path.join(folders.documents(), 'Star Hauler'),
      path.join(folders.savedGames(), 'Star Hauler'),
      path.join(folders.localAppData(), 'StarHauler', 'Saved', 'Config'),
      path.join(folders.programFiles(), 'Star Hauler'),
      path.join(library, 'steamapps', 'common', 'Star Hauler'),
      path.join(folders.home(), 'Games', 'Star Hauler'),
      'D:\\Games\\Star Hauler',
    ]) {
      expect(await reason(fine), fine).toBeUndefined();
    }
  });
});

describe('programs that are never a game’s', () => {
  it('refuses Windows’ own programs and RigReady itself, by name and by file, in any case', async () => {
    rig = await scenarioRig('generic-fresh', { files: [] });
    for (const name of ['explorer.exe', 'SVCHOST.EXE', 'cmd.exe', 'powershell.exe', 'dwm.exe']) {
      expect(protectedProgramReason(name), name).toBe('it is part of Windows');
    }
    expect(protectedProgramReason('RigReady.exe')).toBe('it is RigReady itself');
    // Steam runs every Steam game: never one game's program, never closed for one game.
    for (const name of ['steam.exe', 'Steam.exe', 'steamwebhelper.exe', 'SteamService.exe']) {
      expect(protectedProgramReason(name), name).toBe(
        'it is Steam, which runs every Steam game. For a Steam game, give its Steam app id'
      );
    }
    expect(protectedProgramReason(' electron.exe ')).toBe('it is RigReady itself');
    expect(protectedProgramReason('StarHauler.exe')).toBeUndefined();

    const file = (f: string) => protectedProgramFileReason(rig!.ports, f);
    expect(file('C:\\Windows\\System32\\notepad.exe')).toBe('it is part of Windows');
    expect(file(path.join(rig.ports.folders.dataRoot(), 'scripts', 'x.exe'))).toBe(
      "it is in RigReady's own folder"
    );
    expect(file('C:\\Program Files\\RigReady\\RigReady.exe')).toBe('it is RigReady itself');
    expect(file('C:\\Program Files (x86)\\Steam\\steam.exe')).toMatch(/^it is Steam/);
    expect(file('\\\\server\\share\\game.exe')).toBe('it is not a file on a drive of this PC');
    expect(file(path.join(rig.home, 'Games', 'Star Hauler', 'StarHauler.exe'))).toBeUndefined();
  });

  it('a restore never asks a part of Windows to close, whatever a game names', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const settings = path.join(app.ports.folders.documents(), 'Rogue Game');
    app.wiring.context.games.register({
      id: 'user-rogue-game',
      name: 'Rogue Game',
      processes: ['explorer.exe', 'RigReady.exe', 'steam.exe', 'RogueGame.exe'],
      detect: async () => ok([]),
      configLocations: async () => ok([{ id: 'settings', label: 'Settings', path: settings }]),
    });
    await mutate(app, [
      { op: 'startProcess', name: 'explorer.exe', path: 'C:\\Windows\\explorer.exe' },
      { op: 'startProcess', name: 'RigReady.exe', path: 'C:\\Apps\\RigReady\\RigReady.exe' },
      { op: 'startProcess', name: 'steam.exe', path: 'C:\\Program Files (x86)\\Steam\\steam.exe' },
    ]);
    const target = { label: 'Rogue Game settings', target: path.join(settings, 'a.ini') };
    const none = await runningHolders(app.wiring.context, [target]);
    expect(none.ok && none.value).toEqual([]);

    await mutate(app, [
      { op: 'startProcess', name: 'RogueGame.exe', path: 'C:\\Games\\Rogue\\RogueGame.exe' },
    ]);
    const held = await runningHolders(app.wiring.context, [target]);
    expect(held.ok && held.value.map((p) => p.processes)).toEqual([['RogueGame.exe']]);
  });
});
