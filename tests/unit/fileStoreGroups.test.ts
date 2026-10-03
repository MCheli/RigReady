import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupFileStore, sha256 } from '../../src/core/files/fileStore';
import { createMatcher, globToRegExp } from '../../src/core/files/glob';
import { NodeRawFs } from '../../src/platform/node';
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
  outside = path.join(dir, 'Saved Games', 'DCS');
  clock = new TestClock();
  store = new BackupFileStore(new NodeRawFs(), dataRoot, clock);
});
afterEach(() => cleanup());

const DAY = 24 * 60 * 60 * 1000;

describe('glob patterns', () => {
  it('match names at any depth, folders, single levels and single characters', () => {
    expect(globToRegExp('*.lua').test('Config/Input/a.LUA')).toBe(true);
    expect(globToRegExp('*.lua').test('a.lua.bak')).toBe(false);
    expect(globToRegExp('Config/Input/**').test('Config/Input/FA-18C/joystick/x.diff.lua')).toBe(
      true
    );
    expect(globToRegExp('Config/Input/').test('Config/Input/x.lua')).toBe(true);
    expect(globToRegExp('Config/*.lua').test('Config/options.lua')).toBe(true);
    expect(globToRegExp('Config/*.lua').test('Config/Input/options.lua')).toBe(false);
    expect(globToRegExp('**/joystick/*.lua').test('joystick/a.lua')).toBe(true);
    expect(globToRegExp('**/joystick/*.lua').test('a/b/joystick/a.lua')).toBe(true);
    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('file?.txt').test('file10.txt')).toBe(false);
    expect(globToRegExp('Config\\Input\\*.lua').test('Config/Input/a.lua')).toBe(true);
    expect(globToRegExp('a+b (x86).txt').test('dir/a+b (x86).txt')).toBe(true);
  });

  it('exclude wins over include, and no include means everything', () => {
    const matches = createMatcher(['Config/**'], ['*.bak', 'Config/Logs/**']);
    expect(matches('Config/options.lua')).toBe(true);
    expect(matches('Config\\Input\\a.lua')).toBe(true);
    expect(matches('Config/options.lua.bak')).toBe(false);
    expect(matches('Config/Logs/dcs.log')).toBe(false);
    expect(matches('Scripts/Export.lua')).toBe(false);
    expect(createMatcher(undefined, ['*.png'])('a/b.txt')).toBe(true);
    expect(createMatcher(undefined, ['*.png'])('a/b.png')).toBe(false);
  });
});

describe('BackupFileStore: reading', () => {
  it('reads and writes binary content exactly, and reports metadata', async () => {
    const bytes = new Uint8Array([0, 255, 1, 128, 13, 10, 0]);
    const file = path.join(outside, 'controls.cfg');
    expect((await store.write(file, bytes, { reason: 'binary' })).ok).toBe(true);
    const read = await store.readBytes(file);
    expect(read.ok && [...read.value]).toEqual([...bytes]);
    const stat = await store.stat(file);
    expect(stat.ok && stat.value).toMatchObject({
      name: 'controls.cfg',
      path: file,
      isDirectory: false,
      size: 7,
    });
    expect(stat.ok && stat.value!.mtimeMs).toBeGreaterThan(0);
    expect(await store.stat(path.join(outside, 'nope'))).toEqual({ ok: true, value: undefined });
    expect(await store.readBytes(path.join(outside, 'nope'))).toMatchObject({
      ok: false,
      error: { code: 'file.read' },
    });
    const folder = await store.stat(outside);
    expect(folder.ok && folder.value?.isDirectory).toBe(true);
  });

  it('lists a folder with metadata, and a tree with include and exclude patterns', async () => {
    await fs.mkdir(path.join(outside, 'Config', 'Input', 'FA-18C', 'joystick'), {
      recursive: true,
    });
    await fs.writeFile(path.join(outside, 'Config', 'options.lua'), 'options');
    await fs.writeFile(
      path.join(outside, 'Config', 'Input', 'FA-18C', 'joystick', 'a.diff.lua'),
      'a'
    );
    await fs.writeFile(path.join(outside, 'Config', 'Input', 'FA-18C', 'joystick', 'b.bak'), 'b');
    await fs.writeFile(path.join(outside, 'dcs.log'), 'log');

    const entries = await store.listEntries(outside);
    expect(entries.ok && entries.value.map((e) => [e.name, e.isDirectory, e.size])).toEqual([
      ['Config', true, 0],
      ['dcs.log', false, 3],
    ]);
    expect(await store.listEntries(path.join(outside, 'nope'))).toEqual({ ok: true, value: [] });

    const all = await store.listTree(outside);
    expect(all.ok && all.value.map((e) => e.relativePath)).toEqual([
      'Config/Input/FA-18C/joystick/a.diff.lua',
      'Config/Input/FA-18C/joystick/b.bak',
      'Config/options.lua',
      'dcs.log',
    ]);
    const lua = await store.listTree(outside, { include: ['*.lua'], exclude: ['Config/Input/**'] });
    expect(lua.ok && lua.value.map((e) => e.relativePath)).toEqual(['Config/options.lua']);
    expect(lua.ok && lua.value[0]).toMatchObject({
      name: 'options.lua',
      path: path.join(outside, 'Config', 'options.lua'),
      size: 7,
      isDirectory: false,
    });
    expect(await store.listTree(outside, { maxEntries: 2 })).toMatchObject({
      ok: false,
      error: { code: 'file.tooMany' },
    });
    expect(await store.listTree(path.join(outside, 'nope'))).toEqual({ ok: true, value: [] });
  });

  it('creates folders, and refuses relative ones', async () => {
    const made = path.join(outside, 'Kneeboard', 'FA-18C_hornet');
    expect(await store.mkdir(made)).toEqual({ ok: true, value: undefined });
    expect((await fs.stat(made)).isDirectory()).toBe(true);
    expect(await store.mkdir('relative')).toMatchObject({
      ok: false,
      error: { code: 'file.relative' },
    });
    // An empty folder is not a change worth journaling.
    expect(await store.journal()).toEqual({ ok: true, value: [] });
  });
});

describe('BackupFileStore: copies and groups', () => {
  it('copy backs up and journals the destination like a write', async () => {
    const source = path.join(dataRoot, 'snapshots', 'a.lua');
    const target = path.join(outside, 'a.lua');
    await store.write(source, 'snapshot', { reason: 'seed' });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(target, 'current');
    const copied = await store.copy(source, target, { reason: 'Restore a.lua' });
    expect(copied.ok && copied.value).toMatchObject({ action: 'write', reason: 'Restore a.lua' });
    expect(await fs.readFile(target, 'utf8')).toBe('snapshot');
    if (!copied.ok || !copied.value) throw new Error('expected a journal entry');
    expect(await fs.readFile(copied.value.backupPath!, 'utf8')).toBe('current');
    expect(copied.value.hashBefore).toBe(sha256('current'));
    expect(copied.value.hashAfter).toBe(sha256('snapshot'));
    expect(await store.copy(path.join(dir, 'missing'), target, { reason: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'file.read' },
    });
  });

  it('copyTree is one journal group that is undone together', async () => {
    const from = path.join(dataRoot, 'backup', 'Input');
    await store.write(path.join(from, 'joystick', 'stick.diff.lua'), 'new stick', { reason: 's' });
    await store.write(path.join(from, 'joystick', 'pedals.diff.lua'), 'new pedals', {
      reason: 's',
    });
    await store.write(path.join(from, 'notes.txt'), 'skip me', { reason: 's' });
    const to = path.join(outside, 'Config', 'Input');
    await fs.mkdir(path.join(to, 'joystick'), { recursive: true });
    await fs.writeFile(path.join(to, 'joystick', 'stick.diff.lua'), 'old stick');

    const copied = await store.copyTree(from, to, {
      reason: 'Restore F/A-18C bindings',
      include: ['*.lua'],
    });
    if (!copied.ok) throw new Error(copied.error.message);
    expect(copied.value.files.map((f) => path.relative(to, f)).sort()).toEqual([
      path.join('joystick', 'pedals.diff.lua'),
      path.join('joystick', 'stick.diff.lua'),
    ]);
    expect(await store.exists(path.join(to, 'notes.txt'))).toBe(false);

    const groups = await store.journalGroups();
    if (!groups.ok) throw new Error('journal');
    expect(groups.value).toHaveLength(1);
    expect(groups.value[0]).toMatchObject({
      id: copied.value.group.id,
      reason: 'Restore F/A-18C bindings',
      undone: false,
    });
    expect(groups.value[0]!.entries).toHaveLength(2);

    const undone = await store.undoGroup(copied.value.group.id);
    expect(undone.ok && undone.value.undone).toBe(true);
    expect(await fs.readFile(path.join(to, 'joystick', 'stick.diff.lua'), 'utf8')).toBe(
      'old stick'
    );
    expect(await store.exists(path.join(to, 'joystick', 'pedals.diff.lua'))).toBe(false);
    expect(await store.undoGroup(copied.value.group.id)).toMatchObject({
      ok: false,
      error: { code: 'journal.undone' },
    });
    expect(await store.undoGroup('nope')).toMatchObject({
      ok: false,
      error: { code: 'journal.missing' },
    });
    expect(await store.copyTree(from, 'relative', { reason: 'x' })).toMatchObject({
      ok: false,
      error: { code: 'file.relative' },
    });
  });

  it('writes and removes under beginGroup are one action; a lone change is its own group', async () => {
    const a = path.join(outside, 'a.lua');
    const b = path.join(outside, 'b.lua');
    await store.write(a, 'a0', { reason: 'first' });
    clock.advance(1000);
    const group = store.beginGroup('Migrate 2 device ids');
    await store.write(a, 'a1', { reason: 'rename', group });
    await store.write(b, 'b1', { reason: 'rename', group });
    await store.write(a, 'a2', { reason: 'rename', group });
    await store.remove(b, { reason: 'rename', group });

    const groups = await store.journalGroups();
    if (!groups.ok) throw new Error('journal');
    // Newest first.
    expect(groups.value.map((g) => [g.reason, g.entries.length])).toEqual([
      ['Migrate 2 device ids', 4],
      ['first', 1],
    ]);
    const undone = await store.undoGroup(group.id);
    expect(undone.ok).toBe(true);
    expect(await fs.readFile(a, 'utf8')).toBe('a0');
    expect(await store.exists(b)).toBe(false);
  });

  it('refuses to undo a file that changed since, unless forced; the undo can itself be undone', async () => {
    const file = path.join(outside, 'options.lua');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(file, 'original');
    const written = await store.write(file, 'by rigready', { reason: 'Select monitor setup' });
    if (!written.ok || !written.value) throw new Error('expected a journal entry');

    // The game (or the user) rewrites the file afterwards.
    await fs.writeFile(file, 'by the game');
    expect(await store.undo(written.value.id)).toMatchObject({
      ok: false,
      error: { code: 'journal.changed' },
    });
    expect(await store.undoGroup(written.value.id)).toMatchObject({
      ok: false,
      error: { code: 'journal.changed' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('by the game');

    const forced = await store.undoGroup(written.value.id, { force: true });
    expect(forced.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('original');

    // Undo is journaled: what it overwrote was backed up, and it can be undone.
    const groups = await store.journalGroups();
    if (!groups.ok) throw new Error('journal');
    expect(groups.value.map((g) => [g.reason, g.undone])).toEqual([
      ['Undo: Select monitor setup', false],
      ['Select monitor setup', true],
    ]);
    expect(groups.value[0]!.entries[0]!.undoOf).toBe(written.value.id);
    const redo = await store.undoGroup(groups.value[0]!.id);
    expect(redo.ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('by the game');
  });

  it('a failing backup stops the write: the target is not modified', async () => {
    const file = path.join(outside, 'Export.lua');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(file, 'keep me');
    const raw = new NodeRawFs();
    raw.copyFile = async () => {
      throw new Error('disk full');
    };
    const failing = new BackupFileStore(raw, dataRoot, clock);
    expect(await failing.write(file, 'new', { reason: 'Add export line' })).toMatchObject({
      ok: false,
      error: { code: 'file.write', detail: 'disk full' },
    });
    expect(await fs.readFile(file, 'utf8')).toBe('keep me');
    expect(await failing.journal()).toEqual({ ok: true, value: [] });
  });
});

describe('BackupFileStore: retention', () => {
  it('measures the backups and prunes those that are old and beyond the newest N actions', async () => {
    const file = path.join(outside, 'a.lua');
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(file, 'v0');
    expect(await store.backupBytes()).toEqual({ ok: true, value: 0 });
    for (let i = 1; i <= 4; i++) {
      await store.write(file, `v${i}`, { reason: `change ${i}` });
      clock.advance(20 * DAY);
    }
    // Four backups of two bytes each.
    expect(await store.backupBytes()).toEqual({ ok: true, value: 8 });

    // Changes are now 80, 60, 40 and 20 days old. Keep 30 days, but always the newest 2.
    const pruned = await store.prune({ days: 30, groups: 2 });
    expect(pruned).toEqual({ ok: true, value: { removedGroups: 2, freedBytes: 4 } });
    const groups = await store.journalGroups();
    expect(groups.ok && groups.value.map((g) => g.reason)).toEqual(['change 4', 'change 3']);
    expect(await store.backupBytes()).toEqual({ ok: true, value: 4 });
    // The kept ones can still be undone.
    if (!groups.ok) throw new Error('journal');
    expect((await store.undoGroup(groups.value[0]!.id)).ok).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('v3');

    // Nothing is old enough: nothing happens.
    expect(await store.prune({ days: 365, groups: 1 })).toEqual({
      ok: true,
      value: { removedGroups: 0, freedBytes: 0 },
    });
    // Everything beyond the newest one is older than a day by now.
    clock.advance(2 * DAY);
    const again = await store.prune({ days: 1, groups: 1 });
    expect(again.ok && again.value.removedGroups).toBe(2);
    const left = await store.journalGroups();
    expect(left.ok && left.value.map((g) => g.reason)).toEqual(['Undo: change 4']);
  });
});
