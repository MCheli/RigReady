import { promises as fs } from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { createZip, extractZip, readZip, safeEntryPath, zipFolder } from '../../src/core/files/zip';
import { NodeRawFs } from '../../src/platform/node';
import { tempDir, TestClock } from '../helpers';

let dir: string;
let cleanup: () => Promise<void>;
let store: BackupFileStore;
const text = (s: string): Uint8Array => new TextEncoder().encode(s);

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  store = new BackupFileStore(new NodeRawFs(), path.join(dir, '.rigready'), new TestClock());
});
afterEach(() => cleanup());

describe('zip helpers', () => {
  it('round-trips entries, including binary content and nested folders', () => {
    const zipped = createZip([
      { path: 'profile.yaml', data: text('name: F/A-18C') },
      { path: 'files\\Config\\Input\\a.diff.lua', data: new Uint8Array([0, 1, 2, 255]) },
      { path: 'empty-folder/', data: new Uint8Array() },
    ]);
    if (!zipped.ok) throw new Error(zipped.error.message);
    const entries = readZip(zipped.value);
    if (!entries.ok) throw new Error(entries.error.message);
    expect(entries.value.map((e) => e.path).sort()).toEqual([
      'files/Config/Input/a.diff.lua',
      'profile.yaml',
    ]);
    const binary = entries.value.find((e) => e.path.endsWith('.lua'))!;
    expect([...binary.data]).toEqual([0, 1, 2, 255]);
  });

  it('rejects paths that could leave the destination (zip slip)', () => {
    for (const bad of [
      '../evil.txt',
      'a/../../evil.txt',
      '/etc/passwd',
      'C:/Windows/evil.dll',
      'C:\\Windows\\evil.dll',
      '..\\..\\evil.txt',
      'a//b.txt',
      './a.txt',
      'a\0b',
      '',
    ]) {
      expect(safeEntryPath(bad), bad).toMatchObject({
        ok: false,
        error: { code: 'zip.unsafePath' },
      });
    }
    expect(safeEntryPath('a/b/c.txt')).toEqual({ ok: true, value: 'a/b/c.txt' });
    expect(safeEntryPath('folder/')).toEqual({ ok: true, value: undefined });
    expect(createZip([{ path: '../x', data: text('x') }])).toMatchObject({
      ok: false,
      error: { code: 'zip.unsafePath' },
    });
    expect(
      createZip([
        { path: 'a.txt', data: text('1') },
        { path: 'a.txt', data: text('2') },
      ])
    ).toMatchObject({ ok: false, error: { code: 'zip.duplicate' } });

    // An archive made by another tool with a traversal entry is refused as a whole.
    const hostile = zipSync({ 'ok.txt': text('fine'), '../../outside.txt': text('gotcha') });
    expect(readZip(hostile)).toMatchObject({ ok: false, error: { code: 'zip.unsafePath' } });
  });

  it('enforces the size cap and the entry cap, and reports unreadable archives', () => {
    const big = zipSync({ 'a.bin': new Uint8Array(4096), 'b.bin': new Uint8Array(4096) });
    expect(readZip(big, { maxTotalBytes: 5000 })).toMatchObject({
      ok: false,
      error: { code: 'zip.tooBig' },
    });
    expect(readZip(big, { maxTotalBytes: 8192 }).ok).toBe(true);
    expect(readZip(big, { maxEntries: 1 })).toMatchObject({
      ok: false,
      error: { code: 'zip.tooMany' },
    });
    expect(readZip(text('this is not a zip file'))).toMatchObject({
      ok: false,
      error: { code: 'zip.read' },
    });
  });

  it('zips a folder with patterns and extracts it elsewhere as one undoable group', async () => {
    const source = path.join(dir, 'Saved Games', 'DCS', 'Config');
    await fs.mkdir(path.join(source, 'Input', 'joystick'), { recursive: true });
    await fs.writeFile(path.join(source, 'options.lua'), 'options = {}');
    await fs.writeFile(path.join(source, 'Input', 'joystick', 'stick.diff.lua'), 'return {}');
    await fs.writeFile(path.join(source, 'network.vault'), 'secret');

    const zipped = await zipFolder(store, source, { exclude: ['*.vault'], prefix: 'Config' });
    if (!zipped.ok) throw new Error(zipped.error.message);
    const names = readZip(zipped.value);
    expect(names.ok && names.value.map((e) => e.path).sort()).toEqual([
      'Config/Input/joystick/stick.diff.lua',
      'Config/options.lua',
    ]);

    const target = path.join(dir, 'Restore');
    await fs.mkdir(path.join(target, 'Config'), { recursive: true });
    await fs.writeFile(path.join(target, 'Config', 'options.lua'), 'old options');
    const extracted = await extractZip(store, zipped.value, target, { reason: 'Restore backup' });
    if (!extracted.ok) throw new Error(extracted.error.message);
    expect(extracted.value.files).toHaveLength(2);
    expect(await fs.readFile(path.join(target, 'Config', 'options.lua'), 'utf8')).toBe(
      'options = {}'
    );

    const groups = await store.journalGroups();
    expect(groups.ok && groups.value.map((g) => [g.reason, g.entries.length])).toEqual([
      ['Restore backup', 2],
    ]);
    expect((await store.undoGroup(extracted.value.group.id)).ok).toBe(true);
    expect(await fs.readFile(path.join(target, 'Config', 'options.lua'), 'utf8')).toBe(
      'old options'
    );
    expect(
      await store.exists(path.join(target, 'Config', 'Input', 'joystick', 'stick.diff.lua'))
    ).toBe(false);
  });

  it('writes nothing when the archive fails validation', async () => {
    const target = path.join(dir, 'Restore');
    const hostile = zipSync({ 'ok.txt': text('fine'), '../outside.txt': text('gotcha') });
    expect(await extractZip(store, hostile, target, { reason: 'Import' })).toMatchObject({
      ok: false,
      error: { code: 'zip.unsafePath' },
    });
    expect(await store.exists(path.join(target, 'ok.txt'))).toBe(false);
    expect(await store.exists(path.join(dir, 'outside.txt'))).toBe(false);
    const big = zipSync({ 'a.bin': new Uint8Array(4096) });
    expect(
      await extractZip(store, big, target, { reason: 'Import', maxTotalBytes: 100 })
    ).toMatchObject({ ok: false, error: { code: 'zip.tooBig' } });
    expect(await extractZip(store, big, 'relative', { reason: 'Import' })).toMatchObject({
      ok: false,
      error: { code: 'file.relative' },
    });
    expect(await zipFolder(store, path.join(dir, 'nope'))).toMatchObject({ ok: true });
  });
});
