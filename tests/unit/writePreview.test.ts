import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { changePreview, lineChanges, previewWrites, sizeText } from '../../src/core/files/preview';
import { ChangePreviewSchema } from '../../src/shared/changePreview';
import { NodeRawFs } from '../../src/platform/node';
import { tempDir, TestClock } from '../helpers';

let dir: string;
let cleanup: () => Promise<void>;
let dataRoot: string;
let outside: string;
let store: BackupFileStore;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  dataRoot = path.join(dir, '.rigready');
  outside = path.join(dir, 'Documents', 'iRacing');
  await fs.mkdir(outside, { recursive: true });
  store = new BackupFileStore(new NodeRawFs(), dataRoot, new TestClock());
});
afterEach(() => cleanup());

describe('previewWrites: what will be written, before it is', () => {
  it('says which files are created, modified, unchanged, renamed and deleted, with sizes', async () => {
    await fs.writeFile(path.join(outside, 'app.ini'), 'a=1\nb=2\nc=3\n');
    await fs.writeFile(path.join(outside, 'same.ini'), 'x=1\n');
    await fs.writeFile(path.join(outside, 'old name.cfg'), 'bindings');
    await fs.writeFile(path.join(outside, 'stale.cfg'), 'gone soon');
    const before = await fs.readdir(outside);

    const preview = await previewWrites(store, [
      { path: path.join(outside, 'app.ini'), content: 'a=1\nb=5\nc=3\nd=4\n' },
      { path: path.join(outside, 'same.ini'), content: 'x=1\n' },
      { path: path.join(outside, 'new.ini'), content: new Uint8Array(2048) },
      {
        path: path.join(outside, 'new name.cfg'),
        content: 'bindings',
        from: path.join(outside, 'old name.cfg'),
      },
      { path: path.join(outside, 'stale.cfg'), remove: true },
      { path: path.join(outside, 'never-there.cfg'), remove: true },
    ]);
    expect(preview.ok && preview.value.entries.map((e) => [e.name, e.change, e.summary])).toEqual([
      ['app.ini', 'modified', '2 lines added, 1 removed'],
      ['same.ini', 'unchanged', 'Identical: left as it is'],
      ['new.ini', 'created', 'New file (2 KB)'],
      ['new name.cfg', 'renamed', 'Renamed from old name.cfg'],
      ['stale.cfg', 'deleted', 'Deleted (9 bytes)'],
      ['never-there.cfg', 'unchanged', 'Not there: nothing to delete'],
    ]);
    expect(preview.ok && preview.value).toMatchObject({
      created: 1,
      modified: 1,
      unchanged: 2,
      renamed: 1,
      deleted: 1,
      summary: '1 file modified, 1 file created, 1 file renamed, 1 file deleted, 2 files unchanged',
    });
    const app = preview.ok ? preview.value.entries[0]! : undefined;
    expect(app).toMatchObject({ sizeBefore: 12, sizeAfter: 16 });
    expect(preview.ok && preview.value.entries[2]).toMatchObject({ sizeAfter: 2048 });
    expect(preview.ok && preview.value.entries[2]).not.toHaveProperty('sizeBefore');
    expect(preview.ok && preview.value.entries[3]!.from).toBe(path.join(outside, 'old name.cfg'));

    // A preview writes nothing and journals nothing.
    expect(await fs.readdir(outside)).toEqual(before);
    const journal = await store.journal();
    expect(journal.ok && journal.value).toEqual([]);
  });

  it('summarises binary files by size, and text that differs only in line endings', async () => {
    const cfg = path.join(outside, 'controls.cfg');
    await fs.writeFile(cfg, new Uint8Array([0, 1, 2, 3]));
    await fs.writeFile(path.join(outside, 'crlf.ini'), 'a=1\r\nb=2\r\n');
    const preview = await previewWrites(store, [
      { path: cfg, content: new Uint8Array([0, 9, 9, 9]) },
      { path: cfg, content: new Uint8Array(3000) },
      { path: path.join(outside, 'crlf.ini'), content: 'a=1\nb=2\n' },
      { path: path.join(outside, 'replaced.cfg'), content: 'x', from: cfg },
    ]);
    expect(preview.ok && preview.value.entries.map((e) => e.summary)).toEqual([
      'Different content, same size (4 bytes)',
      '4 bytes to 3 KB',
      'Line endings or spacing only',
      'Renamed from controls.cfg',
    ]);
    await fs.writeFile(path.join(outside, 'replaced.cfg'), 'already here');
    const again = await previewWrites(store, [
      { path: path.join(outside, 'replaced.cfg'), content: 'x', from: cfg },
    ]);
    expect(again.ok && again.value.entries[0]!.summary).toBe(
      'Renamed from controls.cfg, replacing the file already there'
    );
    expect((await previewWrites(store, [])).ok).toBe(true);
    const empty = await previewWrites(store, []);
    expect(empty.ok && empty.value.summary).toBe('Nothing to write');
  });

  it('fails rather than guess when a file that is there cannot be read', async () => {
    const locked = path.join(outside, 'locked.ini');
    await fs.writeFile(locked, 'x');
    const files = {
      exists: (file: string) => store.exists(file),
      readBytes: async () => ({
        ok: false as const,
        error: { code: 'file.read', message: `Could not read ${locked}.` },
      }),
    };
    expect(await previewWrites(files, [{ path: locked, content: 'y' }])).toMatchObject({
      ok: false,
      error: { code: 'file.read' },
    });
  });

  it('counts changed lines and formats sizes', () => {
    expect(lineChanges('a\nb\nc', 'a\nc\nd\ne')).toEqual({ added: 2, removed: 1 });
    expect(lineChanges('a\na\nb', 'a\nb')).toEqual({ added: 0, removed: 1 });
    expect(sizeText(1)).toBe('1 byte');
    expect(sizeText(900)).toBe('900 bytes');
    expect(sizeText(30 * 1024)).toBe('30 KB');
    expect(sizeText(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('gives the shape that crosses IPC and that the shared list shows, with labels', async () => {
    await fs.writeFile(path.join(outside, 'app.ini'), 'a=1\n');
    const planned = [
      { path: path.join(outside, 'app.ini'), content: 'a=2\n' },
      { path: path.join(outside, 'setups', 'car.cfg'), content: 'x' },
    ];
    const plain = await changePreview(store, planned);
    expect(plain.ok && plain.value).toEqual({
      summary: '1 file modified, 1 file created',
      files: [
        {
          path: path.join(outside, 'app.ini'),
          label: 'app.ini',
          change: 'modified',
          detail: '1 line added, 1 removed',
        },
        {
          path: path.join(outside, 'setups', 'car.cfg'),
          label: 'car.cfg',
          change: 'created',
          detail: 'New file (1 byte)',
        },
      ],
    });
    expect(ChangePreviewSchema.safeParse(plain.ok && plain.value).success).toBe(true);
    const labelled = await changePreview(store, planned, (write, index) =>
      index === 1 ? path.relative(outside, write.path).replace(/\\/g, '/') : undefined
    );
    expect(labelled.ok && labelled.value.files.map((f) => f.label)).toEqual([
      'app.ini',
      'setups/car.cfg',
    ]);
    // An unreadable file fails the preview, as in previewWrites.
    await fs.mkdir(path.join(outside, 'folder.cfg'));
    const failed = await changePreview(store, [
      { path: path.join(outside, 'folder.cfg'), content: 'x' },
    ]);
    expect(failed.ok).toBe(false);
  });
});

/** What every line of the change journal must have: BACKUP-011. */
const JournalLineSchema = z.object({
  id: z.string().min(1),
  time: z.string().min(1),
  path: z.string().min(1),
  action: z.enum(['write', 'remove']),
  /** Why, in words the user reads. */
  reason: z.string().min(1),
  /** The user action the change belongs to: never absent. */
  groupId: z.string().min(1),
  groupReason: z.string().min(1),
});

describe('the change journal', () => {
  it('has no entry without the id and the reason of the action it belongs to', async () => {
    const file = (name: string): string => path.join(outside, name);
    // Every kind of change a feature can make: alone, grouped, and the undo of each.
    const lone = await store.write(file('lone.ini'), 'a', { reason: 'Set the MFD export' });
    await store.copy(file('lone.ini'), file('copied.ini'), { reason: 'Copy bindings' });
    await store.move(file('copied.ini'), file('moved.ini'), { reason: 'Rename a device file' });
    await store.remove(file('moved.ini'), { reason: 'Clear a device' });
    await fs.mkdir(path.join(outside, 'tree'), { recursive: true });
    await fs.writeFile(path.join(outside, 'tree', 'one.diff'), '1');
    await store.copyTree(path.join(outside, 'tree'), path.join(outside, 'tree copy'), {
      reason: 'Copy older bindings',
    });
    const group = store.beginGroup('Restore a backup');
    await store.write(file('a.ini'), 'a', { reason: 'Restore a backup', group });
    await store.write(file('b.ini'), 'b', { reason: 'Restore a backup', group });
    await store.write(path.join(dataRoot, 'profiles', 'p.yaml'), 'id: p', {
      reason: 'Import setup',
      journal: true,
    });
    if (lone.ok && lone.value) await store.undo(lone.value.id);
    await store.undoGroup(group.id);

    const raw = await fs.readFile(path.join(dataRoot, 'journal.jsonl'), 'utf8');
    const lines = raw
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const entries = lines.filter((line) => !('undo' in line));
    expect(entries.length).toBeGreaterThanOrEqual(11);
    for (const entry of entries) {
      const parsed = JournalLineSchema.safeParse(entry);
      expect(parsed.success, JSON.stringify(entry)).toBe(true);
    }
    // A lone change is an action of its own, named by its reason.
    const first = entries.find((e) => String(e['path']).endsWith('lone.ini'))!;
    expect(first['groupId']).toBe(first['id']);
    expect(first['groupReason']).toBe('Set the MFD export');

    // The Safety page lists each of them as one action.
    const groups = await store.journalGroups();
    expect(groups.ok && groups.value.map((g) => g.reason)).toEqual([
      'Undo: Restore a backup',
      'Undo: Set the MFD export',
      'Import setup',
      'Restore a backup',
      'Copy older bindings',
      'Clear a device',
      'Rename a device file',
      'Copy bindings',
      'Set the MFD export',
    ]);
  });

  it('still reads a journal written before lone changes had an action id', async () => {
    const target = path.join(outside, 'old.ini');
    await fs.writeFile(target, 'new');
    await fs.mkdir(dataRoot, { recursive: true });
    await fs.writeFile(
      path.join(dataRoot, 'journal.jsonl'),
      JSON.stringify({
        id: '2026-01-01T00-00-00-000Z-001',
        time: '2026-01-01T00:00:00.000Z',
        path: target,
        action: 'write',
        reason: 'Old change',
        backupPath: null,
        undone: false,
      }) + '\n'
    );
    const groups = await store.journalGroups();
    expect(groups.ok && groups.value).toMatchObject([
      { id: '2026-01-01T00-00-00-000Z-001', reason: 'Old change' },
    ]);
    const undone = await store.undoGroup('2026-01-01T00-00-00-000Z-001', { force: true });
    expect(undone.ok).toBe(true);
    expect(await store.exists(target)).toBe(false);
  });
});
