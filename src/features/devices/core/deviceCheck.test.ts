import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import type { DeviceInfo } from '../../../shared/models';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { deviceCapture, deviceConnectedCheck, identityFor, matchesDevice } from './deviceCheck';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const device = (overrides: Partial<DeviceInfo>): DeviceInfo => ({
  instanceId: 'USB\\VID_1234&PID_0001\\5&abc&0&1',
  vendorId: '1234',
  productId: '0001',
  name: 'Button Box',
  isHid: true,
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
    ).toEqual({ pass: false, summary: 'Not connected' });
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

  it('proposes every peripheral on the rig, input devices pre-selected, hubs left out', async () => {
    rig = await scenarioRig('flying-fresh');
    const result = await deviceCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    const titles = result.value.map((c) => c.title);
    expect(titles).toContain('WINWING MFD1-L');
    expect(titles).toContain('TrackIR 5');
    expect(titles.some((t) => /hub/i.test(t))).toBe(false);
    expect(result.value.find((c) => c.title === 'T-Pendular-Rudder')!.selectedByDefault).toBe(true);
    expect(result.value.find((c) => c.title === 'TrackIR 5')!.selectedByDefault).toBe(false);
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
