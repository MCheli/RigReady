import type { Registry } from './ports';
import { ok, type Result } from './result';
import type { DeviceInfo, DirectInputIdentity, RegistryValue } from '../shared/models';

/**
 * What Windows remembers about DirectInput game controllers, read from the registry.
 * This is where the instance GUID in DCS binding file names and in iRacing's files
 * comes from, and it also resolves a GUID found in an old file back to a VID/PID.
 *
 * For the controllers attached right now, InputProvider.start() gives the live
 * instance GUID of each. When a VID/PID has several slots here, only that live list
 * (or the game's own log) says which slot is in use.
 */

const PRIVATE = 'System\\CurrentControlSet\\Control\\MediaProperties\\PrivateProperties';
const DIRECTINPUT = `${PRIVATE}\\DirectInput`;
const OEM = `${PRIVATE}\\Joystick\\OEM`;

/** 16 registry bytes (hex) to "806E0610-B756-11F0-8024-444553540000". */
export function guidFromBytes(hex: string): string | undefined {
  const h = hex.toUpperCase();
  if (!/^[0-9A-F]{32}$/.test(h)) return undefined;
  const swap = (part: string): string => part.match(/../g)!.reverse().join('');
  return [
    swap(h.slice(0, 8)),
    swap(h.slice(8, 12)),
    swap(h.slice(12, 16)),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join('-');
}

/** DCS writes the third group in lower case: 806E0610-B756-11f0-8024-444553540000. */
export function dcsGuidText(guid: string): string {
  const parts = guid.replace(/[{}]/g, '').toUpperCase().split('-');
  if (parts.length !== 5) return guid;
  parts[2] = parts[2]!.toLowerCase();
  return parts.join('-');
}

/** Case- and brace-insensitive GUID comparison. */
export function sameGuid(a: string, b: string): boolean {
  const clean = (g: string): string => g.replace(/[{}]/g, '').toUpperCase();
  return clean(a) === clean(b);
}

/** The DirectInput product GUID of a HID device: PPPPVVVV-0000-0000-0000-504944564944. */
export function productGuidFor(vendorId: string, productId: string): string {
  return `${productId}${vendorId}-0000-0000-0000-504944564944`.toUpperCase();
}

function littleEndianNumber(value: RegistryValue | undefined): number | undefined {
  if (!value) return undefined;
  if (value.type === 'number') return value.value;
  if (value.type !== 'binary' || value.value.length < 8) return undefined;
  const bytes = value.value.slice(0, 8).match(/../g)!;
  return Number.parseInt(bytes.reverse().join(''), 16);
}

/** Every game controller model Windows has registered for DirectInput, with its instance GUIDs. */
export async function readDirectInputIdentities(
  registry: Registry
): Promise<Result<DirectInputIdentity[]>> {
  const models = await registry.listKeys('HKCU', DIRECTINPUT);
  if (!models.ok) return models;
  const identities: DirectInputIdentity[] = [];
  for (const model of models.value) {
    const match = /^VID_([0-9A-F]{4})&PID_([0-9A-F]{4})$/i.exec(model);
    if (!match) continue;
    const vendorId = match[1]!.toUpperCase();
    const productId = match[2]!.toUpperCase();
    let name = '';
    for (const hive of ['HKCU', 'HKLM'] as const) {
      const oem = await registry.getValue(hive, `${OEM}\\${model}`, 'OEMName');
      if (oem.ok && oem.value?.type === 'string' && oem.value.value) {
        name = oem.value.value;
        break;
      }
    }
    const identity: DirectInputIdentity = {
      vendorId,
      productId,
      name,
      productGuid: productGuidFor(vendorId, productId),
      instances: [],
    };
    const slots = await registry.listKeys('HKCU', `${DIRECTINPUT}\\${model}\\Calibration`);
    for (const slot of slots.ok ? slots.value : []) {
      if (!/^\d+$/.test(slot)) continue;
      const values = await registry.listValues(
        'HKCU',
        `${DIRECTINPUT}\\${model}\\Calibration\\${slot}`
      );
      if (!values.ok) continue;
      const raw = values.value['GUID'];
      const guid = raw?.type === 'binary' ? guidFromBytes(raw.value) : undefined;
      if (!guid) continue;
      const joystickId = littleEndianNumber(values.value['Joystick Id']);
      identity.instances.push({
        slot: Number.parseInt(slot, 10),
        guid,
        ...(joystickId !== undefined ? { joystickId } : {}),
      });
    }
    identity.instances.sort((a, b) => a.slot - b.slot);
    identities.push(identity);
  }
  identities.sort(
    (a, b) => a.vendorId.localeCompare(b.vendorId) || a.productId.localeCompare(b.productId)
  );
  return ok(identities);
}

/** The DirectInput record for a USB device, joined by VID/PID. */
export function identityForDevice(
  identities: DirectInputIdentity[],
  device: Pick<DeviceInfo, 'vendorId' | 'productId'>
): DirectInputIdentity | undefined {
  return identities.find(
    (i) =>
      i.vendorId === device.vendorId.toUpperCase() && i.productId === device.productId.toUpperCase()
  );
}

/** Which controller model an instance GUID (from a DCS file name, an iRacing file, ...) belongs to. */
export function identityForGuid(
  identities: DirectInputIdentity[],
  guid: string
): DirectInputIdentity | undefined {
  return identities.find((i) => i.instances.some((instance) => sameGuid(instance.guid, guid)));
}
