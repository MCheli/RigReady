import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileSchema } from '../../core/profile/schema';
import type { InputDevice, InputState } from '../../shared/models';
import { BINDING_FILES } from '../../../tests/dcsBindings';
import { wiredApp, type WiredApp } from '../../../tests/helpers';
import type { OverlayState, PressRow } from './contract';

/**
 * The overlay as the app wires it: its channels as the Overlay page and the overlay window
 * call them (input and output checked as in the app), the events they are sent, and what
 * happens when RigReady starts and quits.
 */

const PANEL = 'overlay-recent-presses';

let app: WiredApp | undefined;
afterEach(async () => {
  if (app) {
    for (const feature of app.wiring.features) await feature.dispose?.();
    await app.cleanup();
  }
  app = undefined;
});

async function open(scenario = 'dcs-bindings-hornet'): Promise<WiredApp> {
  app = await wiredApp(scenario, { files: BINDING_FILES });
  return app;
}

function controller(on: WiredApp, name: string): InputDevice {
  const found = on.ports.input.devices().find((d) => d.name.startsWith(name));
  if (!found) throw new Error(`No controller "${name}" on this rig`);
  return found;
}

function held(device: InputDevice, buttons: number[] = []): InputState {
  return {
    index: device.index,
    name: device.name,
    axes: [],
    buttons: Array.from({ length: device.numButtons }, (_, i) => buttons.includes(i + 1)),
    hats: Array.from({ length: device.numHats }, (): [number, number] => [0, 0]),
    timestamp: 0,
  };
}

const sent = <T>(on: WiredApp, event: string): T[] =>
  on.events.filter((e) => e.channel === `overlay:event:${event}`).map((e) => e.payload as T);

describe('the channels of the overlay', () => {
  it('state, set, recent and the two events: off, on over the main screen, a press, off again', async () => {
    const app = await open();
    const before = await app.invoke<OverlayState>('overlay:state', undefined);
    expect(before.on).toBe(false);
    expect(before.widgets.map((w) => [w.id, w.showing])).toEqual([['recent-presses', false]]);
    expect(before.source.aircraft).toMatchObject({ id: 'FA-18C_hornet', how: 'setup' });
    expect(app.ports.overlays.panels.size).toBe(0);

    const on = await app.invoke<OverlayState>('overlay:set', { on: true });
    expect(on.on).toBe(true);
    expect(on.input).toEqual({ ok: true });
    expect(on.widgets[0]).toMatchObject({ showing: true, width: 396, height: 300 });
    expect(app.ports.overlays.panels.get(PANEL)!.panel).toMatchObject({
      route: '/overlay/recent-presses',
      movable: false,
    });
    expect(sent<OverlayState>(app, 'changed').at(-1)).toEqual(on);
    // What a window of the overlay starts from: the same, with nothing read again.
    expect(await app.invoke<OverlayState>('overlay:current', undefined)).toEqual(on);

    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    const told = sent<{ rows: PressRow[] }>(app, 'presses');
    expect(told).toHaveLength(1);
    expect(told[0]!.rows).toHaveLength(1);
    expect(told[0]!.rows[0]).toMatchObject({
      control: 'Button 5',
      count: 1,
      actions: [{ action: 'Gun Trigger - SECOND DETENT (Press to shoot)', modifiers: [] }],
      known: true,
    });
    // A window that opens now starts from the same list.
    const recent = await app.invoke<{ rows: PressRow[] }>('overlay:recent', undefined);
    expect(recent.rows).toEqual(told[0]!.rows);

    const off = await app.invoke<OverlayState>('overlay:set', { on: false });
    expect(off.on).toBe(false);
    expect(app.ports.overlays.panels.size).toBe(0);
    expect((await app.invoke<{ rows: PressRow[] }>('overlay:recent', undefined)).rows).toEqual([]);
  });

  it('options, place, move and aircraft do what the page asks, and refuse what does not fit', async () => {
    const app = await open();
    await app.invoke('overlay:set', { on: true });

    const options = { lifetimeSeconds: 8, rows: 3, size: 'small', showUnbound: false };
    const smaller = await app.invoke<OverlayState>('overlay:options', {
      widget: 'recent-presses',
      options,
    });
    expect(smaller.widgets[0]).toMatchObject({ options, width: 316, height: 154 });
    await expect(
      app.invoke('overlay:options', { widget: 'recent-presses', options: { rows: 40 } })
    ).rejects.toThrow(/overlay\.options/);

    const corner = await app.invoke<OverlayState>('overlay:place', {
      widget: 'recent-presses',
      at: { x: 1, y: 0 },
    });
    expect(corner.widgets[0]!.place.at).toEqual({ x: 1, y: 0 });
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 5120 - 316, y: 0 });
    await expect(
      app.invoke('overlay:place', { widget: 'recent-presses', at: { x: 2, y: 0 } })
    ).rejects.toThrow(/ipc\.input/);
    await expect(
      app.invoke('overlay:place', {
        widget: 'recent-presses',
        screen: 'no-such-screen',
        at: { x: 0, y: 0 },
      })
    ).rejects.toThrow(/overlay\.screen/);

    const moving = await app.invoke<OverlayState>('overlay:move', {
      widget: 'recent-presses',
      moving: true,
    });
    expect(moving.widgets[0]!.moving).toBe(true);
    expect(app.ports.overlays.drag(PANEL, { x: 100, y: 100 })).toBe(true);
    const locked = await app.invoke<OverlayState>('overlay:move', {
      widget: 'recent-presses',
      moving: false,
    });
    expect(locked.widgets[0]).toMatchObject({ moving: false, showing: true });
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 100, y: 100 });
    expect(app.ports.overlays.panels.get(PANEL)!.panel.movable).toBe(false);

    const huey = await app.invoke<OverlayState>('overlay:aircraft', { aircraftId: 'UH-1H' });
    expect(huey.source.aircraft).toMatchObject({ id: 'UH-1H', how: 'chosen' });
    const back = await app.invoke<OverlayState>('overlay:aircraft', { aircraftId: null });
    expect(back.source.aircraft).toMatchObject({ id: 'FA-18C_hornet', how: 'setup' });
    await expect(app.invoke('overlay:aircraft', { aircraftId: 'Su-99' })).rejects.toThrow(
      /overlay\.aircraft/
    );
    await expect(app.invoke('overlay:move', { widget: 'gauges', moving: true })).rejects.toThrow(
      /overlay\.widget/
    );
  });
});

describe('the overlay in each setup, through the channels the setup editor and Setups use', () => {
  it('the switch saved in the setup editor takes it down and up, and the editor is told the default', async () => {
    const app = await open();
    await app.invoke('overlay:set', { on: true });
    expect(app.ports.overlays.panels.size).toBe(1);
    expect(await app.invoke('overlay:setupDefault', { game: 'dcs' })).toEqual({
      startsOn: true,
      overlayOn: true,
    });
    expect(await app.invoke('overlay:setupDefault', { game: 'x-plane-12' })).toEqual({
      startsOn: false,
      why: 'RigReady cannot read the bindings of X-Plane 12, so the overlay cannot say what a press does.',
      overlayOn: true,
    });

    // Saved by the setup editor with the switch off.
    const hornet = await app.invoke<Record<string, unknown>>('profiles:get', {
      id: 'dcs-bindings-hornet',
    });
    await app.invoke('profiles:save', { ...hornet, extensions: { overlay: { on: false } } });
    const down = await app.invoke<OverlayState>('overlay:state', undefined);
    expect(down.offInSetup).toEqual({ id: 'dcs-bindings-hornet', name: 'DCS F/A-18C' });
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(sent<OverlayState>(app, 'changed').at(-1)!.offInSetup).toBeDefined();

    // Another setup made the one in use from Setups: one for a game without bindings, on.
    const made = await app.wiring.context.profiles.save(
      ProfileSchema.parse({
        id: 'xplane',
        name: 'X-Plane',
        game: 'x-plane-12',
        createdAt: '2026-11-13T09:00:00.000Z',
        updatedAt: '2026-11-13T09:00:00.000Z',
        extensions: { overlay: { on: true } },
      })
    );
    if (!made.ok) throw new Error(made.error.message);
    await app.invoke('profiles:use', { id: 'xplane' });
    const up = await app.invoke<OverlayState>('overlay:state', undefined);
    expect(up.offInSetup).toBeUndefined();
    expect(up.source.setup).toEqual({ id: 'xplane', name: 'X-Plane' });
    expect(app.ports.overlays.panels.size).toBe(1);
  });

  it('"The main screen" is chosen with a screen of null', async () => {
    const app = await open();
    await app.invoke('overlay:set', { on: true });
    const before = await app.invoke<OverlayState>('overlay:state', undefined);
    const other = before.screens.find((s) => !s.primary)!;
    const pinned = await app.invoke<OverlayState>('overlay:place', {
      widget: 'recent-presses',
      screen: other.id,
      at: { x: 0, y: 0 },
    });
    expect(pinned.widgets[0]!.place).toMatchObject({ screen: other.id });
    expect(pinned.widgets[0]!.place.main).toBeUndefined();
    const main = await app.invoke<OverlayState>('overlay:place', {
      widget: 'recent-presses',
      screen: null,
      at: { x: 0, y: 0 },
    });
    expect(main.widgets[0]!.place).toMatchObject({ screenName: 'LC49G95T', main: true });
  });
});

describe('when RigReady starts and quits', () => {
  it('nothing is put on the screen by starting RigReady until the overlay was turned on once', async () => {
    const app = await open();
    for (const feature of app.wiring.features) await feature.start?.();
    await app.invoke<OverlayState>('overlay:state', undefined);
    expect(app.ports.overlays.panels.size).toBe(0);
  });

  it('left on, it is over the screen again after a start without the page being opened, and gone on quit', async () => {
    app = await wiredApp('dcs-bindings-hornet', {
      files: BINDING_FILES,
      // As the last run of RigReady left it: the overlay on.
      beforeWiring: async (rig) => {
        const file = path.join(rig.ports.folders.dataRoot(), 'overlay', 'settings.json');
        const written = await rig.ports.files.write(
          file,
          JSON.stringify({ schemaVersion: 1, on: true, widgets: {}, aircraft: {} }),
          { reason: 'The overlay was left on' }
        );
        if (!written.ok) throw new Error(written.error.message);
      },
    });
    expect(app.ports.overlays.panels.size).toBe(0);
    const overlay = app.wiring.features.find((f) => f.id === 'overlay')!;
    await overlay.start?.();
    expect(app.ports.overlays.panels.get(PANEL)!.panel.movable).toBe(false);
    expect(sent<OverlayState>(app, 'changed').at(-1)).toMatchObject({
      on: true,
      input: { ok: true },
    });
    // The presses are listened to from then on.
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(sent<{ rows: PressRow[] }>(app, 'presses')).toHaveLength(1);

    // Quit: the window goes.
    await overlay.dispose?.();
    expect(app.ports.overlays.panels.size).toBe(0);
  });
});
