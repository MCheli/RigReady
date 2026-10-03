import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import dcs from './module';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

async function put(file: string, content = ''): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

const steamRoot = (home: string): string => path.join(home, 'Program Files (x86)', 'Steam');

describe('DCS game module', () => {
  it('finds the Steam edition, launches it through Steam and writes to Saved Games\\DCS', async () => {
    rig = await scenarioRig('flying-fresh', {
      files: ['Program Files (x86)/Steam/**', 'Saved Games/DCS/Config/options.lua'],
    });
    const installs = await dcs.detect(rig.ctx);
    expect(installs.ok && installs.value).toEqual([
      {
        source: 'steam',
        installDir: path.join(steamRoot(rig.home), 'steamapps', 'common', 'DCSWorld'),
        launch: {
          exe: path.join(steamRoot(rig.home), 'steam.exe'),
          args: ['-applaunch', '223750'],
        },
        userDir: path.join(rig.home, 'Saved Games', 'DCS'),
      },
    ]);
  });

  it('finds DCS in the second of three Steam libraries', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const root = steamRoot(rig.home);
    const second = path.join(rig.home, 'SteamLibraryD');
    const third = path.join(rig.home, 'SteamLibraryE');
    const vdf = (dir: string, n: number): string =>
      `\t"${n}"\n\t{\n\t\t"path"\t\t"${dir.replace(/\\/g, '\\\\')}"\n\t}\n`;
    await put(
      path.join(root, 'steamapps', 'libraryfolders.vdf'),
      `"libraryfolders"\n{\n${vdf(root, 0)}${vdf(second, 1)}${vdf(third, 2)}}\n`
    );
    await put(path.join(root, 'steam.exe'));
    await put(path.join(second, 'steamapps', 'common', 'DCSWorld', 'bin', 'DCS.exe'));
    await put(path.join(third, 'steamapps', 'common', 'Other', 'game.exe'));
    const installs = await dcs.detect(rig.ctx);
    expect(installs.ok && installs.value.map((i) => i.installDir)).toEqual([
      path.join(second, 'steamapps', 'common', 'DCSWorld'),
    ]);
  });

  it('follows the app manifest when DCS was installed under another folder name', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const root = steamRoot(rig.home);
    await put(
      path.join(root, 'steamapps', 'appmanifest_223750.acf'),
      '"AppState"\n{\n\t"appid"\t\t"223750"\n\t"installdir"\t\t"DCS World Steam"\n\t"buildid"\t\t"1"\n\t"StateFlags"\t\t"4"\n}\n'
    );
    await put(path.join(root, 'steamapps', 'common', 'DCS World Steam', 'bin', 'DCS.exe'));
    const installs = await dcs.detect(rig.ctx);
    expect(installs.ok && installs.value.map((i) => path.basename(i.installDir))).toEqual([
      'DCS World Steam',
    ]);
    // Without steam.exe the game itself is started.
    expect(installs.ok && installs.value[0]!.launch?.exe).toMatch(/bin\\DCS\.exe$/);
  });

  it('finds standalone installs from the Eagle Dynamics keys and ignores one whose folder is gone', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const stable = path.join(rig.home, 'Games', 'DCS World');
    const gone = path.join(rig.home, 'Games', 'DCS World OpenBeta');
    await put(path.join(stable, 'bin', 'DCS.exe'));
    await put(path.join(stable, 'dcs_variant.txt'), 'openbeta\r\n');
    await mutate(rig, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Eagle Dynamics\\DCS World',
        name: 'Path',
        value: { type: 'string', value: stable },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKLM',
        key: 'Software\\Eagle Dynamics\\DCS World OpenBeta',
        name: 'Path',
        value: { type: 'string', value: gone },
      },
    ]);
    const installs = await dcs.detect(rig.ctx);
    expect(installs.ok && installs.value).toEqual([
      {
        source: 'standalone',
        installDir: stable,
        launch: {
          exe: path.join(stable, 'bin', 'DCS.exe'),
          args: [],
          cwd: path.join(stable, 'bin'),
        },
        userDir: path.join(rig.home, 'Saved Games', 'DCS.openbeta'),
      },
    ]);
  });

  it('lists every Saved Games DCS folder, the installs own first', async () => {
    rig = await scenarioRig('flying-fresh', { files: ['Program Files (x86)/Steam/**'] });
    for (const name of ['DCS.openbeta', 'DCS', 'DCS.old']) {
      await fs.mkdir(path.join(rig.home, 'Saved Games', name, 'Config'), { recursive: true });
    }
    await put(path.join(rig.home, 'Saved Games', 'DCS.txt'));
    const locations = await dcs.configLocations(rig.ctx);
    expect(locations.ok && locations.value.map((l) => [l.id, l.label])).toEqual([
      ['dcs', 'Saved Games\\DCS'],
      ['dcs-old', 'Saved Games\\DCS.old'],
      ['dcs-openbeta', 'Saved Games\\DCS.openbeta'],
    ]);
    const variables = await dcs.pathVariables!(rig.ctx);
    expect(variables.ok && variables.value).toEqual({
      DCS_INSTALL: path.join(steamRoot(rig.home), 'steamapps', 'common', 'DCSWorld'),
      DCS_USER: path.join(rig.home, 'Saved Games', 'DCS'),
    });
  });

  it('uses the Saved Games known folder even when it is redirected', async () => {
    rig = await scenarioRig('flying-fresh', { files: ['Program Files (x86)/Steam/**'] });
    const redirected = path.join(rig.home, 'OneDrive', 'Saved Games');
    await fs.mkdir(path.join(redirected, 'DCS'), { recursive: true });
    rig.ports.folders.savedGames = () => redirected;
    const installs = await dcs.detect(rig.ctx);
    expect(installs.ok && installs.value[0]!.userDir).toBe(path.join(redirected, 'DCS'));
    const locations = await dcs.configLocations(rig.ctx);
    expect(locations.ok && locations.value.map((l) => l.path)).toEqual([
      path.join(redirected, 'DCS'),
    ]);
  });

  it('reports the Steam build and a queued update', async () => {
    rig = await scenarioRig('flying-fresh', { files: ['Program Files (x86)/Steam/**'] });
    const installs = await dcs.detect(rig.ctx);
    if (!installs.ok) throw new Error(installs.error.message);
    const install = installs.value[0];
    const before = await dcs.installedVersion!(rig.ctx, install!);
    expect(before.ok && before.value).toEqual({
      version: 'Steam build 25625823',
      updatePending: false,
    });
    await mutate(rig, [
      { op: 'setSteamBuild', appId: '223750', stateFlags: 6, targetBuildId: '25700000' },
    ]);
    const after = await dcs.installedVersion!(rig.ctx, install!);
    expect(after.ok && after.value).toEqual({
      version: 'Steam build 25625823',
      updatePending: true,
    });
  });

  it('reads a standalone version from autoupdate.cfg', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const dir = path.join(rig.home, 'Games', 'DCS World');
    const install = { source: 'standalone' as const, installDir: dir };
    const missing = await dcs.installedVersion!(rig.ctx, install);
    expect(missing.ok).toBe(false);
    await put(
      path.join(dir, 'autoupdate.cfg'),
      JSON.stringify({ branch: 'dcs_world', version: '2.9.29.27468' })
    );
    const version = await dcs.installedVersion!(rig.ctx, install);
    expect(version.ok && version.value.version).toBe('2.9.29.27468 (dcs_world)');
    await put(path.join(dir, 'autoupdate.cfg'), '{ broken');
    expect((await dcs.installedVersion!(rig.ctx, install)).ok).toBe(false);
    await put(path.join(dir, 'autoupdate.cfg'), '{}');
    expect((await dcs.installedVersion!(rig.ctx, install)).ok).toBe(false);
  });

  it('suggests the files worth tracking', async () => {
    rig = await scenarioRig('flying-fresh', {
      files: ['Program Files (x86)/Steam/**', 'Saved Games/DCS/Config/options.lua'],
    });
    const tracked = await dcs.trackedFiles!(rig.ctx);
    expect(tracked.ok && tracked.value.map((t) => t.label)).toEqual([
      'DCS options',
      'DCS input bindings',
      'DCS monitor setups',
      'DCS Export.lua',
    ]);
  });
});
