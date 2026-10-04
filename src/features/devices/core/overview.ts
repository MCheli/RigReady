import type { Profile } from '../../../core/profile/schema';
import type { DeviceInfo, InputDevice } from '../../../shared/models';
import {
  DEVICE_CONNECTED,
  DeviceParamsSchema,
  matchesDevice,
  type DeviceParams,
} from './deviceCheck';
import { canSeeHidden, hiddenDeviceIds, onAppList, type HidHideInfo } from './hidhide';
import {
  formatWhen,
  hubNames,
  identifiedBy,
  identityFor,
  locate,
  sameModel,
  twinsOf,
} from './identity';
import type { HidHideSummary, MissingDevice, Overview, RigDevice } from './model';
import { findName, lastSighting, type DevicesData, type History } from './store';

export interface OverviewInputs {
  devices: DeviceInfo[];
  input: InputDevice[];
  inputError?: string;
  data: DevicesData;
  history: History;
  profiles: Profile[];
  activeProfile?: Profile;
  hidHide: HidHideInfo;
  /** Games whose bindings can be read: where a controller's bindings are shown. */
  bindingPages?: { label: string; route(guid: string): string }[];
  /** RigReady's own executable: it must see hidden devices for the input tester to show them. */
  rigReadyExe?: string;
  now: Date;
}

export interface Requirement {
  profile: string;
  title: string;
  params: DeviceParams;
}

/** Every device check in the given setups, with its parsed identity. */
export function requirements(profiles: Profile[]): Requirement[] {
  const out: Requirement[] = [];
  for (const profile of profiles) {
    for (const check of profile.checks) {
      if (check.type !== DEVICE_CONNECTED) continue;
      const params = DeviceParamsSchema.safeParse(check.params);
      if (params.success)
        out.push({ profile: profile.name, title: check.title, params: params.data });
    }
  }
  return out;
}

const sameIds = (device: InputDevice, usb: Pick<DeviceInfo, 'vendorId' | 'productId'>): boolean =>
  device.vendorId.toUpperCase() === usb.vendorId &&
  device.productId.toUpperCase() === usb.productId;

function hidHideSummary(inputs: OverviewInputs, hiddenCount: number): HidHideSummary {
  const info = inputs.hidHide;
  if (!info.installed) return { state: 'notInstalled' };
  if (info.error) return { state: 'error', message: info.error };
  const programs: { label: string; exe: string }[] = [];
  if (inputs.rigReadyExe) programs.push({ label: 'RigReady', exe: inputs.rigReadyExe });
  const seen = new Set<string>();
  for (const profile of inputs.profiles) {
    const exe = profile.launch?.exe;
    if (!exe || seen.has(exe.toLowerCase())) continue;
    seen.add(exe.toLowerCase());
    programs.push({ label: profile.name, exe });
  }
  return {
    state: 'ok',
    cloak: info.cloak,
    inverse: info.inverse,
    hiddenCount,
    apps: info.apps,
    programs: programs.map((p) => ({
      ...p,
      onList: onAppList(info, p.exe),
      seesHidden: canSeeHidden(info, p.exe) === true,
    })),
  };
}

export function buildOverview(inputs: OverviewInputs): Overview {
  const present = inputs.devices.filter((d) => !d.isHub);
  const hubs = hubNames(inputs.devices);
  const hidden = hiddenDeviceIds(inputs.hidHide, present);
  const needs = requirements(inputs.profiles);
  const usedControllers = new Set<string>();
  const bindingLinks = (controllers: InputDevice[]): RigDevice['bindingLinks'] =>
    controllers.length === 0
      ? []
      : (inputs.bindingPages ?? []).map((page) => ({
          label: page.label,
          to: page.route(controllers[0]!.guid),
        }));

  const devices: RigDevice[] = present.map((device) => {
    const twins = twinsOf(device, present).length;
    const controllers = inputs.input.filter((c) => sameIds(c, device));
    controllers.forEach((c) => usedControllers.add(c.guid));
    const identity = identityFor(device, present);
    const given = findName(inputs.data.names, device, present)?.name;
    return {
      key: device.instanceId,
      instanceId: device.instanceId,
      vendorId: device.vendorId,
      productId: device.productId,
      ...(device.serial ? { serial: device.serial } : {}),
      ...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
      productName: device.name.trim(),
      ...(given ? { givenName: given } : {}),
      name: given ?? device.name.trim(),
      kind: device.isGameController || controllers.length > 0 ? 'controller' : 'other',
      controllers,
      controllersShared: twins > 1 && controllers.length > 0,
      twins,
      identity,
      identifiedBy: identifiedBy(identity),
      location: locate(device, hubs),
      hidden: hidden.has(device.instanceId.toUpperCase()),
      requiredBy: [
        ...new Set(needs.filter((n) => matchesDevice(device, n.params)).map((n) => n.profile)),
      ],
      bindingLinks: bindingLinks(controllers),
    };
  });

  // Controllers DirectInput lists without a USB device of the same model: virtual
  // (vJoy, ViGEm) or wireless ones. Named by their instance GUID.
  for (const controller of inputs.input) {
    if (usedControllers.has(controller.guid)) continue;
    const given = inputs.data.names.find(
      (e) => e.guid !== undefined && e.guid.toUpperCase() === controller.guid.toUpperCase()
    )?.name;
    const vendorId = controller.vendorId || '0000';
    const productId = controller.productId || '0000';
    devices.push({
      key: `guid:${controller.guid}`,
      vendorId,
      productId,
      productName: controller.name.trim(),
      ...(given ? { givenName: given } : {}),
      name: given ?? controller.name.trim(),
      kind: 'controller',
      controllers: [controller],
      controllersShared: false,
      twins: 1,
      identity: { vendorId, productId, guid: controller.guid },
      identifiedBy: 'guid',
      hidden: false,
      requiredBy: [],
      bindingLinks: bindingLinks([controller]),
    });
  }

  devices.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'controller' ? -1 : 1) ||
      a.name.localeCompare(b.name) ||
      a.key.localeCompare(b.key)
  );

  // Devices a setup needs that are not here.
  const missing = new Map<string, MissingDevice>();
  for (const need of needs) {
    const found = present.filter((d) => matchesDevice(d, need.params)).length;
    if (found >= (need.params.count ?? 1)) continue;
    const { count: _count, ...identity } = need.params;
    const key = JSON.stringify({
      ...identity,
      vendorId: identity.vendorId.toUpperCase(),
      productId: identity.productId.toUpperCase(),
    });
    const existing = missing.get(key);
    if (existing) {
      if (!existing.profiles.includes(need.profile)) existing.profiles.push(need.profile);
      continue;
    }
    const seen = lastSighting(inputs.history, identity);
    const named = inputs.data.names.find(
      (e) =>
        e.guid === undefined &&
        sameModel(e, identity) &&
        (identity.serial === undefined || e.serial === identity.serial) &&
        (identity.instanceId === undefined ||
          e.instanceId?.toUpperCase() === identity.instanceId.toUpperCase())
    )?.name;
    missing.set(key, {
      title: named ?? need.title,
      identity,
      profiles: [need.profile],
      ...(seen && !seen.connected
        ? {
            lastSeen: formatWhen(new Date(seen.lastSeen), inputs.now),
            lastLocation: seen.location,
            lastPath: seen.path,
          }
        : {}),
      otherUnit: present.some((d) => sameModel(d, identity)),
    });
  }

  return {
    devices,
    missing: [...missing.values()].sort((a, b) => a.title.localeCompare(b.title)),
    hidHide: hidHideSummary(inputs, hidden.size),
    ...(inputs.inputError ? { inputError: inputs.inputError } : {}),
    notifications: inputs.data.notifications,
    ...(inputs.activeProfile ? { activeProfile: inputs.activeProfile.name } : {}),
  };
}
