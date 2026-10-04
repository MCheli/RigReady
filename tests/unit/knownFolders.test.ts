/**
 * PLAT-008: where RigReady looks for the user's folders and its own data.
 *
 *   - RIGREADY_HOME overrides the data root;
 *   - with USERPROFILE, APPDATA and LOCALAPPDATA pointed at temp folders, every value of
 *     the real Windows KnownFolders is under them (nothing can reach the real profile);
 *   - KnownFolders is the only module that computes such a path: no other shipped source
 *     reads a path variable from the environment or asks the OS for the home folder.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isWithin } from '../../src/core/paths';
import type { KnownFolders, Registry } from '../../src/core/ports';
import { ok } from '../../src/core/result';
import { repoRoot, scenarioRig, tempDir, type TestRig } from '../helpers';

const windows = process.platform === 'win32';

/** A registry with nothing in it: no Steam, so no library outside the temp folders. */
const emptyRegistry: Registry = {
  getValue: async () => ok(undefined),
  listKeys: async () => ok([]),
  listValues: async () => ok({}),
};

const USER_FOLDERS = ['home', 'documents', 'savedGames', 'appData', 'localAppData'] as const;

describe.runIf(windows)('the real Windows KnownFolders under a redirected profile', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it('with USERPROFILE, APPDATA and LOCALAPPDATA in temp folders every user folder is under them', async () => {
    const temp = await tempDir();
    cleanup = temp.cleanup;
    const { WindowsKnownFolders } = await import('../../src/platform/windows/knownFolders');
    const user = path.join(temp.dir, 'user');
    const roaming = path.join(temp.dir, 'roaming');
    const local = path.join(temp.dir, 'local');
    const folders: KnownFolders = new WindowsKnownFolders(
      { USERPROFILE: user, APPDATA: roaming, LOCALAPPDATA: local },
      emptyRegistry
    );
    expect(folders.home()).toBe(user);
    expect(folders.documents()).toBe(path.join(user, 'Documents'));
    expect(folders.savedGames()).toBe(path.join(user, 'Saved Games'));
    expect(folders.appData()).toBe(roaming);
    expect(folders.localAppData()).toBe(local);
    // Without RIGREADY_HOME the data root follows the (redirected) home.
    expect(folders.dataRoot()).toBe(path.join(user, '.rigready'));
    for (const name of USER_FOLDERS) {
      expect(isWithin(temp.dir, folders[name]()), `${name}: ${folders[name]()}`).toBe(true);
    }
    expect(isWithin(temp.dir, folders.dataRoot())).toBe(true);
    // None of them is, or is inside, a folder of the real profile that RigReady uses.
    // (The temp folder itself is under the real AppData\Local, so the home is not compared.)
    const real = os.homedir();
    for (const name of [...USER_FOLDERS, 'dataRoot'] as const) {
      for (const used of ['Documents', 'Saved Games', '.rigready', 'AppData\\Roaming']) {
        expect(isWithin(path.join(real, used), folders[name]()), `${name} in ${used}`).toBe(false);
      }
      expect(folders[name]().toLowerCase()).not.toBe(real.toLowerCase());
    }
    const libraries = await folders.steamLibraries();
    expect(libraries).toEqual({ ok: true, value: [] });
  });

  it('RIGREADY_HOME overrides the data root, redirected profile or not', async () => {
    const temp = await tempDir();
    cleanup = temp.cleanup;
    const { WindowsKnownFolders } = await import('../../src/platform/windows/knownFolders');
    const data = path.join(temp.dir, 'data root');
    const redirected = new WindowsKnownFolders(
      { USERPROFILE: path.join(temp.dir, 'user'), RIGREADY_HOME: data },
      emptyRegistry
    );
    expect(redirected.dataRoot()).toBe(data);
    // On the real profile too: only the data root moves.
    const real = new WindowsKnownFolders({ ...process.env, RIGREADY_HOME: data }, emptyRegistry);
    expect(real.dataRoot()).toBe(data);
    expect(real.home().toLowerCase()).toBe(os.homedir().toLowerCase());
    // An empty value is no override.
    const empty = new WindowsKnownFolders(
      { USERPROFILE: path.join(temp.dir, 'user'), RIGREADY_HOME: '' },
      emptyRegistry
    );
    expect(empty.dataRoot()).toBe(path.join(temp.dir, 'user', '.rigready'));
  });

  it('without APPDATA and LOCALAPPDATA a redirected profile still keeps them under the home', async () => {
    const temp = await tempDir();
    cleanup = temp.cleanup;
    const { WindowsKnownFolders } = await import('../../src/platform/windows/knownFolders');
    const folders = new WindowsKnownFolders({ USERPROFILE: temp.dir }, emptyRegistry);
    expect(folders.appData()).toBe(path.join(temp.dir, 'AppData', 'Roaming'));
    expect(folders.localAppData()).toBe(path.join(temp.dir, 'AppData', 'Local'));
  });
});

describe('the fake KnownFolders of tests and scenario runs', () => {
  let rig: TestRig | undefined;
  afterEach(async () => {
    await rig?.cleanup();
    rig = undefined;
  });

  it('every folder is under the temp home, Program Files and the Steam libraries included', async () => {
    rig = await scenarioRig('flying-all-good', { files: ['Program Files (x86)/Steam/**'] });
    const { folders } = rig.ports;
    for (const name of [
      ...USER_FOLDERS,
      'programFiles',
      'programFilesX86',
      'programData',
      'dataRoot',
    ] as const) {
      expect(isWithin(rig.home, folders[name]()), name).toBe(true);
    }
    const libraries = await folders.steamLibraries();
    expect(libraries.ok && libraries.value.length).toBeGreaterThan(0);
    for (const library of libraries.ok ? libraries.value : []) {
      expect(isWithin(rig.home, library), library).toBe(true);
    }
    expect(isWithin(os.tmpdir(), rig.home)).toBe(true);
  });
});

// ---- nobody else computes a user path -------------------------------------------------

const PATH_VARIABLES = [
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData',
  'ALLUSERSPROFILE',
  'PUBLIC',
  'OneDrive',
  'SystemRoot',
  'windir',
  'RIGREADY_HOME',
];

async function sources(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'legacy') out.push(...(await sources(full)));
    } else if (/\.(ts|vue|mjs)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name))
      out.push(full);
  }
  return out;
}

const withoutComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (found) => found.replace(/[^\n]/g, ''))
    .replace(/^\s*\/\/.*$/gm, '');

describe('KnownFolders is the only module that computes user paths', () => {
  /**
   * Where a path variable may be named, each for one reason:
   *   knownFolders.ts  the module itself;
   *   fake/index.ts    startScenario reads RIGREADY_HOME from the environment it is given,
   *                    to put a scenario's data root where the e2e harness asked;
   *   pathVariables.ts the names of RigReady's own path variables ({APPDATA}, ...), whose
   *                    values come from ports.folders;
   *   scriptEnv.ts     RIGREADY_HOME is handed to scripts, its value from ports.folders.
   */
  const ALLOWED = new Set([
    'src/platform/windows/knownFolders.ts',
    'src/platform/fake/index.ts',
    'src/core/pathVariables.ts',
    'src/core/scriptEnv.ts',
  ]);

  it('no other source reads a path variable from the environment, os.homedir or os.tmpdir', async () => {
    const files = await sources(path.join(repoRoot, 'src'));
    expect(files.length).toBeGreaterThan(200);
    const quoted = new RegExp(
      `(?:env|ENV)\\s*(?:\\.\\s*(?:${PATH_VARIABLES.filter((v) => /^\w+$/.test(v)).join('|')})\\b|\\[\\s*['"\`](?:${PATH_VARIABLES.map((v) => v.replace(/[()]/g, '\\$&')).join('|')})['"\`]\\s*\\])`,
      'i'
    );
    const hits: string[] = [];
    for (const file of files) {
      const name = path.relative(repoRoot, file).replace(/\\/g, '/');
      const lines = withoutComments(await fs.readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (
          /\b(homedir|tmpdir)\s*\(/.test(line) &&
          name !== 'src/platform/windows/knownFolders.ts'
        ) {
          hits.push(`${name}:${index + 1}: asks the OS for a folder`);
        }
        if (quoted.test(line) && !ALLOWED.has(name)) {
          hits.push(`${name}:${index + 1}: reads a path variable from the environment`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('the allowed modules read them only from the environment they are given, never from process.env directly (except KnownFolders’ default)', async () => {
    for (const name of ALLOWED) {
      const text = withoutComments(await fs.readFile(path.join(repoRoot, name), 'utf8'));
      const direct = text
        .split('\n')
        .filter((line) => /process\.env\s*(\.|\[)/.test(line))
        .filter((line) => PATH_VARIABLES.some((v) => line.includes(v)));
      expect(direct, name).toEqual([]);
    }
  });
});
