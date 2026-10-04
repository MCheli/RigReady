import { createHash } from 'node:crypto';
import path from 'node:path';
import { isWithin } from '../paths';
import type {
  ChangeGroup,
  ChangeOptions,
  Clock,
  FileEntry,
  FileStore,
  JournalEntry,
  JournalGroup,
  RawFs,
  TreeEntry,
  TreeOptions,
  UndoOptions,
} from '../ports';
import { err, fromThrown, ok, type Result } from '../result';
import { createMatcher } from './glob';
import { stripBom } from './text';

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

type JournalLine = JournalEntry | { undo: string };

/** One line of journal.jsonl: what it says, or only its text when it cannot be read. */
export interface JournalFileLine {
  raw: string;
  record?: JournalLine;
}

const isText = (value: unknown): value is string => typeof value === 'string';

/**
 * Reads the journal file line by line. A line that is not a journal record (cut off by
 * a crash while it was being written, or damaged later) is kept as text and does not
 * stop the others from being read: one bad line must not take Undo away for every change.
 */
export function parseJournal(text: string): JournalFileLine[] {
  const lines: JournalFileLine[] = [];
  for (const raw of stripBom(text).split(/\r?\n/)) {
    if (raw.trim().length === 0) continue;
    let record: JournalLine | undefined;
    try {
      // Only a JSON object can be a record; looking first keeps a large damaged file quick.
      const value = raw.trimStart().startsWith('{')
        ? (JSON.parse(raw) as Record<string, unknown> | null)
        : null;
      if (value && typeof value === 'object') {
        if (isText(value['undo'])) record = { undo: value['undo'] };
        else if (
          isText(value['id']) &&
          isText(value['path']) &&
          isText(value['time']) &&
          isText(value['reason']) &&
          (value['action'] === 'write' || value['action'] === 'remove') &&
          (value['backupPath'] === null || isText(value['backupPath']))
        ) {
          record = value as unknown as JournalEntry;
        }
      }
    } catch {
      // Not JSON: kept as a damaged line below.
    }
    lines.push(record ? { raw, record } : { raw });
  }
  return lines;
}

/**
 * The one way RigReady changes files. A write, copy or remove outside the data root
 * first copies the existing file to <data root>/backups/auto/<id>/ and appends an
 * entry to <data root>/journal.jsonl, which the UI can list and undo. Changes made
 * under one beginGroup() are one user action and are undone together.
 */
export class BackupFileStore implements FileStore {
  private sequence = 0;

  constructor(
    private readonly raw: RawFs,
    private readonly dataRoot: string,
    private readonly clock: Clock
  ) {}

  private get journalPath(): string {
    return path.join(this.dataRoot, 'journal.jsonl');
  }

  private get backupRoot(): string {
    return path.join(this.dataRoot, 'backups', 'auto');
  }

  private nextId(): string {
    const stamp = this.clock.now().toISOString().replace(/[:.]/g, '-');
    return `${stamp}-${String(++this.sequence).padStart(3, '0')}`;
  }

  async readText(file: string): Promise<Result<string>> {
    try {
      return ok(await this.raw.readText(file));
    } catch (e) {
      return fromThrown('file.read', `Could not read ${file}.`, e);
    }
  }

  async readBytes(file: string): Promise<Result<Uint8Array>> {
    try {
      return ok(await this.raw.readBytes(file));
    } catch (e) {
      return fromThrown('file.read', `Could not read ${file}.`, e);
    }
  }

  exists(file: string): Promise<boolean> {
    return this.raw.exists(file);
  }

  async stat(file: string): Promise<Result<FileEntry | undefined>> {
    try {
      const stat = await this.raw.stat(file);
      if (!stat) return ok(undefined);
      return ok({ name: path.basename(file), path: path.resolve(file), ...stat });
    } catch (e) {
      return fromThrown('file.stat', `Could not read ${file}.`, e);
    }
  }

  async list(dir: string): Promise<Result<string[]>> {
    try {
      return ok(await this.raw.list(dir));
    } catch (e) {
      return fromThrown('file.list', `Could not list ${dir}.`, e);
    }
  }

  async listEntries(dir: string): Promise<Result<FileEntry[]>> {
    try {
      const entries: FileEntry[] = [];
      for (const name of await this.raw.list(dir)) {
        const full = path.join(dir, name);
        const stat = await this.raw.stat(full);
        // An entry can vanish between the listing and the stat; leave it out.
        if (stat) entries.push({ name, path: full, ...stat });
      }
      return ok(entries);
    } catch (e) {
      return fromThrown('file.list', `Could not list ${dir}.`, e);
    }
  }

  async listTree(dir: string, options: TreeOptions = {}): Promise<Result<TreeEntry[]>> {
    const matches = createMatcher(options.include, options.exclude);
    const max = options.maxEntries ?? 20_000;
    const found: TreeEntry[] = [];
    const walk = async (folder: string, prefix: string): Promise<boolean> => {
      for (const name of await this.raw.list(folder)) {
        const full = path.join(folder, name);
        const stat = await this.raw.stat(full);
        if (!stat) continue;
        const relativePath = prefix ? `${prefix}/${name}` : name;
        if (stat.isDirectory) {
          if (!(await walk(full, relativePath))) return false;
        } else if (matches(relativePath)) {
          if (found.length >= max) return false;
          found.push({ name, path: full, relativePath, ...stat });
        }
      }
      return true;
    };
    try {
      if (!(await walk(dir, ''))) {
        return err('file.tooMany', `${dir} holds more than ${max} files.`);
      }
      return ok(found);
    } catch (e) {
      return fromThrown('file.list', `Could not list ${dir}.`, e);
    }
  }

  async mkdir(dir: string): Promise<Result<void>> {
    if (!path.isAbsolute(dir)) return err('file.relative', `The path must be absolute: ${dir}`);
    try {
      await this.raw.mkdirp(dir);
      return ok(undefined);
    } catch (e) {
      return fromThrown('file.mkdir', `Could not create ${dir}.`, e);
    }
  }

  beginGroup(reason: string): ChangeGroup {
    return { id: this.nextId(), reason };
  }

  async write(
    file: string,
    content: string | Uint8Array,
    options: ChangeOptions
  ): Promise<Result<JournalEntry | null>> {
    const lossy = await this.lossyRewrite(file, content);
    if (lossy) return lossy;
    return this.change(file, 'write', options, sha256(content), () =>
      this.raw.writeBytes(file, content)
    );
  }

  /**
   * A file that is not UTF-8 (a game file in a Windows code page, UTF-16) reads as text
   * with U+FFFD where its bytes meant something else. Writing such text back would
   * destroy those characters for good, so it is refused: the text has the replacement
   * character and the file on disk does not.
   */
  private async lossyRewrite(
    file: string,
    content: string | Uint8Array
  ): Promise<Result<never> | undefined> {
    if (typeof content !== 'string' || !content.includes('�')) return undefined;
    if (!path.isAbsolute(file) || isWithin(this.dataRoot, path.resolve(file))) return undefined;
    try {
      if (!(await this.raw.exists(file))) return undefined;
      const current = await this.raw.readBytes(file);
      for (let i = 0; i + 2 < current.length; i++) {
        if (current[i] === 0xef && current[i + 1] === 0xbf && current[i + 2] === 0xbd) {
          return undefined;
        }
      }
    } catch (e) {
      return fromThrown('file.write', `Could not write ${file}.`, e);
    }
    return err(
      'file.encoding',
      `${file} is not UTF-8 text, so RigReady cannot change it without damaging characters in it. It was left as it is.`
    );
  }

  async remove(file: string, options: ChangeOptions): Promise<Result<JournalEntry | null>> {
    if (!(await this.raw.exists(file))) return ok(null);
    return this.change(file, 'remove', options, null, () => this.raw.remove(file));
  }

  async copy(
    from: string,
    to: string,
    options: ChangeOptions
  ): Promise<Result<JournalEntry | null>> {
    const bytes = await this.readBytes(from);
    if (!bytes.ok) return bytes;
    return this.write(to, bytes.value, options);
  }

  async move(from: string, to: string, options: ChangeOptions): Promise<Result<ChangeGroup>> {
    const group = options.group ?? this.beginGroup(options.reason);
    if (path.resolve(from).toLowerCase() === path.resolve(to).toLowerCase()) return ok(group);
    const copied = await this.copy(from, to, { reason: options.reason, group });
    if (!copied.ok) return copied;
    const removed = await this.remove(from, { reason: options.reason, group });
    if (!removed.ok) return removed;
    return ok(group);
  }

  async copyTree(
    fromDir: string,
    toDir: string,
    options: ChangeOptions & TreeOptions
  ): Promise<Result<{ group: ChangeGroup; files: string[] }>> {
    if (!path.isAbsolute(toDir)) return err('file.relative', `The path must be absolute: ${toDir}`);
    const tree = await this.listTree(fromDir, options);
    if (!tree.ok) return tree;
    const group = options.group ?? this.beginGroup(options.reason);
    const files: string[] = [];
    for (const entry of tree.value) {
      const target = path.join(toDir, ...entry.relativePath.split('/'));
      const copied = await this.copy(entry.path, target, { reason: options.reason, group });
      if (!copied.ok) return copied;
      files.push(target);
    }
    return ok({ group, files });
  }

  private async change(
    file: string,
    action: JournalEntry['action'],
    options: ChangeOptions & { undoOf?: string },
    hashAfter: string | null,
    perform: () => Promise<void>
  ): Promise<Result<JournalEntry | null>> {
    if (!path.isAbsolute(file)) return err('file.relative', `The path must be absolute: ${file}`);
    const target = path.resolve(file);
    try {
      if (isWithin(this.dataRoot, target) && !options.journal) {
        await perform();
        return ok(null);
      }
      const now = this.clock.now();
      const id = this.nextId();
      let backupPath: string | null = null;
      let hashBefore: string | null = null;
      if (await this.raw.exists(target)) {
        backupPath = path.join(this.backupRoot, id, path.basename(target));
        await this.raw.copyFile(target, backupPath);
        // Hash the copy: it is what an undo would put back.
        hashBefore = sha256(await this.raw.readBytes(backupPath));
      }
      const createdDirs = action === 'write' && !backupPath ? await this.missingDirs(target) : [];
      // The journal is written before the change: a crash leaves a record, never a silent edit.
      const entry: JournalEntry = {
        id,
        time: now.toISOString(),
        path: target,
        action,
        reason: options.reason,
        backupPath,
        hashBefore,
        hashAfter,
        // A change made outside a beginGroup() is an action of its own: every entry
        // names the user action it belongs to, so the Safety page lists it as one.
        groupId: options.group?.id ?? id,
        groupReason: options.group?.reason ?? options.reason,
        ...(options.undoOf ? { undoOf: options.undoOf } : {}),
        ...(createdDirs.length > 0 ? { createdDirs } : {}),
        undone: false,
      };
      await this.appendJournal(entry);
      await perform();
      return ok(entry);
    } catch (e) {
      return fromThrown(`file.${action}`, `Could not ${action} ${target}.`, e);
    }
  }

  /** The folders above `file` that do not exist yet, innermost first. */
  private async missingDirs(file: string): Promise<string[]> {
    const missing: string[] = [];
    let dir = path.dirname(file);
    while (!(await this.raw.exists(dir))) {
      missing.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return missing;
  }

  /**
   * After an undo removed the file a change created: removes the folders that change
   * created for it, innermost first, stopping at the first that still holds something.
   * Only folders named in the journal entry are touched, and only while they lie above
   * the file, so a folder that was there before, or that anything else was put into,
   * always stays.
   */
  private async removeCreatedDirs(entry: JournalEntry): Promise<void> {
    let expected = path.dirname(entry.path);
    for (const dir of entry.createdDirs ?? []) {
      if (path.resolve(dir) !== expected) return;
      if (!(await this.raw.removeEmptyDir(dir))) return;
      expected = path.dirname(expected);
    }
  }

  private journalChecked = false;

  private async appendJournal(record: JournalLine): Promise<void> {
    let lead = '';
    if (!this.journalChecked) {
      // A crash while a line was being written leaves it without its line break; the
      // next record must not be glued onto that damaged line.
      if (await this.raw.exists(this.journalPath)) {
        const text = await this.raw.readText(this.journalPath);
        if (text.length > 0 && !text.endsWith('\n')) lead = '\n';
      }
      this.journalChecked = true;
    }
    await this.raw.appendText(this.journalPath, lead + JSON.stringify(record) + '\n');
  }

  private async fileLines(): Promise<JournalFileLine[]> {
    if (!(await this.raw.exists(this.journalPath))) return [];
    return parseJournal(await this.raw.readText(this.journalPath));
  }

  private async lines(): Promise<JournalLine[]> {
    return (await this.fileLines()).flatMap((line) => (line.record ? [line.record] : []));
  }

  async journal(): Promise<Result<JournalEntry[]>> {
    try {
      const entries = new Map<string, JournalEntry>();
      for (const record of await this.lines()) {
        if ('undo' in record) {
          const original = entries.get(record.undo);
          if (original) original.undone = true;
        } else {
          entries.set(record.id, record);
        }
      }
      return ok([...entries.values()].reverse());
    } catch (e) {
      return fromThrown('journal.read', 'Could not read the change journal.', e);
    }
  }

  async journalGroups(): Promise<Result<JournalGroup[]>> {
    const all = await this.journal();
    if (!all.ok) return all;
    const groups = new Map<string, JournalGroup>();
    // Oldest first, so a group's time and position are those of its first change.
    for (const entry of [...all.value].reverse()) {
      const id = entry.groupId ?? entry.id;
      let group = groups.get(id);
      if (!group) {
        group = {
          id,
          time: entry.time,
          reason: entry.groupReason ?? entry.reason,
          entries: [],
          undone: true,
        };
        groups.set(id, group);
      }
      group.entries.push(entry);
      if (!entry.undone) group.undone = false;
    }
    return ok([...groups.values()].reverse());
  }

  async undo(entryId: string, options: UndoOptions = {}): Promise<Result<JournalEntry>> {
    const all = await this.journal();
    if (!all.ok) return all;
    const entry = all.value.find((e) => e.id === entryId);
    if (!entry) return err('journal.missing', `There is no journal entry ${entryId}.`);
    return this.undoEntry(entry, options, undefined);
  }

  private async undoEntry(
    entry: JournalEntry,
    options: UndoOptions,
    group: ChangeGroup | undefined
  ): Promise<Result<JournalEntry>> {
    if (entry.undone) return err('journal.undone', 'That change has already been undone.');
    try {
      if (!options.force && entry.hashAfter !== undefined) {
        const current = (await this.raw.exists(entry.path))
          ? sha256(await this.raw.readBytes(entry.path))
          : null;
        if (current !== entry.hashAfter) {
          return err(
            'journal.changed',
            `${entry.path} was changed again after this. Undoing would discard that change.`
          );
        }
      }
      const change = {
        reason: `Undo: ${entry.reason}`,
        undoOf: entry.id,
        ...(group ? { group } : {}),
      };
      let undone: Result<JournalEntry | null>;
      if (entry.backupPath) {
        if (!(await this.raw.exists(entry.backupPath))) {
          return err('journal.backup', `The backup file is missing: ${entry.backupPath}`);
        }
        const previous = await this.raw.readBytes(entry.backupPath);
        undone = await this.change(entry.path, 'write', change, sha256(previous), () =>
          this.raw.writeBytes(entry.path, previous)
        );
      } else if (await this.raw.exists(entry.path)) {
        // The file did not exist before the change, so undoing means removing it.
        undone = await this.change(entry.path, 'remove', change, null, () =>
          this.raw.remove(entry.path)
        );
      } else {
        undone = ok(null);
      }
      if (!undone.ok) return undone;
      if (!entry.backupPath) await this.removeCreatedDirs(entry);
      await this.appendJournal({ undo: entry.id });
      return ok({ ...entry, undone: true });
    } catch (e) {
      return fromThrown('journal.undo', `Could not undo the change to ${entry.path}.`, e);
    }
  }

  async undoGroup(groupId: string, options: UndoOptions = {}): Promise<Result<JournalGroup>> {
    const groups = await this.journalGroups();
    if (!groups.ok) return groups;
    const group = groups.value.find((g) => g.id === groupId);
    if (!group) return err('journal.missing', `There is no journal entry ${groupId}.`);
    if (group.undone) return err('journal.undone', 'That change has already been undone.');
    const pending = group.entries.filter((e) => !e.undone).reverse();
    if (!options.force) {
      // Check everything first: an undo that stops half-way is worse than one that does not start.
      const changed: string[] = [];
      for (const entry of pending) {
        if (entry.hashAfter === undefined) continue;
        let current: string | null = null;
        if (await this.raw.exists(entry.path)) {
          try {
            current = sha256(await this.raw.readBytes(entry.path));
          } catch {
            // A file that cannot be read (locked) is not known to be unchanged: it counts as changed.
            current = 'unreadable';
          }
        }
        // Only the newest change of a file in the group is comparable with the file on disk.
        const newest = pending.find((e) => e.path === entry.path);
        if (newest === entry && current !== entry.hashAfter) changed.push(entry.path);
      }
      if (changed.length > 0) {
        return err(
          'journal.changed',
          changed.length === 1
            ? `${changed[0]} was changed again after this. Undoing would discard that change.`
            : `${changed.length} files were changed again after this. Undoing would discard those changes.`,
          changed.join('\n')
        );
      }
    }
    const undoGroup = this.beginGroup(`Undo: ${group.reason}`);
    for (const entry of pending) {
      const undone = await this.undoEntry(entry, { force: true }, undoGroup);
      if (!undone.ok) return undone;
      entry.undone = true;
    }
    return ok({ ...group, undone: true });
  }

  private async folderBytes(dir: string): Promise<number> {
    let total = 0;
    for (const name of await this.raw.list(dir)) {
      const full = path.join(dir, name);
      const stat = await this.raw.stat(full);
      if (!stat) continue;
      total += stat.isDirectory ? await this.folderBytes(full) : stat.size;
    }
    return total;
  }

  async backupBytes(): Promise<Result<number>> {
    try {
      return ok(await this.folderBytes(this.backupRoot));
    } catch (e) {
      return fromThrown('journal.size', 'Could not measure the automatic backups.', e);
    }
  }

  async prune(keep: {
    days: number;
    groups: number;
  }): Promise<Result<{ removedGroups: number; freedBytes: number }>> {
    const groups = await this.journalGroups();
    if (!groups.ok) return groups;
    const cutoff = this.clock.now().getTime() - keep.days * 24 * 60 * 60 * 1000;
    const expired = groups.value
      .slice(Math.max(0, keep.groups))
      .filter((group) => Date.parse(group.time) < cutoff);
    if (expired.length === 0) return ok({ removedGroups: 0, freedBytes: 0 });
    try {
      const gone = new Set<string>();
      let freedBytes = 0;
      for (const group of expired) {
        for (const entry of group.entries) {
          gone.add(entry.id);
          if (!entry.backupPath) continue;
          const dir = path.dirname(entry.backupPath);
          // Only ever delete inside the backup folder, whatever the journal says.
          if (!isWithin(this.backupRoot, dir) || path.resolve(dir) === this.backupRoot) continue;
          freedBytes += await this.folderBytes(dir);
          await this.raw.removeDir(dir);
        }
      }
      // Lines that could not be read are written back as they are: pruning never drops them.
      const kept = (await this.fileLines()).filter(
        ({ record }) => !record || !gone.has('undo' in record ? record.undo : record.id)
      );
      await this.raw.writeBytes(this.journalPath, kept.map((line) => line.raw + '\n').join(''));
      return ok({ removedGroups: expired.length, freedBytes });
    } catch (e) {
      return fromThrown('journal.prune', 'Could not remove old automatic backups.', e);
    }
  }
}
