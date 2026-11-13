import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeviceInfo } from '../../../shared/models';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  DevicesDataSchema,
  deviceNames,
  deviceStores,
  findEntry,
  findName,
  HistorySchema,
  lastSighting,
  recordSeen,
  saidOf,
  updateHistory,
  withControllerName,
  withControllerWhat,
  withName,
  withWhat,
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

  it('names identical controllers by DirectInput GUID when the controller says which USB device it is, and never guesses otherwise', () => {
    const box = { vendorId: '1234', productId: 'ABCD', name: 'Button Box' };
    const a = device({ ...box, serial: 'A1', instanceId: 'USB\\VID_1234&PID_ABCD\\A1' });
    const b = device({ ...box, serial: 'B2', instanceId: 'USB\\VID_1234&PID_ABCD\\B2' });
    const present = [a, b];
    let data = withName(empty, a, present, 'Left box');
    data = withName(data, b, present, 'Right box');
    const GUID_A = 'AAAAAAAA-0000-0000-0000-000000000001';
    const GUID_B = 'BBBBBBBB-0000-0000-0000-000000000002';
    const query = { vendorId: '1234', productId: 'ABCD' };

    // Windows said which USB device each controller is: the GUID finds the name.
    const linked = deviceNames(data.names, present, [
      { guid: GUID_A, usbInstanceId: a.instanceId.toLowerCase() },
      { guid: GUID_B, usbInstanceId: b.instanceId },
    ]);
    expect(linked.nameOf({ ...query, guid: GUID_A })).toBe('Left box');
    expect(linked.nameOf({ ...query, guid: `{${GUID_B.toLowerCase()}}` })).toBe('Right box');
    // Without a GUID, or with one no controller has, there is still no telling.
    expect(linked.nameOf(query)).toBeUndefined();
    expect(
      linked.nameOf({ ...query, guid: 'CCCCCCCC-0000-0000-0000-000000000003' })
    ).toBeUndefined();
    // Serial and port keep working as before.
    expect(linked.nameOf({ ...query, serial: 'B2' })).toBe('Right box');

    // The controllers do not say which device they are: nothing is guessed.
    const unlinked = deviceNames(data.names, present, [{ guid: GUID_A }, { guid: GUID_B }]);
    expect(unlinked.nameOf({ ...query, guid: GUID_A })).toBeUndefined();
    expect(deviceNames(data.names, present).nameOf({ ...query, guid: GUID_A })).toBeUndefined();
    // A controller pointing at a device that is not there (or of another model) names nothing.
    const stray = deviceNames(data.names, present, [
      { guid: GUID_A, usbInstanceId: 'USB\\VID_1234&PID_ABCD\\GONE' },
    ]);
    expect(stray.nameOf({ ...query, guid: GUID_A })).toBeUndefined();
    // Only one of the twins was named: the other has no name, not its twin's.
    const one = deviceNames(withName(empty, a, present, 'Left box').names, present, [
      { guid: GUID_A, usbInstanceId: a.instanceId },
      { guid: GUID_B, usbInstanceId: b.instanceId },
    ]);
    expect(one.nameOf({ ...query, guid: GUID_A })).toBe('Left box');
    expect(one.nameOf({ ...query, guid: GUID_B })).toBeUndefined();
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

  it('says a model is known when one was seen, named or said what it is; nothing without the history', () => {
    const t1 = new Date('2026-10-02T21:14:00Z');
    const t2 = new Date('2026-11-10T18:30:00Z');
    const pedals = device({
      vendorId: '044F',
      productId: 'B68F',
      name: 'T-Pendular-Rudder',
      instanceId: 'USB\\VID_044F&PID_B68F\\8&348856f8&0&2',
    });
    let history = recordSeen(HistorySchema.parse({}), [pedals], t1);
    history = recordSeen(history, [], t2);
    const named = withName(empty, device({ vendorId: '1209', productId: '0001' }), [], 'Old box');
    const said = withWhat(empty, device({ vendorId: '1209', productId: '0002' }), [], {
      kind: 'pedals',
    });
    const names = deviceNames(named.names, [], [], said.whatItIs, history.seen);
    // Seen: the name it had and when it went away; in any spelling of the ids.
    expect(names.known?.({ vendorId: '044f', productId: 'b68f' })).toEqual({
      name: 'T-Pendular-Rudder',
      lastSeen: t2.toISOString(),
    });
    expect(names.known?.({ vendorId: '1209', productId: '0001' })).toEqual({ name: 'Old box' });
    expect(names.known?.({ vendorId: '1209', productId: '0002' })).toEqual({});
    expect(names.known?.({ vendorId: '1209', productId: '0003' })).toBeUndefined();
    // A history that could not be read gives no answer at all, never "not seen".
    expect(deviceNames(named.names, []).known).toBeUndefined();
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

describe('DEV-017: what the user said a device is', () => {
  const WHEEL = { vendorId: '0EB7', productId: '0007' };
  const MFD = { vendorId: '4098', productId: 'BEE0' };

  it('is kept under the identity a name is kept under, and found by the same rules', () => {
    const wheel = device({});
    const left = device({
      ...MFD,
      name: 'WINWING MFD1',
      instanceId: 'USB\\VID_4098&PID_BEE0\\7&1&0&1',
    });
    const right = device({
      ...MFD,
      name: 'WINWING MFD1',
      instanceId: 'USB\\VID_4098&PID_BEE0\\7&1&0&2',
    });
    const present = [wheel, left, right];
    let data = withWhat(empty, wheel, present, { kind: 'wheel', usedFor: 'racing' });
    data = withWhat(data, right, present, { kind: 'display' });
    expect(data.whatItIs).toEqual([
      { ...WHEEL, instanceId: wheel.instanceId, kind: 'wheel', usedFor: 'racing' },
      { ...MFD, instanceId: right.instanceId, kind: 'display' },
    ]);
    // An answer is not a name: the names are as they were.
    expect(data.names).toEqual([]);

    const names = deviceNames(data.names, present, [], data.whatItIs);
    // The only one of its model: ids are enough, in any case of the letters.
    expect(names.whatIs?.({ vendorId: '0eb7', productId: '0007' })).toEqual({
      kind: 'wheel',
      usedFor: 'racing',
    });
    expect(names.nameOf(WHEEL)).toBeUndefined();
    // Identical devices: only the port tells them apart; without it there is no guess.
    expect(names.whatIs?.(MFD)).toBeUndefined();
    expect(names.whatIs?.({ ...MFD, instanceId: right.instanceId })).toEqual({ kind: 'display' });
    expect(names.whatIs?.({ ...MFD, instanceId: left.instanceId })).toBeUndefined();
    // A DirectInput GUID tells them apart when its controller says which USB device it is.
    const byGuid = deviceNames(
      [],
      present,
      [{ guid: 'CCCCCCCC-0000-0000-0000-000000000002', usbInstanceId: right.instanceId }],
      data.whatItIs
    );
    expect(byGuid.whatIs?.({ ...MFD, guid: '{cccccccc-0000-0000-0000-000000000002}' })).toEqual({
      kind: 'display',
    });
    expect(
      byGuid.whatIs?.({ ...MFD, guid: '{dddddddd-0000-0000-0000-000000000009}' })
    ).toBeUndefined();
    // Unplugged: what was said of exactly that identity still stands.
    const without = deviceNames([], [left, right], [], data.whatItIs);
    expect(without.whatIs?.(WHEEL)).toEqual({ kind: 'wheel', usedFor: 'racing' });
    // Moved to another port, and still the only one of its model.
    const moved = device({ instanceId: 'USB\\VID_0EB7&PID_0007\\7&9a60daa&0&3' });
    expect(saidOf(findEntry(data.whatItIs, moved, [moved]))).toEqual({
      kind: 'wheel',
      usedFor: 'racing',
    });
    // A second identical base: the answer pinned to a port is not handed to the other one.
    const second = device({ instanceId: 'USB\\VID_0EB7&PID_0007\\7&1&0&1' });
    expect(findEntry(data.whatItIs, second, [wheel, second])).toBeUndefined();
    // Nothing said, nothing answered.
    expect(deviceNames([], present).whatIs?.(WHEEL)).toBeUndefined();
    expect(saidOf(undefined)).toBeUndefined();
    expect(saidOf({})).toBeUndefined();
  });

  it('one part can be said without the other; a new answer replaces the old; nothing said removes it', () => {
    const wheel = device({});
    const at = { ...WHEEL, instanceId: wheel.instanceId };
    let data = withWhat(empty, wheel, [wheel], { usedFor: 'both' });
    expect(data.whatItIs).toEqual([{ ...at, usedFor: 'both' }]);
    data = withWhat(data, wheel, [wheel], { kind: 'pedals' });
    expect(data.whatItIs).toEqual([{ ...at, kind: 'pedals' }]);
    data = withWhat(data, wheel, [wheel], {});
    expect(data.whatItIs).toEqual([]);

    // A name and an answer of the same device live side by side: taking one leaves the other.
    let both = withName(empty, wheel, [wheel], 'Wheel base');
    both = withWhat(both, wheel, [wheel], { kind: 'wheel' });
    both = withName(both, wheel, [wheel], '');
    expect(both.names).toEqual([]);
    expect(both.whatItIs).toEqual([{ ...at, kind: 'wheel' }]);
    both = withName(both, wheel, [wheel], 'Wheel base');
    both = withWhat(both, wheel, [wheel], {});
    expect(both.names.map((n) => n.name)).toEqual(['Wheel base']);
    expect(both.whatItIs).toEqual([]);
  });

  it('a controller without a USB device of its own is answered for by its GUID', () => {
    const pad = {
      vendorId: '0000',
      productId: '0000',
      guid: 'AAAAAAAA-0000-0000-0000-000000000001',
    };
    let data = withControllerWhat(empty, pad, { kind: 'stick', usedFor: 'flight' });
    // The same controller, in another spelling of its GUID: one answer, the newer one.
    data = withControllerWhat(data, { ...pad, guid: pad.guid.toLowerCase() }, { kind: 'throttle' });
    expect(data.whatItIs).toEqual([{ ...pad, guid: pad.guid.toLowerCase(), kind: 'throttle' }]);
    const names = deviceNames([], [], [], data.whatItIs);
    expect(names.whatIs?.({ vendorId: '0000', productId: '0000', guid: `{${pad.guid}}` })).toEqual({
      kind: 'throttle',
    });
    expect(names.whatIs?.({ vendorId: '0000', productId: '0000' })).toBeUndefined();
    expect(withControllerWhat(data, pad, {}).whatItIs).toEqual([]);
  });

  it('a file from before has no answers, and an answer outside the lists is not read', () => {
    const before = DevicesDataSchema.parse({ names: [{ ...WHEEL, name: 'Wheel base' }] });
    expect(before.whatItIs).toEqual([]);
    expect(before.names).toHaveLength(1);
    const refused = (entry: Record<string, unknown>): boolean =>
      !DevicesDataSchema.safeParse({ whatItIs: [{ ...WHEEL, ...entry }] }).success;
    expect(refused({ kind: 'spaceship' })).toBe(true);
    expect(refused({ usedFor: 'trucks' })).toBe(true);
    expect(refused({ kind: 'wheel', usedFor: 'both' })).toBe(false);
  });
});
