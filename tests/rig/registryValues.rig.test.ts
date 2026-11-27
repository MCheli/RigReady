/**
 * The real Windows registry write behind FileStore (src/core/files/registryValues.ts), on
 * a key of this test's own that it makes and removes with reg.exe. It touches nothing else
 * in the registry, and its journal and backups go to a temp folder, not to the real data
 * folder. It writes, so it runs only with RIGREADY_RIG_APPLY=1 (npm run rig:smoke:apply).
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registryValuePath } from '../../src/core/files/registryValues';
import { nullLogger } from '../../src/core/logger';
import type { Ports } from '../../src/core/ports';
import { createWindowsPorts } from '../../src/platform/windows';

const apply = process.env.RIGREADY_RIG_APPLY === '1';
const KEY = `Software\\RigReady-rig-test-${process.pid}`;
const FULL = `HKCU\\${KEY}`;
// A name longer than a file name may be, with the characters a game's save data uses.
const NAME = `Save|player=0|kind=Map|device=${'x'.repeat(260)}|duplicate=0_h1`;
const reg = (...args: string[]): string =>
  execFileSync('reg.exe', args, { encoding: 'utf8', windowsHide: true });
const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');

describe.skipIf(!apply)('real registry: a binary value replaced through FileStore', () => {
  let ports: Ports;
  let home: string;
  let previousHome: string | undefined;

  beforeAll(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-rig-registry-'));
    previousHome = process.env.RIGREADY_HOME;
    process.env.RIGREADY_HOME = home;
    ports = createWindowsPorts({ log: nullLogger, projectRoot: path.resolve(__dirname, '../..') });
    expect(ports.folders.dataRoot()).toBe(home);
    reg('add', FULL, '/v', NAME, '/t', 'REG_BINARY', '/d', hex('before'), '/f');
    reg('add', FULL, '/v', 'Volume', '/t', 'REG_DWORD', '/d', '7', '/f');
  });

  afterAll(async () => {
    try {
      reg('delete', FULL, '/f');
    } finally {
      if (previousHome === undefined) delete process.env.RIGREADY_HOME;
      else process.env.RIGREADY_HOME = previousHome;
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  const stored = async (name: string): Promise<unknown> => {
    const value = await ports.registry.getValue('HKCU', KEY, name);
    return value.ok ? value.value : undefined;
  };

  it('replaces the bytes after a backup, keeps the type and the other value, and Undo restores them', async () => {
    const address = registryValuePath('HKCU', KEY, NAME);
    expect(await ports.files.exists(address)).toBe(true);
    const group = ports.files.beginGroup('Rig test: replace a binary value');
    const written = await ports.files.write(address, Buffer.from('after, and longer', 'utf8'), {
      reason: 'Rig test',
      group,
    });
    if (!written.ok || !written.value)
      throw new Error(written.ok ? 'no entry' : written.error.message);
    expect(await stored(NAME)).toEqual({ type: 'binary', value: hex('after, and longer') });
    expect(await stored('Volume')).toEqual({ type: 'number', value: 7 });
    expect(await fs.readFile(written.value.backupPath!, 'utf8')).toBe('before');
    // Windows itself still calls it binary data.
    expect(reg('query', FULL, '/v', 'Volume')).toContain('REG_DWORD');
    expect(reg('query', FULL)).toContain('REG_BINARY');

    const undone = await ports.files.undoGroup(group.id);
    expect(undone.ok).toBe(true);
    expect(await stored(NAME)).toEqual({ type: 'binary', value: hex('before') });
  });

  it('refuses a value that is not binary, one that is not there, and a delete', async () => {
    const change = { reason: 'Rig test' };
    expect(
      (await ports.files.write(registryValuePath('HKCU', KEY, 'Volume'), 'x', change)).ok
    ).toBe(false);
    expect(
      (await ports.files.write(registryValuePath('HKCU', KEY, 'Missing'), 'x', change)).ok
    ).toBe(false);
    expect((await ports.files.remove(registryValuePath('HKCU', KEY, NAME), change)).ok).toBe(false);
    expect(await stored(NAME)).toEqual({ type: 'binary', value: hex('before') });
    expect(await stored('Volume')).toEqual({ type: 'number', value: 7 });
    expect(await stored('Missing')).toBeUndefined();
  });
});
