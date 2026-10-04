import type { Registry } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { RegistryHive, RegistryValue } from '../../shared/models';
import {
  HKEY_CURRENT_USER,
  HKEY_LOCAL_MACHINE,
  RegCloseKey,
  RegEnumKeyExW,
  RegEnumValueW,
  RegOpenKeyExW,
  RegQueryValueExW,
} from './win32';

/** Read-only registry access through advapi32. Keys are opened with KEY_READ and nothing else. */

const KEY_READ = 0x20019;
const ERROR_SUCCESS = 0;
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;
const ERROR_MORE_DATA = 234;
const ERROR_NO_MORE_ITEMS = 259;
const REG_SZ = 1;
const REG_EXPAND_SZ = 2;
const REG_DWORD = 4;
const REG_MULTI_SZ = 7;
const REG_QWORD = 11;

const HIVES: Record<RegistryHive, bigint> = {
  HKCU: HKEY_CURRENT_USER,
  HKLM: HKEY_LOCAL_MACHINE,
};

export function decodeRegistryValue(type: number, data: Buffer): RegistryValue {
  switch (type) {
    case REG_SZ:
    case REG_EXPAND_SZ:
      return { type: 'string', value: data.toString('utf16le').replace(/\0+$/, '') };
    case REG_MULTI_SZ:
      return {
        type: 'strings',
        value: data
          .toString('utf16le')
          .split('\0')
          .filter((entry) => entry.length > 0),
      };
    case REG_DWORD:
      return { type: 'number', value: data.length >= 4 ? data.readUInt32LE(0) : 0 };
    case REG_QWORD:
      return { type: 'number', value: data.length >= 8 ? Number(data.readBigUInt64LE(0)) : 0 };
    default:
      return { type: 'binary', value: data.toString('hex') };
  }
}

/** One value, read synchronously; undefined when the key or value is missing or unreadable. */
export function readRegistryValue(
  hive: RegistryHive,
  key: string,
  name: string
): RegistryValue | undefined {
  try {
    return withKey(hive, key, (handle) => queryValue(handle, name));
  } catch {
    // Missing and unreadable are the same to the callers: there is no value.
    return undefined;
  }
}

/** Runs fn with the key open. Gives undefined when the key does not exist. */
function withKey<T>(hive: RegistryHive, key: string, fn: (handle: bigint) => T): T | undefined {
  const out: [bigint] = [0n];
  const status = RegOpenKeyExW(HIVES[hive], key, 0, KEY_READ, out);
  if (status === ERROR_FILE_NOT_FOUND || status === ERROR_PATH_NOT_FOUND) return undefined;
  if (status !== ERROR_SUCCESS) {
    throw new Error(`RegOpenKeyExW(${hive}\\${key}) failed with ${status}`);
  }
  const handle = BigInt(out[0]);
  try {
    return fn(handle);
  } finally {
    RegCloseKey(handle);
  }
}

function queryValue(handle: bigint, name: string): RegistryValue | undefined {
  const type = [0];
  const size = [0];
  let status = RegQueryValueExW(handle, name, null, type, null, size);
  if (status === ERROR_FILE_NOT_FOUND) return undefined;
  if (status !== ERROR_SUCCESS && status !== ERROR_MORE_DATA) {
    throw new Error(`RegQueryValueExW(${name}) failed with ${status}`);
  }
  // The value can grow between the two calls; retry with what Windows asks for.
  for (let attempt = 0; attempt < 4; attempt++) {
    const data = Buffer.alloc(Math.max(size[0]!, 2));
    size[0] = data.length;
    status = RegQueryValueExW(handle, name, null, type, data, size);
    if (status === ERROR_SUCCESS) return decodeRegistryValue(type[0]!, data.subarray(0, size[0]!));
    if (status !== ERROR_MORE_DATA) {
      throw new Error(`RegQueryValueExW(${name}) failed with ${status}`);
    }
  }
  throw new Error(`RegQueryValueExW(${name}) kept changing size`);
}

export class WindowsRegistry implements Registry {
  async getValue(
    hive: RegistryHive,
    key: string,
    name: string
  ): Promise<Result<RegistryValue | undefined>> {
    try {
      return ok(withKey(hive, key, (handle) => queryValue(handle, name)));
    } catch (e) {
      return err('registry.read', `Could not read ${hive}\\${key}.`, String(e));
    }
  }

  async listKeys(hive: RegistryHive, key: string): Promise<Result<string[]>> {
    try {
      const names = withKey(hive, key, (handle) => {
        const found: string[] = [];
        const name = Buffer.alloc(512); // key names are at most 255 characters
        for (let index = 0; ; index++) {
          const length = [256];
          const status = RegEnumKeyExW(handle, index, name, length, null, null, null, null);
          if (status === ERROR_NO_MORE_ITEMS) break;
          if (status !== ERROR_SUCCESS) throw new Error(`RegEnumKeyExW failed with ${status}`);
          found.push(name.toString('utf16le', 0, length[0]! * 2));
        }
        return found;
      });
      return ok(names ?? []);
    } catch (e) {
      return err('registry.read', `Could not read ${hive}\\${key}.`, String(e));
    }
  }

  async listValues(
    hive: RegistryHive,
    key: string
  ): Promise<Result<Record<string, RegistryValue>>> {
    try {
      const values = withKey(hive, key, (handle) => {
        const found: Record<string, RegistryValue> = {};
        const name = Buffer.alloc(32768); // value names are at most 16 383 characters
        for (let index = 0; ; index++) {
          const length = [16384];
          const status = RegEnumValueW(handle, index, name, length, null, [0], null, [0]);
          if (status === ERROR_NO_MORE_ITEMS) break;
          if (status !== ERROR_SUCCESS && status !== ERROR_MORE_DATA) {
            throw new Error(`RegEnumValueW failed with ${status}`);
          }
          const valueName = name.toString('utf16le', 0, length[0]! * 2);
          const value = queryValue(handle, valueName);
          if (value) found[valueName] = value;
        }
        return found;
      });
      return ok(values ?? {});
    } catch (e) {
      return err('registry.read', `Could not read ${hive}\\${key}.`, String(e));
    }
  }
}
