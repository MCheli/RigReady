import { afterEach, describe, expect, it, vi } from 'vitest';
import { nullLogger } from '../../core/logger';
import { discoverFeatures, wireFeatures } from '../../main/bootstrap';
import type { InputDevice, InputState } from '../../shared/models';
import { mutate, wiredApp, type WiredApp } from '../../../tests/helpers';
import type { HealthReport } from './core/health';
import type { Overview, UsbMap } from './core/model';

/** A loaded CI runner can take longer than vi.waitFor's 1 s default to answer. */
const WAIT = { timeout: 10_000 };

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
    }, WAIT);
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
    await vi.waitFor(
      () => expect(app!.events.some((e) => e.channel === 'devices:event:input')).toBe(true),
      WAIT
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

  it('tells the window when a controller came or went, by itself and before any input of the new list', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    const lists = (): { at: number; names: string[] }[] =>
      app!.events.flatMap((e, at) =>
        e.channel === 'devices:event:controllers'
          ? [{ at, names: (e.payload as { devices: InputDevice[] }).devices.map((d) => d.name) }]
          : []
      );
    const inputs = (): { at: number; states: InputState[] }[] =>
      app!.events.flatMap((e, at) =>
        e.channel === 'devices:event:input'
          ? [{ at, states: (e.payload as { states: InputState[] }).states }]
          : []
      );

    // A window that starts to watch gets the list as it is now.
    await app.invoke('devices:watchInput', { client: 'a', on: true });
    expect(lists()).toHaveLength(1);
    expect(lists()[0]!.names).toHaveLength(12);
    expect(lists()[0]!.names.slice(0, 2)).toEqual([
      'FANATEC Podium Wheel Base DD2',
      'R-VPC Panel #1',
    ]);

    // The wheel base is unplugged. Nobody presses anything and nothing else asks: the
    // window is told by itself, and the button box now has the number the base had.
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '0EB7', productId: '0007' } }]);
    await vi.waitFor(() => expect(lists()).toHaveLength(2), WAIT);
    expect(lists()[1]!.names).toHaveLength(11);
    expect(lists()[1]!.names[0]).toBe('R-VPC Panel #1');

    // The button box goes and the base comes back while input of the button box may still
    // wait to be sent: whatever is sent after the new list was read from the new list.
    app.ports.input.emit([state(0, 55, [3])]);
    await mutate(app, [
      { op: 'unplugDevice', match: { vendorId: '3344', productId: 'C259' } },
      { op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } },
      { op: 'unplugDevice', match: { vendorId: '4098' } },
      { op: 'plugDevice', match: { vendorId: '0EB7', productId: '0007' } },
    ]);
    app.ports.input.emit([state(0, 108, [5])]);
    await vi.waitFor(
      () => expect(inputs().some((i) => i.states.some((s) => s.buttons.length === 108))).toBe(true),
      WAIT
    );
    const fromBase = inputs().find((i) => i.states.some((s) => s.buttons.length === 108))!;
    // The list in force when the base's input goes out is the one with the base alone. (The
    // list may have been sent in steps while the devices went one by one.)
    const swapped = lists()
      .filter((l) => l.at < fromBase.at)
      .at(-1)!;
    expect(swapped.names).toEqual(['FANATEC Podium Wheel Base DD2']);
    expect(lists().length).toBeGreaterThanOrEqual(3);
    const after = inputs().filter((i) => i.at > swapped.at);
    expect(after.flatMap((i) => i.states.map((s) => s.buttons.length))).toEqual([108]);
    // The press on the button box went out before the list changed, or not at all.
    const changed = lists()[2]!;
    const fromBox = inputs().filter((i) => i.states.some((s) => s.buttons.length === 55));
    expect(fromBox.every((i) => i.at < changed.at)).toBe(true);

    // Nobody watches: nothing is compared and nothing is sent, whatever comes or goes.
    await app.invoke('devices:watchInput', { client: 'a', on: false });
    const sent = (): number =>
      app!.events.filter((e) => e.channel.startsWith('devices:event:')).length;
    const before = sent();
    await mutate(app, [{ op: 'plugDevice', match: { vendorId: '3344', productId: 'C259' } }]);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(sent()).toBe(before);

    // The next window to watch gets the list as it is by then.
    await app.invoke('devices:watchInput', { client: 'b', on: true });
    expect(lists().at(-1)!.names).toEqual(['FANATEC Podium Wheel Base DD2', 'R-VPC Panel #1']);
    expect(sent()).toBe(before + 1);
    // A reading from before the list changed is not played back to it: the numbers may
    // belong to other controllers by now.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sent()).toBe(before + 1);
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

describe('DEV-017: what is this device?', () => {
  const PEDALS = { vendorId: '044F', productId: 'B68F' };

  it('keeps what the user says a device is beside what RigReady reads, part by part, and it survives a restart', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    const pedals = async (): Promise<Overview['devices'][number]> =>
      (await app!.invoke<Overview>('devices:overview')).devices.find(
        (d) => d.productName === 'T-Pendular-Rudder'
      )!;
    const first = await pedals();
    expect(first.said).toBeUndefined();
    expect(first.reads).toEqual({ kind: 'pedals', usedFor: 'flight' });

    expect(
      await app.invoke('devices:setWhatItIs', { key: first.key, kind: null, usedFor: 'both' })
    ).toEqual({ usedFor: 'both' });
    expect((await pedals()).said).toEqual({ usedFor: 'both' });
    expect(
      await app.invoke('devices:setWhatItIs', { key: first.key, kind: 'shifter', usedFor: 'both' })
    ).toEqual({ kind: 'shifter', usedFor: 'both' });
    // What RigReady reads by itself stays on show: it is what "from its name" goes back to.
    expect(await pedals()).toMatchObject({
      said: { kind: 'shifter', usedFor: 'both' },
      reads: { kind: 'pedals', usedFor: 'flight' },
      name: 'T-Pendular-Rudder',
    });

    // A restart: the features are wired again on the same machine and data folder.
    const again = wireFeatures({
      features: discoverFeatures(),
      ports: app.ports,
      log: nullLogger,
      send: () => {},
    });
    const envelope = await again.handlers.get('devices:overview')!(undefined);
    if (!envelope.ok) throw new Error('overview');
    expect(
      (envelope.value as Overview).devices.find((d) => d.productName === 'T-Pendular-Rudder')!.said
    ).toEqual({ kind: 'shifter', usedFor: 'both' });
    expect((await again.context.names.devices()).whatIs?.(PEDALS)).toEqual({
      kind: 'shifter',
      usedFor: 'both',
    });
    for (const feature of again.features) await feature.dispose?.();

    // Taken back: nothing is said, and other features are told nothing.
    expect(
      await app.invoke('devices:setWhatItIs', { key: first.key, kind: null, usedFor: null })
    ).toEqual({});
    expect((await pedals()).said).toBeUndefined();
    expect((await app.wiring.context.names.devices()).whatIs?.(PEDALS)).toBeUndefined();
  });

  it('answers for a controller without a USB device by its GUID, and refuses what it cannot keep', async () => {
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
    const key = 'guid:AAAA0000-0000-0000-0000-444553540000';
    await app.invoke('devices:overview');
    expect(
      await app.invoke('devices:setWhatItIs', { key, kind: 'stick', usedFor: 'flight' })
    ).toEqual({ kind: 'stick', usedFor: 'flight' });
    const overview = await app.invoke<Overview>('devices:overview');
    expect(overview.devices.find((d) => d.key === key)!.said).toEqual({
      kind: 'stick',
      usedFor: 'flight',
    });
    // As a game spells the GUID.
    expect(
      (await app.wiring.context.names.devices()).whatIs?.({
        vendorId: '0000',
        productId: '0000',
        guid: '{aaaa0000-0000-0000-0000-444553540000}',
      })
    ).toEqual({ kind: 'stick', usedFor: 'flight' });
    expect(await app.invoke('devices:setWhatItIs', { key, kind: null, usedFor: null })).toEqual({});

    // A device or a controller that went away is said so, and nothing is stored for it.
    const stick = { kind: 'stick', usedFor: null };
    await expect(app.invoke('devices:setWhatItIs', { key: 'USB\\GONE', ...stick })).rejects.toThrow(
      /no longer connected/
    );
    await expect(app.invoke('devices:setWhatItIs', { key: 'guid:GONE', ...stick })).rejects.toThrow(
      /no longer connected/
    );
    // Only the kinds and uses of the lists are taken.
    await expect(
      app.invoke('devices:setWhatItIs', { key, kind: 'spaceship', usedFor: null })
    ).rejects.toThrow();
    await expect(
      app.invoke('devices:setWhatItIs', { key, kind: null, usedFor: 'trucks' })
    ).rejects.toThrow();
    const after = await app.invoke<Overview>('devices:overview');
    expect(after.devices.every((d) => d.said === undefined)).toBe(true);
  });
});
