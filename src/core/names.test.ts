import { describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../shared/models';
import { deviceQueryOf, NameRegistry } from './names';

const WHEEL = { vendorId: '0EB7', productId: '0007' };

describe('the device a checklist item is about', () => {
  it('is read from the parameters by their shape: USB ids, with a serial or a port when there is one', () => {
    expect(deviceQueryOf({ vendorId: '044f', productId: 'b68f' })).toEqual({
      vendorId: '044F',
      productId: 'B68F',
    });
    expect(
      deviceQueryOf({ vendorId: '4098', productId: 'BEE0', serial: ' S1 ', instanceId: 'USB\\X' })
    ).toEqual({ vendorId: '4098', productId: 'BEE0', serial: 'S1', instanceId: 'USB\\X' });
    expect(deviceQueryOf({ ...WHEEL, serial: '', count: 2 })).toEqual(WHEEL);
  });

  it('is nothing for an item that is not about one device', () => {
    expect(deviceQueryOf({})).toBeUndefined();
    expect(deviceQueryOf({ name: 'TrackIR5.exe' })).toBeUndefined();
    expect(deviceQueryOf({ vendorId: '044F' })).toBeUndefined();
    expect(deviceQueryOf({ vendorId: 'nope', productId: 'B68F' })).toBeUndefined();
    expect(deviceQueryOf({ vendorId: 1103, productId: 46735 })).toBeUndefined();
  });
});

describe('DEV-017: what a device is, asked through core', () => {
  it('hands the devices the asker has just read to the source, so they are not listed twice', async () => {
    const names = new NameRegistry();
    const asked: (DeviceInfo[] | undefined)[] = [];
    names.provideDevices(async (present) => {
      asked.push(present);
      return { nameOf: () => 'Wheel base', whatIs: () => ({ kind: 'wheel', usedFor: 'racing' }) };
    });
    const present: DeviceInfo[] = [];
    const lookup = await names.devices(present);
    expect(lookup.whatIs?.(WHEEL)).toEqual({ kind: 'wheel', usedFor: 'racing' });
    expect(lookup.nameOf(WHEEL)).toBe('Wheel base');
    await names.devices();
    expect(asked).toHaveLength(2);
    expect(asked[0]).toBe(present);
    expect(asked[1]).toBeUndefined();
  });

  it('with no source, a source that only knows names, or one that fails, nothing is known and nothing breaks', async () => {
    const none = await new NameRegistry().devices();
    expect(none.nameOf(WHEEL)).toBeUndefined();
    expect(none.whatIs?.(WHEEL)).toBeUndefined();

    const namesOnly = new NameRegistry();
    namesOnly.provideDevices(async () => ({ nameOf: () => 'Wheel base' }));
    expect((await namesOnly.devices()).whatIs?.(WHEEL)).toBeUndefined();

    const failing = new NameRegistry();
    failing.provideDevices(async () => {
      throw new Error('disk');
    });
    const lookup = await failing.devices([]);
    expect(lookup.nameOf(WHEEL)).toBeUndefined();
    expect(lookup.whatIs?.(WHEEL)).toBeUndefined();
  });
});
