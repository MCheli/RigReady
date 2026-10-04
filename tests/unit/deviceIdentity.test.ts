/**
 * NFR-007: a device is never identified by its display name alone.
 *
 * Two kinds of proof:
 *   - schemas: what a setup, the device-name store and a monitor layout store about a
 *     device or a monitor is refused when only the name is left;
 *   - matching: on a rig where every device, controller and monitor kept its name but
 *     got other ids ("impostors"), nothing that was recognised before is recognised
 *     now, in any check type a feature registers for devices or monitors, in the names
 *     the owner gave, and in the DCS binding files.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { captureCandidates, runCheckItem } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import { NamedLayoutSchema } from '../../src/core/displays/layouts';
import { matchMonitors } from '../../src/core/displays/identity';
import { DeviceParamsSchema, matchesDevice } from '../../src/features/devices/core/deviceCheck';
import { DeviceIdentitySchema } from '../../src/features/devices/core/identity';
import { NameEntrySchema } from '../../src/features/devices/core/store';
import type { DeviceInfo, DisplayInfo } from '../../src/shared/models';
import { BINDING_FILES, HORNET } from '../dcsBindings';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

const NAME_KEY = /name|title|label|description/i;

/**
 * The same value with every identifying string removed: only strings under name-like keys
 * stay, with the numbers and switches (positions, enabled) that identify nothing.
 */
function nameOnly(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return NAME_KEY.test(key) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => nameOnly(item, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const kept = nameOnly(v, k);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  return value;
}

/** Gives every device, controller and monitor other ids and keeps every name. */
function makeImpostors(target: WiredApp): void {
  const { state } = target.ports;
  state.devices.forEach((device: DeviceInfo, index) => {
    const productId = (0xa000 + index).toString(16).toUpperCase();
    device.vendorId = 'F00D';
    device.productId = productId;
    device.instanceId = `USB\\VID_F00D&PID_${productId}\\IMPOSTOR${index}`;
    if (device.serial !== undefined) device.serial = `IMPOSTOR${index}`;
  });
  state.input.forEach((controller, index) => {
    const tail = index.toString(16).padStart(12, '0').toUpperCase();
    controller.guid = `DEADBEEF-0000-0000-0000-${tail}`;
    controller.productGuid = `F00DA000-0000-0000-0000-504944564944`;
    controller.vendorId = 'F00D';
    controller.productId = (0xa000 + index).toString(16).toUpperCase();
  });
  state.displays.forEach((display: DisplayInfo, index) => {
    display.id = `\\\\?\\display#zzz${1000 + index}#9&impostor${index}&0&uid${index}#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}`;
    if (display.serial !== undefined) display.serial = `IMPOSTOR${index}`;
    if (display.usbSerial !== undefined) display.usbSerial = `IMPOSTORUSB${index}`;
    if (display.edid !== undefined) display.edid = `ZZZ${1000 + index}`;
    if (display.usbId !== undefined) display.usbId = `F00D:${1000 + index}`;
  });
  target.ports.devices.emitChanged();
}

// ---- schemas ------------------------------------------------------------------------------

describe('NFR-007 schemas refuse a name as the only identity', () => {
  it('a device check needs vendor and product id; a name, a title or a serial alone is refused', () => {
    expect(DeviceParamsSchema.safeParse({ vendorId: '044F', productId: 'B68F' }).success).toBe(
      true
    );
    for (const params of [
      {},
      { name: 'T-Pendular-Rudder' },
      { title: 'T-Pendular-Rudder', deviceName: 'T-Pendular-Rudder' },
      { serial: 'TPR0012345' },
      { vendorId: '044F' },
      { productId: 'B68F' },
      { vendorId: 'Thrustmaster', productId: 'TPR' },
      { vendorId: '044F', productId: 'B68F', serial: 42 },
    ]) {
      expect(DeviceParamsSchema.safeParse(params).success, JSON.stringify(params)).toBe(false);
    }
  });

  it('the device-name store keeps a name only next to the ids it belongs to', () => {
    expect(
      NameEntrySchema.safeParse({ vendorId: '044F', productId: 'B68F', name: 'Rudder pedals' })
        .success
    ).toBe(true);
    for (const entry of [
      { name: 'Rudder pedals' },
      { name: 'Rudder pedals', productName: 'T-Pendular-Rudder' },
      { name: 'Rudder pedals', serial: 'TPR0012345' },
      { name: 'Rudder pedals', vendorId: '044F' },
    ]) {
      expect(NameEntrySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(false);
      expect(DeviceIdentitySchema.safeParse(entry).success, JSON.stringify(entry)).toBe(false);
    }
  });

  it('a saved monitor layout needs each monitor’s id; a monitor known only by name is refused', () => {
    const SavedLayoutsSchema = NamedLayoutSchema;
    const layout = (displays: unknown[]): unknown => ({
      id: 'flying',
      name: 'Flying',
      createdAt: '2026-10-03T12:00:00.000Z',
      updatedAt: '2026-10-03T12:00:00.000Z',
      displays,
    });
    const monitor = {
      id: '\\\\?\\display#abc1234#5&1&0&uid1#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
      name: 'USB_Monitor',
      enabled: true,
      primary: true,
      x: 0,
      y: 0,
      rotation: 0,
    };
    expect(SavedLayoutsSchema.safeParse(layout([monitor])).success).toBe(true);
    const { id: _id, ...byNameOnly } = monitor;
    expect(SavedLayoutsSchema.safeParse(layout([byNameOnly])).success).toBe(false);
    expect(SavedLayoutsSchema.safeParse(layout([{ ...byNameOnly, id: '' }])).success).toBe(false);
  });

  it('every registered check type for devices and monitors refuses its own parameters once only names are left', async () => {
    const audited: string[] = [];
    const lax: string[] = [];
    for (const scenario of SCENARIOS) {
      app = await wiredApp(scenario, { files: [] });
      const registry = app.wiring.context.checks;
      const captured = await captureCandidates(registry, {
        ports: app.wiring.context.ports,
        log: app.wiring.context.log,
      });
      for (const candidate of captured.candidates) {
        if (candidate.group !== 'devices' && candidate.group !== 'displays') continue;
        const definition = registry.check(candidate.check.type)!;
        const params = candidate.check.params;
        const stripped = nameOnly(params);
        // Nothing identifying in the parameters: the check knows its hardware by ids in code.
        if (JSON.stringify(stripped) === JSON.stringify(params)) continue;
        audited.push(candidate.check.type);
        expect(definition.params.safeParse(params).success).toBe(true);
        if (definition.params.safeParse(stripped).success) {
          // Accepted, so it must be because every identifying field is optional and the
          // check then means "any such device", which the impostor test below settles.
          lax.push(candidate.check.type);
        }
      }
      await app.cleanup();
      app = undefined;
    }
    expect(new Set(audited).size).toBeGreaterThanOrEqual(2);
    expect([...new Set(lax)].sort()).toEqual(LAX_BY_DESIGN);
  });
});

/** Rigs that between them have every kind of hardware a feature registers a check for. */
const SCENARIOS = [
  'flying-all-good',
  'mark-racing-tv',
  'devices-identical',
  'stream-deck-owner',
  'dcs-setup-flying',
];

/**
 * Check types whose identifying parameters are all optional: without them the check is
 * about "a device of this make" (vendor and product ids in code), never about a name.
 */
const LAX_BY_DESIGN: string[] = [];

/**
 * Check types in the monitors group that are not about which monitor is which, each with
 * its reason. They may pass on the impostor rig.
 */
const NOT_ABOUT_IDENTITY: Record<string, string> = {
  'dcs.monitorSetup':
    'compares the pixel rectangles DCS draws into with the desktop as it is; it names no monitor, and impostors at the same places leave the desktop the same',
};

// ---- matching -----------------------------------------------------------------------------

describe('NFR-007 a rig of impostors: every name the same, every id different', () => {
  it('no device or monitor check that passed before passes now, in any feature', async () => {
    const exercised = new Set<string>();
    const fooled: string[] = [];
    let registered: string[] = [];
    for (const scenario of SCENARIOS) {
      app = await wiredApp(scenario);
      const registry = app.wiring.context.checks;
      const ctx = { ports: app.wiring.context.ports, log: app.wiring.context.log };
      registered = registry
        .checkTypes()
        .filter((type) => ['devices', 'displays'].includes(registry.check(type)!.group));
      const captured = await captureCandidates(registry, ctx);
      // What the capture screen offers on this rig, and what the scenario's own setups check.
      const setups = await app.wiring.context.profiles.list();
      const items = [
        ...captured.candidates
          .filter((c: CaptureCandidate) => c.group === 'devices' || c.group === 'displays')
          .map((c, index) => ({ ...c.check, id: `i${index}` })),
        ...(setups.ok ? setups.value : []).flatMap((profile) =>
          profile.checks.filter((item) => registered.includes(item.type))
        ),
      ];
      const passing = [];
      for (const item of items) {
        const result = await runCheckItem(item, registry, ctx);
        if (result.status === 'pass') passing.push(item);
      }
      expect(passing.length, scenario).toBeGreaterThan(0);
      const names = app.ports.state.devices.map((d) => d.name).join('|');

      makeImpostors(app);

      // The names really are all still there.
      expect(app.ports.state.devices.map((d) => d.name).join('|')).toBe(names);
      for (const item of passing) {
        exercised.add(item.type);
        const result = await runCheckItem(item, registry, ctx);
        if (item.type in NOT_ABOUT_IDENTITY) continue;
        if (result.status === 'pass') fooled.push(`${scenario}: ${item.type} "${item.title}"`);
      }
      await app.cleanup();
      app = undefined;
    }
    expect(fooled).toEqual([]);
    // Every check type a feature registers for devices or monitors was put to the test. A
    // new one that no rig above offers needs its scenario added to SCENARIOS.
    expect(registered.filter((type) => !exercised.has(type))).toEqual([]);
    console.log(
      `  NFR-007: impostor rig, check types audited: ${[...exercised].sort().join(', ')}`
    );
  });

  it('a name the owner gave stays with the ids it was given to, not with the product name', async () => {
    app = await wiredApp('devices-rig', { files: [] });
    interface Lite {
      key: string;
      name: string;
      productName: string;
      vendorId: string;
      productId: string;
      givenName?: string;
    }
    const before = await app.invoke<{ devices: Lite[] }>('devices:overview');
    const pedals = before.devices.find((d) => d.productId === 'B68F')!;
    await app.invoke('devices:rename', { key: pedals.key, name: 'Rudder pedals' });
    const names = await app.wiring.context.names.devices();
    expect(names.nameOf({ vendorId: '044F', productId: 'B68F' })).toBe('Rudder pedals');

    makeImpostors(app);

    const after = await app.invoke<{ devices: Lite[] }>('devices:overview');
    const impostor = after.devices.find((d) => d.productName === pedals.productName);
    // Still called T-Pendular-Rudder by Windows, but it is another device: no given name.
    expect(impostor).toBeDefined();
    expect(impostor!.vendorId).toBe('F00D');
    expect(JSON.stringify(impostor)).not.toContain('Rudder pedals');
    const again = await app.wiring.context.names.devices();
    expect(again.nameOf({ vendorId: impostor!.vendorId, productId: impostor!.productId })).toBe(
      undefined
    );
    // The real one keeps its name for when it comes back.
    expect(again.nameOf({ vendorId: '044F', productId: 'B68F' })).toBe('Rudder pedals');
  });

  it('DCS binding files are not attached to a controller that only has the same name', async () => {
    app = await wiredApp('devices-rig', { files: BINDING_FILES });
    const reader = app.wiring.context.bindings.get('dcs')!;
    const before = await reader.bindings(HORNET);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const connected = before.value.devices.filter(
      (d) => d.kind === 'controller' && d.connected && d.guid
    );
    expect(connected.length).toBeGreaterThan(5);

    makeImpostors(app);

    const after = await reader.bindings(HORNET);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    // Controllers with binding files of their own: the file names carry the old ids.
    const withFiles = connected.filter((d) => d.bindings.some((b) => b.source === 'user'));
    expect(withFiles.length).toBeGreaterThan(5);
    for (const device of withFiles) {
      const same = after.value.devices.find((d) => d.guid === device.guid);
      // Its file is still listed, for a controller that is not there any more.
      expect(same, device.name).toBeDefined();
      expect(same!.connected, device.name).toBe(false);
      // The impostor with its name is listed too, as another device, without those bindings.
      const impostor = after.value.devices.find(
        (d) => d.name === device.name && d.guid !== device.guid
      );
      if (impostor) {
        expect(impostor.guid).toMatch(/^DEADBEEF/);
        expect(impostor.bindings.some((b) => b.source === 'user')).toBe(false);
      }
    }
    // Whatever is connected now is an impostor: nothing kept its old id.
    for (const device of after.value.devices) {
      if (device.kind === 'controller' && device.connected) {
        expect(device.guid).toMatch(/^DEADBEEF/);
      }
    }
  });
});

describe('NFR-007 identical devices are told apart by serial or instance', () => {
  it('two devices with one name and one vendor/product id: a check with a serial follows that one device', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const pedals = app.ports.state.devices.find((d) => d.productId === 'B68F')!;
    const twin: DeviceInfo = {
      ...structuredClone(pedals),
      instanceId: 'USB\\VID_044F&PID_B68F\\TWIN0002',
      serial: 'TWIN0002',
    };
    const first: DeviceInfo = { ...structuredClone(pedals), serial: 'FIRST0001' };
    app.ports.state.devices = app.ports.state.devices.filter((d) => d !== pedals);
    app.ports.state.devices.push(first, twin);

    const bySerial = { vendorId: '044F', productId: 'B68F', serial: 'FIRST0001' };
    expect(matchesDevice(first, bySerial)).toBe(true);
    expect(matchesDevice(twin, bySerial)).toBe(false);
    expect(first.name).toBe(twin.name);

    const registry = app.wiring.context.checks;
    const ctx = { ports: app.wiring.context.ports, log: app.wiring.context.log };
    const item = {
      id: 'pedals',
      type: 'device.connected',
      title: 'Pedals',
      required: true,
      params: bySerial,
    };
    expect((await runCheckItem(item, registry, ctx)).status).toBe('pass');
    // The one with that serial goes; its twin with the same name and ids stays.
    await mutate(app, [{ op: 'unplugDevice', match: { serial: 'FIRST0001' } }]);
    expect(app.ports.state.devices.some((d) => d.serial === 'TWIN0002')).toBe(true);
    expect((await runCheckItem(item, registry, ctx)).status).toBe('fail');
    // Without a serial the check is about the model, and the twin satisfies it.
    const anyOfModel = { ...item, params: { vendorId: '044F', productId: 'B68F' } };
    expect((await runCheckItem(anyOfModel, registry, ctx)).status).toBe('pass');
  });

  it('a device with the same name but another vendor or product id never satisfies a check', () => {
    const device: DeviceInfo = {
      instanceId: 'USB\\VID_044F&PID_B68F\\X',
      vendorId: '044F',
      productId: 'B68F',
      name: 'T-Pendular-Rudder',
      isHid: true,
      isGameController: true,
      isHub: false,
      hubChain: [],
    };
    expect(matchesDevice(device, { vendorId: '044F', productId: 'B68F' })).toBe(true);
    expect(
      matchesDevice({ ...device, vendorId: '044E' }, { vendorId: '044F', productId: 'B68F' })
    ).toBe(false);
    expect(
      matchesDevice({ ...device, productId: 'B68E' }, { vendorId: '044F', productId: 'B68F' })
    ).toBe(false);
  });

  it('monitors: three screens with one name are matched by USB serial, and a same-named screen of another model is no match', () => {
    const screen = (index: number, usbSerial: string): DisplayInfo => ({
      id: `\\\\?\\display#reg0319#a&${index}&0&uid256#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}`,
      name: 'USB_Monitor',
      serial: '1',
      usbSerial,
      enabled: true,
      primary: false,
      x: index * 768,
      y: 0,
      width: 768,
      height: 1024,
      rotation: 90,
    });
    const stored = [screen(1, 'AAA'), screen(2, 'BBB'), screen(3, 'CCC')];
    // Plugged into other ports, in another order: ids differ, USB serials decide.
    const now = [
      { ...screen(7, 'CCC'), x: 0 },
      { ...screen(8, 'AAA'), x: 0 },
      { ...screen(9, 'BBB'), x: 0 },
    ];
    const matches = matchMonitors(stored, now);
    expect(matches.map((m) => m.actual?.usbSerial)).toEqual(['AAA', 'BBB', 'CCC']);
    // Same name, another model and no serial in common: not the stored screen.
    const impostor: DisplayInfo = {
      ...screen(1, 'ZZZ'),
      id: '\\\\?\\display#xyz9999#5&1&0&uid1#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
      serial: '777',
    };
    expect(matchMonitors([stored[0]!], [impostor])[0]!.actual).toBeUndefined();
  });
});
