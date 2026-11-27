import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { mutate, wiredApp, type WiredApp } from '../../../tests/helpers';
import {
  isRegistryPath,
  parseRegistryPath,
  registryKeyPath,
  registryLeaf,
  registryValuePath,
} from './registryValues';

/**
 * A registry value changed through FileStore: backed up, journaled and undone like a file,
 * and nothing wider than replacing the bytes of an existing binary value under
 * HKEY_CURRENT_USER\Software.
 */
const KEY = 'Software\\Example Studio\\Example Game';
const NAME =
  'Save|player=0|kind=Bindings|device=A very long name that could never be a file name_h123';
const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');

describe('registry values through FileStore', () => {
  let app: WiredApp | undefined;
  afterEach(async () => {
    await app?.cleanup();
    app = undefined;
  });

  async function start(): Promise<WiredApp> {
    app = await wiredApp('generic-fresh');
    await mutate(app, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: KEY,
        name: NAME,
        value: { type: 'binary', value: hex('before') },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: KEY,
        name: 'Volume_h9',
        value: { type: 'number', value: 7 },
      },
      {
        op: 'setRegistryValue',
        hive: 'HKLM',
        key: 'Software\\Example Studio\\Machine',
        name: 'Blob',
        value: { type: 'binary', value: hex('machine') },
      },
    ]);
    return app;
  }
  const stored = async (a: WiredApp, name = NAME): Promise<unknown> => {
    const value = await a.ports.registry.getValue('HKCU', KEY, name);
    return value.ok ? value.value : undefined;
  };

  it('the address of a value is a path a file store can carry, with a short file name', () => {
    const address = registryValuePath('HKCU', KEY, NAME);
    expect(address).toMatch(
      /^\\\\registry\\HKCU\\Software\\Example Studio\\Example Game\\[0-9a-f]{32}\.regvalue$/
    );
    expect(registryLeaf(NAME)).toHaveLength(41);
    expect(parseRegistryPath(address)).toEqual({
      hive: 'HKCU',
      key: KEY,
      leaf: registryLeaf(NAME),
    });
    expect(parseRegistryPath('\\\\registry\\HKCU\\Software\\X')).toEqual({
      hive: 'HKCU',
      key: 'Software\\X',
      leaf: '',
    });
    expect(isRegistryPath(address)).toBe(true);
    // A key's address is the folder its values' addresses are in.
    expect(registryKeyPath('HKCU', KEY)).toBe(
      '\\\\registry\\HKCU\\Software\\Example Studio\\Example Game'
    );
    expect(address.startsWith(`${registryKeyPath('HKCU', KEY)}\\`)).toBe(true);
    for (const file of [
      'C:\\Users\\User\\file.txt',
      '\\\\server\\share\\file.txt',
      'registry\\HKCU',
    ]) {
      expect(parseRegistryPath(file), file).toBeUndefined();
      expect(isRegistryPath(file), file).toBe(false);
    }
    expect(parseRegistryPath('\\\\registry\\HKCR\\Software\\X')).toBeUndefined();
    // Two names differ in their address even when they differ only at the end.
    expect(registryLeaf(`${NAME}4`)).not.toBe(registryLeaf(NAME));
  });

  it('a write replaces the value’s bytes after a backup, is journaled with its reason, and Undo puts the bytes back', async () => {
    const a = await start();
    const address = registryValuePath('HKCU', KEY, NAME);
    expect(await a.ports.files.exists(address)).toBe(true);
    const before = await a.ports.files.readBytes(address);
    expect(before.ok && Buffer.from(before.value).toString('utf8')).toBe('before');

    const group = a.ports.files.beginGroup('Example Game: bind Fire to Button 6');
    const written = await a.ports.files.write(address, Buffer.from('after', 'utf8'), {
      reason: 'Example Game bindings',
      group,
    });
    if (!written.ok || !written.value) throw new Error('not written');
    expect(await stored(a)).toEqual({ type: 'binary', value: hex('after') });
    // The other value of the key is as it was.
    expect(await stored(a, 'Volume_h9')).toEqual({ type: 'number', value: 7 });

    // The backup is a file in RigReady's data folder holding the bytes from before.
    const entry = written.value;
    expect(entry.path).toBe(address);
    expect(entry.backupPath).toContain('backups');
    expect(await fs.readFile(entry.backupPath!, 'utf8')).toBe('before');
    const groups = await a.ports.files.journalGroups();
    if (!groups.ok) throw new Error(groups.error.message);
    expect(groups.value[0]).toMatchObject({ reason: 'Example Game: bind Fire to Button 6' });

    const undone = await a.ports.files.undoGroup(group.id);
    expect(undone.ok).toBe(true);
    expect(await stored(a)).toEqual({ type: 'binary', value: hex('before') });
  });

  it('Undo is refused when the value was changed again by something else', async () => {
    const a = await start();
    const address = registryValuePath('HKCU', KEY, NAME);
    const written = await a.ports.files.write(address, 'after', {
      reason: 'Example Game bindings',
    });
    if (!written.ok || !written.value) throw new Error('not written');
    // The game saves its own change afterwards.
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: KEY,
        name: NAME,
        value: { type: 'binary', value: hex('the game wrote this') },
      },
    ]);
    const undone = await a.ports.files.undo(written.value.id);
    expect(undone.ok).toBe(false);
    if (!undone.ok) expect(undone.error.code).toBe('journal.changed');
    expect(await stored(a)).toEqual({ type: 'binary', value: hex('the game wrote this') });
  });

  it('refuses everything wider: another hive, outside Software, a value that is not there or not binary, a delete', async () => {
    const a = await start();
    const change = { reason: 'not allowed' };
    const refused = async (address: string): Promise<string> => {
      const result = await a.ports.files.write(address, 'x', change);
      expect(result.ok, address).toBe(false);
      return result.ok ? '' : `${result.error.message} ${result.error.detail ?? ''}`;
    };
    expect(
      await refused(registryValuePath('HKLM', 'Software\\Example Studio\\Machine', 'Blob'))
    ).toContain('only under HKEY_CURRENT_USER\\Software');
    expect(await refused(registryValuePath('HKCU', 'Environment', 'Path'))).toContain(
      'only under HKEY_CURRENT_USER\\Software'
    );
    expect(await refused(registryValuePath('HKCU', KEY, 'Not there_h1'))).toContain(
      'does not create one'
    );
    // A number is not binary data: it is not offered, so it cannot be replaced.
    expect(await refused(registryValuePath('HKCU', KEY, 'Volume_h9'))).toContain(
      'does not create one'
    );
    const removed = await a.ports.files.remove(registryValuePath('HKCU', KEY, NAME), change);
    expect(removed.ok).toBe(false);
    // Nothing changed, and a refused change leaves no value behind in the journal's backups.
    expect(await stored(a)).toEqual({ type: 'binary', value: hex('before') });
    expect(await stored(a, 'Volume_h9')).toEqual({ type: 'number', value: 7 });
    const machine = await a.ports.registry.getValue(
      'HKLM',
      'Software\\Example Studio\\Machine',
      'Blob'
    );
    expect(machine.ok && machine.value).toEqual({ type: 'binary', value: hex('machine') });
  });

  it('a refused write or delete leaves nothing behind: no journal entry and no backup', async () => {
    const a = await start();
    const change = { reason: 'not allowed' };
    const backups = `${a.ports.folders.dataRoot()}\\backups\\auto`;
    const group = a.ports.files.beginGroup('A change that will be refused');
    for (const address of [
      registryValuePath('HKLM', 'Software\\Example Studio\\Machine', 'Blob'),
      registryValuePath('HKCU', 'Environment', 'Path'),
      registryValuePath('HKCU', KEY, 'Not there_h1'),
      registryValuePath('HKCU', KEY, 'Volume_h9'),
    ]) {
      const written = await a.ports.files.write(address, 'x', { ...change, group });
      expect(written.ok, address).toBe(false);
      if (!written.ok) expect(written.error.code, address).toBe('file.refused');
    }
    const removed = await a.ports.files.remove(registryValuePath('HKCU', KEY, NAME), {
      ...change,
      group,
    });
    expect(removed.ok).toBe(false);
    if (!removed.ok) {
      expect(removed.error).toMatchObject({
        code: 'file.refused',
        message: 'RigReady does not delete registry values.',
      });
    }
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
    expect(await a.ports.files.exists(backups)).toBe(false);
  });

  it('refuses an address Windows would read as another place, before anything is backed up', async () => {
    const a = await start();
    // "Other" has a value of the same name: the normalised path would be that one.
    await mutate(a, [
      {
        op: 'setRegistryValue',
        hive: 'HKCU',
        key: 'Software\\Example Studio\\Other',
        name: NAME,
        value: { type: 'binary', value: hex('the other one') },
      },
    ]);
    const leaf = registryLeaf(NAME);
    for (const address of [
      `\\\\registry\\HKCU\\Software\\Example Studio\\Example Game\\..\\Other\\${leaf}`,
      `\\\\registry\\HKCU\\Software\\Example Studio\\.\\Example Game\\${leaf}`,
      `\\\\registry\\HKCU\\Software\\Example Studio\\\\Example Game\\${leaf}`,
      `//registry/HKCU/Software/Example Studio/Example Game/../Other/${leaf}`,
    ]) {
      const written = await a.ports.files.write(address, 'x', { reason: 'not allowed' });
      expect(written.ok, address).toBe(false);
      if (!written.ok) {
        expect(written.error.code, address).toBe('file.refused');
        expect(written.error.message, address).toContain('another place');
      }
    }
    expect(await stored(a)).toEqual({ type: 'binary', value: hex('before') });
    const other = await a.ports.registry.getValue('HKCU', 'Software\\Example Studio\\Other', NAME);
    expect(other.ok && other.value).toEqual({ type: 'binary', value: hex('the other one') });
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('a path in the registry’s namespace that is not an address never reaches the file system', async () => {
    const a = await start();
    const leaf = registryLeaf(NAME);
    for (const address of [
      `\\\\registry\\HKCR\\Software\\X\\${leaf}`,
      `\\\\registry\\share\\folder\\file.txt`,
      `\\\\registry\\`,
    ]) {
      expect(await a.ports.files.exists(address), address).toBe(false);
      expect((await a.ports.files.readBytes(address)).ok, address).toBe(false);
      const written = await a.ports.files.write(address, 'x', { reason: 'not allowed' });
      expect(written.ok, address).toBe(false);
      if (!written.ok) {
        expect(written.error.code, address).toBe('file.refused');
        expect(written.error.message, address).toMatch(/not a registry address|another place/);
      }
      const removed = await a.ports.files.remove(address, { reason: 'not allowed' });
      // There is nothing there to remove, so nothing is tried (and nothing reaches a disk).
      expect(removed, address).toEqual({ ok: true, value: null });
      const listed = await a.ports.files.list(address);
      expect(listed.ok && listed.value, address).toEqual([]);
    }
    const journal = await a.ports.files.journalGroups();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('files are read and written exactly as before', async () => {
    const a = await start();
    const file = `${a.home}\\Documents\\note.txt`;
    const written = await a.ports.files.write(file, 'hello', { reason: 'a note' });
    expect(written.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('hello');
    const listed = await a.ports.files.list(`${a.home}\\Documents`);
    expect(listed.ok && listed.value).toContain('note.txt');
  });
});
