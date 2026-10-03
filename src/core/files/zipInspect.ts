import { err, ok, type Result } from '../result';
import { safeEntryPath } from './zip';

/** What an archive's central directory says about one entry, before anything is unpacked. */
export interface ZipDirectoryEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/**
 * Reads the central directory of a zip archive without decompressing anything, so an
 * untrusted archive can be refused for what it claims to hold: symbolic links,
 * encrypted entries, unsafe names, too many entries or too many bytes.
 */
export function inspectZip(
  bytes: Uint8Array,
  limits: { maxTotalBytes: number; maxEntries?: number }
): Result<ZipDirectoryEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const notZip = err('zip.read', 'The file is not a readable zip archive.');
  if (bytes.length < 22) return notZip;
  // The end-of-central-directory record is in the last 22 + 65535 bytes.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return notZip;
  const count = view.getUint16(eocd + 10, true);
  const size = view.getUint32(eocd + 12, true);
  const offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    return err('zip.unsupported', 'Archives larger than 4 GB (zip64) are not supported.');
  }
  if (offset + size > bytes.length) return notZip;
  const maxEntries = limits.maxEntries ?? 20_000;
  if (count > maxEntries) {
    return err('zip.tooMany', `The archive holds more than ${maxEntries} files.`);
  }
  const decoder = new TextDecoder();
  const entries: ZipDirectoryEntry[] = [];
  let total = 0;
  let at = offset;
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) return notZip;
    const madeBy = view.getUint16(at + 4, true) >> 8;
    const flags = view.getUint16(at + 8, true);
    const compressedSize = view.getUint32(at + 20, true);
    const uncompressedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const external = view.getUint32(at + 38, true);
    if (at + 46 + nameLength > bytes.length) return notZip;
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    // Unix-made entries keep the file mode in the high 16 bits of the external attributes.
    if (madeBy === 3 && ((external >>> 16) & S_IFMT) === S_IFLNK)
      return err('zip.symlink', `The archive contains a link: ${name}`);
    if (flags & 1) return err('zip.encrypted', `The archive contains an encrypted file: ${name}`);
    const safe = safeEntryPath(name);
    if (!safe.ok) return safe;
    total += uncompressedSize;
    if (total > limits.maxTotalBytes) {
      return err(
        'zip.tooBig',
        `The archive unpacks to more than ${Math.round(limits.maxTotalBytes / (1024 * 1024))} MB.`
      );
    }
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      isDirectory: safe.value === undefined,
    });
  }
  return ok(entries);
}
