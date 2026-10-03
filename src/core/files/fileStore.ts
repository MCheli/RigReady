import path from 'node:path';
import { isWithin } from '../paths';
import type { Clock, FileStore, JournalEntry, RawFs } from '../ports';
import { err, fromThrown, ok, type Result } from '../result';

/**
 * The one way RigReady changes files. A write or remove outside the data root first
 * copies the existing file to <data root>/backups/auto/<timestamp>/ and appends an
 * entry to <data root>/journal.jsonl, which the UI can list and undo.
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

  async readText(file: string): Promise<Result<string>> {
    try {
      return ok(await this.raw.readText(file));
    } catch (e) {
      return fromThrown('file.read', `Could not read ${file}.`, e);
    }
  }

  exists(file: string): Promise<boolean> {
    return this.raw.exists(file);
  }

  async list(dir: string): Promise<Result<string[]>> {
    try {
      return ok(await this.raw.list(dir));
    } catch (e) {
      return fromThrown('file.list', `Could not list ${dir}.`, e);
    }
  }

  async write(
    file: string,
    content: string | Uint8Array,
    options: { reason: string }
  ): Promise<Result<JournalEntry | null>> {
    return this.change(file, 'write', options.reason, () => this.raw.writeBytes(file, content));
  }

  async remove(file: string, options: { reason: string }): Promise<Result<JournalEntry | null>> {
    if (!(await this.raw.exists(file))) return ok(null);
    return this.change(file, 'remove', options.reason, () => this.raw.remove(file));
  }

  private async change(
    file: string,
    action: JournalEntry['action'],
    reason: string,
    perform: () => Promise<void>
  ): Promise<Result<JournalEntry | null>> {
    if (!path.isAbsolute(file)) return err('file.relative', `The path must be absolute: ${file}`);
    const target = path.resolve(file);
    try {
      if (isWithin(this.dataRoot, target)) {
        await perform();
        return ok(null);
      }
      const now = this.clock.now();
      const id = `${now.toISOString().replace(/[:.]/g, '-')}-${String(++this.sequence).padStart(3, '0')}`;
      let backupPath: string | null = null;
      if (await this.raw.exists(target)) {
        backupPath = path.join(this.dataRoot, 'backups', 'auto', id, path.basename(target));
        await this.raw.copyFile(target, backupPath);
      }
      // The journal is written before the change: a crash leaves a record, never a silent edit.
      const entry: JournalEntry = {
        id,
        time: now.toISOString(),
        path: target,
        action,
        reason,
        backupPath,
        undone: false,
      };
      await this.raw.appendText(this.journalPath, JSON.stringify(entry) + '\n');
      await perform();
      return ok(entry);
    } catch (e) {
      return fromThrown(`file.${action}`, `Could not ${action} ${target}.`, e);
    }
  }

  async journal(): Promise<Result<JournalEntry[]>> {
    if (!(await this.raw.exists(this.journalPath))) return ok([]);
    try {
      const text = await this.raw.readText(this.journalPath);
      const entries = new Map<string, JournalEntry>();
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const record = JSON.parse(line) as JournalEntry | { undo: string };
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

  async undo(entryId: string): Promise<Result<JournalEntry>> {
    const all = await this.journal();
    if (!all.ok) return all;
    const entry = all.value.find((e) => e.id === entryId);
    if (!entry) return err('journal.missing', `There is no journal entry ${entryId}.`);
    if (entry.undone) return err('journal.undone', 'That change has already been undone.');
    try {
      if (entry.backupPath) {
        if (!(await this.raw.exists(entry.backupPath))) {
          return err('journal.backup', `The backup file is missing: ${entry.backupPath}`);
        }
        await this.raw.copyFile(entry.backupPath, entry.path);
      } else {
        // The file did not exist before the change, so undoing means removing it.
        await this.raw.remove(entry.path);
      }
      await this.raw.appendText(this.journalPath, JSON.stringify({ undo: entry.id }) + '\n');
      return ok({ ...entry, undone: true });
    } catch (e) {
      return fromThrown('journal.undo', `Could not undo the change to ${entry.path}.`, e);
    }
  }
}
