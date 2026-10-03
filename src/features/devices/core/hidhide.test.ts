import { afterEach, describe, expect, it } from 'vitest';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  canSeeHidden,
  findHidHideCli,
  GAMING_ARGS,
  hiddenDeviceIds,
  hidHideCached,
  onAppList,
  parseGaming,
  parseHidHideState,
  readHidHide,
  STATE_ARGS,
  type HidHideInfo,
} from './hidhide';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

const TPR = 'USB\\VID_044F&PID_B68F\\8&348856F8&0&2';

describe('HidHide', () => {
  it('parses the CLI output in command form, quoted or not', () => {
    expect(
      parseHidHideState(
        '--cloak-on\r\n--inv-off\r\n--dev-hide "HID\\VID_044F&PID_B68F\\8&1"\r\n--dev-hide HID\\X\r\n--app-reg "C:\\Games\\DCS.exe"\r\n'
      )
    ).toEqual({
      cloak: true,
      inverse: false,
      hidden: ['HID\\VID_044F&PID_B68F\\8&1', 'HID\\X'],
      apps: ['C:\\Games\\DCS.exe'],
    });
    expect(parseHidHideState('--cloak-off\n--inv-on')).toMatchObject({
      cloak: false,
      inverse: true,
    });
    expect(
      parseGaming(
        'noise [{"devices":[{"deviceInstancePath":"HID\\\\A","baseContainerDeviceInstancePath":"USB\\\\B"},{"x":1}]},{"y":2}]'
      )
    ).toEqual([{ deviceInstancePath: 'HID\\A', baseContainerDeviceInstancePath: 'USB\\B' }]);
    expect(parseGaming('[{"devices":[{"deviceInstancePath":"HID\\\\A"}]}]')).toEqual([
      { deviceInstancePath: 'HID\\A', baseContainerDeviceInstancePath: '' },
    ]);
    expect(parseGaming('no json')).toEqual([]);
    expect(parseGaming('[ broken')).toEqual([]);
    expect(parseGaming('{"a":[1]}')).toEqual([]);
  });

  it('reads the recorded rig without changing anything: every query ends with --cancel', async () => {
    rig = await scenarioRig('flying-all-good', {
      files: ['Program Files/Nefarius Software Solutions/**'],
    });
    const info = await readHidHide(rig.ports);
    expect(info).toMatchObject({ installed: true, cloak: false, inverse: false, hidden: [] });
    expect(info.installed && info.apps).toHaveLength(3);
    for (const call of rig.ports.shell.calls)
      expect(call.args[call.args.length - 1]).toBe('--cancel');
    expect(rig.ports.shell.calls.map((c) => c.args)).toEqual([STATE_ARGS]);
  });

  it('traces a hidden HID node to its USB device: the pedals, and only the pedals', async () => {
    rig = await scenarioRig('devices-tpr-hidden', {
      files: ['Program Files/Nefarius Software Solutions/**'],
    });
    const info = await readHidHide(rig.ports);
    expect(info).toMatchObject({ installed: true, cloak: true });
    expect(rig.ports.shell.calls.map((c) => c.args)).toEqual([STATE_ARGS, GAMING_ARGS]);
    const devices = await rig.ports.devices.list();
    if (!devices.ok) throw new Error('list');
    expect([...hiddenDeviceIds(info, devices.value)]).toEqual([TPR]);
    expect(canSeeHidden(info, 'C:\\Games\\DCS\\bin\\DCS.exe')).toBe(false);
    expect(canSeeHidden(info, 'C:\\x\\HidHideClient.exe')).toBe(true);
  });

  it('falls back to the VID/PID or the instance suffix when HidHide did not list the device as gaming', () => {
    const base: HidHideInfo = {
      installed: true,
      cli: 'x',
      cloak: true,
      inverse: false,
      hidden: [],
      apps: [],
      gaming: [],
    };
    const dev = (instanceId: string, vendorId = '1234', productId = '0001') => ({
      instanceId,
      vendorId,
      productId,
      name: 'Box',
      isHid: true,
      isGameController: true,
      isHub: false,
      hubChain: [],
    });
    const one = dev('USB\\VID_1234&PID_0001\\5&A&0&1');
    const twin = dev('USB\\VID_1234&PID_0001\\5&A&0&2');
    expect([
      ...hiddenDeviceIds({ ...base, hidden: ['HID\\VID_1234&PID_0001&COL01\\7&Z&0&0'] }, [one]),
    ]).toEqual([one.instanceId.toUpperCase()]);
    expect([
      ...hiddenDeviceIds({ ...base, hidden: ['HID\\VID_1234&PID_0001\\5&A&0&2'] }, [one, twin]),
    ]).toEqual([twin.instanceId.toUpperCase()]);
    expect(
      hiddenDeviceIds({ ...base, hidden: ['HID\\VID_1234&PID_0001\\other'] }, [one, twin]).size
    ).toBe(0);
    expect(hiddenDeviceIds({ ...base, hidden: ['garbage'] }, [one]).size).toBe(0);
    expect(hiddenDeviceIds({ installed: false }, [one]).size).toBe(0);
    expect(hiddenDeviceIds({ ...base, hidden: [one.instanceId] }, [one]).size).toBe(1);
  });

  it('works out who can see hidden devices: cloaking, the allow list, inverse mode', () => {
    const info: HidHideInfo = {
      installed: true,
      cli: 'x',
      cloak: true,
      inverse: false,
      hidden: ['h'],
      apps: ['C:\\Games\\DCS World\\bin\\DCS.exe'],
      gaming: [],
    };
    expect(onAppList(info, 'c:\\games\\dcs world\\bin\\dcs.exe')).toBe(true);
    expect(onAppList(info, 'D:\\Other\\DCS.exe')).toBe(true);
    expect(onAppList({ installed: false }, 'x')).toBe(false);
    expect(canSeeHidden(info, 'D:\\Steam\\DCS.exe')).toBe(true);
    expect(canSeeHidden(info, 'iRacingSim64DX11.exe')).toBe(false);
    expect(canSeeHidden(info, undefined)).toBe(false);
    expect(canSeeHidden({ ...info, cloak: false }, 'x.exe')).toBe(true);
    expect(canSeeHidden({ ...info, inverse: true }, 'DCS.exe')).toBe(false);
    expect(canSeeHidden({ ...info, inverse: true }, 'other.exe')).toBe(true);
    expect(canSeeHidden({ ...info, inverse: true }, undefined)).toBeUndefined();
    expect(canSeeHidden({ installed: false }, 'x.exe')).toBe(true);
  });

  it('says nothing when HidHide is not installed, and reports a CLI that fails', async () => {
    rig = await scenarioRig('flying-all-good', {
      files: ['Program Files/Nefarius Software Solutions/**'],
    });
    await mutate(rig, [{ op: 'setHidHide', installed: false }]);
    expect(await readHidHide(rig.ports)).toEqual({ installed: false });

    await mutate(rig, [{ op: 'setHidHide', installed: true }]);
    rig.ports.shell.scripts.push({
      match: { exe: 'HidHideCLI', args: ['--cloak-state'] },
      result: { code: 5, stdout: '', stderr: 'denied' },
    });
    expect(await readHidHide(rig.ports)).toMatchObject({
      installed: true,
      error: 'HidHideCLI exited with code 5.',
    });
    rig.ports.shell.run = async () => ({
      ok: false,
      error: { code: 'shell.timeout', message: 'Timed out' },
    });
    expect(await readHidHide(rig.ports)).toMatchObject({ installed: true, error: 'Timed out' });
  });

  it('finds the CLI from the uninstall entry, or not at all when the files are missing', async () => {
    rig = await scenarioRig('flying-all-good', { files: [] });
    expect(await findHidHideCli(rig.ports)).toBeUndefined();
    expect(await readHidHide(rig.ports)).toEqual({ installed: false });
    // One check run asks once for all of its devices.
    const first = hidHideCached(rig.ports);
    expect(hidHideCached(rig.ports)).toBe(first);
    rig.clock.advance(5000);
    expect(hidHideCached(rig.ports)).not.toBe(first);
  });
});
