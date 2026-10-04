import path from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../../../core/jsonStore';
import type { DeviceNameQuery, DeviceNames } from '../../../core/names';
import type { Clock, FileStore, KnownFolders } from '../../../core/ports';
import { ok, type Result } from '../../../core/result';
import type { DeviceInfo } from '../../../shared/models';
import {
  DeviceIdentitySchema,
  hubNames,
  locate,
  sameModel,
  serialIsUnique,
  type DeviceIdentity,
} from './identity';
import { NotificationModeSchema } from './model';

/**
 * The feature's own data under the data root:
 *   devices.json          names the user gave, switches marked as "on is normal", notification choice
 *   devices-history.json  where and when each device was last seen
 */

export const NameEntrySchema = DeviceIdentitySchema.extend({ name: z.string().min(1).max(80) });
export type NameEntry = z.infer<typeof NameEntrySchema>;

export const SwitchEntrySchema = z.object({
  /** inputKeyFor(): which controller, stable across restarts. */
  inputKey: z.string(),
  /** Zero-based button index. */
  button: z.number().int().min(0),
});
export type SwitchEntry = z.infer<typeof SwitchEntrySchema>;

export const DevicesDataSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  names: z.array(NameEntrySchema).default([]),
  switches: z.array(SwitchEntrySchema).default([]),
  notifications: NotificationModeSchema.default('controllers'),
});
export type DevicesData = z.infer<typeof DevicesDataSchema>;

export const SeenEntrySchema = z.object({
  vendorId: z.string(),
  productId: z.string(),
  serial: z.string().optional(),
  instanceId: z.string(),
  name: z.string(),
  /** Where it was plugged in, in words ("Port 2 on USB2.1 Hub"). */
  location: z.string(),
  /** Port numbers from the root down ("6 › 4 › 2 › 2"). */
  path: z.string(),
  /** When it was last present. */
  lastSeen: z.string(),
  connected: z.boolean(),
});
export type SeenEntry = z.infer<typeof SeenEntrySchema>;

export const HistorySchema = z.object({
  schemaVersion: z.literal(1).default(1),
  seen: z.array(SeenEntrySchema).default([]),
});
export type History = z.infer<typeof HistorySchema>;

const HISTORY_LIMIT = 500;

export interface DeviceStores {
  data: JsonStore<typeof DevicesDataSchema>;
  history: JsonStore<typeof HistorySchema>;
}

export function deviceStores(ports: { files: FileStore; folders: KnownFolders }): DeviceStores {
  const root = ports.folders.dataRoot();
  return {
    data: new JsonStore(ports.files, path.join(root, 'devices.json'), DevicesDataSchema),
    history: new JsonStore(ports.files, path.join(root, 'devices-history.json'), HistorySchema),
  };
}

const eq = (a: string | undefined, b: string | undefined): boolean =>
  a !== undefined && b !== undefined && a.toUpperCase() === b.toUpperCase();

/**
 * The name the user gave this device, if any:
 * 1. same model and a serial that no other present unit shares;
 * 2. same model and the same USB port (instance path);
 * 3. the only unit of this model present, and the only name stored for the model, as long
 *    as that name is not pinned to a port another present unit is on (the device moved port).
 */
export function findName(
  entries: NameEntry[],
  device: DeviceInfo,
  present: DeviceInfo[]
): NameEntry | undefined {
  const model = entries.filter((e) => e.guid === undefined && sameModel(device, e));
  if (model.length === 0) return undefined;
  if (serialIsUnique(device, present)) {
    const bySerial = model.find((e) => e.serial === device.serial);
    if (bySerial) return bySerial;
  }
  const byPort = model.find((e) => eq(e.instanceId, device.instanceId));
  if (byPort) return byPort;
  const twins = present.filter((d) => !d.isHub && sameModel(d, device));
  if (twins.length === 1 && model.length === 1) {
    const only = model[0]!;
    const pinnedElsewhere =
      only.serial !== undefined && device.serial !== undefined && only.serial !== device.serial;
    if (!pinnedElsewhere) return only;
  }
  return undefined;
}

/**
 * The names as other features ask for them (`ctx.names.devices()`): the same rules as
 * findName, for a device described by what the asker knows about it.
 * - A DirectInput GUID that has a name of its own (a controller without a USB device) wins.
 * - A connected device is found by model, narrowed by serial and port when the asker has
 *   them, and named by findName. Several identical devices that the query cannot tell
 *   apart have no name: RigReady never guesses between them.
 * - A device that is not connected has the name stored for exactly that identity.
 * The name is only ever something to show; what a check matches on stays the identity.
 */
export function deviceNames(entries: NameEntry[], devices: DeviceInfo[]): DeviceNames {
  const present = devices.filter((d) => !d.isHub);
  const narrowed = <T extends { serial?: string | undefined; instanceId?: string | undefined }>(
    list: T[],
    query: DeviceNameQuery
  ): T[] =>
    list.filter(
      (d) =>
        (query.serial === undefined || d.serial === query.serial) &&
        (query.instanceId === undefined || eq(d.instanceId, query.instanceId))
    );
  return {
    nameOf(query) {
      if (query.guid !== undefined) {
        const guid = query.guid.replace(/[{}]/g, '');
        const byGuid = entries.find((e) => eq(e.guid, guid));
        if (byGuid) return byGuid.name;
      }
      const connected = narrowed(
        present.filter((d) => sameModel(d, query)),
        query
      );
      if (connected.length === 1) return findName(entries, connected[0]!, present)?.name;
      if (connected.length > 1) return undefined;
      const stored = narrowed(
        entries.filter((e) => e.guid === undefined && sameModel(e, query)),
        query
      );
      return stored.length === 1 ? stored[0]!.name : undefined;
    },
  };
}

/** What is stored when the user names a device: the model, a unique serial, and the port as a hint. */
export function nameEntryFor(device: DeviceInfo, present: DeviceInfo[], name: string): NameEntry {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    ...(serialIsUnique(device, present) ? { serial: device.serial! } : {}),
    instanceId: device.instanceId,
    name,
  };
}

/** Replaces (or with an empty name, removes) the name of a USB device. */
export function withName(
  data: DevicesData,
  device: DeviceInfo,
  present: DeviceInfo[],
  name: string
): DevicesData {
  const current = findName(data.names, device, present);
  const names = data.names.filter((e) => e !== current);
  const trimmed = name.trim();
  if (trimmed) names.push(nameEntryFor(device, present, trimmed));
  return { ...data, names };
}

/** Replaces (or removes) the name of a controller that has no USB device of its own. */
export function withControllerName(
  data: DevicesData,
  identity: DeviceIdentity & { guid: string },
  name: string
): DevicesData {
  const names = data.names.filter((e) => !eq(e.guid, identity.guid));
  const trimmed = name.trim();
  if (trimmed) names.push({ ...identity, name: trimmed });
  return { ...data, names };
}

/**
 * Records the devices present now: each one's place and time, and which ones went away
 * since the last update (their last-seen time becomes now).
 */
export function recordSeen(history: History, present: DeviceInfo[], now: Date): History {
  const at = now.toISOString();
  const hubs = hubNames(present);
  const byInstance = new Map(history.seen.map((e) => [e.instanceId.toUpperCase(), e]));
  const presentIds = new Set<string>();
  for (const device of present) {
    if (device.isHub) continue;
    const key = device.instanceId.toUpperCase();
    presentIds.add(key);
    const where = locate(device, hubs);
    byInstance.set(key, {
      vendorId: device.vendorId,
      productId: device.productId,
      ...(device.serial ? { serial: device.serial } : {}),
      instanceId: device.instanceId,
      name: device.name,
      location: where.text,
      path: where.path,
      lastSeen: at,
      connected: true,
    });
  }
  for (const [key, entry] of byInstance) {
    if (!presentIds.has(key) && entry.connected) {
      byInstance.set(key, { ...entry, connected: false, lastSeen: at });
    }
  }
  const seen = [...byInstance.values()]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, HISTORY_LIMIT);
  return { ...history, seen };
}

/** The most recent sighting of a device matching the identity, if any. */
export function lastSighting(history: History, identity: DeviceIdentity): SeenEntry | undefined {
  return history.seen
    .filter(
      (e) =>
        sameModel(e, identity) &&
        (identity.serial === undefined || e.serial === identity.serial) &&
        (identity.instanceId === undefined || eq(e.instanceId, identity.instanceId))
    )
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))[0];
}

/** Reads, records, writes. A damaged history file is started again rather than blocking. */
export async function updateHistory(
  stores: DeviceStores,
  present: DeviceInfo[],
  clock: Clock
): Promise<Result<History>> {
  const current = await stores.history.read();
  const base = current.ok ? current.value : HistorySchema.parse({});
  const next = recordSeen(base, present, clock.now());
  const written = await stores.history.write(next);
  return written.ok ? ok(written.value) : written;
}
