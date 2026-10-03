import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runChecks } from '../../src/core/checks/engine';
import { CheckRegistry } from '../../src/core/checks/registry';
import { GameRegistry, type GameModule } from '../../src/core/games';
import { JsonStore } from '../../src/core/jsonStore';
import {
  allPathVariables,
  collapsePath,
  expandPath,
  standardPathVariables,
  variableOf,
} from '../../src/core/pathVariables';
import {
  ProfileSchema,
  profileExtension,
  withProfileExtension,
  type Profile,
} from '../../src/core/profile/schema';
import { err, ok } from '../../src/core/result';
import dcs from '../../src/features/games/dcs/module';
import { markFull, rigFromState, scenarioRig, type TestRig } from '../helpers';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

describe('path variables', () => {
  it('expand to folders under the (fake) user profile and collapse back to the longest match', async () => {
    rig = await scenarioRig('desk-mfds-wrong', {
      files: ['Saved Games/DCS/Config/options.lua', 'Program Files (x86)/Steam/**'],
    });
    const games = new GameRegistry();
    games.register(dcs);
    const variables = await allPathVariables(rig.ctx, games);
    const { folders } = rig.ports;
    expect(variables).toMatchObject({
      USER: rig.home,
      DOCUMENTS: folders.documents(),
      SAVED_GAMES: folders.savedGames(),
      APPDATA: folders.appData(),
      LOCALAPPDATA: folders.localAppData(),
      RIGREADY_HOME: folders.dataRoot(),
      STEAM: path.join(rig.home, 'Program Files (x86)', 'Steam'),
      DCS_USER: path.join(folders.savedGames(), 'DCS'),
      DCS_INSTALL: path.join(
        rig.home,
        'Program Files (x86)',
        'Steam',
        'steamapps',
        'common',
        'DCSWorld'
      ),
    });

    const options = path.join(folders.savedGames(), 'DCS', 'Config', 'options.lua');
    // The game's own variable wins over {SAVED_GAMES} and {USER}: it is the longest match.
    expect(collapsePath(options, variables)).toBe('{DCS_USER}/Config/options.lua');
    expect(collapsePath(path.join(folders.savedGames(), 'Other', 'a.txt'), variables)).toBe(
      '{SAVED_GAMES}/Other/a.txt'
    );
    expect(collapsePath(folders.documents().toUpperCase(), variables)).toBe('{DOCUMENTS}');
    expect(collapsePath('Q:\\Elsewhere\\file.txt', variables)).toBe('Q:\\Elsewhere\\file.txt');

    expect(expandPath('{DCS_USER}/Config/options.lua', variables)).toEqual({
      ok: true,
      value: options,
    });
    expect(expandPath('{DCS_USER}\\Config\\options.lua', variables)).toEqual({
      ok: true,
      value: options,
    });
    expect(expandPath('{DOCUMENTS}', variables)).toEqual({ ok: true, value: folders.documents() });
    expect(expandPath(options, variables)).toEqual({ ok: true, value: options });
    expect(variableOf('{DCS_USER}/Config')).toBe('DCS_USER');
    expect(variableOf('C:\\x')).toBeUndefined();

    expect(expandPath('{IRACING_USER}/controls.cfg', variables)).toEqual({
      ok: false,
      error: {
        code: 'path.variable',
        message: 'Unknown path variable {IRACING_USER}.',
        detail: 'IRACING_USER',
      },
    });
    expect(expandPath('{USER}/../../Windows/win.ini', variables)).toMatchObject({
      ok: false,
      error: { code: 'path.outside' },
    });
    expect(expandPath('C:\\a\\{USER}\\b', variables)).toMatchObject({
      ok: false,
      error: { code: 'path.variable' },
    });
    expect(expandPath('relative/file.txt', variables)).toMatchObject({
      ok: false,
      error: { code: 'path.relative' },
    });
  });

  it('has no {STEAM} without Steam, and a failing game module adds nothing', async () => {
    rig = await rigFromState(await markFull());
    rig.ports.folders.steamLibraries = async () => ok([]);
    expect('STEAM' in (await standardPathVariables(rig.ports))).toBe(false);
    const games = new GameRegistry();
    const broken: GameModule = {
      id: 'broken',
      name: 'Broken',
      detect: async () => ok([]),
      configLocations: async () => ok([]),
      pathVariables: async () => {
        throw new Error('boom');
      },
    };
    const failing: GameModule = {
      ...broken,
      id: 'failing',
      pathVariables: async () => err('x', 'no'),
    };
    const plain: GameModule = {
      id: 'plain',
      name: 'Plain',
      detect: broken.detect,
      configLocations: broken.configLocations,
    };
    games.register(broken);
    games.register(failing);
    games.register(plain);
    const variables = await allPathVariables(rig.ctx, games);
    expect(Object.keys(variables).sort()).toEqual(
      Object.keys(await standardPathVariables(rig.ports)).sort()
    );
  });
});

describe('JsonStore', () => {
  const Schema = z.object({ names: z.record(z.string(), z.string()).default({}) });

  it('gives defaults for a missing file, round-trips data, and reports a damaged file', async () => {
    rig = await rigFromState(await markFull());
    const file = path.join(rig.ports.folders.dataRoot(), 'devices', 'names.json');
    const store = new JsonStore(rig.ports.files, file, Schema);
    expect(await store.read()).toEqual({ ok: true, value: { names: {} } });
    expect(await rig.ports.files.exists(file)).toBe(false);

    const updated = await store.update((v) => ({ names: { ...v.names, 'USB\\X': 'Left MFD' } }));
    expect(updated).toEqual({ ok: true, value: { names: { 'USB\\X': 'Left MFD' } } });
    expect(await new JsonStore(rig.ports.files, file, Schema).read()).toEqual(updated);
    expect(await store.write({ names: { a: 1 } } as never)).toMatchObject({
      ok: false,
      error: { code: 'store.invalid' },
    });

    for (const broken of ['{ nope', '{"names": 5}']) {
      await fs.writeFile(file, broken);
      expect(await store.read()).toMatchObject({ ok: false, error: { code: 'store.invalid' } });
      expect(await store.update((v) => v)).toMatchObject({ ok: false });
      // Never silently replaced.
      expect(await fs.readFile(file, 'utf8')).toBe(broken);
    }
    const strict = new JsonStore(
      rig.ports.files,
      path.join(rig.home, 'none.json'),
      z.object({ id: z.string() })
    );
    expect(await strict.read()).toMatchObject({ ok: false, error: { code: 'store.invalid' } });
    const withDefault = new JsonStore(
      rig.ports.files,
      path.join(rig.home, 'none.json'),
      z.object({ id: z.string() }),
      {
        id: 'x',
      }
    );
    expect(await withDefault.read()).toEqual({ ok: true, value: { id: 'x' } });
  });
});

describe('profile extensions', () => {
  const base: Profile = {
    schemaVersion: 1,
    id: 'p',
    name: 'P',
    createdAt: '',
    updatedAt: '',
    checks: [],
    extensions: {},
  };
  const Backup = z.object({ tracked: z.array(z.string()).default([]) });

  it('let a feature keep validated data inside a profile without changing the profile schema', async () => {
    expect(profileExtension(base, 'backup', Backup)).toEqual({ tracked: [] });
    const next = withProfileExtension(base, 'backup', { tracked: ['{DCS_USER}/Config/Input'] });
    expect(profileExtension(next, 'backup', Backup)).toEqual({
      tracked: ['{DCS_USER}/Config/Input'],
    });
    expect(base.extensions).toEqual({});
    expect(
      profileExtension(withProfileExtension(base, 'backup', { tracked: 'no' }), 'backup', Backup)
    ).toBeUndefined();
    // Old profile files without the field still load, and the field survives a round trip.
    const { extensions: _dropped, ...old } = base;
    expect(ProfileSchema.parse(old).extensions).toEqual({});
    expect(ProfileSchema.parse(next).extensions).toEqual(next.extensions);

    rig = await rigFromState(await markFull());
    const saved = await rig.ctx.ports.files.write(
      path.join(rig.ports.folders.dataRoot(), 'x.json'),
      JSON.stringify(next),
      { reason: 't' }
    );
    expect(saved.ok).toBe(true);
  });
});

describe('check timeout', () => {
  it('reports a check that takes too long as not met, and leaves the others alone', async () => {
    rig = await rigFromState(await markFull());
    const registry = new CheckRegistry();
    let release: (() => void) | undefined;
    registry.registerCheck({
      type: 'test.slow',
      group: 'other',
      label: 'Slow',
      params: z.object({}),
      run: () =>
        new Promise((resolve) => {
          release = () => resolve({ pass: true, summary: 'done' });
        }),
    });
    registry.registerCheck({
      type: 'test.fast',
      group: 'other',
      label: 'Fast',
      params: z.object({}),
      run: async () => ({ pass: true, summary: 'fine' }),
    });
    const profile: Profile = {
      schemaVersion: 1,
      id: 'p',
      name: 'P',
      createdAt: '',
      updatedAt: '',
      extensions: {},
      checks: [
        { id: 'a', type: 'test.slow', title: 'Slow one', required: true, params: {} },
        { id: 'b', type: 'test.slow', title: 'Slow optional', required: false, params: {} },
        { id: 'c', type: 'test.fast', title: 'Fast one', required: true, params: {} },
      ],
    };
    const report = await runChecks(profile, registry, rig.ctx, { timeoutMs: 50 });
    expect(report.results.map((r) => [r.title, r.status, r.summary])).toEqual([
      ['Slow one', 'error', 'Timed out after 0.1 s'],
      ['Slow optional', 'error', 'Timed out after 0.1 s'],
      ['Fast one', 'pass', 'fine'],
    ]);
    expect(report.ready).toBe(false);
    release?.();
    // Without a limit the same check is simply awaited.
    const pending = runChecks({ ...profile, checks: [profile.checks[0]!] }, registry, rig.ctx);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release?.();
    expect((await pending).results[0]).toMatchObject({ status: 'pass', summary: 'done' });
  });
});

describe('move and overlays', () => {
  it('move renames a file as one undoable action', async () => {
    rig = await rigFromState(await markFull());
    const dir = path.join(rig.ports.folders.savedGames(), 'DCS', 'Config', 'Input', 'joystick');
    const from = path.join(dir, 'Stick {OLD-GUID}.diff.lua');
    const to = path.join(dir, 'Stick {NEW-GUID}.diff.lua');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(from, 'bindings');
    const { files } = rig.ports;
    const moved = await files.move(from, to, { reason: 'Migrate device id' });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(await files.exists(from)).toBe(false);
    expect(await fs.readFile(to, 'utf8')).toBe('bindings');
    const groups = await files.journalGroups();
    expect(
      groups.ok && groups.value.map((g) => [g.reason, g.entries.map((e) => e.action)])
    ).toEqual([['Migrate device id', ['write', 'remove']]]);
    expect((await files.undoGroup(moved.value.id)).ok).toBe(true);
    expect(await fs.readFile(from, 'utf8')).toBe('bindings');
    expect(await files.exists(to)).toBe(false);

    // Moving onto itself (only the case differs) changes nothing; a missing source is an error.
    const same = await files.move(from, from.toUpperCase(), { reason: 'noop' });
    expect(same.ok).toBe(true);
    expect(await fs.readFile(from, 'utf8')).toBe('bindings');
    expect(await files.move(path.join(dir, 'missing.lua'), to, { reason: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'file.read' },
    });
    const group = files.beginGroup('Two moves');
    expect(await files.move(from, to, { reason: 'x', group })).toEqual({ ok: true, value: group });
  });

  it('the fake overlay records the labels it was asked to show', async () => {
    rig = await rigFromState(await markFull());
    const labels = [{ x: 0, y: 0, width: 2560, height: 1440, text: '1', caption: 'DELL G3223D' }];
    expect(await rig.ports.overlays.showLabels(labels, 5000)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(rig.ports.overlays.shown).toEqual([{ labels, durationMs: 5000 }]);
  });
});
