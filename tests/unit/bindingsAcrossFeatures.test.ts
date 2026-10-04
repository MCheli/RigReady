/**
 * What the devices feature gets from the bindings feature through core (`ctx.bindings`),
 * and the Fly screen's "Diagnose" link: no feature imports another.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BINDING_FILES, HORNET } from '../dcsBindings';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp;
afterEach(() => app?.cleanup());

const MFD_LEFT = '7F3956A0-B756-11F0-801A-444553540000';

interface Bound {
  gameName: string;
  aircraft: { id: string; name: string };
  controllers: {
    guid: string;
    route: string;
    controls: {
      input: string;
      label: string;
      duplicate: boolean;
      actions: { action: string; source: string; modifiers: string[] }[];
    }[];
  }[];
}

describe('bindings across features', () => {
  it('the input tester can ask what a control does in an aircraft, duplicates flagged (DEV-010)', async () => {
    app = await wiredApp('dcs-bindings-conflict', { files: BINDING_FILES });
    expect(app.wiring.context.bindings.get('dcs')?.gameName).toBe('DCS World');
    const sources =
      await app.invoke<
        { game: string; aircraft: { id: string; name: string; hasUserBindings: boolean }[] }[]
      >('devices:bindingSources');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.game).toBe('dcs');
    expect(sources[0]!.aircraft[0]).toEqual({ id: HORNET, name: 'F/A-18C', hasUserBindings: true });

    const bound = await app.invoke<Bound>('devices:boundInputs', {
      game: 'dcs',
      aircraftId: HORNET,
    });
    expect(bound.aircraft.name).toBe('F/A-18C');
    // Every attached controller is there, by the GUID the tester knows it by.
    const attached = await app.invoke<{ guid: string }[]>('devices:inputDevices');
    for (const controller of attached) {
      expect(bound.controllers.some((c) => c.guid === controller.guid)).toBe(true);
    }
    const mfd = bound.controllers.find((c) => c.guid === MFD_LEFT)!;
    expect(mfd.route).toBe(`/configure/dcs-bindings/devices?aircraft=${HORNET}&guid=${MFD_LEFT}`);
    // The knob that is bound to the HUD brightness and, by accident, to pitch.
    const knob = mfd.controls.find((c) => c.input === 'JOY_SLIDER1')!;
    expect(knob.label).toBe('Slider 1');
    expect(knob.actions.map((a) => a.action).sort()).toEqual([
      'HUD Symbology Brightness Control Knob',
      'Pitch',
    ]);
    expect(knob.duplicate).toBe(true);
    const button = mfd.controls.find((c) => c.input === 'JOY_BTN1')!;
    expect(button.actions).toHaveLength(1);
    expect(button.duplicate).toBe(false);

    await expect(
      app.invoke('devices:boundInputs', { game: 'msfs', aircraftId: 'x' })
    ).rejects.toThrow(/devices.noBindings/);
    await expect(
      app.invoke('devices:boundInputs', { game: 'dcs', aircraftId: 'No-Such' })
    ).rejects.toThrow(/dcs.aircraft.unknown/);
  });

  it('a device detail links to its DCS bindings, by DirectInput GUID (DEV-004)', async () => {
    app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
    const overview = await app.invoke<{
      devices: {
        productName: string;
        kind: string;
        controllers: { guid: string }[];
        bindingLinks: { label: string; to: string }[];
      }[];
    }>('devices:overview');
    const mfd = overview.devices.find((d) => d.productName === 'WINWING MFD1-L')!;
    expect(mfd.bindingLinks).toEqual([
      { label: 'DCS bindings', to: `/configure/dcs-bindings/devices?guid=${MFD_LEFT}` },
    ]);
    // Something games do not see as a controller has no bindings to link to.
    const other = overview.devices.find((d) => d.kind === 'other')!;
    expect(other.bindingLinks).toEqual([]);
  });

  it('on the racing rig the tester knows what a paddle does in iRacing, and a device links only to a bindings page that opens on it', async () => {
    app = await wiredApp('mark-racing', {
      files: ['Documents/iRacing/**', 'Program Files (x86)/Steam/steamapps/**'],
    });
    const sources = await app.invoke<{ game: string }[]>('devices:bindingSources');
    expect(sources.map((s) => s.game)).toEqual(['dcs', 'iracing', 'lmu']);

    // iRacing counts buttons from 0 and names axes its own way; the tester finds a binding
    // by the control it is on, as press detection names it.
    const iracing = await app.invoke<Bound>('devices:boundInputs', {
      game: 'iracing',
      aircraftId: 'all',
    });
    expect(iracing.controllers).toHaveLength(1);
    const wheel = iracing.controllers[0]!;
    const does = (bound: Bound['controllers'][number], input: string): string[] =>
      bound.controls.find((c) => c.input === input)?.actions.map((a) => a.action) ?? [];
    expect(wheel.route).toBe('/configure/racing/iracing');
    expect(does(wheel, 'JOY_BTN5')).toEqual(['Shift up']);
    expect(does(wheel, 'JOY_BTN6')).toEqual(['Shift down']);
    expect(does(wheel, 'JOY_X')).toEqual(['Steering']);
    expect(does(wheel, 'JOY_RZ')).toEqual(['Brake']);
    // Le Mans Ultimate's D-pad is the hat.
    const lmu = await app.invoke<Bound>('devices:boundInputs', { game: 'lmu', aircraftId: 'all' });
    expect(does(lmu.controllers[0]!, 'JOY_BTN_POV1_U')).toEqual(['Pit Menu Up']);

    // The wheel's row links to its DCS bindings, which open on the wheel. The racing games'
    // pages are about the game, not one controller: no link to each from every device.
    const overview = await app.invoke<{
      devices: { productName: string; bindingLinks: { label: string; to: string }[] }[];
    }>('devices:overview');
    const base = overview.devices.find((d) => d.productName === 'FANATEC Podium Wheel Base DD2')!;
    expect(base.bindingLinks.map((l) => l.label)).toEqual(['DCS bindings']);
  });

  it('without DCS on the PC there is nothing to link to or to choose', async () => {
    app = await wiredApp('dcs-bindings-no-dcs', { files: [] });
    expect(await app.invoke('devices:bindingSources')).toEqual([]);
    const overview = await app.invoke<{ devices: { bindingLinks: unknown[] }[] }>(
      'devices:overview'
    );
    expect(overview.devices.every((d) => d.bindingLinks.length === 0)).toBe(true);
  });

  it('Diagnose: a checklist item resolves to its device, connected or not, and nothing else does (FLY-009)', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const pedals = await app.invoke<{
      title: string;
      profile: string;
      identity: Record<string, string>;
      keys: string[];
    }>('devices:forCheck', { profileId: 'dcs-f-a-18c', itemId: 'c3' });
    expect(pedals).toMatchObject({
      title: 'T-Pendular-Rudder',
      profile: 'DCS F/A-18C',
      identity: { vendorId: '044F', productId: 'B68F' },
    });
    expect(pedals.keys).toHaveLength(1);
    expect(pedals.keys[0]).toContain('VID_044F&PID_B68F');

    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    const gone = await app.invoke<{ keys: string[] }>('devices:forCheck', {
      profileId: 'dcs-f-a-18c',
      itemId: 'c3',
    });
    expect(gone.keys).toEqual([]);

    // An item that is not a device check, an unknown item, an unknown setup.
    for (const input of [
      { profileId: 'dcs-f-a-18c', itemId: 'c13' },
      { profileId: 'dcs-f-a-18c', itemId: 'nope' },
      { profileId: 'no-such-setup', itemId: 'c3' },
    ]) {
      await expect(app.invoke('devices:forCheck', input)).rejects.toThrow(/devices.noSuchItem/);
    }
    // The route's parameters are validated before anything is looked up.
    await expect(app.invoke('devices:forCheck', { profileId: '', itemId: 'c3' })).rejects.toThrow();
  });
});
