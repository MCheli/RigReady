import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import type { DeviceInfo } from '../../../shared/models';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  BY_PORT_NOTE,
  deviceCapture,
  deviceConnectedCheck,
  DeviceParamsSchema,
  identityFor,
  matchesDevice,
} from './deviceCheck';
import { deviceStores, updateHistory, withName } from './store';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const device = (overrides: Partial<DeviceInfo>): DeviceInfo => ({
  instanceId: 'USB\\VID_1234&PID_0001\\5&abc&0&1',
  vendorId: '1234',
  productId: '0001',
  name: 'Button Box',
  isHid: true,
  isGameController: true,
  isHub: false,
  hubChain: [],
  ...overrides,
});

describe('device.connected', () => {
  it('passes for a connected device and names the hub it is on', async () => {
    rig = await scenarioRig('flying-all-good');
    const outcome = await deviceConnectedCheck.run(
      { vendorId: '044f', productId: 'b68f' },
      rig.ctx
    );
    expect(outcome.pass).toBe(true);
    expect(outcome.summary).toMatch(/^Connected · /);
  });

  it('fails when the device is unplugged', async () => {
    rig = await scenarioRig('flying-pedals-unplugged');
    expect(
      await deviceConnectedCheck.run({ vendorId: '044F', productId: 'B68F' }, rig.ctx)
    ).toMatchObject({ pass: false, summary: 'Not connected' });
  });

  it('reports a provider failure as a failed check', async () => {
    rig = await scenarioRig('flying-all-good');
    rig.ports.devices.list = async () => err('device.enumerate', 'Could not list USB devices.');
    expect(
      await deviceConnectedCheck.run({ vendorId: '044F', productId: 'B68F' }, rig.ctx)
    ).toEqual({ pass: false, summary: 'Could not list USB devices.' });
  });

  it('matches on ids, then serial, then instance path; never on the name', () => {
    const a = device({ serial: 'A1' });
    expect(matchesDevice(a, { vendorId: '1234', productId: '0001' })).toBe(true);
    expect(matchesDevice(a, { vendorId: '1234', productId: '0002' })).toBe(false);
    expect(matchesDevice(a, { vendorId: '9999', productId: '0001' })).toBe(false);
    expect(matchesDevice(a, { vendorId: '1234', productId: '0001', serial: 'A1' })).toBe(true);
    expect(matchesDevice(a, { vendorId: '1234', productId: '0001', serial: 'B2' })).toBe(false);
    expect(
      matchesDevice(a, {
        vendorId: '1234',
        productId: '0001',
        instanceId: a.instanceId.toLowerCase(),
      })
    ).toBe(true);
    expect(
      matchesDevice(a, { vendorId: '1234', productId: '0001', instanceId: 'USB\\OTHER' })
    ).toBe(false);
  });
});

describe('device capture', () => {
  it('uses the narrowest identity that tells identical devices apart', () => {
    const single = device({});
    expect(identityFor(single, [single])).toEqual({ vendorId: '1234', productId: '0001' });
    const s1 = device({ serial: 'A1', instanceId: 'USB\\VID_1234&PID_0001\\A1' });
    const s2 = device({ serial: 'B2', instanceId: 'USB\\VID_1234&PID_0001\\B2' });
    expect(identityFor(s1, [s1, s2])).toEqual({
      vendorId: '1234',
      productId: '0001',
      serial: 'A1',
    });
    const n1 = device({ instanceId: 'USB\\VID_1234&PID_0001\\5&1' });
    const n2 = device({ instanceId: 'USB\\VID_1234&PID_0001\\5&2' });
    expect(identityFor(n1, [n1, n2])).toEqual({
      vendorId: '1234',
      productId: '0001',
      instanceId: n1.instanceId,
    });
    const dup1 = device({ serial: '0', instanceId: 'USB\\VID_1234&PID_0001\\x1' });
    const dup2 = device({ serial: '0', instanceId: 'USB\\VID_1234&PID_0001\\x2' });
    expect(identityFor(dup1, [dup1, dup2]).instanceId).toBe(dup1.instanceId);
  });

  it('proposes every peripheral on the rig, game controllers pre-selected, hubs left out', async () => {
    rig = await scenarioRig('flying-fresh');
    const result = await deviceCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    const titles = result.value.map((c) => c.title);
    expect(titles).toContain('WINWING MFD1-L');
    expect(titles).toContain('TrackIR 5');
    expect(titles.some((t) => /hub/i.test(t))).toBe(false);
    expect(result.value.find((c) => c.title === 'T-Pendular-Rudder')!.selectedByDefault).toBe(true);
    expect(result.value.find((c) => c.title === 'TrackIR 5')!.selectedByDefault).toBe(false);
    expect(result.value.find((c) => c.title === 'SteelSeries Apex Pro')!.selectedByDefault).toBe(
      false
    );
    expect(
      result.value.find((c) => c.title === 'FANATEC Podium Wheel Base DD2')!.selectedByDefault
    ).toBe(true);
    // The three identical USB display adapters are told apart by serial.
    const adapters = result.value.filter((c) => c.title === 'WINWING USB 3.0 Display1');
    expect(new Set(adapters.map((c) => c.check.params['serial'])).size).toBe(3);
    // Every proposed check passes right now: capture describes the present.
    for (const candidate of result.value) {
      const params = deviceConnectedCheck.params.parse(candidate.check.params);
      expect((await deviceConnectedCheck.run(params, rig.ctx)).pass, candidate.title).toBe(true);
    }
    rig.ports.devices.list = async () => err('device.enumerate', 'nope');
    expect(await deviceCapture.capture(rig.ctx)).toMatchObject({ ok: false });
  });
});

describe('device checks on the recorded rig', () => {
  it('rejects a device check that names a device but gives no vendor and product id', () => {
    expect(DeviceParamsSchema.safeParse({ name: 'TPR pedals' }).success).toBe(false);
    expect(DeviceParamsSchema.safeParse({ vendorId: '044F' }).success).toBe(false);
    expect(DeviceParamsSchema.safeParse({ vendorId: '044F', productId: 'B68F' }).success).toBe(
      true
    );
    expect(DeviceParamsSchema.safeParse({ vendorId: '44F', productId: 'B68F' }).success).toBe(
      false
    );
  });

  it('passes when the required number of matching devices is present', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const trackballs = { vendorId: '047D', productId: '80A6' };
    expect(await deviceConnectedCheck.run({ ...trackballs, count: 2 }, rig.ctx)).toMatchObject({
      pass: true,
      summary: '2 connected',
    });
    expect(await deviceConnectedCheck.run({ ...trackballs, count: 3 }, rig.ctx)).toMatchObject({
      pass: false,
      summary: '2 of 3 connected',
    });
  });

  it('checks identical devices unit by unit: one MFD screen unplugged fails only its own check', async () => {
    rig = await scenarioRig('devices-identical', { files: [] });
    const screen = (serial: string) => ({ vendorId: '17E9', productId: 'FF00', serial });
    const left = await deviceConnectedCheck.run(screen('WWIN29320221210092611'), rig.ctx);
    const centre = await deviceConnectedCheck.run(screen('WWIN29320221210093818'), rig.ctx);
    const right = await deviceConnectedCheck.run(screen('WWIN29320221210163532'), rig.ctx);
    expect([left.pass, centre.pass, right.pass]).toEqual([true, true, false]);
    expect(right.summary).toBe('Not connected');
    expect(right.details![0]).toBe(
      'A different WINWING USB 3.0 Display1 is connected (serial WWIN29320221210092611), not this one.'
    );
  });

  it('says a device identified by USB port is tied to that port, and notices it moved', async () => {
    rig = await scenarioRig('devices-identical', { files: [] });
    const a = {
      vendorId: '047D',
      productId: '80A6',
      instanceId: 'USB\\VID_047D&PID_80A6\\8&66de2c5&0&1',
    };
    const passed = await deviceConnectedCheck.run(a, rig.ctx);
    expect(passed.pass).toBe(true);
    expect(passed.summary).toBe('Connected · Port 1 on USB2.0 Hub');
    expect(passed.details).toEqual([BY_PORT_NOTE]);
    expect(BY_PORT_NOTE).toContain('identified by USB port');
    // Trackball A is gone; B, on the other port, is the same model.
    rig.ports.state.devices = rig.ports.state.devices.filter((d) => d.instanceId !== a.instanceId);
    const failed = await deviceConnectedCheck.run(a, rig.ctx);
    expect(failed.pass).toBe(false);
    expect(failed.details).toContain(
      'A ORBIT WIRELESS TB is connected on another USB port (port 2 on usb2.0 hub).'
    );
    expect(failed.details).toContain(BY_PORT_NOTE);
  });

  it('says when and where a missing device was last plugged in', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    const stores = deviceStores(rig.ports);
    const before = await rig.ports.devices.list();
    if (!before.ok) throw new Error('list');
    await updateHistory(stores, before.value, rig.clock);
    await mutate(rig, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const after = await rig.ports.devices.list();
    if (!after.ok) throw new Error('list');
    await updateHistory(stores, after.value, rig.clock);
    rig.clock.advance(25 * 60 * 60 * 1000);
    const outcome = await deviceConnectedCheck.run(
      { vendorId: '044F', productId: 'B68F' },
      rig.ctx
    );
    expect(outcome.pass).toBe(false);
    expect(outcome.summary).toMatch(
      /^Not connected · last seen (yesterday|today|\d+ \w+) \d\d:\d\d, port 2 on USB2\.1 Hub$/
    );
    expect(outcome.details).toContain(
      'It was last plugged in to port 2 on USB2.1 Hub (USB path 6 › 4 › 2 › 2).'
    );
  });

  it('fails a required device that HidHide hides from the game, and only that one', async () => {
    rig = await scenarioRig('devices-tpr-hidden', {
      files: ['Program Files/Nefarius Software Solutions/**'],
    });
    const tpr = { vendorId: '044F', productId: 'B68F' };
    const hidden = await deviceConnectedCheck.run(tpr, rig.ctx);
    expect(hidden.pass).toBe(false);
    expect(hidden.summary).toBe('Hidden by HidHide');
    expect(hidden.details![0]).toBe(
      'HidHide hides it from every program not on its allow list, and DCS.exe is not on that list.'
    );
    expect(hidden.details).toContain('RigReady does not change HidHide settings.');
    expect(
      (await deviceConnectedCheck.run({ vendorId: '4098', productId: 'BEA8' }, rig.ctx)).pass
    ).toBe(true);

    // The game on the allow list sees hidden devices.
    await mutate(rig, [
      {
        op: 'setHidHide',
        apps: ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\DCSWorld\\bin\\DCS.exe'],
      },
    ]);
    rig.clock.advance(5000);
    expect((await deviceConnectedCheck.run(tpr, rig.ctx)).pass).toBe(true);
    // Cloaking off: nothing is hidden.
    await mutate(rig, [{ op: 'setHidHide', apps: [], cloak: false }]);
    rig.clock.advance(5000);
    expect((await deviceConnectedCheck.run(tpr, rig.ctx)).pass).toBe(true);
    // No HidHide at all: the check adds nothing and does not error.
    await mutate(rig, [{ op: 'setHidHide', installed: false, cloak: true }]);
    rig.clock.advance(5000);
    expect(await deviceConnectedCheck.run(tpr, rig.ctx)).toMatchObject({
      pass: true,
      summary: 'Connected · Port 2 on USB2.1 Hub',
    });
  });

  it('proposes names the user gave as titles when capturing', async () => {
    rig = await scenarioRig('flying-fresh', { files: [] });
    const stores = deviceStores(rig.ports);
    const listed = await rig.ports.devices.list();
    if (!listed.ok) throw new Error('list');
    const pedals = listed.value.find((d) => d.productId === 'B68F')!;
    await stores.data.update((data) => withName(data, pedals, listed.value, 'Rudder pedals'));
    const result = await deviceCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture');
    const candidate = result.value.find((c) => c.title === 'Rudder pedals')!;
    expect(candidate.check.params).toEqual({ vendorId: '044F', productId: 'B68F' });
    const trackball = result.value.find((c) => c.title === 'ORBIT WIRELESS TB')!;
    expect(trackball.description).toBe('047D:80A6 · identified by USB port');
  });
});
