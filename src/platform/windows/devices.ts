import type { DeviceProvider } from '../../core/ports';
import { err, ok, type Result } from '../../core/result';
import type { DeviceInfo, HubNode } from '../../shared/models';
import {
  CM_Get_DevNode_PropertyW,
  CM_Get_Device_ID_ListW,
  CM_Get_Device_ID_List_SizeW,
  CM_Locate_DevNodeW,
  propertyKey,
  wstr,
} from './win32';

/** USB device enumeration through the Configuration Manager (cfgmgr32) device tree. */

const CM_GETIDLIST_FILTER_PRESENT = 0x100;
const DEVICE_GUID = '{a45c254e-df1c-4efd-8020-67d146a850e0}';
const KEY_DEVICE_DESC = propertyKey(DEVICE_GUID, 2);
const KEY_HARDWARE_IDS = propertyKey(DEVICE_GUID, 3);
const KEY_SERVICE = propertyKey(DEVICE_GUID, 6);
const KEY_MANUFACTURER = propertyKey(DEVICE_GUID, 13);
const KEY_FRIENDLY_NAME = propertyKey(DEVICE_GUID, 14);
const KEY_BUS_REPORTED_DESC = propertyKey('{540b947e-8b40-45bc-a8a2-6a0b894cbda2}', 4);
export const KEY_PARENT = propertyKey('{4340a6c5-93fa-4706-972c-7b648008a5a7}', 8);

const USB_DEVICE = /^USB\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})\\([^\\]+)$/i;
const ROOT_HUB = /^USB\\ROOT_HUB/i;

function presentInstanceIds(): string[] {
  const len = [0];
  let status = CM_Get_Device_ID_List_SizeW(len, null, CM_GETIDLIST_FILTER_PRESENT);
  if (status !== 0) throw new Error(`CM_Get_Device_ID_List_SizeW failed with ${status}`);
  const chars = len[0]! + 1024; // headroom for devices arriving between the two calls
  const buffer = Buffer.alloc(chars * 2);
  status = CM_Get_Device_ID_ListW(null, buffer, chars, CM_GETIDLIST_FILTER_PRESENT);
  if (status !== 0) throw new Error(`CM_Get_Device_ID_ListW failed with ${status}`);
  return buffer
    .toString('utf16le')
    .split('\0')
    .filter((id) => id.length > 0);
}

export class DevTree {
  private nodes = new Map<string, number | null>();
  private scratch = Buffer.alloc(4096);

  private devInst(instanceId: string): number | null {
    const key = instanceId.toUpperCase();
    const cached = this.nodes.get(key);
    if (cached !== undefined) return cached;
    const out = [0];
    const status = CM_Locate_DevNodeW(out, instanceId, 0);
    const value = status === 0 ? out[0]! : null;
    this.nodes.set(key, value);
    return value;
  }

  text(instanceId: string, key: Buffer): string | undefined {
    const inst = this.devInst(instanceId);
    if (inst === null) return undefined;
    const type = [0];
    const size = [this.scratch.length];
    const status = CM_Get_DevNode_PropertyW(inst, key, type, this.scratch, size, 0);
    if (status !== 0) return undefined;
    const value = wstr(this.scratch, 0, size[0]!);
    return value.length > 0 ? value : undefined;
  }

  /** A REG_MULTI_SZ property as its list of strings. */
  list(instanceId: string, key: Buffer): string[] {
    const inst = this.devInst(instanceId);
    if (inst === null) return [];
    const type = [0];
    const size = [this.scratch.length];
    const status = CM_Get_DevNode_PropertyW(inst, key, type, this.scratch, size, 0);
    if (status !== 0) return [];
    return this.scratch
      .toString('utf16le', 0, size[0]!)
      .split('\0')
      .filter((entry) => entry.length > 0);
  }

  name(instanceId: string): string {
    return (
      this.text(instanceId, KEY_BUS_REPORTED_DESC) ??
      this.text(instanceId, KEY_FRIENDLY_NAME) ??
      this.text(instanceId, KEY_DEVICE_DESC) ??
      instanceId
    );
  }

  hubName(instanceId: string): string {
    return (
      this.text(instanceId, KEY_FRIENDLY_NAME) ??
      this.text(instanceId, KEY_DEVICE_DESC) ??
      instanceId
    );
  }

  parent(instanceId: string): string | undefined {
    return this.text(instanceId, KEY_PARENT);
  }
}

export function enumerateUsbDevices(): DeviceInfo[] {
  const tree = new DevTree();
  const ids = presentInstanceIds();

  // A USB device "is HID" when any HID node descends from it.
  const hidOwners = new Set<string>();
  // ...and "is a game controller" when Windows classes one of those nodes as a game device.
  const gameOwners = new Set<string>();
  for (const id of ids) {
    if (!/^HID\\/i.test(id)) continue;
    let current: string | undefined = id;
    for (let depth = 0; current && depth < 8; depth++) {
      if (USB_DEVICE.test(current)) {
        hidOwners.add(current.toUpperCase());
        if (
          tree.list(id, KEY_HARDWARE_IDS).some((h) => h.toUpperCase() === 'HID_DEVICE_SYSTEM_GAME')
        ) {
          gameOwners.add(current.toUpperCase());
        }
        break;
      }
      current = tree.parent(current);
    }
  }

  const devices: DeviceInfo[] = [];
  for (const id of ids) {
    const match = USB_DEVICE.exec(id);
    if (!match) continue;
    const [, vid, pid, suffix] = match;
    const hubChain: HubNode[] = [];
    let current = tree.parent(id);
    for (let depth = 0; current && depth < 12; depth++) {
      if (!/^USB\\/i.test(current)) break;
      hubChain.push({ instanceId: current, name: tree.hubName(current).trim() });
      if (ROOT_HUB.test(current)) break;
      current = tree.parent(current);
    }
    const service = (tree.text(id, KEY_SERVICE) ?? '').toLowerCase();
    const device: DeviceInfo = {
      instanceId: id,
      vendorId: vid!.toUpperCase(),
      productId: pid!.toUpperCase(),
      // Not trimmed: some vendors report names with a trailing space and games key files on the exact name.
      name: tree.name(id),
      isHid: hidOwners.has(id.toUpperCase()),
      isGameController: gameOwners.has(id.toUpperCase()),
      isHub: service.startsWith('usbhub'),
      hubChain,
    };
    const manufacturer = tree.text(id, KEY_MANUFACTURER);
    if (manufacturer) device.manufacturer = manufacturer;
    // Windows invents suffixes containing '&' when the device reports no serial number.
    if (!suffix!.includes('&')) device.serial = suffix!;
    devices.push(device);
  }
  devices.sort((a, b) => a.name.localeCompare(b.name) || a.instanceId.localeCompare(b.instanceId));
  return devices;
}

/** Total length of the present-device id list: cheap to read, and it changes on any plug or unplug. */
function presentListSize(): number {
  const len = [0];
  return CM_Get_Device_ID_List_SizeW(len, null, CM_GETIDLIST_FILTER_PRESENT) === 0 ? len[0]! : -1;
}

export class WindowsDeviceProvider implements DeviceProvider {
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSize = -1;

  constructor(private readonly pollMs = 1500) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    if (!this.timer) {
      this.lastSize = presentListSize();
      this.timer = setInterval(() => {
        const size = presentListSize();
        if (size === this.lastSize) return;
        this.lastSize = size;
        for (const each of [...this.listeners]) each();
      }, this.pollMs);
      // Watching for devices must never keep the process alive.
      this.timer.unref();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  async list(): Promise<Result<DeviceInfo[]>> {
    try {
      return ok(enumerateUsbDevices());
    } catch (e) {
      return err('device.enumerate', 'Could not list USB devices.', String(e));
    }
  }
}
