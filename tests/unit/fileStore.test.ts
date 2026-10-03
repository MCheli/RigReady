import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { ProfileStore } from '../../src/core/profile/store';
import type { Profile } from '../../src/core/profile/schema';
import { NodeRawFs, NodeShell, RotatingFileSink, systemClock } from '../../src/platform/node';
import { tempDir, TestClock } from '../helpers';

let dir: string;
let cleanup: () => Promise<void>;
let dataRoot: string;
let outside: string;
let store: BackupFileStore;
let clock: TestClock;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  dataRoot = path.join(dir, '.rigready');
  outside = path.join(dir, 'Saved Games', 'DCS', 'Config');
  clock = new TestClock();
  store = new BackupFileStore(new NodeRawFs(), dataRoot, clock);
});
afterEach(() => cleanup());

describe('BackupFileStore', () => {
  it('writes inside the data root without a journal entry', async () => {
    const file = path.join(dataRoot, 'profiles', 'a.yaml');
    const result = await store.write(file, 'x: 1', { reason: 'save' });
    expect(result).toEqual({ ok: true, value: null });
    expect(await fs.readFile(file, 'utf8')).toBe('x: 1');
    expect(await store.journal()).toEqual({ ok: true, value: [] });
  });

  it('backs up the previous content before writing outside the data root, and can undo', async () => {
    const file = path.join(outside, 'options.lua');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(file, 'original');

    const written = await store.write(file, 'changed', { reason: 'Set MFD viewports' });
    expect(written.ok).toBe(true);
    if (!written.ok || !written.value) throw new Error('expected a journal entry');
    const entry = written.value;
    expect(entry.reason).toBe('Set MFD viewports');
    expect(entry.backupPath).toContain(path.join(dataRoot, 'backups', 'auto'));
    expect(await fs.readFile(entry.backupPath!, 'utf8')).toBe('original');
    expect(await fs.readFile(file, 'utf8')).toBe('changed');

    const journal = await store.journal();
    expect(journal.ok && journal.value.map((e) => [e.path, e.undone])).toEqual([[file, false]]);

    const undone = await store.undo(entry.id);
    expect(undone.ok && undone.value.undone).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('original');
    const after = await store.journal();
    // The undo is itself a journaled change (newest first), and the original is marked undone.
    expect(after.ok && after.value.map((e) => [e.reason, e.undone])).toEqual([
      ['Undo: Set MFD viewports', false],
      ['Set MFD viewports', true],
    ]);
    expect(await store.undo(entry.id)).toMatchObject({
      ok: false,
      error: { code: 'journal.undone' },
    });
  });

  it('undoing the creation of a new file removes it', async () => {
    const file = path.join(outside, 'new.lua');
    const written = await store.write(file, 'fresh', { reason: 'Create export script' });
    if (!written.ok || !written.value) throw new Error('expected a journal entry');
    expect(written.value.backupPath).toBeNull();
    await store.undo(written.value.id);
    expect(await store.exists(file)).toBe(false);
  });

  it('backs up before removing, keeps every change of the same file separately', async () => {
    const file = path.join(outside, 'a.lua');
    await store.write(file, 'one', { reason: 'first' });
    clock.advance(1000);
    await store.write(file, 'two', { reason: 'second' });
    clock.advance(1000);
    const removed = await store.remove(file, { reason: 'cleanup' });
    if (!removed.ok || !removed.value) throw new Error('expected a journal entry');
    expect(removed.value.action).toBe('remove');
    expect(await store.exists(file)).toBe(false);
    const journal = await store.journal();
    // Newest first.
    expect(journal.ok && journal.value.map((e) => e.reason)).toEqual([
      'cleanup',
      'second',
      'first',
    ]);
    await store.undo(removed.value.id);
    expect(await fs.readFile(file, 'utf8')).toBe('two');
    expect(await store.remove(path.join(outside, 'missing.lua'), { reason: 'x' })).toEqual({
      ok: true,
      value: null,
    });
  });

  it('refuses relative paths and reports missing things as errors, not throws', async () => {
    expect(await store.write('relative.txt', 'x', { reason: 'r' })).toMatchObject({
      ok: false,
      error: { code: 'file.relative' },
    });
    expect(await store.readText(path.join(dir, 'nope.txt'))).toMatchObject({
      ok: false,
      error: { code: 'file.read' },
    });
    expect(await store.list(path.join(dir, 'nope'))).toEqual({ ok: true, value: [] });
    expect(await store.undo('nope')).toMatchObject({
      ok: false,
      error: { code: 'journal.missing' },
    });
  });

  it('reports a missing backup instead of pretending to undo', async () => {
    const file = path.join(outside, 'b.lua');
    await store.write(file, 'one', { reason: 'first' });
    const second = await store.write(file, 'two', { reason: 'second' });
    if (!second.ok || !second.value) throw new Error('expected a journal entry');
    await fs.rm(second.value.backupPath!);
    expect(await store.undo(second.value.id)).toMatchObject({
      ok: false,
      error: { code: 'journal.backup' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('two');
  });
});

describe('ProfileStore', () => {
  const profile = (id: string, name: string): Profile => ({
    schemaVersion: 1,
    id,
    name,
    createdAt: '2026-10-03T12:00:00.000Z',
    updatedAt: '2026-10-03T12:00:00.000Z',
    checks: [
      {
        id: 'c1',
        type: 'device.connected',
        title: 'Stick',
        required: true,
        params: { vendorId: '4098', productId: 'BEA8' },
      },
    ],
    extensions: {},
  });

  it('round-trips profiles as YAML and remembers the last used one', async () => {
    const profiles = new ProfileStore(store, dataRoot);
    expect(await profiles.list()).toEqual({ ok: true, value: [] });
    await profiles.save(profile('dcs-f-a-18c', 'DCS F/A-18C'));
    await profiles.save(profile('a-huey', 'DCS UH-1H'));
    const text = await fs.readFile(path.join(dataRoot, 'profiles', 'dcs-f-a-18c.yaml'), 'utf8');
    expect(text).toContain('name: DCS F/A-18C');
    const listed = await profiles.list();
    expect(listed.ok && listed.value.map((p) => p.name)).toEqual(['DCS F/A-18C', 'DCS UH-1H']);
    expect(await profiles.get('dcs-f-a-18c')).toEqual({
      ok: true,
      value: profile('dcs-f-a-18c', 'DCS F/A-18C'),
    });

    expect(await profiles.lastProfileId()).toBeUndefined();
    await profiles.setLastProfileId('a-huey');
    expect(await profiles.lastProfileId()).toBe('a-huey');
    expect(await profiles.uniqueId('DCS F/A-18C')).toBe('dcs-f-a-18c-2');
    expect(await profiles.uniqueId('New one')).toBe('new-one');

    await profiles.remove('a-huey');
    expect(await profiles.lastProfileId()).toBeUndefined();
    expect(await profiles.get('a-huey')).toMatchObject({
      ok: false,
      error: { code: 'profile.missing' },
    });
  });

  it('rejects invalid profiles and ids, and a broken file does not hide the others', async () => {
    const profiles = new ProfileStore(store, dataRoot);
    await profiles.save(profile('good', 'Good'));
    await fs.writeFile(path.join(dataRoot, 'profiles', 'broken.yaml'), 'name: [unclosed');
    await fs.writeFile(path.join(dataRoot, 'profiles', 'wrong.yaml'), 'id: wrong\nname: 5\n');
    await fs.writeFile(path.join(dataRoot, 'state.json'), '{not json');
    const listed = await profiles.list();
    expect(listed.ok && listed.value.map((p) => p.id)).toEqual(['good']);
    expect(await profiles.get('broken')).toMatchObject({
      ok: false,
      error: { code: 'profile.yaml' },
    });
    expect(await profiles.get('wrong')).toMatchObject({
      ok: false,
      error: { code: 'profile.invalid' },
    });
    expect(await profiles.get('..\\evil')).toMatchObject({
      ok: false,
      error: { code: 'profile.id' },
    });
    expect(await profiles.remove('..\\evil')).toMatchObject({
      ok: false,
      error: { code: 'profile.id' },
    });
    expect(await profiles.save({ ...profile('x', ''), name: '' })).toMatchObject({
      ok: false,
      error: { code: 'profile.invalid' },
    });
    expect(await profiles.lastProfileId()).toBeUndefined();
  });
});

describe('node platform', () => {
  it('Shell.run passes arguments as an array, never through a shell', async () => {
    const shell = new NodeShell();
    const result = await shell.run(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1]); process.stderr.write("e")',
      '"; & del x | echo',
    ]);
    expect(result).toEqual({
      ok: true,
      value: { code: 0, stdout: '"; & del x | echo', stderr: 'e' },
    });
    expect(await shell.run(path.join(dir, 'missing.exe'), [])).toMatchObject({
      ok: false,
      error: { code: 'shell.spawn' },
    });
    expect(await shell.launch(path.join(dir, 'missing.exe'), [])).toMatchObject({
      ok: false,
      error: { code: 'shell.launch' },
    });
  });

  it('Shell.launch starts a detached program', async () => {
    const marker = path.join(dir, 'launched.txt');
    const launched = await new NodeShell().launch(
      process.execPath,
      ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ok')`],
      { cwd: dir }
    );
    expect(launched.ok && typeof launched.value.pid).toBe('number');
    await expect
      .poll(() => fs.readFile(marker, 'utf8').catch(() => ''), { timeout: 10_000 })
      .toBe('ok');
  });

  it('RotatingFileSink appends and rotates', async () => {
    const file = path.join(dir, 'logs', 'app.log');
    const sink = new RotatingFileSink(file, 50, 2);
    sink.write('a'.repeat(40) + '\n');
    sink.write('b'.repeat(40) + '\n');
    sink.write('c'.repeat(40) + '\n');
    await sink.close();
    await sink.close();
    expect(await fs.readFile(file, 'utf8')).toBe('c'.repeat(40) + '\n');
    expect(await fs.readFile(`${file}.1`, 'utf8')).toBe('b'.repeat(40) + '\n');
    expect(await fs.readFile(`${file}.2`, 'utf8')).toBe('a'.repeat(40) + '\n');
    expect(systemClock.now()).toBeInstanceOf(Date);
  });

  it('NodeRawFs lists, copies and appends', async () => {
    const raw = new NodeRawFs();
    await raw.appendText(path.join(dir, 'x', 'a.txt'), 'one');
    await raw.appendText(path.join(dir, 'x', 'a.txt'), 'two');
    await raw.copyFile(path.join(dir, 'x', 'a.txt'), path.join(dir, 'y', 'b.txt'));
    await raw.mkdirp(path.join(dir, 'z'));
    expect(await raw.readText(path.join(dir, 'y', 'b.txt'))).toBe('onetwo');
    expect(await raw.list(path.join(dir, 'x'))).toEqual(['a.txt']);
    expect(await raw.list(path.join(dir, 'none'))).toEqual([]);
    await raw.remove(path.join(dir, 'x', 'a.txt'));
    expect(await raw.exists(path.join(dir, 'x', 'a.txt'))).toBe(false);
  });
});
