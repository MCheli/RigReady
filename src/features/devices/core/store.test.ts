import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../../../shared/models';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  DevicesDataSchema,
  deviceNames,
  deviceStores,
  findName,
  HistorySchema,
  lastSighting,
  recordSeen,
  updateHistory,
  withControllerName,
  withName,
} from './store';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

const root = { instanceId: 'USB\\ROOT_HUB30\\4&2fd48294&0&0', name: 'USB Root Hub (USB 3.0)' };
const device = (overrides: Partial<DeviceInfo>): DeviceInfo => ({
  instanceId: 'USB\\VID_0EB7&PID_0007\\6&3a944ce5&0&4',
  vendorId: '0EB7',
  productId: '0007',
  name: 'FANATEC Podium Wheel Base DD2',
  isHid: true,
  isGameController: true,
  isHub: false,
  hubChain: [root],
  ...overrides,
});
const empty = DevicesDataSchema.parse({});

describe('device names', () => {
  it('answers other features by the same rules: serial, port, only one of its model, or GUID', () => {
    const wheel = device({});
    const mfd = { vendorId: '4098', productId: 'BEE0', name: 'WINWING MFD1' };
    const left = device({ ...mfd, instanceId: 'USB\\VID_4098&PID_BEE0\\7&1&0&1' });
    const right = device({ ...mfd, instanceId: 'USB\\VID_4098&PID_BEE0\\7&1&0&2' });
    const screen = device({
      vendorId: '17E9',
      productId: 'FF00',
      serial: 'S1',
      instanceId: 'USB\\VID_17E9&PID_FF00\\S1',
    });
    const present = [wheel, left, right, screen];
    let data = withName(empty, wheel, present, 'Wheel base');
    data = withName(data, left, present, 'MFD left');
    data = withName(data, right, present, 'MFD right');
    data = withName(data, screen, present, 'Left screen');
    data = withControllerName(
      data,
      { vendorId: '0000', productId: '0000', guid: 'AAAAAAAA-0000-0000-0000-000000000001' },
      'Virtual stick'
    );
    const names = deviceNames(data.names, present);
    // The only one of its model: ids are enough, and so is asking from a game's point of view.
    expect(names.nameOf({ vendorId: '0eb7', productId: '0007' })).toBe('Wheel base');
    expect(
      names.nameOf({ vendorId: '0EB7', productId: '0007', guid: 'BBBBBBBB-0000-0000-0000-1' })
    ).toBe('Wheel base');
    // Identical devices: only the port tells them apart; without it there is no guess.
    expect(names.nameOf({ vendorId: '4098', productId: 'BEE0' })).toBeUndefined();
    expect(
      names.nameOf({ vendorId: '4098', productId: 'BEE0', instanceId: right.instanceId })
    ).toBe('MFD right');
    expect(names.nameOf({ vendorId: '17E9', productId: 'FF00', serial: 'S1' })).toBe('Left screen');
    expect(names.nameOf({ vendorId: '17E9', productId: 'FF00', serial: 'S2' })).toBeUndefined();
    // A controller that is its own identity, in DCS's spelling of the GUID.
    expect(
      names.nameOf({
        vendorId: '0000',
        productId: '0000',
        guid: '{aaaaaaaa-0000-0000-0000-000000000001}',
      })
    ).toBe('Virtual stick');
    // Unplugged: the name stored for exactly that identity is still its name.
    const without = deviceNames(data.names, [left, right]);
    expect(without.nameOf({ vendorId: '0EB7', productId: '0007' })).toBe('Wheel base');
    expect(without.nameOf({ vendorId: '17E9', productId: 'FF00', serial: 'S1' })).toBe(
      'Left screen'
    );
    expect(without.nameOf({ vendorId: '1234', productId: '5678' })).toBeUndefined();
  });

  it('keeps the name of a serial-less device that moved to another port, as long as it is the only one', () => {
    const wheel = device({});
    const named = withName(empty, wheel, [wheel], 'Wheel base');
    expect(named.names).toEqual([
      { vendorId: '0EB7', productId: '0007', instanceId: wheel.instanceId, name: 'Wheel base' },
    ]);
    const moved = device({ instanceId: 'USB\\VID_0EB7&PID_0007\\7&9a60daa&0&3' });
    expect(findName(named.names, moved, [moved])?.name).toBe('Wheel base');
    // With a second identical base present, a name pinned to a port is not handed to the other one.
    const second = device({ instanceId: 'USB\\VID_0EB7&PID_0007\\7&1&0&1' });
    expect(findName(named.names, second, [wheel, second])).toBeUndefined();
    expect(findName(named.names, wheel, [wheel, second])?.name).toBe('Wheel base');
  });

  it('tells identical units apart by serial, and by port when the serial is shared', () => {
    const a = device({
      vendorId: '17E9',
      productId: 'FF00',
      serial: 'S1',
      instanceId: 'USB\\VID_17E9&PID_FF00\\S1',
    });
    const b = device({
      vendorId: '17E9',
      productId: 'FF00',
      serial: 'S2',
      instanceId: 'USB\\VID_17E9&PID_FF00\\S2',
    });
    let data = withName(empty, a, [a, b], 'Left screen');
    data = withName(data, b, [a, b], 'Right screen');
    expect(data.names.map((n) => n.serial)).toEqual(['S1', 'S2']);
    expect(findName(data.names, a, [a, b])?.name).toBe('Left screen');
    expect(findName(data.names, b, [a, b])?.name).toBe('Right screen');
    // Renaming replaces, an empty name removes.
    data = withName(data, a, [a, b], '  Centre screen ');
    expect(findName(data.names, a, [a, b])?.name).toBe('Centre screen');
    data = withName(data, a, [a, b], '');
    expect(findName(data.names, a, [a, b])).toBeUndefined();
    expect(data.names).toHaveLength(1);

    const z1 = device({
      vendorId: '258A',
      productId: '2013',
      serial: '0',
      instanceId: 'USB\\VID_258A&PID_2013\\8&1&0&1',
    });
    const z2 = device({
      vendorId: '258A',
      productId: '2013',
      serial: '0',
      instanceId: 'USB\\VID_258A&PID_2013\\8&1&0&2',
    });
    const shared = withName(empty, z2, [z1, z2], 'Mouse 2');
    expect(shared.names[0]!.serial).toBeUndefined();
    expect(findName(shared.names, z2, [z1, z2])?.name).toBe('Mouse 2');
    expect(findName(shared.names, z1, [z1, z2])).toBeUndefined();
    // A serial entry for another unit is not given to this one even when it is alone.
    const other = device({
      vendorId: '17E9',
      productId: 'FF00',
      serial: 'S9',
      instanceId: 'USB\\VID_17E9&PID_FF00\\S9',
    });
    expect(findName(withName(empty, b, [a, b], 'B').names, other, [other])).toBeUndefined();
  });

  it('names a controller without a USB device by its instance GUID', () => {
    const identity = { vendorId: '0000', productId: '0000', guid: 'ABC' };
    let data = withControllerName(empty, identity, 'vJoy');
    expect(data.names).toEqual([{ ...identity, name: 'vJoy' }]);
    data = withControllerName(data, { ...identity, guid: 'abc' }, '');
    expect(data.names).toEqual([]);
  });
});

describe('device history', () => {
  it('remembers where each device was and when it went away', () => {
    const t1 = new Date('2026-10-02T21:14:00Z');
    const t2 = new Date('2026-10-03T08:00:00Z');
    const pedals = device({
      vendorId: '044F',
      productId: 'B68F',
      instanceId: 'USB\\VID_044F&PID_B68F\\8&348856f8&0&2',
      hubChain: [{ instanceId: 'USB\\HUB\\7&2877fc43&0&2', name: 'Generic USB Hub' }, root],
    });
    const hub = device({ isHub: true, instanceId: 'USB\\HUB\\7&2877fc43&0&2', name: 'USB2.1 Hub' });
    let history = recordSeen(HistorySchema.parse({}), [pedals, hub], t1);
    expect(history.seen).toEqual([
      expect.objectContaining({
        instanceId: pedals.instanceId,
        location: 'Port 2 on USB2.1 Hub',
        path: '2 › 2',
        connected: true,
        lastSeen: t1.toISOString(),
      }),
    ]);
    history = recordSeen(history, [hub], t2);
    const seen = lastSighting(history, { vendorId: '044f', productId: 'b68f' });
    expect(seen).toMatchObject({ connected: false, lastSeen: t2.toISOString() });
    expect(
      lastSighting(history, { vendorId: '044F', productId: 'B68F', serial: 'X' })
    ).toBeUndefined();
    expect(
      lastSighting(history, {
        vendorId: '044F',
        productId: 'B68F',
        instanceId: pedals.instanceId.toLowerCase(),
      })
    ).toBeDefined();
  });

  it('is kept under the data root and a damaged file is started again', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const stores = deviceStores(rig.ports);
    await fs.mkdir(rig.ports.folders.dataRoot(), { recursive: true });
    await fs.writeFile(stores.history.file, '{ not json');
    const listed = await rig.ports.devices.list();
    if (!listed.ok) throw new Error('list');
    const written = await updateHistory(stores, listed.value, rig.clock);
    expect(written.ok && written.value.seen.length).toBe(
      listed.value.filter((d) => !d.isHub).length
    );
    expect(JSON.parse(await fs.readFile(stores.history.file, 'utf8')).seen.length).toBeGreaterThan(
      30
    );
  });
});
