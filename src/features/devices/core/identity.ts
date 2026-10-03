import { z } from 'zod';
import type { DeviceInfo } from '../../../shared/models';

/**
 * How RigReady recognises one physical device: vendor/product id, narrowed by serial
 * number or, for identical devices without a usable serial, by USB port (instance path).
 * Never by display name (PRODUCT.md rule 4). Pure: the renderer uses it too.
 */

const hex4 = z.string().regex(/^[0-9A-Fa-f]{4}$/);

export const DeviceIdentitySchema = z.object({
  vendorId: hex4,
  productId: hex4,
  serial: z.string().optional(),
  instanceId: z.string().optional(),
  /** DirectInput instance GUID, for a controller that has no USB device of its own (virtual, Bluetooth). */
  guid: z.string().optional(),
});
export type DeviceIdentity = z.infer<typeof DeviceIdentitySchema>;

export type IdentifiedBy = 'ids' | 'serial' | 'port';

const same = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toUpperCase() === b.toUpperCase();

export const sameModel = (
  a: Pick<DeviceInfo, 'vendorId' | 'productId'>,
  b: Pick<DeviceIdentity, 'vendorId' | 'productId'>
): boolean => same(a.vendorId, b.vendorId) && same(a.productId, b.productId);

/** Present devices of the same model (VID/PID), the device itself included. */
export function twinsOf(device: DeviceInfo, all: DeviceInfo[]): DeviceInfo[] {
  return all.filter((d) => !d.isHub && sameModel(d, device));
}

/**
 * True when the serial tells this device apart from its twins: it has one, and no other
 * present device of the same model reports the same one (some vendors give every unit "0").
 */
export function serialIsUnique(device: DeviceInfo, all: DeviceInfo[]): boolean {
  if (!device.serial) return false;
  return twinsOf(device, all).filter((d) => d.serial === device.serial).length === 1;
}

/** Narrowest identity that still tells this device apart from the others present. */
export function identityFor(device: DeviceInfo, all: DeviceInfo[]): DeviceIdentity {
  const identity: DeviceIdentity = { vendorId: device.vendorId, productId: device.productId };
  if (twinsOf(device, all).length <= 1) return identity;
  if (serialIsUnique(device, all)) return { ...identity, serial: device.serial! };
  return { ...identity, instanceId: device.instanceId };
}

export function identifiedBy(identity: DeviceIdentity): IdentifiedBy {
  if (identity.serial !== undefined) return 'serial';
  if (identity.instanceId !== undefined) return 'port';
  return 'ids';
}

/**
 * The port number on the parent hub, when Windows generated the instance suffix from the
 * port ("8&348856f8&0&2" is port 2). Devices with a real serial number do not say.
 */
export function portOf(instanceId: string): number | undefined {
  const suffix = instanceId.split('\\').pop() ?? '';
  const match = /^[0-9a-f]+&[0-9a-f]+&\d+&(\d+)$/i.exec(suffix);
  return match ? Number(match[1]) : undefined;
}

/** External hubs between the root hub and the device. */
export const hubDepth = (device: Pick<DeviceInfo, 'hubChain'>): number =>
  Math.max(0, device.hubChain.length - 1);

/** USB allows five hubs between the host and a device; Windows starts failing at the edge. */
export const HUB_DEPTH_WARN = 4;
export const HUB_DEPTH_MAX = 5;

export interface DeviceLocation {
  /** "Port 2 on USB2.1 Hub" or "On USB2.1 Hub" when the port is not known. */
  text: string;
  /** Port numbers from the root hub down, "?" where unknown; the device's own port only when known. */
  path: string;
  depth: number;
  hubName?: string;
  port?: number;
}

/** Where a device is plugged in, in words. `hubs` gives product names for hub instance ids. */
export function locate(
  device: Pick<DeviceInfo, 'instanceId' | 'hubChain'>,
  hubs: Map<string, string> = new Map()
): DeviceLocation {
  const hubName = (h: { instanceId: string; name: string }): string =>
    (hubs.get(h.instanceId.toUpperCase()) ?? h.name).trim();
  const nearest = device.hubChain[0];
  const port = portOf(device.instanceId);
  // Each hub's own port on its parent, root side first, then the device's port.
  const ports = [...device.hubChain]
    .slice(0, -1)
    .reverse()
    .map((h) => portOf(h.instanceId));
  if (port !== undefined) ports.push(port);
  const path = ports.map((p) => (p === undefined ? '?' : String(p))).join(' › ');
  const depth = hubDepth(device);
  if (!nearest) return { text: 'Not on a USB hub', path, depth };
  const name = hubName(nearest);
  const isRoot = device.hubChain.length === 1;
  const where = isRoot ? 'the computer' : name;
  return {
    text: port !== undefined ? `Port ${port} on ${where}` : `On ${where}`,
    path,
    depth,
    hubName: isRoot ? 'the computer' : name,
    ...(port !== undefined ? { port } : {}),
  };
}

/** Product names of the hubs in a device list, by upper-case instance id. */
export function hubNames(devices: DeviceInfo[]): Map<string, string> {
  return new Map(devices.filter((d) => d.isHub).map((d) => [d.instanceId.toUpperCase(), d.name]));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "just now", "12 minutes ago", "today 09:41", "yesterday 21:14", "3 Oct 21:14". */
export function formatWhen(at: Date, now: Date): string {
  const ms = now.getTime() - at.getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 60 * 60_000) {
    const minutes = Math.floor(ms / 60_000);
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
  }
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(at)) / 86_400_000);
  if (days === 0) return `today ${time}`;
  if (days === 1) return `yesterday ${time}`;
  const month = MONTHS[at.getMonth()];
  const year = at.getFullYear() === now.getFullYear() ? '' : ` ${at.getFullYear()}`;
  return `${at.getDate()} ${month}${year} ${time}`;
}

export function vidPid(d: Pick<DeviceIdentity, 'vendorId' | 'productId'>): string {
  return `${d.vendorId.toUpperCase()}:${d.productId.toUpperCase()}`;
}
