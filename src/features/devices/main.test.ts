import { afterEach, describe, expect, it, vi } from 'vitest';
import { nullLogger } from '../../core/logger';
import { discoverFeatures, wireFeatures } from '../../main/bootstrap';
import type { InputState } from '../../shared/models';
import { mutate, wiredApp, type WiredApp } from '../../../tests/helpers';
import type { HealthReport } from './core/health';
import type { Overview, UsbMap } from './core/model';

let app: WiredApp | undefined;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
  app = undefined;
});

const HIDHIDE = ['Program Files/Nefarius Software Solutions/**'];

function state(
  index: number,
  buttons: number,
  pressed: number[] = [],
  axes: number[] = []
): InputState {
  return {
    index,
    name: `controller ${index}`,
    axes,
    buttons: Array.from({ length: buttons }, (_, i) => pressed.includes(i + 1)),
    hats: [],
    timestamp: 0,
  };
}

describe('devices: the overview', () => {
  it('lists game controllers apart from everything else, with identity, place, DirectInput GUID and setups', async () => {
    app = await wiredApp('devices-rig', { files: HIDHIDE });
    const overview = await app.invoke<Overview>('devices:overview');
    const controllers = overview.devices.filter((d) => d.kind === 'controller');
    expect(controllers.map((d) => d.productName).sort()).toEqual(
      [
        'FANATEC Podium Wheel Base DD2',
        'R-VPC Panel #1',
        'T-Pendular-Rudder',
        'WINWING F18 STARTUP PANEL',
        'WINWING F18 TAKEOFF PANEL 2',
        'WINWING ICP',
        'WINWING MFD1-C',
        'WINWING MFD1-L',
        'WINWING MFD1-R',
        'WINWING Orion Joystick Base 2 + JGRIP-F16',
        'WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R',
        'WINWING UFC1 + HUD1',
      ].sort()
    );
    const others = overview.devices.filter((d) => d.kind === 'other').map((d) => d.name);
    expect(others).toContain('TrackIR 5');
    expect(others).toContain('Stream Deck XL');
    expect(others).toContain('Keychron K2 Pro');
    expect(overview.devices.some((d) => /hub/i.test(d.name))).toBe(false);

    const mfd = overview.devices.find((d) => d.productName === 'WINWING MFD1-R')!;
    expect(mfd).toMatchObject({
      vendorId: '4098',
      productId: 'BEE2',
      serial: '80E62062A4E6D221B2465002',
      instanceId: 'USB\\VID_4098&PID_BEE2\\80E62062A4E6D221B2465002',
      identifiedBy: 'ids',
      requiredBy: ['DCS F/A-18C'],
      hidden: false,
      controllers: [expect.objectContaining({ guid: '806E0610-B756-11F0-8024-444553540000' })],
    });
    const pedals = overview.devices.find((d) => d.productName === 'T-Pendular-Rudder')!;
    expect(pedals.serial).toBeUndefined();
    expect(pedals.location).toMatchObject({ text: 'Port 2 on USB2.1 Hub', depth: 3 });
    expect(overview.hidHide).toMatchObject({ state: 'ok', cloak: false, hiddenCount: 0 });
    expect(overview).toMatchObject({ notifications: 'controllers', activeProfile: 'DCS F/A-18C' });
    expect(overview.missing).toEqual([]);
    expect(overview.inputError).toBeUndefined();
  });

  it('shows the DD2 as one device with two game controllers, not as a duplicate', async () => {
    app = await wiredApp('racing-fresh', { files: [] });
    const dd2 = app.ports.state.input.find((d) => d.productId === '0007')!;
    app.ports.state.input.push({
      ...dd2,
      index: app.ports.state.input.length,
      guid: '20B0BED0-03A4-11F1-8002-444553540000',
      numButtons: 63,
      numAxes: 0,
      numHats: 0,
      axisNames: [],
    });
    const overview = await app.invoke<Overview>('devices:overview');
    const wheels = overview.devices.filter(
      (d) => d.productName === 'FANATEC Podium Wheel Base DD2'
    );
    expect(wheels).toHaveLength(1);
    expect(wheels[0]).toMatchObject({ twins: 1, controllersShared: false, identifiedBy: 'ids' });
    expect(wheels[0]!.controllers.map((c) => c.guid)).toEqual([
      '20B0BED0-03A4-11F1-8001-444553540000',
      '20B0BED0-03A4-11F1-8002-444553540000',
    ]);
  });

  it('lists controllers DirectInput sees without a USB device, and devices a setup needs that are missing', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    app.ports.state.input.push({
      index: 12,
      name: 'vJoy Device',
      guid: 'AAAA0000-0000-0000-0000-444553540000',
      productGuid: '',
      vendorId: '',
      productId: '',
      numAxes: 8,
      numButtons: 32,
      numHats: 0,
      axisNames: [],
    });
    await app.invoke('devices:overview');
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    await vi.waitFor(async () => {
      const overview = await app!.invoke<Overview>('devices:overview');
      expect(overview.missing).toEqual([
        expect.objectContaining({
          title: 'T-Pendular-Rudder',
          profiles: ['DCS F/A-18C'],
          lastSeen: 'just now',
          lastLocation: 'Port 2 on USB2.1 Hub',
          lastPath: '6 › 4 › 2 › 2',
          otherUnit: false,
        }),
      ]);
    });
    const overview = await app.invoke<Overview>('devices:overview');
    expect(overview.devices.find((d) => d.key.startsWith('guid:'))).toMatchObject({
      name: 'vJoy Device',
      kind: 'controller',
      identifiedBy: 'guid',
    });
    await app.invoke('devices:rename', {
      key: 'guid:AAAA0000-0000-0000-0000-444553540000',
      name: 'Virtual stick',
    });
    const renamed = await app.invoke<Overview>('devices:overview');
    expect(renamed.devices.find((d) => d.key.startsWith('guid:'))!.name).toBe('Virtual stick');
  });
});

describe('devices: names', () => {
  it('names identical MFD screens one by one, and the names survive a restart', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    const first = await app.invoke<Overview>('devices:overview');
    const screens = first.devices.filter((d) => d.productName === 'WINWING USB 3.0 Display1');
    expect(screens).toHaveLength(3);
    for (const [i, screen] of screens.entries()) {
      expect(
        await app.invoke('devices:rename', { key: screen.key, name: `Screen ${i + 1}` })
      ).toEqual({
        name: `Screen ${i + 1}`,
      });
    }
    // A restart: the features are wired again on the same machine and data folder.
    const again = wireFeatures({
      features: discoverFeatures(),
      ports: app.ports,
      log: nullLogger,
      send: () => {},
    });
    const envelope = await again.handlers.get('devices:overview')!(undefined);
    if (!envelope.ok) throw new Error('overview');
    const after = (envelope.value as Overview).devices.filter(
      (d) => d.productName === 'WINWING USB 3.0 Display1'
    );
    expect(after.map((d) => [d.serial, d.name])).toEqual(
      screens.map((d, i) => [d.serial, `Screen ${i + 1}`])
    );
    for (const feature of again.features) await feature.dispose?.();

    // The name is the check title a new capture proposes.
    expect(await app.invoke('devices:rename', { key: screens[0]!.key, name: '' })).toEqual({
      name: null,
    });
    await expect(app.invoke('devices:rename', { key: 'USB\\GONE', name: 'x' })).rejects.toThrow(
      /no longer connected/
    );
    await expect(app.invoke('devices:rename', { key: 'guid:GONE', name: 'x' })).rejects.toThrow(
      /no longer connected/
    );
  });
});

describe('devices: live input, health check, switches', () => {
  it('sends live input to the window only while it is watched, keeping every button change', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    expect(await app.invoke('devices:inputDevices')).toHaveLength(12);
    expect(await app.invoke('devices:watchInput', { client: 'a', on: true })).toEqual({
      watching: true,
    });
    app.ports.input.emit([state(10, 62)]);
    app.ports.input.emit([state(10, 62, [12])]);
    app.ports.input.emit([state(10, 62, [])]);
    app.ports.input.emit([state(10, 62, [], [0.1]), state(9, 42)]);
    app.ports.input.emit([state(10, 62, [], [0.2])]);
    await vi.waitFor(() =>
      expect(app!.events.some((e) => e.channel === 'devices:event:input')).toBe(true)
    );
    const sent = app.events
      .filter((e) => e.channel === 'devices:event:input')
      .flatMap((e) => (e.payload as { states: InputState[] }).states);
    // The press and the release both arrive; axis-only updates are merged.
    expect(
      sent.map((s) => `${s.index}:${s.buttons.filter(Boolean).length}:${s.axes[0] ?? '-'}`)
    ).toEqual(['10:0:-', '10:1:-', '10:0:0.2', '9:0:-']);
    expect(await app.invoke('devices:watchInput', { client: 'a', on: false })).toEqual({
      watching: false,
    });
    const before = app.events.length;
    app.ports.input.emit([state(10, 62, [1])]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.events.length).toBe(before);
  });

  it('runs the hands-off check on live input and remembers switches marked as normally on', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    app.ports.input.emit([state(3, 57, [3]), state(10, 62, [], [0, 0, 0])]);
    const scan = app.invoke<HealthReport>('devices:healthScan', { seconds: 0.3 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    app.ports.input.emit([state(10, 62, [], [0, 0, 0.05])]);
    const report = await scan;
    expect(report.devicesChecked).toBe(12);
    expect(report.findings.map((f) => `${f.kind} ${f.device} ${f.input}`)).toEqual([
      'noisy WINWING THROTTLE BASE1 + F15EX HANDLE L + F15EX HANDLE R Z axis',
      'switch WINWING F18 STARTUP PANEL Button 3',
    ]);
    const held = report.findings.find((f) => f.kind === 'switch')!;
    expect(
      await app.invoke('devices:markSwitch', { inputKey: held.inputKey, button: 2, expected: true })
    ).toEqual({ switches: 1 });
    const again = await app.invoke<HealthReport>('devices:healthScan', { seconds: 0.1 });
    expect(again.findings.map((f) => f.kind)).toEqual(['expected']);
    expect(
      await app.invoke('devices:markSwitch', {
        inputKey: held.inputKey,
        button: 2,
        expected: false,
      })
    ).toEqual({ switches: 0 });
  });

  it('copies the findings as text, with what was recorded and without the name of this PC', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    app.ports.input.emit([state(3, 57, [3]), state(10, 62, [], [0, 0, 0])]);
    const scan = app.invoke<HealthReport>('devices:healthScan', { seconds: 0.3 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    app.ports.input.emit([state(10, 62, [], [0, 0, 0.05])]);
    const report = await scan;
    const noisy = report.findings.find((f) => f.kind === 'noisy')!;
    expect(noisy.evidence).toMatchObject({ kind: 'axis', low: 50, high: 52.5, rest: 50 });
    expect(noisy.measure).toBe('2.5%');

    // A device the owner named after the PC and after themselves.
    const machine = app.ports.folders.machineName();
    const named = {
      ...report,
      findings: report.findings.map((f) =>
        f.kind === 'noisy' ? { ...f, device: `Throttle on ${machine}` } : f
      ),
    };
    const copied = await app.invoke<{ characters: number }>('devices:copyHealth', {
      report: named,
    });
    expect(app.ports.clipboard.copied).toHaveLength(1);
    const text = app.ports.clipboard.copied[0]!;
    expect(copied.characters).toBe(text.length);
    expect(text).toContain('RigReady health check');
    expect(text).toContain('2 things need a look.');
    expect(text).toContain('NOISY AXIS\nThrottle on my-pc · Z axis');
    expect(text).toContain('It stayed between 50% and 52.5% of its travel');
    expect(text).toContain('WINWING F18 STARTUP PANEL · Button 3');
    expect(text).not.toContain(machine);
  });

  it('says so when the clipboard cannot be written, and copies nothing', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    app.ports.clipboard.writeText = async () =>
      ({
        ok: false,
        error: { code: 'clipboard.write', message: 'Could not copy to the clipboard.' },
      }) as const;
    await expect(
      app.invoke('devices:copyHealth', {
        report: { seconds: 10, devicesChecked: 12, findings: [] },
      })
    ).rejects.toThrow(/Could not copy/);
  });
});

describe('devices: tray notifications', () => {
  it(
    'tells about a device unplugged while the window is hidden, within 2 s, as the user chose',
    { timeout: 20_000 },
    async () => {
      app = await wiredApp('devices-rig', { files: [] });
      await app.invoke('devices:overview');
      const sent = app.ports.notifications.sent;
      // With the window on screen nothing is shown: the screens update themselves.
      await mutate(app, [{ op: 'unplugDevice', match: { productId: 'BEE2' } }]);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(sent).toEqual([]);

      await app.invoke('devices:windowVisible', { visible: false });
      const unplugged = Date.now();
      await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
      await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 2000 });
      expect(Date.now() - unplugged).toBeLessThan(2000);
      expect(sent[0]).toEqual({
        title: 'T-Pendular-Rudder disconnected',
        body: 'It was unplugged or lost power.',
      });

      // A keyboard is not a game controller: only told when the user asks for every device.
      await mutate(app, [{ op: 'unplugDevice', match: { name: 'Keychron K2' } }]);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(sent).toHaveLength(1);
      expect(await app.invoke('devices:setNotifications', { mode: 'all' })).toEqual({
        mode: 'all',
      });
      await mutate(app, [{ op: 'unplugDevice', match: { name: 'Keychron K3' } }]);
      await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 2000 });
      expect(sent[1]!.title).toBe('Keychron K3 disconnected');

      await app.invoke('devices:setNotifications', { mode: 'required' });
      await mutate(app, [{ op: 'unplugDevice', match: { name: 'SteelSeries' } }]);
      await mutate(app, [{ op: 'unplugDevice', match: { productId: 'BEA8' } }]);
      await vi.waitFor(() => expect(sent).toHaveLength(3), { timeout: 2000 });
      expect(sent[2]!.title).toBe('WINWING Orion Joystick Base 2 + JGRIP-F16 disconnected');

      await app.invoke('devices:setNotifications', { mode: 'off' });
      await mutate(app, [{ op: 'unplugDevice', match: { productId: 'BD26' } }]);
      await new Promise((resolve) => setTimeout(resolve, 1300));
      expect(sent).toHaveLength(3);
      expect((await app.invoke<Overview>('devices:overview')).notifications).toBe('off');
    }
  );
});

describe('devices: USB map', () => {
  it('places every device of the recorded rig on its hub, with depth and what could be unplugged', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    await app.invoke('fly:check', { profileId: 'dcs-f-a-18c' });
    const map = await app.invoke<UsbMap>('devices:usbMap');
    expect(map.activeProfile).toBe('DCS F/A-18C');
    expect(map.controllers).toEqual([
      expect.objectContaining({
        name: 'USB Root Hub (USB 3.0)',
        devices: 31,
        hubs: 31,
        addresses: 62,
        status: 'ok',
        deepest: 3,
      }),
    ]);
    const pedals = map.nodes.find((n) => n.name === 'T-Pendular-Rudder')!;
    expect(pedals).toMatchObject({ kind: 'device', port: 2, depth: 3, required: true });
    const parent = map.nodes.find((n) => n.id === pedals.parentId)!;
    expect(parent).toMatchObject({ kind: 'hub', name: 'USB2.1 Hub', port: 2 });
    const spare = map.controllers[0]!.spare.map((s) => s.name);
    expect(spare).toContain('Keychron K2 Pro');
    expect(spare).not.toContain('T-Pendular-Rudder');
    expect(map.nodes.filter((n) => n.kind === 'device')).toHaveLength(31);
  });
});
