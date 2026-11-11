import { KnownDeviceSchema, type KnownDevice, type KnownDeviceInput } from './schema';
import { THRUSTMASTER } from './thrustmaster';
import { LOGITECH } from './logitech';

export { KnownDeviceSchema, outOfShape } from './schema';
export type { KnownDevice, KnownControl, KnownInput } from './schema';

/** Every device map RigReady ships, in the order the manual lists them. */
export const KNOWN_DEVICES: readonly KnownDeviceInput[] = [...THRUSTMASTER, ...LOGITECH];

export interface BuiltinKnown {
  devices: KnownDevice[];
  /** A map that did not pass its schema: a bug, reported and skipped. */
  broken: { name: string; reason: string }[];
}

let cached: BuiltinKnown | undefined;

/** The shipped device maps, validated like any file. */
export function knownDevices(): BuiltinKnown {
  if (cached) return cached;
  const devices: KnownDevice[] = [];
  const broken: BuiltinKnown['broken'] = [];
  for (const raw of KNOWN_DEVICES) {
    const parsed = KnownDeviceSchema.safeParse(raw);
    if (parsed.success) devices.push(parsed.data);
    else broken.push({ name: raw.name, reason: parsed.error.message });
  }
  cached = { devices, broken };
  return cached;
}

/**
 * The map of a device: by its USB vendor and product id first, then by a part of the name
 * it reports (for models whose product id the firmware sets).
 */
export function knownDeviceFor(device: {
  vendorId?: string | undefined;
  productId?: string | undefined;
  name?: string | undefined;
}): KnownDevice | undefined {
  const { devices } = knownDevices();
  const vid = device.vendorId?.toUpperCase();
  const pid = device.productId?.toUpperCase();
  if (vid && pid) {
    const byId = devices.find((d) => d.match.vendorId === vid && d.match.productIds.includes(pid));
    if (byId) return byId;
  }
  const name = device.name?.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!name) return undefined;
  return devices.find(
    (d) =>
      (!vid || d.match.vendorId === vid) &&
      d.match.names.some((part) => name.includes(part.toLowerCase()))
  );
}

/** "H2 TMS hat ↑", "TG1 trigger, first stage": what each input of a known device is. */
export function knownLabels(device: KnownDevice): Map<string, string> {
  const labels = new Map<string, string>();
  for (const control of device.controls) {
    for (const input of control.inputs) {
      labels.set(input.id, input.tag ? `${control.name} ${input.tag}` : control.name);
    }
  }
  return labels;
}
