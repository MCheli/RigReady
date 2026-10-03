import type { AudioProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { AudioDevice, AudioState } from '../../shared/models';
import {
  CoCreateInstance,
  CoInitializeEx,
  CoTaskMemFree,
  PropVariantClear,
  comCall,
  comRelease,
  guidBuffer,
  pointerAt,
  propertyKey,
  wstrAt,
} from './win32';

/** Default audio endpoints through the Core Audio COM API (IMMDeviceEnumerator). */

const CLSID_MMDeviceEnumerator = guidBuffer('{BCDE0395-E52F-467C-8E3D-C4579291692E}');
const IID_IMMDeviceEnumerator = guidBuffer('{A95664D2-9614-4F35-A746-DE8DB63617E6}');
const PKEY_Device_FriendlyName = propertyKey('{a45c254e-df1c-4efd-8020-67d146a850e0}', 14);
const CLSCTX_ALL = 23;
const DEVICE_STATE_ACTIVE = 1;
const STGM_READ = 0;
const VT_LPWSTR = 31;
const E_RENDER = 0;
const E_CAPTURE = 1;
const ROLE_CONSOLE = 0;
const ROLE_COMMUNICATIONS = 2;

type Pointer = bigint;
const isNull = (p: unknown): boolean => !p || BigInt(p as bigint) === 0n;

function describe(device: Pointer, flow: AudioDevice['flow']): AudioDevice | undefined {
  const idOut: [Pointer | null] = [null];
  if (comCall(device, 5, ['_Out_ void **id'], idOut) !== 0 || isNull(idOut[0])) return undefined;
  const id = wstrAt(idOut[0]);
  CoTaskMemFree(idOut[0]);

  let name = id;
  const storeOut: [Pointer | null] = [null];
  if (
    comCall(device, 4, ['uint32_t access', '_Out_ void **store'], STGM_READ, storeOut) === 0 &&
    !isNull(storeOut[0])
  ) {
    const store = storeOut[0]!;
    const variant = Buffer.alloc(24);
    if (comCall(store, 5, ['void *key', 'void *value'], PKEY_Device_FriendlyName, variant) === 0) {
      if (variant.readUInt16LE(0) === VT_LPWSTR) {
        const text = variant.readBigUInt64LE(8);
        if (text !== 0n) name = wstrAt(text);
      }
      PropVariantClear(variant);
    }
    comRelease(store);
  }
  return { id, name, flow };
}

function defaultEndpoint(enumerator: Pointer, flow: number, role: number): AudioDevice | undefined {
  const out: [Pointer | null] = [null];
  const hr = comCall(
    enumerator,
    4,
    ['uint32_t flow', 'uint32_t role', '_Out_ void **device'],
    flow,
    role,
    out
  );
  if (hr !== 0 || isNull(out[0])) return undefined; // E_NOTFOUND when there is no such device
  try {
    return describe(out[0]!, flow === E_RENDER ? 'playback' : 'recording');
  } finally {
    comRelease(out[0]!);
  }
}

function endpoints(enumerator: Pointer, flow: number): AudioDevice[] {
  const out: [Pointer | null] = [null];
  const hr = comCall(
    enumerator,
    3,
    ['uint32_t flow', 'uint32_t mask', '_Out_ void **collection'],
    flow,
    DEVICE_STATE_ACTIVE,
    out
  );
  if (hr !== 0 || isNull(out[0])) return [];
  const collection = out[0]!;
  const devices: AudioDevice[] = [];
  try {
    const count = [0];
    if (comCall(collection, 3, ['_Out_ uint32_t *count'], count) !== 0) return [];
    for (let i = 0; i < count[0]!; i++) {
      const item: [Pointer | null] = [null];
      if (
        comCall(collection, 4, ['uint32_t index', '_Out_ void **device'], i, item) !== 0 ||
        isNull(item[0])
      )
        continue;
      const described = describe(item[0]!, flow === E_RENDER ? 'playback' : 'recording');
      comRelease(item[0]!);
      if (described) devices.push(described);
    }
  } finally {
    comRelease(collection);
  }
  return devices;
}

export function readAudioState(): AudioState {
  // S_FALSE / RPC_E_CHANGED_MODE mean COM is already initialized on this thread, which is fine.
  CoInitializeEx(null, 0);
  const out: [Pointer | null] = [null];
  const hr = CoCreateInstance(
    CLSID_MMDeviceEnumerator,
    null,
    CLSCTX_ALL,
    IID_IMMDeviceEnumerator,
    out
  );
  if (hr !== 0 || isNull(out[0]))
    throw new Error(`CoCreateInstance(MMDeviceEnumerator) failed with ${hr}`);
  const enumerator = out[0]!;
  // Touch the vtable once so a bad pointer fails here rather than inside a call.
  pointerAt(enumerator, 0);
  try {
    const state: AudioState = {
      devices: [...endpoints(enumerator, E_RENDER), ...endpoints(enumerator, E_CAPTURE)],
    };
    const playback = defaultEndpoint(enumerator, E_RENDER, ROLE_CONSOLE);
    const recording = defaultEndpoint(enumerator, E_CAPTURE, ROLE_CONSOLE);
    const commsPlayback = defaultEndpoint(enumerator, E_RENDER, ROLE_COMMUNICATIONS);
    const commsRecording = defaultEndpoint(enumerator, E_CAPTURE, ROLE_COMMUNICATIONS);
    if (playback) state.defaultPlayback = playback;
    if (recording) state.defaultRecording = recording;
    if (commsPlayback) state.defaultCommsPlayback = commsPlayback;
    if (commsRecording) state.defaultCommsRecording = commsRecording;
    return state;
  } finally {
    comRelease(enumerator);
  }
}

export class WindowsAudioProvider implements AudioProvider {
  async read(): Promise<Result<AudioState>> {
    try {
      return ok(readAudioState());
    } catch (e) {
      return err('audio.read', 'Could not read the audio devices.', String(e));
    }
  }
}
