import path from 'node:path';
import { sha256 } from '../../../core/files/fileStore';
import type { FileStore } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';

/**
 * File contents stored once by hash under <data root>/backup/blobs, so snapshots and
 * "last worked" fingerprints can show and put back old versions without copying the
 * same file again and again.
 */
export class BlobStore {
  constructor(
    private readonly files: FileStore,
    private readonly dataRoot: string
  ) {}

  private fileFor(hash: string): string {
    return path.join(this.dataRoot, 'backup', 'blobs', hash.slice(0, 2), hash);
  }

  async put(bytes: Uint8Array): Promise<Result<string>> {
    const hash = sha256(bytes);
    const file = this.fileFor(hash);
    if (await this.files.exists(file)) return ok(hash);
    const written = await this.files.write(file, bytes, { reason: 'RigReady data' });
    return written.ok ? ok(hash) : written;
  }

  has(hash: string): Promise<boolean> {
    return /^[0-9a-f]{64}$/.test(hash)
      ? this.files.exists(this.fileFor(hash))
      : Promise.resolve(false);
  }

  async get(hash: string): Promise<Result<Uint8Array>> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return err('blob.id', 'Not a content id.');
    const bytes = await this.files.readBytes(this.fileFor(hash));
    if (!bytes.ok) return err('blob.missing', 'The stored copy of this file is missing.');
    if (sha256(bytes.value) !== hash)
      return err('blob.damaged', 'The stored copy of this file is damaged.');
    return bytes;
  }

  /** Removes every blob not in `keep`. Returns the number removed. */
  async sweep(keep: Set<string>): Promise<number> {
    const root = path.join(this.dataRoot, 'backup', 'blobs');
    const tree = await this.files.listTree(root);
    if (!tree.ok) return 0;
    let removed = 0;
    for (const entry of tree.value) {
      if (keep.has(entry.name)) continue;
      const gone = await this.files.remove(entry.path, { reason: 'RigReady data' });
      if (gone.ok) removed++;
    }
    return removed;
  }
}
