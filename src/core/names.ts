/**
 * The names the owner gave things ("MFD left", "Left throttle"), for every feature to
 * show instead of what the hardware calls itself.
 *
 * The feature that lets the user name something keeps the names and registers a source
 * here from its main.ts (`ctx.names.provideMonitors(...)`, `ctx.names.provideDevices(...)`);
 * any other feature reads them through `ctx.names`. A name is never worth failing for:
 * without a source, or when the source fails, there are simply no names.
 *
 * The same lookup answers what the user said a device is (`whatIs`): the kind of gear and
 * what it is used for, for a device RigReady cannot tell or has wrong.
 */

import type { DeviceInfo } from '../shared/models';
import type { DeviceKind, DeviceUse } from './gearKind';
import { nullLogger, type Logger } from './logger';

/** Friendly monitor names by monitor id (lower case). */
export type MonitorNames = Record<string, string>;

/** Enough of a device to find its name: USB ids, narrowed by serial, port or DirectInput GUID. */
export interface DeviceNameQuery {
  vendorId: string;
  productId: string;
  serial?: string;
  /** Windows device instance path (the USB port, for identical devices without a serial). */
  instanceId?: string;
  /**
   * DirectInput instance GUID, for a controller looked up from a game's point of view.
   * Among several identical devices it picks the one the controller belongs to, when the
   * platform reports that (InputDevice.usbInstanceId); otherwise there is no name.
   */
  guid?: string;
}

/**
 * What the user said a device is, on the Devices page. Either part can be left unsaid.
 * It is the user's word about their own device and stays on this PC. It wins over what
 * RigReady tells from the device's name (core/gearKind) and from its maker. The kinds and
 * the uses there are to choose from are lists in core/gearKind.
 */
export interface DeviceSaid {
  /** The kind of gear: what picture goes beside it, and which games read it. */
  kind?: DeviceKind;
  /** Flight gear, racing gear, or both: which new setups keep it by default. */
  usedFor?: DeviceUse;
}

/** The device names as they are now. */
export interface DeviceNames {
  /** The name the user gave this device, when there is one. */
  nameOf(device: DeviceNameQuery): string | undefined;
  /**
   * What the user said this device is, when they said anything. Found by the same rules
   * as the name. Optional, so that a source of names alone is still a source: ask with
   * `names.whatIs?.(device)`.
   */
  whatIs?(device: DeviceNameQuery): DeviceSaid | undefined;
}

const HEX4 = /^[0-9A-Fa-f]{4}$/;
const words = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * The device a checklist item is about, read from its parameters by their shape: USB ids,
 * with a serial number or a port when the item names one unit. Undefined for an item that
 * is not about one device. For a feature that shows a setup's devices and wants the
 * owner's word on each (`nameOf`, `whatIs`) without knowing the check that keeps them.
 */
export function deviceQueryOf(params: Record<string, unknown>): DeviceNameQuery | undefined {
  const vendorId = words(params['vendorId']);
  const productId = words(params['productId']);
  if (!vendorId || !productId || !HEX4.test(vendorId) || !HEX4.test(productId)) return undefined;
  const serial = words(params['serial']);
  const instanceId = words(params['instanceId']);
  return {
    vendorId: vendorId.toUpperCase(),
    productId: productId.toUpperCase(),
    ...(serial ? { serial } : {}),
    ...(instanceId ? { instanceId } : {}),
  };
}

const NO_DEVICE_NAMES: DeviceNames = { nameOf: () => undefined };

/**
 * Where the device names come from. `present`: the connected devices, when the asker has
 * just read them; the source then does not ask the machine again.
 */
export type DeviceNameSource = (present?: DeviceInfo[]) => Promise<DeviceNames>;

export class NameRegistry {
  private monitorSource: (() => Promise<MonitorNames>) | undefined;
  private deviceSource: DeviceNameSource | undefined;

  constructor(private readonly log: Logger = nullLogger) {}

  provideMonitors(source: () => Promise<MonitorNames>): void {
    if (this.monitorSource) throw new Error('Monitor names are already provided');
    this.monitorSource = source;
  }

  provideDevices(source: DeviceNameSource): void {
    if (this.deviceSource) throw new Error('Device names are already provided');
    this.deviceSource = source;
  }

  /** Friendly monitor names by monitor id (lower case); empty when there are none. */
  async monitors(): Promise<MonitorNames> {
    try {
      return (await this.monitorSource?.()) ?? {};
    } catch (e) {
      // Names are decoration: a provider that fails must not take down the screen that shows them.
      this.log.warn('monitor names could not be read', e);
      return {};
    }
  }

  /**
   * A lookup over the device names as they are now. Hand in the connected devices when
   * you have just read them (`ports.devices.list()`): listing them is the slowest thing
   * RigReady does, and the lookup then does not do it a second time.
   */
  async devices(present?: DeviceInfo[]): Promise<DeviceNames> {
    try {
      return (await this.deviceSource?.(present)) ?? NO_DEVICE_NAMES;
    } catch (e) {
      this.log.warn('device names could not be read', e);
      return NO_DEVICE_NAMES;
    }
  }
}
