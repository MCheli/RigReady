/**
 * The names the owner gave things ("MFD left", "Left throttle"), for every feature to
 * show instead of what the hardware calls itself.
 *
 * The feature that lets the user name something keeps the names and registers a source
 * here from its main.ts (`ctx.names.provideMonitors(...)`, `ctx.names.provideDevices(...)`);
 * any other feature reads them through `ctx.names`. A name is never worth failing for:
 * without a source, or when the source fails, there are simply no names.
 */

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
  /** DirectInput instance GUID, for a controller looked up from a game's point of view. */
  guid?: string;
}

/** The device names as they are now. */
export interface DeviceNames {
  /** The name the user gave this device, when there is one. */
  nameOf(device: DeviceNameQuery): string | undefined;
}

const NO_DEVICE_NAMES: DeviceNames = { nameOf: () => undefined };

export class NameRegistry {
  private monitorSource: (() => Promise<MonitorNames>) | undefined;
  private deviceSource: (() => Promise<DeviceNames>) | undefined;

  constructor(private readonly log: Logger = nullLogger) {}

  provideMonitors(source: () => Promise<MonitorNames>): void {
    if (this.monitorSource) throw new Error('Monitor names are already provided');
    this.monitorSource = source;
  }

  provideDevices(source: () => Promise<DeviceNames>): void {
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

  /** A lookup over the device names as they are now. */
  async devices(): Promise<DeviceNames> {
    try {
      return (await this.deviceSource?.()) ?? NO_DEVICE_NAMES;
    } catch (e) {
      this.log.warn('device names could not be read', e);
      return NO_DEVICE_NAMES;
    }
  }
}
