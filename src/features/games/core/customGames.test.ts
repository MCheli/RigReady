import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { knownPathVariables, allPathVariables } from '../../../core/pathVariables';
import { CheckItemSchema, ProfileSchema, type Profile } from '../../../core/profile/schema';
import { ok } from '../../../core/result';
import { wiredApp, type WiredApp } from '../../../../tests/helpers';
import { sabotage } from '../../../../tests/sabotage';
import type { CommandShell } from '../../../shared/feature';
import gameCommands, { ADD_GAME_ROUTE } from '../commands';
import type { GameSummary, UserGameView } from '../contract';
import { nameFromProgram } from './userGamePicks';

/**
 * "Add a game" (GAME-ADD-001 to GAME-ADD-005): a game the user adds is kept in
 * <data folder>/games/custom.json, becomes a game module at start, and is then found,
 * launched, backed up and offered for a setup like one RigReady ships. Its program and
 * settings folders come only from the native pickers, and whatever it names is checked
 * again when the file is read back.
 */

let app: WiredApp | undefined;
let friend: WiredApp | undefined;
afterEach(async () => {
  for (const a of [app, friend]) {
    for (const f of a?.wiring.features ?? []) await f.dispose?.();
    await a?.cleanup();
  }
  app = undefined;
  friend = undefined;
});

type Picked = { picked: boolean; ref?: string; shown?: string; name?: string; process?: string };
type UserGames = { games: UserGameView[]; problems: string[] };

const customFile = (a: WiredApp): string =>
  path.join(a.ports.folders.dataRoot(), 'games', 'custom.json');
const starHauler = (a: WiredApp): string =>
  path.join(a.home, 'Games', 'Star Hauler', 'StarHauler.exe');
const settings = (a: WiredApp): string => path.join(a.ports.folders.documents(), 'Star Hauler');

/** Star Hauler added the way the dialog adds it: the program and the folder from the pickers. */
async function addStarHauler(a: WiredApp, kind = 'flight'): Promise<GameSummary> {
  a.ports.dialogs.script.open.push(['Games/Star Hauler/StarHauler.exe'], ['Documents/Star Hauler']);
  const program = await a.invoke<Picked>('games:pickProgram');
  const folder = await a.invoke<Picked>('games:pickFolder', { game: 'Star Hauler' });
  return a.invoke<GameSummary>('games:saveUserGame', {
    name: program.name,
    kind,
    program: program.ref,
    folders: [folder.ref],
    processes: [program.process],
  });
}

async function writeCustom(a: { ports: WiredApp['ports'] }, games: unknown[]): Promise<void> {
  const file = path.join(a.ports.folders.dataRoot(), 'games', 'custom.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, games }, null, 2));
}

function setupFor(game: string, checks: Profile['checks'] = []): Profile {
  return ProfileSchema.parse({
    id: 'star-hauler',
    name: 'Star Hauler',
    game,
    createdAt: '2026-11-12T12:00:00.000Z',
    updatedAt: '2026-11-12T12:00:00.000Z',
    checks,
    launch: { exe: '{USER}/Games/Star Hauler/StarHauler.exe', args: [] },
  });
}

describe('adding a game', () => {
  it('a game added from the native pickers is found, launched, backed up and offered for a setup like a built-in one', async () => {
    app = await wiredApp('generic-custom-game');
    app.ports.dialogs.script.open.push(['Games/Star Hauler/StarHauler.exe']);
    const program = await app.invoke<Picked>('games:pickProgram');
    expect(program).toEqual({
      picked: true,
      ref: 'pick-1',
      shown: starHauler(app),
      name: 'Star Hauler',
      process: 'StarHauler.exe',
    });
    expect(app.ports.dialogs.calls.at(-1)!.options).toMatchObject({
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });
    app.ports.dialogs.script.open.push(['Documents/Star Hauler']);
    const folder = await app.invoke<Picked>('games:pickFolder', { game: 'Star Hauler' });
    expect(folder).toEqual({ picked: true, ref: 'pick-2', shown: settings(app) });
    expect(app.ports.dialogs.calls.at(-1)!.options).toMatchObject({
      title: 'Choose a folder where Star Hauler keeps its settings',
      directory: true,
    });

    const game = await app.invoke<GameSummary>('games:saveUserGame', {
      name: 'Star Hauler',
      kind: 'flight',
      program: program.ref,
      folders: [folder.ref],
      processes: ['StarHauler.exe'],
    });
    const dir = path.dirname(starHauler(app));
    expect(game).toMatchObject({
      id: 'user-star-hauler',
      name: 'Star Hauler',
      kind: 'flight',
      addedByYou: true,
      installs: [
        {
          source: 'standalone',
          installDir: dir,
          launch: { exe: starHauler(app), args: [], cwd: dir },
        },
      ],
      configLocations: [{ id: 'folder-1', label: 'Settings folder', path: settings(app) }],
      trackedFiles: [{ label: 'Star Hauler settings', path: settings(app) }],
      problems: [],
    });
    // Kept with the standard folders, so a copy of the data folder works under another user.
    const stored = JSON.parse(await fs.readFile(customFile(app), 'utf8'));
    expect(stored.games).toEqual([
      {
        id: 'user-star-hauler',
        name: 'Star Hauler',
        kind: 'flight',
        program: '{USER}/Games/Star Hauler/StarHauler.exe',
        settingsFolders: ['{DOCUMENTS}/Star Hauler'],
        processes: ['StarHauler.exe'],
      },
    ]);

    // On the Games page, with the built-in ones.
    const list = await app.invoke<GameSummary[]>('games:list');
    expect(list.find((g) => g.id === 'user-star-hauler')?.installs).toHaveLength(1);
    expect(list.filter((g) => g.addedByYou).map((g) => g.id)).toEqual(['user-star-hauler']);

    // Launch starts the chosen program with an argument list, never a command line.
    const launched = await app.invoke<{ message: string }>('games:launch', {
      gameId: 'user-star-hauler',
    });
    expect(launched.message).toBe('Started Star Hauler.');
    expect(app.ports.processes.started.at(-1)).toEqual({
      exe: starHauler(app),
      args: [],
      cwd: dir,
    });
    expect(
      (await app.invoke<GameSummary>('games:get', { gameId: 'user-star-hauler' })).running
    ).toBe(true);

    // Its settings folder is a path variable of its own, so its setups and backups stay portable.
    const context = app.wiring.context;
    expect(knownPathVariables(context.games)['USER_STAR_HAULER']).toBe(
      'Star Hauler settings folder'
    );
    expect((await allPathVariables(context, context.games))['USER_STAR_HAULER']).toBe(
      settings(app)
    );

    // A new setup offers it, found on this PC.
    const capture = await app.invoke<{
      games: { id: string; installs: unknown[] }[];
      candidates: { key: string }[];
    }>('profiles:capture');
    expect(capture.games.find((g) => g.id === 'user-star-hauler')?.installs).toHaveLength(1);
    // Its own program has no version to read, so no "not updated since verified" is offered.
    expect(context.games.get('user-star-hauler')?.installedVersion).toBeUndefined();
    expect(capture.candidates.map((c) => c.key)).not.toContain('game:user-star-hauler');
    // Backups suggest its folder, for the game.
    const suggestions =
      await app.invoke<{ path: string; game?: string; fileCount: number }[]>('backup:suggestions');
    // Stored with the game's own variable, so the backup means the same folder on another PC.
    expect(suggestions.find((s) => s.game === 'user-star-hauler')).toMatchObject({
      path: '{USER_STAR_HAULER}',
      fileCount: 3,
    });
    // And a restore knows to close it first.
    const holder = context.games.get('user-star-hauler');
    expect(holder?.processes).toEqual(['StarHauler.exe']);
    expect(holder?.closeBeforeRestore?.why).toBe(
      'Star Hauler may write its settings when it exits, which would undo the restore.'
    );
  });

  it('reads the games in custom.json at start and turns each into a game module', async () => {
    app = await wiredApp('generic-custom-game', {
      beforeWiring: (rig) =>
        writeCustom(rig, [
          {
            id: 'user-star-hauler',
            name: 'Star Hauler',
            kind: 'none',
            program: '{USER}/Games/Star Hauler/StarHauler.exe',
            settingsFolders: ['{DOCUMENTS}/Star Hauler'],
            processes: ['StarHauler.exe'],
          },
        ]),
    });
    const list = await app.invoke<GameSummary[]>('games:list');
    const game = list.find((g) => g.id === 'user-star-hauler')!;
    expect(game.installs).toHaveLength(1);
    // "Neither" is a game without a family: no Flight or Racing chip, no gear ticked for one.
    expect(game.kind).toBeUndefined();
    expect(app.wiring.context.games.get('user-star-hauler')?.kind).toBeUndefined();
    const own = await app.invoke<UserGames>('games:userGames');
    expect(own).toEqual({
      games: [
        {
          id: 'user-star-hauler',
          name: 'Star Hauler',
          kind: 'none',
          program: starHauler(app),
          programRef: 'saved-0',
          folders: [{ ref: 'saved-0', path: settings(app) }],
          processes: ['StarHauler.exe'],
          usedBy: [],
          problems: [],
        },
      ],
      problems: [],
    });
  });

  it('a game sold on Steam is found and started through Steam by its app id alone', async () => {
    app = await wiredApp('flying-fresh', {
      files: ['Program Files (x86)/Steam/steamapps/*.acf', 'Program Files (x86)/Steam/*.exe'],
    });
    const game = await app.invoke<GameSummary>('games:saveUserGame', {
      name: 'My Hornet copy',
      kind: 'flight',
      folders: [],
      steamAppId: '223750',
      processes: ['DCS.exe'],
    });
    expect(game.id).toBe('user-my-hornet-copy');
    expect(game.installs[0]).toMatchObject({
      source: 'steam',
      launch: { args: ['-applaunch', '223750'] },
    });
    expect(game.version?.version).toMatch(/^Build /);
    expect(app.wiring.context.games.get(game.id)?.pathVariableLabels).toBeUndefined();
  });

  it('ids start with user-, never take another game’s, and names are not doubled', async () => {
    app = await wiredApp('generic-custom-game');
    expect((await addStarHauler(app)).id).toBe('user-star-hauler');
    app.ports.dialogs.script.open.push(['Games/Star Hauler/StarHauler.exe']);
    const again = await app.invoke<Picked>('games:pickProgram');
    // The same name twice would be two games nobody can tell apart.
    await expect(
      app.invoke('games:saveUserGame', {
        name: 'star hauler',
        kind: 'flight',
        program: again.ref,
        folders: [],
        processes: [],
      })
    ).rejects.toThrow('games.custom.name RigReady already knows a game called Star Hauler.');
    await expect(
      app.invoke('games:saveUserGame', {
        name: 'iRacing',
        kind: 'racing',
        program: again.ref,
        folders: [],
        processes: [],
      })
    ).rejects.toThrow('RigReady already knows a game called iRacing.');
    // Another name with the same letters gets an id of its own; the program is its name.
    const second = await app.invoke<GameSummary>('games:saveUserGame', {
      name: 'Star-Hauler!',
      kind: 'flight',
      program: again.ref,
      folders: [],
      processes: [],
    });
    expect(second.id).toBe('user-star-hauler-2');
    expect(app.wiring.context.games.get(second.id)?.processes).toEqual(['StarHauler.exe']);
    // A game RigReady ships can never be replaced or removed as one of the user's.
    expect(() => app!.wiring.context.games.unregister('iracing')).toThrow();
    await expect(app.invoke('games:removeUserGame', { gameId: 'iracing' })).rejects.toThrow();
  });

  it('names a game after its folder, past the folders that say nothing', () => {
    expect(nameFromProgram('D:\\Games\\Star Hauler\\StarHauler.exe')).toBe('Star Hauler');
    expect(nameFromProgram('D:\\Games\\Rally Pro\\bin\\x64\\RallyPro.exe')).toBe('Rally Pro');
    expect(nameFromProgram('D:\\Win64\\Racer.exe')).toBe('Racer');
    expect(nameFromProgram('D:\\Racer.exe')).toBe('Racer');
  });

  it('the palette command “Add a game” opens the Games page with the dialog, and adds nothing itself', async () => {
    const went: string[] = [];
    const shell: CommandShell = {
      client: () => {
        throw new Error('the command calls no channel');
      },
      go: async (to) => {
        went.push(to);
      },
      route: () => '/fly',
      machineChanged: () => {},
      progress: () => {},
    };
    const add = gameCommands.commands?.find((c) => c.id === 'games.add');
    expect(add).toMatchObject({ title: 'Add a game', icon: 'mdi-plus' });
    expect(add?.to).toBeUndefined();
    expect(await add!.run!(shell)).toBeUndefined();
    expect(went).toEqual([ADD_GAME_ROUTE]);
    expect(ADD_GAME_ROUTE).toBe('/configure/games?add=1');
  });

  it('a setup for a game taken out of custom.json by hand is shown as “Another game”, never by its id', async () => {
    app = await wiredApp('generic-custom-game', { beforeWiring: (rig) => writeCustom(rig, []) });
    await app.invoke('games:list');
    expect(app.wiring.context.games.get('user-star-hauler')).toBeUndefined();
    await app.wiring.context.profiles.save(setupFor('user-star-hauler'));
    const state = await app.invoke<{ profiles: { id: string; gameName?: string }[] }>('fly:state');
    expect(state.profiles.find((p) => p.id === 'star-hauler')?.gameName).toBe('Another game');
    const overview = await app.invoke<{
      profiles: { profile: { id: string }; gameName?: string }[];
    }>('profiles:overview');
    expect(overview.profiles.find((p) => p.profile.id === 'star-hauler')?.gameName).toBe(
      'Another game'
    );
    // The setup itself is left as it is: adding the game again under its name brings it back.
    const setup = await app.wiring.context.profiles.get('star-hauler');
    expect(setup.ok && setup.value.game).toBe('user-star-hauler');
    await addStarHauler(app);
    const back = await app.invoke<{ profiles: { id: string; gameName?: string }[] }>('fly:state');
    expect(back.profiles.find((p) => p.id === 'star-hauler')?.gameName).toBe('Star Hauler');
  });
});

describe('the program and the program names (GAME-ADD-004)', () => {
  it('takes the program only from the file picker, refuses Windows and RigReady, and never a path from the window', async () => {
    app = await wiredApp('generic-custom-game');
    const draft = (program: string | undefined, processes: string[] = []) => ({
      name: 'Star Hauler',
      kind: 'flight',
      ...(program ? { program } : {}),
      folders: [],
      processes,
    });
    // A path is not a ref: the schema itself refuses it.
    await expect(app.invoke('games:saveUserGame', draft(starHauler(app)))).rejects.toThrow(
      'ipc.input'
    );
    // A ref that was never picked.
    await expect(app.invoke('games:saveUserGame', draft('pick-77'))).rejects.toThrow(
      'games.custom.pick'
    );
    // A folder pick is not a program.
    app.ports.dialogs.script.open.push(['Documents/Star Hauler']);
    const folder = await app.invoke<Picked>('games:pickFolder', {});
    await expect(app.invoke('games:saveUserGame', draft(folder.ref))).rejects.toThrow(
      'games.custom.pick'
    );
    // Neither a program nor a Steam id: nothing to find or start.
    await expect(app.invoke('games:saveUserGame', draft(undefined))).rejects.toThrow(
      'Choose the program that starts the game, or give its Steam app id.'
    );
    // Picked, but part of Windows or RigReady itself.
    app.ports.dialogs.script.open.push(['C:\\Windows\\System32\\cmd.exe']);
    await expect(app.invoke('games:pickProgram')).rejects.toThrow('it is part of Windows');
    app.ports.dialogs.script.open.push(['AppData/Local/Programs/RigReady/RigReady.exe']);
    await expect(app.invoke('games:pickProgram')).rejects.toThrow('it is RigReady itself');
    app.ports.dialogs.script.open.push([]);
    expect(await app.invoke<Picked>('games:pickProgram')).toEqual({ picked: false });

    app.ports.dialogs.script.open.push(['Games/Star Hauler/StarHauler.exe']);
    const program = await app.invoke<Picked>('games:pickProgram');
    for (const [name, why] of [
      ['explorer.exe', 'RigReady will not treat explorer.exe as the game: it is part of Windows.'],
      ['RigReady.exe', 'RigReady will not treat RigReady.exe as the game: it is RigReady itself.'],
      // Steam runs every Steam game: a Steam game is named by its app id instead.
      [
        'steam.exe',
        'RigReady will not treat steam.exe as the game: it is Steam, which runs every Steam game. For a Steam game, give its Steam app id.',
      ],
      ['C:\\Games\\x.exe', 'is not the name of a program file'],
      ['notes.txt', 'is not the name of a program file'],
    ] as const) {
      await expect(
        app.invoke('games:saveUserGame', draft(program.ref, ['StarHauler.exe', name]))
      ).rejects.toThrow(why);
    }
    expect(await fs.readFile(customFile(app), 'utf8').catch(() => 'none')).toBe('none');
  });

  it('a hand-edited file cannot make RigReady start or close Windows’ programs or RigReady', async () => {
    app = await wiredApp('generic-custom-game', {
      beforeWiring: (rig) =>
        writeCustom(rig, [
          {
            id: 'user-star-hauler',
            name: 'Star Hauler',
            kind: 'flight',
            program: 'C:\\Windows\\System32\\cmd.exe',
            settingsFolders: [],
            steamAppId: '9999999',
            processes: [
              'explorer.exe',
              'RigReady.exe',
              'svchost.exe',
              '..\\x.exe',
              'StarHauler.exe',
            ],
          },
        ]),
    });
    await app.invoke('games:list');
    const module = app.wiring.context.games.get('user-star-hauler')!;
    expect(module.processes).toEqual(['StarHauler.exe']);
    const detected = await module.detect(app.ctx);
    expect(detected.ok && detected.value).toEqual([]);
    const own = await app.invoke<UserGames>('games:userGames');
    expect(own.games[0]!.program).toBeUndefined();
    expect(own.games[0]!.problems).toEqual([
      'The program C:\\Windows\\System32\\cmd.exe is not used: it is part of Windows.',
      'The program name explorer.exe is not used: it is part of Windows.',
      'The program name RigReady.exe is not used: it is RigReady itself.',
      'The program name svchost.exe is not used: it is part of Windows.',
      'The program name ..\\x.exe is not used: it is not the name of a program file.',
    ]);
    // Shown on the game's page too.
    const game = await app.invoke<GameSummary>('games:get', { gameId: 'user-star-hauler' });
    expect(game.problems).toContain(
      'The program name explorer.exe is not used: it is part of Windows.'
    );
  });
});

describe('the settings folders (GAME-ADD-003)', () => {
  it('refuses a drive, Windows, Program Files, the user folder and RigReady’s own folder in the picker', async () => {
    app = await wiredApp('generic-custom-game');
    const refused: [string, string][] = [
      ['C:\\', 'it is a whole drive'],
      ['C:\\Windows', 'it is part of Windows'],
      ['Program Files', 'it holds every installed program'],
      ['', 'it holds your whole user folder'],
      ['.rigready', "it is RigReady's own folder"],
      ['Documents', 'it holds the files of many programs'],
    ];
    for (const [answer, why] of refused) {
      app.ports.dialogs.script.open.push([answer === '' ? app.home : answer]);
      await expect(app.invoke('games:pickFolder', { game: 'Star Hauler' })).rejects.toThrow(why);
    }
    // Nothing refused was kept: the next pick is the first one handed out.
    app.ports.dialogs.script.open.push(['Documents/Star Hauler']);
    expect((await app.invoke<Picked>('games:pickFolder', {})).ref).toBe('pick-1');
  });

  it('a hand-edited file cannot open a whole drive or the user folder to backups and restores', async () => {
    app = await wiredApp('generic-custom-game', {
      beforeWiring: (rig) =>
        writeCustom(rig, [
          {
            id: 'user-star-hauler',
            name: 'Star Hauler',
            program: '{USER}/Games/Star Hauler/StarHauler.exe',
            settingsFolders: ['C:\\', '{USER}', '{PROGRAM_FILES}', '{DOCUMENTS}/Star Hauler'],
            processes: ['StarHauler.exe'],
          },
          { id: 'star-hauler-2', name: 'No prefix', settingsFolders: ['C:\\'] },
          'not a game',
        ]),
    });
    const game = await app.invoke<GameSummary>('games:get', { gameId: 'user-star-hauler' });
    expect(game.configLocations.map((l) => l.path)).toEqual([settings(app)]);
    expect(game.trackedFiles.map((l) => l.path)).toEqual([settings(app)]);
    expect(game.problems).toEqual([
      'The settings folder C:\\ is not used: it is a whole drive.',
      'The settings folder {USER} is not used: it holds your whole user folder.',
      'The settings folder {PROGRAM_FILES} is not used: it holds every installed program.',
    ]);
    const own = await app.invoke<UserGames>('games:userGames');
    expect(own.problems).toEqual([
      'A game "No prefix" in custom.json was left out: it is not a game RigReady can read.',
      'A game in custom.json was left out: it is not a game RigReady can read.',
    ]);
    expect(app.wiring.context.games.get('star-hauler-2')).toBeUndefined();
    // The program next to the settings is in the user folder, outside what RigReady may use.
    const outside = await app
      .invoke('backup:previewItem', {
        label: 'Program',
        path: starHauler(app),
        kind: 'file',
        include: [],
        exclude: [],
      })
      .catch((e: Error) => e.message);
    expect(outside).toContain('path.outside');
    // The game's own folder may be tracked: the game vouches for it.
    const inside = await app.invoke<{ fileCount: number }>('backup:previewItem', {
      label: 'Settings',
      path: '{USER_STAR_HAULER}',
      kind: 'folder',
      include: [],
      exclude: [],
    });
    expect(inside.fileCount).toBe(3);
    // The hand-edited entries are kept as they are when the user saves a change.
    await app.invoke('games:saveUserGame', {
      gameId: 'user-star-hauler',
      name: 'Star Hauler',
      kind: 'flight',
      program: 'saved-0',
      folders: ['saved-0'],
      processes: ['StarHauler.exe'],
    });
    const stored = JSON.parse(await fs.readFile(customFile(app), 'utf8'));
    expect(stored.games.slice(1)).toEqual([
      { id: 'star-hauler-2', name: 'No prefix', settingsFolders: ['C:\\'] },
      'not a game',
    ]);
  });

  it('backup does not let any game’s folder that is too broad vouch for a path (the code that decides)', async () => {
    app = await wiredApp('generic-custom-game');
    const games = app.wiring.context.games;
    const home = app.home;
    // A module that names the whole user folder, as a game file edited past every check would.
    games.register({
      id: 'user-rogue',
      name: 'Rogue',
      detect: async () => ok([]),
      configLocations: async () => ok([{ id: 'all', label: 'All', path: home }]),
      trackedFiles: async () => ok([{ label: 'Everything', path: home, kind: 'folder' }]),
      pathVariableLabels: { USER_ROGUE: 'Rogue settings folder' },
      pathVariables: async () => ok({ USER_ROGUE: home }),
    });
    const preview = (p: string) =>
      app!
        .invoke<{ fileCount: number }>('backup:previewItem', {
          label: 'x',
          path: p,
          kind: 'file',
          include: [],
          exclude: [],
        })
        .then(
          () => 'accepted',
          (e: Error) => e.message
        );
    expect(await preview(starHauler(app))).toContain('path.outside');
    expect(await preview('{USER_ROGUE}/Games/Star Hauler/StarHauler.exe')).toContain(
      'path.outside'
    );
    // The same game naming its own folder vouches for what is in it.
    games.unregister('user-rogue');
    const own = path.dirname(starHauler(app));
    games.register({
      id: 'user-rogue',
      name: 'Rogue',
      detect: async () => ok([]),
      configLocations: async () => ok([{ id: 'own', label: 'Own', path: own }]),
      pathVariableLabels: { USER_ROGUE: 'Rogue settings folder' },
      pathVariables: async () => ok({ USER_ROGUE: own }),
    });
    expect(await preview(starHauler(app))).toBe('accepted');
  });
});

describe('editing and removing a game (GAME-ADD-002)', () => {
  it('a removed game’s setups keep working as “Another game”, and the page said which they were', async () => {
    app = await wiredApp('generic-custom-game');
    await addStarHauler(app);
    const check = {
      id: 'settings',
      type: 'file.exists',
      title: 'Star Hauler settings',
      required: true,
      params: { path: '{USER_STAR_HAULER}/settings.ini' },
    };
    const saved = await app.wiring.context.profiles.save(
      setupFor('user-star-hauler', [CheckItemSchema.parse(check)])
    );
    expect(saved.ok).toBe(true);
    const own = await app.invoke<UserGames>('games:userGames');
    expect(own.games[0]!.usedBy).toEqual(['Star Hauler']);
    const before = await app.invoke<{ results: { itemId: string; status: string }[] }>(
      'fly:check',
      {
        profileId: 'star-hauler',
      }
    );
    expect(before.results.find((i) => i.itemId === 'settings')?.status).toBe('pass');

    // Edited: a new name and kind, the same program and folder, the same id.
    const edited = await app.invoke<GameSummary>('games:saveUserGame', {
      gameId: 'user-star-hauler',
      name: 'Star Hauler Deluxe',
      kind: 'racing',
      program: 'saved-0',
      folders: ['saved-0'],
      processes: ['StarHauler.exe', 'StarHaulerLauncher.exe'],
    });
    expect(edited).toMatchObject({
      id: 'user-star-hauler',
      name: 'Star Hauler Deluxe',
      kind: 'racing',
    });
    expect(app.wiring.context.games.get('user-star-hauler')?.processes).toEqual([
      'StarHauler.exe',
      'StarHaulerLauncher.exe',
    ]);
    const state = await app.invoke<{
      profiles: { id: string; gameName?: string; kind?: string }[];
    }>('fly:state');
    expect(state.profiles.find((p) => p.id === 'star-hauler')).toMatchObject({
      gameName: 'Star Hauler Deluxe',
      kind: 'racing',
    });

    const removed = await app.invoke<{ name: string; setups: string[] }>('games:removeUserGame', {
      gameId: 'user-star-hauler',
    });
    expect(removed).toEqual({ name: 'Star Hauler Deluxe', setups: ['Star Hauler'] });
    expect(app.wiring.context.games.get('user-star-hauler')).toBeUndefined();
    expect((await app.invoke<GameSummary[]>('games:list')).some((g) => g.addedByYou)).toBe(false);
    expect(JSON.parse(await fs.readFile(customFile(app), 'utf8')).games).toEqual([]);

    const setup = await app.wiring.context.profiles.get('star-hauler');
    if (!setup.ok) throw new Error(setup.error.message);
    expect(setup.value).toMatchObject({ game: 'other', gameName: 'Star Hauler Deluxe' });
    // The folder the variable meant is written out, so the check still looks there.
    expect(setup.value.checks[0]!.params['path']).toBe('{DOCUMENTS}/Star Hauler/settings.ini');
    const after = await app.invoke<{ results: { itemId: string; status: string }[] }>('fly:check', {
      profileId: 'star-hauler',
    });
    expect(after.results.find((i) => i.itemId === 'settings')?.status).toBe('pass');
    const shown = await app.invoke<{ profiles: { id: string; gameName?: string }[] }>('fly:state');
    expect(shown.profiles.find((p) => p.id === 'star-hauler')?.gameName).toBe('Star Hauler Deluxe');
  });

  it('says it did not save or remove when the file does not hold the change afterwards', async () => {
    app = await wiredApp('generic-custom-game');
    app.ports.dialogs.script.open.push(['Games/Star Hauler/StarHauler.exe']);
    const program = await app.invoke<Picked>('games:pickProgram');
    const broken = sabotage(app.ports);
    try {
      await expect(
        app.invoke('games:saveUserGame', {
          name: 'Star Hauler',
          kind: 'flight',
          program: program.ref,
          folders: [],
          processes: [],
        })
      ).rejects.toThrow('games.custom.notSaved');
    } finally {
      broken.restore();
    }
    expect(app.wiring.context.games.get('user-star-hauler')).toBeUndefined();
    await addStarHauler(app);
    await app.wiring.context.profiles.save(setupFor('user-star-hauler'));
    const again = sabotage(app.ports);
    try {
      await expect(
        app.invoke('games:removeUserGame', { gameId: 'user-star-hauler' })
      ).rejects.toThrow('games.custom.setup');
    } finally {
      again.restore();
    }
    expect(app.wiring.context.games.get('user-star-hauler')).toBeDefined();
  });
});

describe('a shared setup for a game this PC does not have (GAME-ADD-005)', () => {
  it('comes in as “Another game” with that game’s name, and the import says so', async () => {
    app = await wiredApp('generic-custom-game');
    await addStarHauler(app);
    await app.wiring.context.profiles.save(setupFor('user-star-hauler'));
    app.ports.dialogs.script.save.push('Documents/star-hauler.rigready');
    const exported = await app.invoke<{ path: string }>('sharing:export', {
      profileId: 'star-hauler',
      includeItems: [],
      decisions: {},
      notes: '',
      reviewed: true,
    });

    friend = await wiredApp('generic-fresh', { files: [] });
    const downloads = path.join(friend.home, 'Downloads');
    await fs.mkdir(downloads, { recursive: true });
    await fs.copyFile(exported.path, path.join(downloads, 'star-hauler.rigready'));
    friend.ports.dialogs.script.open.push(['Downloads/star-hauler.rigready']);
    const report = await friend.invoke<{
      importId: string;
      compatibility: {
        software: { name: string; kind: string; found: boolean; detail?: string }[];
      };
      parts: { id: string; detail: string }[];
    }>('sharing:openImport');
    expect(report.compatibility.software.find((s) => s.kind === 'game')).toMatchObject({
      name: 'Star Hauler',
      found: false,
      detail: 'Added by hand on the other PC: the setup comes in for “Another game”',
    });
    expect(report.parts.find((p) => p.id === 'profile')?.detail).toContain(
      'for “Another game” called Star Hauler, a game added by hand on the other PC'
    );
    const result = await friend.invoke<{ profileId?: string }>('sharing:import', {
      importId: report.importId,
      parts: ['profile'],
    });
    const imported = await friend.wiring.context.profiles.get(result.profileId!);
    if (!imported.ok) throw new Error(imported.error.message);
    expect(imported.value).toMatchObject({ game: 'other', gameName: 'Star Hauler' });
    expect(imported.value.gameInstall).toBeUndefined();
  });

  it('keeps the game when this PC has a game of the same name added', async () => {
    app = await wiredApp('generic-custom-game');
    await addStarHauler(app);
    await app.wiring.context.profiles.save(setupFor('user-star-hauler'));
    app.ports.dialogs.script.save.push('Documents/star-hauler.rigready');
    const exported = await app.invoke<{ path: string }>('sharing:export', {
      profileId: 'star-hauler',
      includeItems: [],
      decisions: {},
      notes: '',
      reviewed: true,
    });
    friend = await wiredApp('generic-custom-game');
    await addStarHauler(friend);
    await fs.copyFile(exported.path, path.join(friend.home, 'Documents', 'star-hauler.rigready'));
    friend.ports.dialogs.script.open.push(['Documents/star-hauler.rigready']);
    const report = await friend.invoke<{ importId: string }>('sharing:openImport');
    const result = await friend.invoke<{ profileId?: string }>('sharing:import', {
      importId: report.importId,
      parts: ['profile'],
    });
    const imported = await friend.wiring.context.profiles.get(result.profileId!);
    expect(imported.ok && imported.value.game).toBe('user-star-hauler');
  });
});
