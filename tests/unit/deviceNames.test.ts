/**
 * DEV-003 across features: a name given on the Devices page reaches the Fly checklist,
 * the DCS bindings views and the USB map through `ctx.names`, and never replaces what a
 * device is recognised by.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BINDING_FILES, HORNET } from '../dcsBindings';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(() => app?.cleanup());

interface RigDeviceLite {
  key: string;
  name: string;
  productName: string;
  vendorId: string;
  productId: string;
  controllers: { guid: string }[];
}

describe('device names everywhere', () => {
  it('a name given on the Devices page shows on the Fly checklist, in DCS bindings and on the USB map', async () => {
    app = await wiredApp('devices-rig', { files: BINDING_FILES });
    const overview = await app.invoke<{ devices: RigDeviceLite[] }>('devices:overview');
    const pedals = overview.devices.find((d) => d.productId === 'B68F')!;
    const ufc = overview.devices.find((d) => d.productName.includes('UFC1'))!;
    await app.invoke('devices:rename', { key: pedals.key, name: 'Rudder pedals' });
    await app.invoke('devices:rename', { key: ufc.key, name: 'Up-front controller' });

    // Through core, as any feature asks: by ids, and from a game's point of view by GUID.
    const names = await app.wiring.context.names.devices();
    expect(names.nameOf({ vendorId: '044F', productId: 'B68F' })).toBe('Rudder pedals');
    expect(
      names.nameOf({
        vendorId: ufc.vendorId,
        productId: ufc.productId,
        guid: ufc.controllers[0]!.guid,
      })
    ).toBe('Up-front controller');

    // Fly: the item keeps its title from the setup; the line under it leads with the name.
    const report = await app.invoke<{
      results: { title: string; status: string; summary: string }[];
    }>('fly:check', { profileId: 'dcs-f-a-18c' });
    const row = report.results.find((r) => r.title === 'T-Pendular-Rudder')!;
    expect(row.status).toBe('pass');
    expect(row.summary).toMatch(/^Rudder pedals · Connected · /);

    // DCS bindings: the owner's name beside the name DCS knows the device by; same GUID.
    const view = await app.invoke<{
      devices: { name: string; givenName?: string; guid?: string; connected: boolean }[];
    }>('dcs-bindings:aircraft', { id: HORNET });
    const bound = view.devices.find((d) => d.name.includes('UFC1'))!;
    expect(bound).toMatchObject({ givenName: 'Up-front controller', connected: true });
    expect(bound.name).toBe(ufc.productName);
    expect(bound.guid?.toUpperCase()).toBe(ufc.controllers[0]!.guid.toUpperCase());
    expect(view.devices.find((d) => d.name === 'Keyboard')?.givenName).toBeUndefined();

    // USB map.
    const map = await app.invoke<{ nodes: { name: string; deviceKey?: string }[] }>(
      'devices:usbMap'
    );
    expect(map.nodes.find((n) => n.deviceKey === pedals.key)?.name).toBe('Rudder pedals');

    // Unplugged, the check still fails on the ids and still says whose it is.
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const after = await app.invoke<{
      results: { title: string; status: string; summary: string }[];
    }>('fly:check', { profileId: 'dcs-f-a-18c' });
    const gone = after.results.find((r) => r.title === 'T-Pendular-Rudder')!;
    expect(gone.status).toBe('fail');
    expect(gone.summary).toMatch(/^Rudder pedals · Not connected/);
  });

  it('the racing pages show the name given to the wheel base, beside what it reports', async () => {
    app = await wiredApp('racing-fresh');
    const overview = await app.invoke<{ devices: RigDeviceLite[] }>('devices:overview');
    const base = overview.devices.find((d) => d.vendorId === '0EB7' && d.productId === '0007')!;
    await app.invoke('devices:rename', { key: base.key, name: 'DD2' });
    const wheel = await app.invoke<{
      status: { name?: string; givenName?: string; vendorId?: string; productId?: string };
    }>('racing:wheel');
    expect(wheel.status).toMatchObject({ givenName: 'DD2', vendorId: '0EB7', productId: '0007' });
    expect(wheel.status.name).not.toBe('DD2');
    const iracing = await app.invoke<{
      devices: { name: string; givenName?: string; vendorId?: string }[];
    }>('racing:iracing');
    const fanatec = iracing.devices.filter((d) => d.vendorId === '0EB7');
    expect(fanatec.length).toBeGreaterThan(0);
    expect(fanatec.every((d) => d.givenName === 'DD2' && d.name !== 'DD2')).toBe(true);
    expect(iracing.devices.filter((d) => d.vendorId !== '0EB7').some((d) => d.givenName)).toBe(
      false
    );
  });

  it('without names nothing changes: devices show what the hardware calls itself', async () => {
    app = await wiredApp('devices-rig', { files: BINDING_FILES });
    const names = await app.wiring.context.names.devices();
    expect(names.nameOf({ vendorId: '044F', productId: 'B68F' })).toBeUndefined();
    const view = await app.invoke<{ devices: { givenName?: string }[] }>('dcs-bindings:aircraft', {
      id: HORNET,
    });
    expect(view.devices.every((d) => d.givenName === undefined)).toBe(true);
  });
});
