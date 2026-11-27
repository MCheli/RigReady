import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { GameSummary } from '../contract';

/**
 * The Nuclear Option game module on fixtures/scenarios/games-nuclear-option.yaml (a generic
 * PC with the game in Steam). Sources for the id and paths: docs/research/nuclear-option.md.
 */
describe('Nuclear Option game module', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  const get = (a: WiredApp): Promise<GameSummary> =>
    a.invoke<GameSummary>('games:get', { gameId: 'nuclear-option' });
  const steam = (a: WiredApp): string => path.join(a.home, 'Program Files (x86)', 'Steam');

  it('is found in Steam as a flight game, with its build and its data folder', async () => {
    app = await wiredApp('games-nuclear-option');
    const game = await get(app);
    expect(game).toMatchObject({ name: 'Nuclear Option', kind: 'flight', problems: [] });
    expect(game.installs).toEqual([
      {
        source: 'steam',
        installDir: path.join(steam(app), 'steamapps', 'common', 'Nuclear Option'),
        launch: { exe: path.join(steam(app), 'steam.exe'), args: ['-applaunch', '2168680'] },
      },
    ]);
    expect(game.version?.version).toBe('Build 20000021');
    expect(game.configLocations.map((l) => l.path)).toEqual([
      path.join(app.home, 'AppData', 'LocalLow', 'Shockfront', 'NuclearOption'),
    ]);
  });

  it('offers no file for backup and says why: the settings are in the registry', async () => {
    app = await wiredApp('games-nuclear-option');
    const game = await get(app);
    expect(game.trackedFiles).toEqual([]);
    expect(game.noFiles).toBe(
      'Nothing: Nuclear Option has no settings file. Its settings are in the registry.'
    );
    expect(game.notes.join(' ')).toContain('in the Windows registry, not in files');
  });

  it('the game-updated warning offers no backup, because there is nothing to back up, and says why', async () => {
    app = await wiredApp('games-nuclear-option');
    const backup = app.wiring.context.checks.remediation('backup.gameFiles')!;
    expect(await backup.available!({ game: 'nuclear-option' }, app.ctx)).toEqual({
      ok: false,
      reason: 'Nothing to back up: no settings files of Nuclear Option were found on this PC.',
    });
    // A game with a settings file on this PC is still offered its backup.
    await app.cleanup();
    app = await wiredApp('generic-more-sims');
    expect(
      await app.wiring.context.checks.remediation('backup.gameFiles')!.available!(
        { game: 'ams2' },
        app.ctx
      )
    ).toEqual({ ok: true });
  });

  it('is launched through Steam with its own app id', async () => {
    app = await wiredApp('games-nuclear-option');
    expect(await app.invoke('games:launch', { gameId: 'nuclear-option' })).toEqual({
      message: 'Asked Steam to start Nuclear Option.',
    });
    expect(app.ports.processes.started.at(-1)).toMatchObject({ args: ['-applaunch', '2168680'] });
  });

  it('counts as running by NuclearOption.exe', async () => {
    app = await wiredApp('games-nuclear-option');
    expect((await get(app)).running).toBe(false);
    await mutate(app, [
      { op: 'startProcess', name: 'NuclearOption.exe', path: 'C:/Games/NuclearOption.exe' },
    ]);
    expect((await get(app)).running).toBe(true);
  });

  it('is not found without its program, and a folder chosen by hand must hold it', async () => {
    app = await wiredApp('generic-more-sims');
    const game = await get(app);
    expect(game).toMatchObject({ installs: [], problems: [], kind: 'flight' });
    expect(game.manualFolder?.label).toContain('NuclearOption.exe');

    const chosen = path.join(app.home, 'Games', 'Nuclear Option');
    await fs.mkdir(chosen, { recursive: true });
    app.ports.dialogs.script.open.push([chosen]);
    await expect(app.invoke('games:chooseFolder', { gameId: 'nuclear-option' })).rejects.toThrow(
      'does not contain NuclearOption.exe'
    );
    await fs.writeFile(path.join(chosen, 'NuclearOption.exe'), '');
    app.ports.dialogs.script.open.push([chosen]);
    const picked = await app.invoke<{ chosen: boolean; game: GameSummary }>('games:chooseFolder', {
      gameId: 'nuclear-option',
    });
    expect(picked.game.installs[0]).toMatchObject({ source: 'standalone', installDir: chosen });
  });
});
