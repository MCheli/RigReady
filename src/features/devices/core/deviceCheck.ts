import { z } from 'zod';
import type { CaptureDefinition, CheckDefinition } from '../../../core/checks/registry';
import { ok } from '../../../core/result';
import type { DeviceInfo } from '../../../shared/models';

export const DEVICE_CONNECTED = 'device.connected';

/**
 * Identity is vendor/product id, narrowed by serial number or instance path when the
 * rig has several identical devices. Never the display name.
 */
export const DeviceParamsSchema = z.object({
  vendorId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  productId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  serial: z.string().optional(),
  instanceId: z.string().optional(),
});
export type DeviceParams = z.infer<typeof DeviceParamsSchema>;

export function matchesDevice(device: DeviceInfo, params: DeviceParams): boolean {
  if (device.vendorId !== params.vendorId.toUpperCase()) return false;
  if (device.productId !== params.productId.toUpperCase()) return false;
  if (params.serial !== undefined && device.serial !== params.serial) return false;
  if (
    params.instanceId !== undefined &&
    device.instanceId.toUpperCase() !== params.instanceId.toUpperCase()
  ) {
    return false;
  }
  return true;
}

export const deviceConnectedCheck: CheckDefinition<DeviceParams> = {
  type: DEVICE_CONNECTED,
  group: 'devices',
  label: 'Device connected',
  params: DeviceParamsSchema,
  async run(params, ctx) {
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return { pass: false, summary: devices.error.message };
    const found = devices.value.find((d) => matchesDevice(d, params));
    if (!found) return { pass: false, summary: 'Not connected' };
    const hub = found.hubChain[0]?.name;
    return { pass: true, summary: hub ? `Connected · ${hub}` : 'Connected' };
  },
};

/** Narrowest identity that still tells this device apart from the others present. */
export function identityFor(device: DeviceInfo, all: DeviceInfo[]): DeviceParams {
  const params: DeviceParams = { vendorId: device.vendorId, productId: device.productId };
  const twins = all.filter(
    (d) => d.vendorId === device.vendorId && d.productId === device.productId
  );
  if (twins.length <= 1) return params;
  const serials = new Set(twins.map((d) => d.serial));
  if (device.serial !== undefined && serials.size === twins.length)
    return { ...params, serial: device.serial };
  return { ...params, instanceId: device.instanceId };
}

export const deviceCapture: CaptureDefinition = {
  id: 'devices',
  label: 'Devices',
  async capture(ctx) {
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return devices;
    const peripherals = devices.value.filter((d) => !d.isHub);
    return ok(
      peripherals.map((device) => {
        const params = identityFor(device, peripherals);
        const id = `${device.vendorId}:${device.productId}`;
        return {
          key: `device:${device.instanceId}`,
          group: 'devices' as const,
          title: device.name,
          description: device.serial ? `${id} · serial ${device.serial}` : id,
          // Game controllers are HID; storage, Bluetooth radios and the like are not.
          selectedByDefault: device.isHid,
          check: { type: DEVICE_CONNECTED, title: device.name, required: true, params },
        };
      })
    );
  },
};
