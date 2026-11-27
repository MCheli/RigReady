import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RawFs, RawStat } from '../ports';
import type { RegistryHive } from '../../shared/models';

/**
 * A registry value changed the way a file is: through FileStore, which copies it to
 * <data root>/backups/auto first, writes the journal, and can undo it from the Safety page.
 *
 * Some games keep their settings in the registry and not in files (a Unity game's
 * PlayerPrefs). RigReady's rule is that nothing outside its data folder changes without a
 * backup and an entry the user can undo, and FileStore is the one place that does that.
 * So a registry value gets an address FileStore can carry, `registryValuePath()`, and the
 * raw file access under FileStore is wrapped by `RegistryRawFs`, which reads and writes
 * such an address in the registry and everything else as a file.
 *
 * What it will do is deliberately narrow:
 * - only HKEY_CURRENT_USER, only below `Software\`;
 * - only a value that exists and holds binary data (REG_BINARY): its bytes are replaced,
 *   its name and type stay. No value is created, renamed or deleted, no key is touched;
 * - the Registry port features read with stays read-only: this is the only way in.
 */

/** Reads and replaces binary registry values. The platform implements it; only RegistryRawFs calls it. */
export interface RegistryValueStore {
  /** The names of the binary values of a key. Empty when the key does not exist. */
  binaryNames(hive: RegistryHive, key: string): Promise<string[]>;
  /** The bytes of a binary value; undefined when it does not exist or is not binary. */
  read(hive: RegistryHive, key: string, name: string): Promise<Uint8Array | undefined>;
  /** Replaces the bytes of an existing binary value. Throws when it cannot. */
  replace(hive: RegistryHive, key: string, name: string, data: Uint8Array): Promise<void>;
}

const ROOT = '\\\\registry\\';
const LEAF = /^[0-9a-f]{32}\.regvalue$/;

/**
 * A value's name as a file name. Value names can be longer than a file name may be and
 * hold characters one may not, and FileStore names the backup after the last part of the
 * path, so the address carries a digest of the name; RegistryRawFs finds the value by it.
 */
export function registryLeaf(name: string): string {
  return `${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 32)}.regvalue`;
}

/** The address of a registry value for FileStore: `\\registry\HKCU\<key>\<digest>.regvalue`. */
export function registryValuePath(hive: RegistryHive, key: string, name: string): string {
  const cleanKey = key.replace(/^\\+|\\+$/g, '');
  return `${ROOT}${hive}\\${cleanKey}\\${registryLeaf(name)}`;
}

export interface RegistryAddress {
  hive: RegistryHive;
  key: string;
  /** The digest file name; empty for the address of a key. */
  leaf: string;
}

/** Takes an address apart; undefined for a path that is a file. */
export function parseRegistryPath(file: string): RegistryAddress | undefined {
  const normal = file.replace(/\//g, '\\');
  if (!normal.toLowerCase().startsWith(ROOT)) return undefined;
  const parts = normal.slice(ROOT.length).split('\\').filter(Boolean);
  const hive = parts[0]?.toUpperCase();
  if (hive !== 'HKCU' && hive !== 'HKLM') return undefined;
  const last = parts.at(-1) ?? '';
  const isValue = LEAF.test(last.toLowerCase());
  const keyParts = isValue ? parts.slice(1, -1) : parts.slice(1);
  return { hive, key: keyParts.join('\\'), leaf: isValue ? last.toLowerCase() : '' };
}

/** True for a path that addresses the registry, whatever it names there. */
export const isRegistryPath = (file: string): boolean =>
  file.replace(/\//g, '\\').toLowerCase().startsWith(ROOT);

const REFUSED = 'RigReady changes registry values only under HKEY_CURRENT_USER\\Software.';
const NOT_AN_ADDRESS =
  'This is not a registry address RigReady understands, so nothing was read or written there.';
const NOT_PLAIN =
  'This registry address has parts that Windows would read as another place ("." or ".."), so it was refused.';

/**
 * True when the address means the same place however a path is normalised: no empty, "."
 * or ".." part. FileStore backs up the normalised path, so one that changes under
 * normalisation could back up one value and replace another.
 */
function plain(file: string): boolean {
  const normal = file.replace(/\//g, '\\');
  const parts = normal.slice(ROOT.length).split('\\');
  return (
    parts.every((part) => part !== '' && part !== '.' && part !== '..') &&
    path.win32.normalize(normal) === normal
  );
}

function writable(address: RegistryAddress): boolean {
  return address.hive === 'HKCU' && /^software\\[^\\]/i.test(address.key);
}

/**
 * The raw file access FileStore is given: files as before, and the bytes of a binary
 * registry value at a `registryValuePath()` address.
 */
export class RegistryRawFs implements RawFs {
  constructor(
    private readonly files: RawFs,
    private readonly values: RegistryValueStore
  ) {}

  /**
   * What a path is: a file, a registry address, or something in the registry's namespace
   * that is not an address (another hive, a part Windows would read as another place). The
   * last is never handed to the file system, where it would be a network path.
   */
  private route(file: string): RegistryAddress | 'file' | 'invalid' {
    if (!isRegistryPath(file)) return 'file';
    const address = parseRegistryPath(file);
    return address && plain(file) ? address : 'invalid';
  }

  /** Why a change will not be made; FileStore asks before it backs up or journals. */
  async refuses(file: string, action: 'write' | 'remove'): Promise<string | undefined> {
    const where = this.route(file);
    if (where === 'file') return this.files.refuses?.(file, action);
    if (where === 'invalid')
      return isRegistryPath(file) && !plain(file) ? NOT_PLAIN : NOT_AN_ADDRESS;
    if (action === 'remove') return 'RigReady does not delete registry values.';
    if (!writable(where)) return REFUSED;
    if (!where.leaf || (await this.nameOf(where)) === undefined) {
      return 'RigReady only replaces a binary registry value that is already there; it does not create one.';
    }
    return undefined;
  }

  private async nameOf(address: RegistryAddress): Promise<string | undefined> {
    if (!address.leaf) return undefined;
    const names = await this.values.binaryNames(address.hive, address.key);
    return names.find((name) => registryLeaf(name) === address.leaf);
  }

  private async bytesOf(file: string, address: RegistryAddress): Promise<Uint8Array> {
    const name = await this.nameOf(address);
    const data =
      name === undefined ? undefined : await this.values.read(address.hive, address.key, name);
    if (data === undefined) throw new Error(`There is no such registry value: ${file}`);
    return data;
  }

  async readText(file: string): Promise<string> {
    const address = this.route(file);
    if (address === 'file') return this.files.readText(file);
    if (address === 'invalid') throw new Error(NOT_AN_ADDRESS);
    return Buffer.from(await this.bytesOf(file, address)).toString('utf8');
  }

  async readBytes(file: string): Promise<Uint8Array> {
    const address = this.route(file);
    if (address === 'file') return this.files.readBytes(file);
    if (address === 'invalid') throw new Error(NOT_AN_ADDRESS);
    return this.bytesOf(file, address);
  }

  async writeBytes(file: string, data: Uint8Array | string): Promise<void> {
    const address = this.route(file);
    if (address === 'file') return this.files.writeBytes(file, data);
    // Checked again here, last: FileStore asks refuses() first, but nothing is written on trust.
    if (address === 'invalid') throw new Error(NOT_AN_ADDRESS);
    if (!writable(address)) throw new Error(REFUSED);
    const name = await this.nameOf(address);
    if (name === undefined) {
      throw new Error(
        'RigReady only replaces a registry value that is already there; it does not create one.'
      );
    }
    const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    await this.values.replace(address.hive, address.key, name, bytes);
  }

  async appendText(file: string, text: string): Promise<void> {
    if (isRegistryPath(file)) throw new Error('A registry value cannot be appended to.');
    return this.files.appendText(file, text);
  }

  async exists(file: string): Promise<boolean> {
    const address = this.route(file);
    if (address === 'file') return this.files.exists(file);
    if (address === 'invalid') return false;
    if (!address.leaf) {
      return (await this.values.binaryNames(address.hive, address.key)).length > 0;
    }
    return (await this.nameOf(address)) !== undefined;
  }

  async stat(file: string): Promise<RawStat | undefined> {
    const address = this.route(file);
    if (address === 'file') return this.files.stat(file);
    if (address === 'invalid') return undefined;
    if (!address.leaf) {
      return (await this.exists(file)) ? { isDirectory: true, size: 0, mtimeMs: 0 } : undefined;
    }
    const name = await this.nameOf(address);
    if (name === undefined) return undefined;
    const data = await this.values.read(address.hive, address.key, name);
    return data === undefined ? undefined : { isDirectory: false, size: data.length, mtimeMs: 0 };
  }

  async mkdirp(dir: string): Promise<void> {
    // A key is never created: writing a value below a missing key is refused there.
    if (isRegistryPath(dir)) return;
    return this.files.mkdirp(dir);
  }

  async list(dir: string): Promise<string[]> {
    const address = this.route(dir);
    if (address === 'file') return this.files.list(dir);
    if (address === 'invalid' || address.leaf) return [];
    return (await this.values.binaryNames(address.hive, address.key)).map(registryLeaf);
  }

  async copyFile(from: string, to: string): Promise<void> {
    if (!isRegistryPath(from) && !isRegistryPath(to)) return this.files.copyFile(from, to);
    // A backup of a value is a file with its bytes; putting it back writes those bytes.
    const data = await this.readBytes(from);
    if (!isRegistryPath(to)) await this.files.mkdirp(path.dirname(to));
    await this.writeBytes(to, data);
  }

  async remove(file: string): Promise<void> {
    if (isRegistryPath(file)) throw new Error('RigReady does not delete registry values.');
    return this.files.remove(file);
  }

  async removeDir(dir: string): Promise<void> {
    if (isRegistryPath(dir)) throw new Error('RigReady does not delete registry keys.');
    return this.files.removeDir(dir);
  }

  async removeEmptyDir(dir: string): Promise<boolean> {
    if (isRegistryPath(dir)) return false;
    return this.files.removeEmptyDir(dir);
  }
}
