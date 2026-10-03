import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../../../shared/models';
import {
  formatWhen,
  hubDepth,
  hubNames,
  identifiedBy,
  identityFor,
  locate,
  portOf,
  serialIsUnique,
  vidPid,
} from './identity';

const root = { instanceId: 'USB\\ROOT_HUB30\\4&2fd48294&0&0', name: 'USB Root Hub (USB 3.0)' };
const hub = (id: string): { instanceId: string; name: string } => ({
  instanceId: `USB\\VID_05E3&PID_0610\\${id}`,
  name: 'Generic USB Hub',
});

const device = (overrides: Partial<DeviceInfo>): DeviceInfo => ({
  instanceId: 'USB\\VID_1234&PID_0001\\5&abc&0&1',
  vendorId: '1234',
  productId: '0001',
  name: 'Button Box',
  isHid: true,
  isGameController: true,
  isHub: false,
  hubChain: [root],
  ...overrides,
});

describe('device identity', () => {
  it('uses ids alone for a single unit, the serial for twins with real serials, the port otherwise', () => {
    const single = device({});
    expect(identityFor(single, [single])).toEqual({ vendorId: '1234', productId: '0001' });
    expect(identifiedBy(identityFor(single, [single]))).toBe('ids');

    const a = device({ serial: 'A1', instanceId: 'USB\\VID_1234&PID_0001\\A1' });
    const b = device({ serial: 'B2', instanceId: 'USB\\VID_1234&PID_0001\\B2' });
    expect(identityFor(a, [a, b])).toEqual({ vendorId: '1234', productId: '0001', serial: 'A1' });
    expect(identifiedBy(identityFor(a, [a, b]))).toBe('serial');

    // Some vendors give every unit the same "serial": that tells nothing apart.
    const z1 = device({ serial: '0', instanceId: 'USB\\VID_1234&PID_0001\\x1' });
    const z2 = device({ serial: '0', instanceId: 'USB\\VID_1234&PID_0001\\x2' });
    expect(serialIsUnique(z1, [z1, z2])).toBe(false);
    expect(identityFor(z1, [z1, z2])).toEqual({
      vendorId: '1234',
      productId: '0001',
      instanceId: z1.instanceId,
    });
    expect(identifiedBy(identityFor(z1, [z1, z2]))).toBe('port');
    // Hubs never count as twins.
    expect(identityFor(single, [single, device({ isHub: true, instanceId: 'h' })])).toEqual({
      vendorId: '1234',
      productId: '0001',
    });
  });

  it('reads the port from a generated instance suffix, not from a serial', () => {
    expect(portOf('USB\\VID_044F&PID_B68F\\8&348856f8&0&2')).toBe(2);
    expect(portOf('USB\\VID_8087&PID_0033\\5&cc3f949&0&14')).toBe(14);
    expect(portOf('USB\\VID_4098&PID_BEE2\\80E62062A4E6D221B2465002')).toBeUndefined();
    expect(portOf('USB\\VID_2109&PID_2817\\MSFT20000000000')).toBeUndefined();
  });

  it('describes where a device is plugged in, with the port path from the computer', () => {
    const pedals = device({
      instanceId: 'USB\\VID_044F&PID_B68F\\8&348856f8&0&2',
      hubChain: [hub('7&2877fc43&0&2'), hub('6&10c71c98&0&4'), hub('5&cc3f949&0&6'), root],
    });
    const names = new Map([[hub('7&2877fc43&0&2').instanceId.toUpperCase(), 'USB2.1 Hub']]);
    expect(locate(pedals, names)).toEqual({
      text: 'Port 2 on USB2.1 Hub',
      path: '6 › 4 › 2 › 2',
      depth: 3,
      hubName: 'USB2.1 Hub',
      port: 2,
    });
    expect(hubDepth(pedals)).toBe(3);

    const serial = device({
      instanceId: 'USB\\VID_4098&PID_BEE2\\80E6',
      hubChain: [hub('7&1&0&4'), root],
    });
    expect(locate(serial)).toMatchObject({ text: 'On Generic USB Hub', path: '4', depth: 1 });

    const onRoot = device({ instanceId: 'USB\\VID_8087&PID_0033\\5&cc3f949&0&14' });
    expect(locate(onRoot)).toMatchObject({ text: 'Port 14 on the computer', path: '14', depth: 0 });
    expect(locate(device({ hubChain: [] })).text).toBe('Not on a USB hub');

    const hubs = hubNames([
      device({ isHub: true, instanceId: 'usb\\hub\\1', name: 'USB2.1 Hub' }),
      device({}),
    ]);
    expect([...hubs.entries()]).toEqual([['USB\\HUB\\1', 'USB2.1 Hub']]);
  });

  it('says when a device was last seen in words', () => {
    const now = new Date(2026, 9, 3, 12, 0);
    expect(formatWhen(new Date(2026, 9, 3, 11, 59, 30), now)).toBe('just now');
    expect(formatWhen(new Date(2026, 9, 3, 11, 59), now)).toBe('1 minute ago');
    expect(formatWhen(new Date(2026, 9, 3, 11, 48), now)).toBe('12 minutes ago');
    expect(formatWhen(new Date(2026, 9, 3, 9, 41), now)).toBe('today 09:41');
    expect(formatWhen(new Date(2026, 9, 2, 21, 14), now)).toBe('yesterday 21:14');
    expect(formatWhen(new Date(2026, 8, 28, 7, 5), now)).toBe('28 Sep 07:05');
    expect(formatWhen(new Date(2025, 8, 28, 7, 5), now)).toBe('28 Sep 2025 07:05');
    expect(vidPid({ vendorId: '044f', productId: 'b68f' })).toBe('044F:B68F');
  });
});
