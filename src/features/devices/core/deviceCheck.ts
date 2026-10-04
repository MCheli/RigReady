import { z } from 'zod';
import type {
  CaptureDefinition,
  CheckContext,
  CheckDefinition,
  CheckOutcome,
} from '../../../core/checks/registry';
import type { Ports } from '../../../core/ports';
import { ProfileStore } from '../../../core/profile/store';
import { ok } from '../../../core/result';
import type { DeviceInfo } from '../../../shared/models';
import { canSeeHidden, hiddenDeviceIds, hidHideCached, type HidHideInfo } from './hidhide';
import {
  formatWhen,
  hubNames,
  identifiedBy,
  identityFor as narrowIdentity,
  locate,
  sameModel,
  vidPid,
} from './identity';
import { simFamily } from './family';
import { deviceNames, deviceStores, findName, lastSighting } from './store';

export const DEVICE_CONNECTED = 'device.connected';

/**
 * Identity is vendor/product id, narrowed by serial number or instance path when the
 * rig has several identical devices. Never the display name: a check with only a name
 * is rejected (PRODUCT.md rule 4).
 */
export const DeviceParamsSchema = z.object({
  vendorId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  productId: z.string().regex(/^[0-9A-Fa-f]{4}$/),
  serial: z.string().optional(),
  instanceId: z.string().optional(),
  /** How many matching devices must be present. */
  count: z.number().int().min(1).max(16).optional(),
});
export type DeviceParams = z.infer<typeof DeviceParamsSchema>;

export function matchesDevice(device: DeviceInfo, params: DeviceParams): boolean {
  if (device.isHub) return false;
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

export const BY_PORT_NOTE =
  'This device is identified by USB port, so moving it to another port breaks this check.';

/** The program the active setup launches: whether a HidHide-hidden device matters depends on it. */
async function activeGameExe(ports: Ports): Promise<string | undefined> {
  const store = new ProfileStore(ports.files, ports.folders.dataRoot());
  const profiles = await store.list();
  if (!profiles.ok) return undefined;
  const id = await store.lastProfileId();
  // The setup Fly shows: the one used last, else the first.
  const active = profiles.value.find((p) => p.id === id) ?? profiles.value[0];
  return active?.launch?.exe;
}

const exeName = (exe: string): string => exe.split(/[\\/]/).pop() ?? exe;

/** Fails the check when HidHide hides a matching device from the game; undefined when it does not. */
async function hiddenOutcome(
  matches: DeviceInfo[],
  ctx: CheckContext
): Promise<{ pass: false; summary: string; details: string[] } | undefined> {
  let info: HidHideInfo;
  try {
    info = await hidHideCached(ctx.ports);
  } catch (e) {
    ctx.log.warn('could not read HidHide', e);
    return undefined;
  }
  if (!info.installed || !info.cloak) return undefined;
  const hidden = hiddenDeviceIds(info, matches);
  if (!matches.some((d) => hidden.has(d.instanceId.toUpperCase()))) return undefined;
  const exe = await activeGameExe(ctx.ports);
  const visible = canSeeHidden(info, exe);
  if (visible === true) return undefined;
  const details = [
    exe
      ? `HidHide hides it from every program not on its allow list, and ${exeName(exe)} is not on that list.`
      : 'HidHide hides it from every program not on its allow list.',
    'To fix it, open HidHide Configuration Client: on the Devices tab untick this device, or on the Applications tab add the game.',
    'RigReady does not change HidHide settings.',
  ];
  return { pass: false, summary: 'Hidden by HidHide', details };
}

export const deviceConnectedCheck: CheckDefinition<DeviceParams> = {
  type: DEVICE_CONNECTED,
  group: 'devices',
  label: 'Device connected',
  params: DeviceParamsSchema,
  async run(params, ctx) {
    const listed = await ctx.ports.devices.list();
    if (!listed.ok) return { pass: false, summary: listed.error.message };
    const outcome = await checkConnected(params, listed.value, ctx);
    // The owner's name for it leads the line; what was matched is still the identity.
    const name = await ownersName(params, listed.value, ctx);
    return name ? { ...outcome, summary: `${name} · ${outcome.summary}` } : outcome;
  },
};

/**
 * The name the owner gave the one device this check is about, unless the item's title
 * already says it (a setup captured after the device was named).
 */
async function ownersName(
  params: DeviceParams,
  devices: DeviceInfo[],
  ctx: CheckContext
): Promise<string | undefined> {
  if ((params.count ?? 1) > 1) return undefined;
  const data = await deviceStores(ctx.ports).data.read();
  if (!data.ok) return undefined;
  const name = deviceNames(data.value.names, devices).nameOf(params);
  if (!name || !ctx.profile) return name;
  const profile = await new ProfileStore(ctx.ports.files, ctx.ports.folders.dataRoot()).get(
    ctx.profile.id
  );
  if (!profile.ok) return name;
  const mine = JSON.stringify(params);
  const inTitle = profile.value.checks.some((check) => {
    if (check.type !== DEVICE_CONNECTED) return false;
    const parsed = DeviceParamsSchema.safeParse(check.params);
    return (
      parsed.success &&
      JSON.stringify(parsed.data) === mine &&
      check.title.toLowerCase().includes(name.toLowerCase())
    );
  });
  return inTitle ? undefined : name;
}

async function checkConnected(
  params: DeviceParams,
  devices: DeviceInfo[],
  ctx: CheckContext
): Promise<CheckOutcome> {
  {
    const wanted = params.count ?? 1;
    const matches = devices.filter((d) => matchesDevice(d, params));
    const hubs = hubNames(devices);
    const stores = deviceStores(ctx.ports);

    if (matches.length >= wanted) {
      const hidden = await hiddenOutcome(matches, ctx);
      if (hidden) return hidden;
      const where = locate(matches[0]!, hubs).text;
      const details: string[] = [];
      if (params.instanceId !== undefined) details.push(BY_PORT_NOTE);
      return {
        pass: true,
        summary: wanted > 1 ? `${matches.length} connected` : `Connected · ${where}`,
        details,
      };
    }

    const details: string[] = [];
    let summary = wanted > 1 ? `${matches.length} of ${wanted} connected` : 'Not connected';
    const history = await stores.history.read();
    const seen = history.ok ? lastSighting(history.value, params) : undefined;
    if (seen && !seen.connected) {
      const when = formatWhen(new Date(seen.lastSeen), ctx.ports.clock.now());
      const phrase = seen.location.charAt(0).toLowerCase() + seen.location.slice(1);
      summary += ` · last seen ${when}, ${phrase}`;
      details.push(
        `It was last plugged in ${phrase.startsWith('on ') ? phrase : `to ${phrase}`} (USB path ${seen.path}).`
      );
    }
    // Same model, different unit: say so rather than a bare "not connected".
    const others = devices.filter((d) => !d.isHub && sameModel(d, params) && !matches.includes(d));
    if (others.length > 0 && (params.serial !== undefined || params.instanceId !== undefined)) {
      const other = others[0]!;
      const names = await stores.data.read();
      const label = (names.ok && findName(names.value.names, other, devices)?.name) || other.name;
      details.unshift(
        params.serial !== undefined
          ? `A different ${label} is connected (serial ${other.serial ?? 'none'}), not this one.`
          : `A ${label} is connected on another USB port (${locate(other, hubs).text.toLowerCase()}).`
      );
    }
    details.push('Check that it is plugged in and powered on, then check again.');
    if (params.instanceId !== undefined) details.push(BY_PORT_NOTE);
    return { pass: false, summary, details };
  }
}

/** Narrowest identity that still tells this device apart from the others present. */
export function identityFor(device: DeviceInfo, all: DeviceInfo[]): DeviceParams {
  return narrowIdentity(device, all);
}

export const deviceCapture: CaptureDefinition = {
  id: 'devices',
  label: 'Devices',
  async capture(ctx) {
    const devices = await ctx.ports.devices.list();
    if (!devices.ok) return devices;
    const peripherals = devices.value.filter((d) => !d.isHub);
    const names = await deviceStores(ctx.ports).data.read();
    const candidates = peripherals.map((device) => {
      const params = identityFor(device, peripherals);
      const given = names.ok ? findName(names.value.names, device, peripherals)?.name : undefined;
      const id = vidPid(device);
      const how = identifiedBy(params);
      // Identical devices without names of their own are told apart by position in the list.
      const twins = peripherals.filter((d) => sameModel(d, device));
      const twin =
        twins.length > 1 ? { index: twins.indexOf(device) + 1, of: twins.length } : undefined;
      const title = given ?? (twin ? `${device.name} (${twin.index} of ${twin.of})` : device.name);
      const kind = simFamily(device.vendorId, device.productId);
      return {
        key: `device:${device.instanceId}`,
        group: 'devices' as const,
        title,
        description:
          how === 'serial'
            ? `${id} · serial ${device.serial}`
            : how === 'port'
              ? `${id} · identified by USB port`
              : id,
        // Sim gear is pre-selected; keyboards, mice, headsets and the rest are the user's call.
        selectedByDefault: device.isGameController,
        tier: device.isGameController ? ('main' as const) : ('more' as const),
        icon: device.isGameController ? 'mdi-controller' : 'mdi-usb',
        ...(kind && device.isGameController ? { kind } : {}),
        device: {
          vendorId: device.vendorId,
          productId: device.productId,
          ...(device.serial ? { serial: device.serial } : {}),
          gameController: device.isGameController,
          identifiedBy: how,
          ...(twin ? { twin } : {}),
          ...(given ? { model: device.name } : {}),
        },
        check: { type: DEVICE_CONNECTED, title, required: true, params },
      };
    });
    // Game controllers first, as the capture screen lists them; names in order within each.
    return ok(
      candidates.sort(
        (a, b) =>
          Number(b.device.gameController) - Number(a.device.gameController) ||
          a.title.localeCompare(b.title)
      )
    );
  },
};
