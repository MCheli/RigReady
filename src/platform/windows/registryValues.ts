import type { RegistryValueStore } from '../../core/files/registryValues';
import type { RegistryHive } from '../../shared/models';
import {
  HKEY_CURRENT_USER,
  HKEY_LOCAL_MACHINE,
  RegCloseKey,
  RegEnumValueW,
  RegOpenKeyExW,
  RegQueryValueExW,
  RegSetValueExW,
} from './win32';

/**
 * Binary registry values for FileStore (src/core/files/registryValues.ts): read, and the
 * bytes of an existing one replaced. A key is opened to write only inside replace(), and
 * only with the right to set a value.
 */

const KEY_QUERY_VALUE = 0x0001;
const KEY_SET_VALUE = 0x0002;
const KEY_READ = 0x20019;
const ERROR_SUCCESS = 0;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const ERROR_MORE_DATA = 234;
const ERROR_NO_MORE_ITEMS = 259;
const REG_BINARY = 3;

const HIVES: Record<RegistryHive, bigint> = {
  HKCU: HKEY_CURRENT_USER,
  HKLM: HKEY_LOCAL_MACHINE,
};

function withKey<T>(
  hive: RegistryHive,
  key: string,
  access: number,
  fn: (handle: bigint) => T
): T | undefined {
  const out: [bigint] = [0n];
  const status = RegOpenKeyExW(HIVES[hive], key, 0, access, out);
  if (status === ERROR_FILE_NOT_FOUND || status === ERROR_PATH_NOT_FOUND) return undefined;
  if (status !== ERROR_SUCCESS) {
    throw new Error(`RegOpenKeyExW(${hive}\${key}) failed with ${status}`);
  }
  const handle = BigInt(out[0]);
  try {
    return fn(handle);
  } finally {
    RegCloseKey(handle);
  }
}

/** The type and bytes of a value; undefined when it does not exist. */
function query(handle: bigint, name: string): { type: number; data: Buffer } | undefined {
  const type = [0];
  const size = [0];
  let status = RegQueryValueExW(handle, name, null, type, null, size);
  if (status === ERROR_FILE_NOT_FOUND) return undefined;
  if (status !== ERROR_SUCCESS && status !== ERROR_MORE_DATA) {
    throw new Error(`RegQueryValueExW(${name}) failed with ${status}`);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = Buffer.alloc(Math.max(size[0]!, 2));
    size[0] = data.length;
    status = RegQueryValueExW(handle, name, null, type, data, size);
    if (status === ERROR_SUCCESS) return { type: type[0]!, data: data.subarray(0, size[0]!) };
    if (status !== ERROR_MORE_DATA) {
      throw new Error(`RegQueryValueExW(${name}) failed with ${status}`);
    }
  }
  throw new Error(`RegQueryValueExW(${name}) kept changing size`);
}

export class WindowsRegistryValues implements RegistryValueStore {
  async binaryNames(hive: RegistryHive, key: string): Promise<string[]> {
    return (
      withKey(hive, key, KEY_READ, (handle) => {
        const found: string[] = [];
        const name = Buffer.alloc(32768); // value names are at most 16 383 characters
        for (let index = 0; ; index++) {
          const length = [16384];
          const type = [0];
          const status = RegEnumValueW(handle, index, name, length, null, type, null, [0]);
          if (status === ERROR_NO_MORE_ITEMS) break;
          if (status !== ERROR_SUCCESS && status !== ERROR_MORE_DATA) {
            throw new Error(`RegEnumValueW failed with ${status}`);
          }
          if (type[0] === REG_BINARY) found.push(name.toString('utf16le', 0, length[0]! * 2));
        }
        return found;
      }) ?? []
    );
  }

  async read(hive: RegistryHive, key: string, name: string): Promise<Uint8Array | undefined> {
    const value = withKey(hive, key, KEY_READ, (handle) => query(handle, name));
    return value && value.type === REG_BINARY ? new Uint8Array(value.data) : undefined;
  }

  async replace(hive: RegistryHive, key: string, name: string, data: Uint8Array): Promise<void> {
    const done = withKey(hive, key, KEY_QUERY_VALUE | KEY_SET_VALUE, (handle) => {
      // Looked at again with the key open to write: only an existing binary value is replaced.
      const current = query(handle, name);
      if (!current) throw new Error(`The registry value is no longer there: ${name}`);
      if (current.type !== REG_BINARY) {
        throw new Error(`The registry value does not hold binary data: ${name}`);
      }
      const status = RegSetValueExW(handle, name, 0, REG_BINARY, Buffer.from(data), data.length);
      if (status !== ERROR_SUCCESS)
        throw new Error(`RegSetValueExW(${name}) failed with ${status}`);
      return true;
    });
    if (!done) throw new Error(`The registry key is not there: ${hive}\${key}`);
  }
}
