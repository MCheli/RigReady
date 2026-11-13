import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadScenario, seedScenario, type SeedOptions } from '../../src/platform/fake';
import { fixturesDir, rigFromState, type TestRig } from '../helpers';

/**
 * Every test rig and every scenario start copies the rig's recorded files into a fresh fake
 * home. These tests hold what that copy must leave behind, whatever way it is done.
 */

const recordedDir = path.join(fixturesDir, 'rigs', 'mark-full', 'files');

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

const load = (name = 'flying-all-good') =>
  loadScenario(path.join(fixturesDir, 'scenarios', `${name}.yaml`), fixturesDir);

/** A fake home that nothing was copied into yet, and the scenario to seed it with. */
const unseeded = async (name?: string) => {
  const loaded = await load(name);
  rig = await rigFromState(loaded.state, loaded.scripts);
  return { loaded, rig };
};

/** Every folder and file below a folder, as paths with forward slashes. */
const listBelow = async (dir: string): Promise<{ folders: string[]; files: string[] }> => {
  const folders: string[] = [];
  const files: string[] = [];
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(dir, relative), { withFileTypes: true })) {
      const below = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        folders.push(below);
        await walk(below);
      } else files.push(below);
    }
  };
  await walk('');
  return { folders: folders.sort(), files: files.sort() };
};

const exists = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    () => true,
    () => false
  );

describe('copying a rig’s recorded files into the fake home', () => {
  it('copies every recorded folder and file, byte for byte apart from the re-pointed ones', async () => {
    const { loaded, rig } = await unseeded();
    await seedScenario(loaded, rig.ports);

    const recorded = await listBelow(recordedDir);
    expect(recorded.files.length).toBeGreaterThan(300);
    const home = await listBelow(rig.home);
    expect(recorded.folders.filter((folder) => !home.folders.includes(folder))).toEqual([]);
    expect(recorded.files.filter((file) => !home.files.includes(file))).toEqual([]);

    // Files that hold a path into the user's folders are re-pointed at the fake home. All
    // others are the recording, to the byte.
    const repointed = new Set(
      JSON.parse(
        await fs.readFile(path.join(fixturesDir, 'rigs', 'mark-full', 'rehome.json'), 'utf8')
      ) as string[]
    );
    const different: string[] = [];
    for (const file of recorded.files) {
      if (repointed.has(file)) continue;
      const [was, is] = await Promise.all([
        fs.readFile(path.join(recordedDir, file)),
        fs.readFile(path.join(rig.home, file)),
      ]);
      if (!was.equals(is)) different.push(file);
    }
    expect(different).toEqual([]);
  });

  it('leaves a file the home already has as it is, and still copies the ones beside it', async () => {
    const { loaded, rig } = await unseeded();
    const config = path.join(rig.home, 'Saved Games', 'DCS', 'Config');
    await fs.mkdir(config, { recursive: true });
    await fs.writeFile(path.join(config, 'options.lua'), 'already here');

    await seedScenario(loaded, rig.ports);

    expect(await fs.readFile(path.join(config, 'options.lua'), 'utf8')).toBe('already here');
    expect(await fs.readFile(path.join(config, 'Input', 'disabled.lua'))).toEqual(
      await fs.readFile(
        path.join(recordedDir, 'Saved Games', 'DCS', 'Config', 'Input', 'disabled.lua')
      )
    );
  });

  it('with a list of wanted files copies only those, and still makes every recorded folder', async () => {
    const { loaded, rig } = await unseeded();
    const options: SeedOptions = { files: ['Saved Games/DCS/Config/**'] };
    await seedScenario(loaded, rig.ports, options);

    const recorded = await listBelow(recordedDir);
    const home = await listBelow(rig.home);
    expect(recorded.folders.filter((folder) => !home.folders.includes(folder))).toEqual([]);
    const wanted = recorded.files.filter((file) => file.startsWith('Saved Games/DCS/Config/'));
    expect(wanted.length).toBeGreaterThan(10);
    // Nothing recorded outside the list is there, and everything inside it is.
    expect(home.files.filter((file) => recorded.files.includes(file))).toEqual(wanted);
  });

  it('with an empty list copies nothing, not even the recorded folders', async () => {
    const { loaded, rig } = await unseeded();
    await seedScenario(loaded, rig.ports, { files: [] });

    expect(await exists(path.join(rig.home, 'Saved Games'))).toBe(false);
    expect(await exists(path.join(rig.home, 'Program Files (x86)'))).toBe(false);
    // The home still counts as seeded: the scenario's own data is in place.
    expect(await exists(path.join(rig.home, '.rigready-scenario-seeded'))).toBe(true);
  });

  it('seeds a rig that recorded no files at all', async () => {
    const { loaded, rig } = await unseeded();
    await seedScenario(
      { ...loaded, filesDir: path.join(rig.home, 'no-such-recording') },
      rig.ports
    );

    expect(await exists(path.join(rig.home, 'Saved Games'))).toBe(false);
    expect(await exists(path.join(rig.home, '.rigready-scenario-seeded'))).toBe(true);
  });
});
