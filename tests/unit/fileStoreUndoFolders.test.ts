import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BackupFileStore } from '../../src/core/files/fileStore';
import { NodeRawFs } from '../../src/platform/node';
import { tempDir, TestClock } from '../helpers';

let dir: string;
let cleanup: () => Promise<void>;
let dataRoot: string;
let saved: string;
let store: BackupFileStore;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir());
  dataRoot = path.join(dir, '.rigready');
  saved = path.join(dir, 'Saved Games');
  await fs.mkdir(saved, { recursive: true });
  store = new BackupFileStore(new NodeRawFs(), dataRoot, new TestClock());
});
afterEach(() => cleanup());

const exists = (p: string): Promise<boolean> =>
  fs.stat(p).then(
    () => true,
    () => false
  );

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('undo removes the folders a change created', () => {
  it('journals the folders a write had to create, innermost first, and nothing for a folder that was there', async () => {
    const file = path.join(saved, 'DCS', 'Config', 'Input', 'a.lua');
    const entry = unwrap(await store.write(file, 'a', { reason: 'Import' }))!;
    expect(entry.createdDirs).toEqual([
      path.join(saved, 'DCS', 'Config', 'Input'),
      path.join(saved, 'DCS', 'Config'),
      path.join(saved, 'DCS'),
    ]);
    const second = unwrap(
      await store.write(path.join(saved, 'DCS', 'Config', 'b.lua'), 'b', { reason: 'Import' })
    )!;
    expect(second.createdDirs).toBeUndefined();
    const again = unwrap(await store.write(file, 'a2', { reason: 'Edit' }))!;
    expect(again.createdDirs).toBeUndefined();
  });

  it('undoing a group removes every folder it created and leaves the folder that existed before', async () => {
    const group = store.beginGroup('Import "Squadron setup"');
    const opts = { reason: 'Import', group };
    unwrap(await store.write(path.join(saved, 'DCS', 'Config', 'Input', 'a.lua'), 'a', opts));
    unwrap(await store.write(path.join(saved, 'DCS', 'Config', 'Input', 'b.lua'), 'b', opts));
    unwrap(await store.write(path.join(saved, 'DCS', 'Config', 'options.lua'), 'o', opts));
    unwrap(await store.write(path.join(saved, 'DCS', 'Scripts', 'Export.lua'), 'e', opts));

    unwrap(await store.undoGroup(group.id));
    expect(await exists(path.join(saved, 'DCS'))).toBe(false);
    expect(await exists(saved)).toBe(true);
    expect(await fs.readdir(saved)).toEqual([]);
  });

  it('keeps a created folder that holds anything else afterwards, and every folder above it', async () => {
    const group = store.beginGroup('Import');
    const opts = { reason: 'Import', group };
    unwrap(await store.write(path.join(saved, 'DCS', 'Config', 'Input', 'a.lua'), 'a', opts));
    unwrap(await store.write(path.join(saved, 'DCS', 'Scripts', 'Export.lua'), 'e', opts));
    // The user (or the game) put something into one of the new folders since.
    await fs.writeFile(path.join(saved, 'DCS', 'Config', 'mine.txt'), 'keep me');

    unwrap(await store.undoGroup(group.id));
    expect(await exists(path.join(saved, 'DCS', 'Config', 'Input'))).toBe(false);
    expect(await exists(path.join(saved, 'DCS', 'Scripts'))).toBe(false);
    expect(await fs.readFile(path.join(saved, 'DCS', 'Config', 'mine.txt'), 'utf8')).toBe(
      'keep me'
    );
    expect(await exists(path.join(saved, 'DCS'))).toBe(true);
  });

  it('never removes a folder that existed before the change, even when the undo leaves it empty', async () => {
    const existing = path.join(saved, 'DCS', 'Config');
    await fs.mkdir(existing, { recursive: true });
    const entry = unwrap(
      await store.write(path.join(existing, 'Input', 'a.lua'), 'a', { reason: 'Import' })
    )!;
    expect(entry.createdDirs).toEqual([path.join(existing, 'Input')]);
    unwrap(await store.undoGroup(entry.groupId!));
    expect(await exists(path.join(existing, 'Input'))).toBe(false);
    expect(await exists(existing)).toBe(true);
  });

  it('undoing one change of several keeps the folder the others still use; the last one removes it', async () => {
    const first = unwrap(
      await store.write(path.join(saved, 'New', 'a.txt'), 'a', { reason: 'One' })
    )!;
    const second = unwrap(
      await store.write(path.join(saved, 'New', 'b.txt'), 'b', { reason: 'Two' })
    )!;
    unwrap(await store.undo(first.id));
    expect(await fs.readdir(path.join(saved, 'New'))).toEqual(['b.txt']);
    // The folder was created by the first change; the second leaves it when it goes,
    // because only the change that created a folder may remove it.
    unwrap(await store.undo(second.id));
    expect(await exists(path.join(saved, 'New'))).toBe(true);
    expect(await fs.readdir(path.join(saved, 'New'))).toEqual([]);
  });

  it('an undo that puts a removed file back can itself be undone, folders included', async () => {
    const file = path.join(saved, 'Tool', 'profiles', 'p.json');
    const created = unwrap(await store.write(file, 'p', { reason: 'Import' }))!;
    unwrap(await store.undoGroup(created.groupId!));
    expect(await exists(path.join(saved, 'Tool'))).toBe(false);
    // Undo the undo: the file and its folders are back.
    const groups = unwrap(await store.journalGroups());
    const undo = groups.find((g) => g.reason.startsWith('Undo: '))!;
    unwrap(await store.undoGroup(undo.id));
    expect(await fs.readFile(file, 'utf8')).toBe('p');
  });

  it('ignores journal folders that are not directly above the file', async () => {
    const file = path.join(saved, 'A', 'a.txt');
    const other = path.join(saved, 'Other');
    await fs.mkdir(other);
    const entry = unwrap(await store.write(file, 'a', { reason: 'Import' }))!;
    // A journal edited by hand (or damaged) names a folder elsewhere.
    const journal = path.join(dataRoot, 'journal.jsonl');
    const text = await fs.readFile(journal, 'utf8');
    await fs.writeFile(
      journal,
      text.replace(JSON.stringify(path.join(saved, 'A')), JSON.stringify(other))
    );
    unwrap(await store.undo(entry.id));
    expect(await exists(other)).toBe(true);
    expect(await exists(file)).toBe(false);
  });

  it('a journaled file inside the data root gives its new folder back too', async () => {
    const file = path.join(dataRoot, 'profiles', 'imported.yaml');
    const entry = unwrap(
      await store.write(file, 'id: imported', { reason: 'Import', journal: true })
    )!;
    expect(entry.createdDirs).toEqual([path.join(dataRoot, 'profiles'), dataRoot]);
    unwrap(await store.undo(entry.id));
    expect(await exists(path.join(dataRoot, 'profiles'))).toBe(false);
    // The data root holds the journal: it is not empty and stays.
    expect(await exists(dataRoot)).toBe(true);
  });
});
