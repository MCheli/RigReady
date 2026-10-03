import koffi from 'koffi';

/**
 * Thin Win32 bindings. Structures are handled as raw Buffers with explicit offsets
 * (x64 layouts) so there is no dependence on FFI struct packing rules.
 */

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const cfgmgr32 = koffi.load('cfgmgr32.dll');
const ole32 = koffi.load('ole32.dll');
const shell32 = koffi.load('shell32.dll');
const advapi32 = koffi.load('advapi32.dll');

// ---- user32: display configuration ----
export const GetDisplayConfigBufferSizes = user32.func(
  'int32_t GetDisplayConfigBufferSizes(uint32_t flags, _Out_ uint32_t *numPaths, _Out_ uint32_t *numModes)'
);
export const QueryDisplayConfig = user32.func(
  'int32_t QueryDisplayConfig(uint32_t flags, _Inout_ uint32_t *numPaths, void *paths, _Inout_ uint32_t *numModes, void *modes, void *topology)'
);
export const DisplayConfigGetDeviceInfo = user32.func(
  'int32_t DisplayConfigGetDeviceInfo(void *packet)'
);
export const SetDisplayConfig = user32.func(
  'int32_t SetDisplayConfig(uint32_t numPaths, void *paths, uint32_t numModes, void *modes, uint32_t flags)'
);

export const EnumDisplaySettingsExW = user32.func(
  'int32_t EnumDisplaySettingsExW(const char16_t *deviceName, uint32_t modeNum, void *devMode, uint32_t flags)'
);

// ---- kernel32: processes ----
export const CreateToolhelp32Snapshot = kernel32.func(
  'intptr_t CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)'
);
export const Process32FirstW = kernel32.func(
  'int32_t Process32FirstW(intptr_t snapshot, void *entry)'
);
export const Process32NextW = kernel32.func(
  'int32_t Process32NextW(intptr_t snapshot, void *entry)'
);
export const OpenProcess = kernel32.func(
  'intptr_t OpenProcess(uint32_t access, int32_t inherit, uint32_t pid)'
);
export const QueryFullProcessImageNameW = kernel32.func(
  'int32_t QueryFullProcessImageNameW(intptr_t process, uint32_t flags, void *name, _Inout_ uint32_t *size)'
);
export const TerminateProcess = kernel32.func(
  'int32_t TerminateProcess(intptr_t process, uint32_t code)'
);
export const CloseHandle = kernel32.func('int32_t CloseHandle(intptr_t handle)');
export const WaitForSingleObject = kernel32.func(
  'uint32_t WaitForSingleObject(intptr_t handle, uint32_t milliseconds)'
);

// ---- user32: top-level windows (to ask a program to close) ----
export const FindWindowExW = user32.func(
  'intptr_t FindWindowExW(intptr_t parent, intptr_t after, const char16_t *className, const char16_t *title)'
);
export const GetWindowThreadProcessId = user32.func(
  'uint32_t GetWindowThreadProcessId(intptr_t window, _Out_ uint32_t *pid)'
);
export const IsWindowVisible = user32.func('int32_t IsWindowVisible(intptr_t window)');
export const PostMessageW = user32.func(
  'int32_t PostMessageW(intptr_t window, uint32_t message, uintptr_t wParam, intptr_t lParam)'
);

// ---- cfgmgr32: device tree ----
export const CM_Get_Device_ID_List_SizeW = cfgmgr32.func(
  'uint32_t CM_Get_Device_ID_List_SizeW(_Out_ uint32_t *len, const char16_t *filter, uint32_t flags)'
);
export const CM_Get_Device_ID_ListW = cfgmgr32.func(
  'uint32_t CM_Get_Device_ID_ListW(const char16_t *filter, void *buffer, uint32_t len, uint32_t flags)'
);
export const CM_Locate_DevNodeW = cfgmgr32.func(
  'uint32_t CM_Locate_DevNodeW(_Out_ uint32_t *devInst, const char16_t *id, uint32_t flags)'
);
export const CM_Get_DevNode_PropertyW = cfgmgr32.func(
  'uint32_t CM_Get_DevNode_PropertyW(uint32_t devInst, void *key, _Out_ uint32_t *type, void *buffer, _Inout_ uint32_t *size, uint32_t flags)'
);

// ---- ole32 / shell32 / advapi32 ----
export const CoInitializeEx = ole32.func('int32_t CoInitializeEx(void *reserved, uint32_t coInit)');
export const CoCreateInstance = ole32.func(
  'int32_t CoCreateInstance(void *clsid, void *outer, uint32_t context, void *iid, _Out_ void **out)'
);
export const CoTaskMemFree = ole32.func('void CoTaskMemFree(void *ptr)');
export const PropVariantClear = ole32.func('int32_t PropVariantClear(void *variant)');
export const SHGetKnownFolderPath = shell32.func(
  'int32_t SHGetKnownFolderPath(void *rfid, uint32_t flags, void *token, _Out_ void **path)'
);

export const RegOpenKeyExW = advapi32.func(
  'int32_t RegOpenKeyExW(uintptr_t key, const char16_t *subKey, uint32_t options, uint32_t access, _Out_ uintptr_t *result)'
);
export const RegCloseKey = advapi32.func('int32_t RegCloseKey(uintptr_t key)');
export const RegEnumKeyExW = advapi32.func(
  'int32_t RegEnumKeyExW(uintptr_t key, uint32_t index, void *name, _Inout_ uint32_t *nameLength, void *reserved, void *className, void *classLength, void *lastWrite)'
);
export const RegEnumValueW = advapi32.func(
  'int32_t RegEnumValueW(uintptr_t key, uint32_t index, void *name, _Inout_ uint32_t *nameLength, void *reserved, _Out_ uint32_t *type, void *data, _Inout_ uint32_t *dataLength)'
);
export const RegQueryValueExW = advapi32.func(
  'int32_t RegQueryValueExW(uintptr_t key, const char16_t *name, void *reserved, _Out_ uint32_t *type, void *data, _Inout_ uint32_t *dataLength)'
);

// ---- advapi32: service control manager (read-only) ----
export const OpenSCManagerW = advapi32.func(
  'uintptr_t OpenSCManagerW(const char16_t *machine, const char16_t *database, uint32_t access)'
);
export const EnumServicesStatusExW = advapi32.func(
  'int32_t EnumServicesStatusExW(uintptr_t manager, int32_t level, uint32_t type, uint32_t state, void *buffer, uint32_t size, _Out_ uint32_t *needed, _Out_ uint32_t *returned, _Inout_ uint32_t *resume, const char16_t *group)'
);
export const CloseServiceHandle = advapi32.func('int32_t CloseServiceHandle(uintptr_t handle)');

export const HKEY_CURRENT_USER = 0x80000001n;
export const HKEY_LOCAL_MACHINE = 0x80000002n;

/** Encodes a GUID string ({xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx}) in its 16-byte binary layout. */
export function guidBuffer(guid: string, extraBytes = 0): Buffer {
  const hex = guid.replace(/[{}-]/g, '');
  if (hex.length !== 32) throw new Error(`Invalid GUID: ${guid}`);
  const buf = Buffer.alloc(16 + extraBytes);
  buf.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  buf.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  buf.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(buf, 8);
  return buf;
}

/** DEVPROPKEY / PROPERTYKEY: GUID followed by a 32-bit property id. */
export function propertyKey(guid: string, pid: number): Buffer {
  const buf = guidBuffer(guid, 4);
  buf.writeUInt32LE(pid, 16);
  return buf;
}

/** Reads a NUL-terminated UTF-16 string from a buffer. */
export function wstr(buf: Buffer, offset = 0, maxBytes = buf.length - offset): string {
  let end = offset;
  const limit = offset + maxBytes;
  while (end + 1 < limit && buf.readUInt16LE(end) !== 0) end += 2;
  return buf.toString('utf16le', offset, end);
}

/** Reads a NUL-terminated UTF-16 string from a native pointer. */
export function wstrAt(pointer: unknown): string {
  return koffi.decode(pointer, 'char16_t', -1) as string;
}

/** Reads a pointer-sized value from native memory at pointer + offset. */
export function pointerAt(pointer: unknown, offset: number): bigint {
  return koffi.decode(pointer, offset, 'uintptr_t') as bigint;
}

/** Calls a COM method by vtable index. `signature` lists the argument types after `this`. */
export function comCall(
  object: unknown,
  index: number,
  signature: string[],
  ...args: unknown[]
): number {
  const vtable = pointerAt(object, 0);
  const fn = pointerAt(vtable, index * 8);
  const proto = comProto(signature);
  return koffi.call(fn, proto, object, ...args) as number;
}

const protoCache = new Map<string, ReturnType<typeof koffi.proto>>();
function comProto(signature: string[]): ReturnType<typeof koffi.proto> {
  const key = signature.join(',');
  let proto = protoCache.get(key);
  if (!proto) {
    proto = koffi.proto(
      `int32_t ComMethod${protoCache.size}(${['void *self', ...signature].join(', ')})`
    );
    protoCache.set(key, proto);
  }
  return proto;
}

export function comRelease(object: unknown): void {
  comCall(object, 2, []);
}
