import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutToTargets } from '../../../core/displays/layouts';
import { ProfileSchema, type Profile } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import type { DisplayInfo, InputDevice, InputState } from '../../../shared/models';
import { BINDING_FILES, diffFile } from '../../../../tests/dcsBindings';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { OverlayState, PressRow } from './model';
import { FULL_CHECK_MS, OverlayService, panelId, QUICK_CHECK_MS } from './service';
import { RECENT_PRESSES } from './widgets';

/**
 * The overlay as it runs, on the recorded rig with its fake ports: the window that is put
 * over the game and where, what a press of a real controller of the rig is shown as, and
 * what happens when the screens, the setup or the bindings change while it is up.
 */

const PANEL = panelId(RECENT_PRESSES);
const TRIGGER = 'Gun Trigger - SECOND DETENT (Press to shoot)';
const STARTING = 'The input reader is still starting.';
/**
 * What the preview shows for the Hornet while the overlay is off: the first two buttons of the
 * controller the recorded rig has the most of its own bindings on, the panel under the HUD.
 */
const HORNET_EXAMPLES = [
  {
    control: 'Button 1',
    device: 'WINWING UFC1',
    actions: [{ action: 'UFC I/P Pushbutton', modifiers: [] }],
    known: true,
  },
  {
    control: 'Button 2',
    device: 'WINWING UFC1',
    actions: [{ action: 'UFC Keyboard Pushbutton - 1', modifiers: [] }],
    known: true,
  },
];

interface Seen {
  changed: OverlayState[];
  presses: PressRow[][];
}

interface Made {
  app: WiredApp;
  service: OverlayService;
  seen: Seen;
}

let app: WiredApp | undefined;
const services: OverlayService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  await app?.cleanup();
  app = undefined;
});

/** An overlay of its own on a wired app, with what it told the page and the windows. */
function make(on: WiredApp, inputWaitMs?: number): Made {
  const seen: Seen = { changed: [], presses: [] };
  const service = new OverlayService(
    on.wiring.context,
    {
      changed: (state) => seen.changed.push(state),
      presses: (rows) => seen.presses.push(rows),
    },
    inputWaitMs
  );
  services.push(service);
  return { app: on, service, seen };
}

async function overlay(
  scenario = 'dcs-bindings-hornet',
  files: string[] = BINDING_FILES
): Promise<Made> {
  app = await wiredApp(scenario, { files });
  return make(app);
}

/** The same with the overlay turned on. */
async function flying(scenario?: string): Promise<Made> {
  const made = await overlay(scenario);
  value(await made.service.setOn(true));
  return made;
}

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const rowsOf = (service: OverlayService): PressRow[] => value(service.recent()).rows;
const actionsOf = (row: PressRow | undefined): string[] => row?.actions.map((a) => a.action) ?? [];

function controller(on: WiredApp, name: string): InputDevice {
  const found = on.ports.input.devices().find((d) => d.name.startsWith(name));
  if (!found) throw new Error(`No controller "${name}" on this rig`);
  return found;
}

/** A controller with these buttons down (counted from 1) and its hats this way. */
function held(
  device: InputDevice,
  buttons: number[] = [],
  hat: [number, number] = [0, 0]
): InputState {
  return {
    index: device.index,
    name: device.name,
    axes: [],
    buttons: Array.from({ length: device.numButtons }, (_, i) => buttons.includes(i + 1)),
    hats: Array.from({ length: device.numHats }, (): [number, number] => hat),
    timestamp: 0,
  };
}

async function displays(on: WiredApp): Promise<DisplayInfo[]> {
  return value(await on.ports.displays.read()).displays;
}

/** The first of the small screens beside the main one. */
async function smallScreen(on: WiredApp): Promise<DisplayInfo> {
  const found = (await displays(on)).find((d) => d.enabled && !d.primary);
  if (!found) throw new Error('This rig has one screen only');
  return found;
}

const settingsFile = (on: WiredApp): string =>
  path.join(on.ports.folders.dataRoot(), 'overlay', 'settings.json');

/** The settings file as it is on the disk, as far as these tests look into it. */
interface Saved {
  on: boolean;
  widgets: { [RECENT_PRESSES]: { options: unknown; place: { monitor: { id: string } } } };
  aircraft: unknown;
}

async function savedSettings(on: WiredApp): Promise<Saved> {
  return JSON.parse(value(await on.ports.files.readText(settingsFile(on)))) as Saved;
}

/**
 * A setup for a game, as the setup editor saves one; `overlay` is the switch in it, left out
 * when the user never touched it.
 */
function setup(
  id: string,
  name: string,
  game: { game?: string; gameName?: string },
  overlay?: boolean,
  more: Record<string, unknown> = {}
): Profile {
  const at = '2026-11-13T09:00:00.000Z';
  return ProfileSchema.parse({
    id,
    name,
    ...game,
    createdAt: at,
    updatedAt: at,
    ...more,
    ...(overlay === undefined ? {} : { extensions: { overlay: { on: overlay } } }),
  });
}

describe('turning the overlay on and off', () => {
  it('is off until the user turns it on: no window, and nothing is listened to', async () => {
    const { app, service, seen } = await overlay();
    const state = value(await service.state());
    expect(state.on).toBe(false);
    expect(state.input).toBeUndefined();
    expect(state.widgets).toHaveLength(1);
    expect(state.widgets[0]).toMatchObject({
      id: 'recent-presses',
      title: 'Recent presses',
      showing: false,
      moving: false,
      options: { lifetimeSeconds: 5, rows: 5, size: 'medium', showUnbound: true },
    });
    expect(app.ports.overlays.panels.size).toBe(0);

    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(seen.presses).toEqual([]);
    expect(rowsOf(service)).toEqual([]);
  });

  it('turned on, the recent presses are low in the middle of the main screen and let the mouse through', async () => {
    const { app, service, seen } = await overlay();
    const state = value(await service.setOn(true));
    expect(state.on).toBe(true);
    expect(state.input).toEqual({ ok: true });
    expect(state.widgets[0]).toMatchObject({
      showing: true,
      moving: false,
      width: 396,
      height: 300,
      place: { screenName: 'LC49G95T', at: { x: 0.5, y: 1 } },
    });
    expect(state.widgets[0]!.place.away).toBeUndefined();
    expect(state.widgets[0]!.problem).toBeUndefined();

    const shown = app.ports.overlays.panels.get(PANEL)!;
    expect(shown.panel).toEqual({
      id: PANEL,
      route: '/overlay/recent-presses',
      screen: { x: 0, y: 0, width: 5120, height: 1440 },
      width: 396,
      height: 300,
      at: { x: 0.5, y: 1 },
      movable: false,
    });
    expect(shown.box).toEqual({ x: 2362, y: 1140, width: 396, height: 300 });
    // Remembered, and the page and the window were told what the answer says.
    expect((await savedSettings(app)).on).toBe(true);
    expect(seen.changed.at(-1)).toEqual(state);
  });

  it('a window of the overlay gets the state as it stands, and nothing is read for it', async () => {
    const { app, service, seen } = await overlay();
    // Before anything was read: off, and no screen known yet.
    expect(value(service.current())).toMatchObject({ on: false, screens: [] });
    const state = value(await service.setOn(true));
    const told = seen.changed.length;

    let reads = 0;
    const read = app.ports.displays.read.bind(app.ports.displays);
    app.ports.displays.read = () => {
      reads++;
      return read();
    };
    expect(value(service.current())).toEqual(state);
    await service.idle();
    expect(reads).toBe(0);
    // Asking is not news: nobody is told anything.
    expect(seen.changed).toHaveLength(told);
  });

  it('left on, it comes up when RigReady starts; left off, it does not', async () => {
    const first = await overlay();
    await first.service.start();
    await first.service.idle();
    expect(first.app.ports.overlays.panels.size).toBe(0);
    expect(first.seen.changed).toEqual([]);

    value(await first.service.setOn(true));
    await first.service.dispose();
    expect(first.app.ports.overlays.panels.size).toBe(0);

    const again = make(first.app);
    await again.service.start();
    await again.service.idle();
    expect(first.app.ports.overlays.panels.has(PANEL)).toBe(true);
    expect(again.seen.changed.at(-1)).toMatchObject({ on: true, input: { ok: true } });
    expect(again.seen.changed.at(-1)!.widgets[0]!.showing).toBe(true);
  });

  it('turned off, the window goes and what was shown is forgotten', async () => {
    const { app, service, seen } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)).toHaveLength(1);

    const state = value(await service.setOn(false));
    expect(state.on).toBe(false);
    expect(state.input).toBeUndefined();
    expect(state.widgets[0]!.showing).toBe(false);
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(rowsOf(service)).toEqual([]);
    expect((await savedSettings(app)).on).toBe(false);

    const told = seen.presses.length;
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [10])]);
    expect(seen.presses).toHaveLength(told);
  });

  it('on quit the window goes and nothing is listened to any more', async () => {
    const { app, service, seen } = await flying();
    await service.dispose();
    expect(app.ports.overlays.panels.size).toBe(0);
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(seen.presses).toEqual([]);
    // Still on for the next start.
    expect((await savedSettings(app)).on).toBe(true);
  });

  it('quit while it is still coming up: nothing comes up after the quit, and nothing is listened to', async () => {
    const first = await flying();
    await first.service.dispose();
    // RigReady starts again with the overlay left on, and is quit while the overlay is still
    // reading what it needs (the screens here; the bindings of DCS can take a quarter of a
    // minute). The input reader is stopped right after the quit.
    const { app } = first;
    const read = app.ports.displays.read.bind(app.ports.displays);
    let answer: (() => void) | undefined;
    app.ports.displays.read = () =>
      new Promise((resolve) => {
        answer = () => void read().then(resolve);
      });
    let listened = 0;
    const subscribe = app.ports.input.subscribe.bind(app.ports.input);
    app.ports.input.subscribe = (listener) => {
      listened++;
      return subscribe(listener);
    };
    const again = make(app);
    const starting = again.service.start();
    await vi.waitFor(() => expect(answer).toBeDefined());
    await again.service.dispose();
    answer!();
    await starting;
    await again.service.idle();
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(listened).toBe(0);
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(again.seen.presses).toEqual([]);
    // Asked for anything after the quit, it does nothing and says why.
    expect(await again.service.setOn(true)).toMatchObject({ ok: false });
    expect(app.ports.overlays.panels.size).toBe(0);
  });

  it('tells the page and the windows only what is new', async () => {
    const { service, seen } = await overlay();
    await service.state();
    await service.state();
    expect(seen.changed).toHaveLength(1);
    value(await service.setOn(true));
    const told = seen.changed.length;
    await service.state();
    await service.state();
    expect(seen.changed).toHaveLength(told);
  });

  it('a window that is there is left alone, and one closed from outside is put back', async () => {
    const { app, service } = await flying();
    const calls = app.ports.overlays.panelCalls.length;
    await service.state();
    expect(app.ports.overlays.panelCalls).toHaveLength(calls);

    app.ports.overlays.panels.delete(PANEL);
    const state = value(await service.state());
    expect(app.ports.overlays.panelCalls).toHaveLength(calls + 1);
    expect(app.ports.overlays.panels.has(PANEL)).toBe(true);
    expect(state.widgets[0]!.showing).toBe(true);
  });
});

describe('what a press is shown as', () => {
  it('what is held when the overlay starts is how the controllers rest, not a press', async () => {
    const { app, service, seen } = await overlay();
    const throttle = controller(app, 'WINWING THROTTLE');
    const stick = controller(app, 'WINWING Orion');
    // Both throttle levers are in their off detents before the overlay is on.
    app.ports.input.emit([held(throttle, [1, 2])]);
    value(await service.setOn(true));
    // The same again, and a controller heard of for the first time with a switch on.
    app.ports.input.emit([held(throttle, [1, 2])]);
    app.ports.input.emit([held(stick, [12])]);
    expect(seen.presses).toEqual([]);

    // Only what goes down after that is a press.
    app.ports.input.emit([held(throttle, [1, 2, 3])]);
    expect(rowsOf(service).map(actionsOf)).toEqual([['Speed Brake Switch - EXTEND']]);
  });

  it('shows what the press does in the game, the control and the controller', async () => {
    const { app, service, seen } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(seen.presses).toEqual([
      [
        {
          id: 1,
          count: 1,
          stamp: app.clock.now().getTime(),
          ageMs: 0,
          control: 'Button 5',
          device: 'WINWING Orion Joystick…',
          actions: [{ action: TRIGGER, modifiers: [] }],
          known: true,
        },
      ],
    ]);

    // A hat, on the wheel base, with what the game binds by itself.
    const wheel = controller(app, 'FANATEC');
    app.ports.input.emit([held(wheel)]);
    app.ports.input.emit([held(wheel, [], [0, 1])]);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Hat 1 up',
      device: 'FANATEC Podium Wheel Base…',
      actions: [{ action: 'View Up slow', modifiers: [] }],
    });
    // The long name of the throttle is cut to what it is built on.
    const throttle = controller(app, 'WINWING THROTTLE');
    app.ports.input.emit([held(throttle)]);
    app.ports.input.emit([held(throttle, [3])]);
    expect(rowsOf(service)[0]!.device).toBe('WINWING THROTTLE BASE1');
  });

  it('uses the name the user gave a controller', async () => {
    const { app, service } = await flying('cheat-sheets-hornet');
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({ device: 'Stick', actions: [{ action: TRIGGER }] });
  });

  // The scenario the screens are tested on (tests/e2e/overlay.e2e.ts): what that test
  // presses and expects to read is settled here, on the same recorded files.
  it('on the rig with named controllers: the setup, its aircraft, and what three controls show', async () => {
    const { app, service } = await flying('cheat-sheets-hornet');
    const state = value(await service.state());
    expect(state.source).toMatchObject({
      setup: { name: 'DCS F/A-18C' },
      game: { id: 'dcs' },
      aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', how: 'setup' },
    });
    expect(state.source.game!.name).toContain('DCS');
    expect(state.screens.map((s) => (s.primary ? `${s.name} (main)` : s.name))).toEqual([
      'LC49G95T (main)',
      'USB_Monitor (1 of 3)',
      'USB_Monitor (2 of 3)',
      'USB_Monitor (3 of 3)',
    ]);
    expect(state.widgets[0]).toMatchObject({
      showing: true,
      width: 396,
      height: 300,
      place: { screenName: 'LC49G95T', at: { x: 0.5, y: 1 } },
    });
    const throttle = controller(app, 'WINWING THROTTLE');
    const icp = controller(app, 'WINWING ICP');
    // A lever of the throttle rests on a button.
    app.ports.input.emit([held(throttle, [7]), held(icp)]);
    expect(rowsOf(service)).toEqual([]);

    app.ports.input.emit([held(throttle, [7, 3])]);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Button 3',
      device: 'Throttle',
      actions: [{ action: 'Speed Brake Switch - EXTEND' }],
    });
    // The switch in its other position, in one report: the same line.
    app.clock.advance(400);
    app.ports.input.emit([held(throttle, [7, 5])]);
    expect(rowsOf(service)).toHaveLength(1);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Button 5',
      actions: [{ action: 'Speed Brake Switch - RETRACT' }],
    });

    app.clock.advance(400);
    app.ports.input.emit([held(icp, [1])]);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Button 1',
      device: 'WINWING ICP',
      actions: [],
      known: true,
    });
    app.clock.advance(400);
    app.ports.input.emit([held(icp, [2])]);
    expect(rowsOf(service)[0]).toMatchObject({ control: 'Button 2', actions: [], known: true });
  });

  it('what needs something held with it comes after what works on its own', async () => {
    const { app, service } = await flying();
    const panel = controller(app, 'R-VPC Panel');
    app.ports.input.emit([held(panel)]);
    app.ports.input.emit([held(panel, [34])]);
    const [row] = rowsOf(service);
    expect(row!.actions).toHaveLength(2);
    expect(row!.actions[0]!.modifiers).toEqual([]);
    expect(row!.actions[1]!.modifiers.length).toBeGreaterThan(0);
    expect(actionsOf(row).sort()).toEqual(['ALR-67 DIS TYPE Switch - CCW', 'RADAR Switch - CCW']);
  });

  it('a press the game has nothing on is shown as that, or left out when the user says so', async () => {
    const { app, service, seen } = await flying();
    const icp = controller(app, 'WINWING ICP');
    app.ports.input.emit([held(icp)]);
    app.ports.input.emit([held(icp, [1])]);
    expect(rowsOf(service)).toHaveLength(1);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Button 1',
      device: 'WINWING ICP',
      actions: [],
      known: true,
    });

    value(
      await service.setOptions(RECENT_PRESSES, {
        lifetimeSeconds: 5,
        rows: 5,
        size: 'medium',
        showUnbound: false,
      })
    );
    // The one that is listed goes at once, like any other option, and the windows are told.
    expect(seen.presses.at(-1)).toEqual([]);
    expect(rowsOf(service)).toEqual([]);
    const told = seen.presses.length;
    app.clock.advance(1000);
    app.ports.input.emit([held(icp)]);
    app.clock.advance(1000);
    app.ports.input.emit([held(icp, [2])]);
    expect(seen.presses).toHaveLength(told);
    expect(rowsOf(service)).toEqual([]);

    // What the game does have something on still shows.
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service).map((r) => r.control)).toEqual(['Button 5']);
  });

  it('the same control pressed again counts up instead of adding a line', async () => {
    const { app, service } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    const first = rowsOf(service)[0]!;
    app.clock.advance(300);
    app.ports.input.emit([held(stick)]);
    app.clock.advance(300);
    app.ports.input.emit([held(stick, [5])]);
    const rows = rowsOf(service);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: first.id, count: 2, ageMs: 0 });
    expect(rows[0]!.stamp).toBe(first.stamp + 600);
  });

  it('a switch or lever going through its positions is one line that changes', async () => {
    const { app, service } = await flying();
    const throttle = controller(app, 'WINWING THROTTLE');
    app.ports.input.emit([held(throttle)]);
    app.ports.input.emit([held(throttle, [3])]);
    const first = rowsOf(service)[0]!;
    expect(actionsOf(first)).toEqual(['Speed Brake Switch - EXTEND']);

    // One position let go and the next taken in the same report.
    app.clock.advance(400);
    app.ports.input.emit([held(throttle, [4])]);
    // And let go in one report and taken in the next, a moment later.
    app.clock.advance(400);
    app.ports.input.emit([held(throttle)]);
    app.clock.advance(16);
    app.ports.input.emit([held(throttle, [5])]);
    const rows = rowsOf(service);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
    expect(actionsOf(rows[0])).toEqual(['Speed Brake Switch - RETRACT']);

    // Another button, well after: a line of its own, the newest first.
    app.clock.advance(1000);
    app.ports.input.emit([held(throttle, [5, 1])]);
    expect(rowsOf(service).map(actionsOf)).toEqual([
      ['Throttle (Right) - OFF'],
      ['Speed Brake Switch - RETRACT'],
    ]);
  });

  it('each line goes when its time is up, and says how old it is until then', async () => {
    const { app, service, seen } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [10])]);
    app.clock.advance(2000);
    expect(rowsOf(service).map((r) => r.ageMs)).toEqual([2000]);
    app.ports.input.emit([held(stick, [10, 11])]);
    expect(seen.presses.at(-1)!.map((r) => [actionsOf(r)[0], r.ageMs])).toEqual([
      ['Select Gun', 0],
      ['Select AMRAAM', 2000],
    ]);
    // Five seconds after it was pressed, a line is gone.
    app.clock.advance(2999);
    expect(rowsOf(service)).toHaveLength(2);
    app.clock.advance(1);
    expect(rowsOf(service).map((r) => [actionsOf(r)[0], r.ageMs])).toEqual([['Select Gun', 3000]]);
    app.clock.advance(2000);
    expect(rowsOf(service)).toEqual([]);
  });
});

describe('the options of the recent presses', () => {
  it('apply at once: fewer lines, a shorter time, another size of window', async () => {
    const { app, service, seen } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [10])]);
    app.clock.advance(500);
    app.ports.input.emit([held(stick, [10, 11])]);
    app.clock.advance(500);
    app.ports.input.emit([held(stick, [10, 11, 12])]);
    expect(rowsOf(service)).toHaveLength(3);

    const options = { lifetimeSeconds: 2, rows: 2, size: 'large', showUnbound: true };
    const state = value(await service.setOptions(RECENT_PRESSES, options));
    expect(state.widgets[0]).toMatchObject({ options, width: 516, height: 154, showing: true });
    expect(app.ports.overlays.panels.get(PANEL)!.panel).toMatchObject({ width: 516, height: 154 });
    expect(seen.presses.at(-1)!.map((r) => actionsOf(r)[0])).toEqual([
      'Select Sidewinder',
      'Select Gun',
    ]);
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].options).toEqual(options);

    app.clock.advance(1600);
    expect(rowsOf(service).map((r) => actionsOf(r)[0])).toEqual(['Select Sidewinder']);
  });

  it('a longer time does not bring back a press whose time was over', async () => {
    const { app, service, seen } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)).toHaveLength(1);
    // Six seconds on, with nothing pressed and nothing read in between: it is off the screen.
    app.clock.advance(6000);
    value(
      await service.setOptions(RECENT_PRESSES, {
        lifetimeSeconds: 30,
        rows: 5,
        size: 'medium',
        showUnbound: true,
      })
    );
    expect(seen.presses.at(-1)).toEqual([]);
    expect(rowsOf(service)).toEqual([]);
    // Pressed again, it is a first press.
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({ control: 'Button 5', count: 1 });
  });

  it('options that do not fit are refused, and so is a part the overlay does not have', async () => {
    const { app, service } = await flying();
    const bad = await service.setOptions(RECENT_PRESSES, { lifetimeSeconds: 0 });
    expect(bad).toMatchObject({ ok: false, error: { code: 'overlay.options' } });
    expect((await savedSettings(app)).widgets).toEqual({});

    for (const answer of [
      await service.setOptions('stick-position', {}),
      await service.place('stick-position', { at: { x: 0, y: 0 } }),
      await service.move('stick-position', true),
    ]) {
      expect(answer).toMatchObject({ ok: false, error: { code: 'overlay.widget' } });
    }
  });
});

describe('where the overlay is', () => {
  it('goes on the screen and to the place the user picks', async () => {
    const { app, service } = await flying();
    const small = await smallScreen(app);
    const screens = value(await service.state()).screens;
    expect(screens[0]).toMatchObject({ name: 'LC49G95T', primary: true, width: 5120 });
    expect(screens.slice(1).map((s) => s.name)).toEqual([
      'USB_Monitor (1 of 3)',
      'USB_Monitor (2 of 3)',
      'USB_Monitor (3 of 3)',
    ]);
    expect(screens[1]!.id).toBe(small.id);

    const state = value(
      await service.place(RECENT_PRESSES, { screen: small.id, at: { x: 0, y: 0 } })
    );
    expect(state.widgets[0]!.place).toEqual({
      screen: small.id,
      screenName: 'USB_Monitor (1 of 3)',
      at: { x: 0, y: 0 },
    });
    expect(app.ports.overlays.panels.get(PANEL)!.box).toEqual({
      x: small.x,
      y: small.y,
      width: 396,
      height: 300,
    });

    // Another place on the same screen: the screen need not be said again.
    value(await service.place(RECENT_PRESSES, { at: { x: 1, y: 1 } }));
    expect(app.ports.overlays.panels.get(PANEL)!.box).toEqual({
      x: small.x + small.width - 396,
      y: small.y + small.height - 300,
      width: 396,
      height: 300,
    });
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].place).toMatchObject({
      monitor: { id: small.id, name: 'USB_Monitor (1 of 3)' },
      at: { x: 1, y: 1 },
    });
  });

  it('a screen that is not on is refused', async () => {
    const { app, service } = await flying();
    const off = (await displays(app)).find((d) => !d.enabled)!;
    const answer = await service.place(RECENT_PRESSES, { screen: off.id, at: { x: 0, y: 0 } });
    expect(answer).toMatchObject({ ok: false, error: { code: 'overlay.screen' } });
    expect((await savedSettings(app)).widgets).toEqual({});
  });

  it('while its screen is off the main screen stands in, and it goes back when the screen is on again', async () => {
    const { app, service } = await flying();
    const small = await smallScreen(app);
    value(await service.place(RECENT_PRESSES, { screen: small.id, at: { x: 0, y: 0 } }));

    await mutate(app, [{ op: 'setDisplay', match: { id: small.id }, set: { enabled: false } }]);
    const away = value(await service.state());
    expect(away.widgets[0]!.place).toEqual({
      screen: (await displays(app)).find((d) => d.primary)!.id,
      screenName: 'LC49G95T',
      at: { x: 0, y: 0 },
      away: 'USB_Monitor (1 of 3)',
    });
    expect(away.widgets[0]!.showing).toBe(true);
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 0, y: 0 });
    // What the user chose is kept.
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].place.monitor.id).toBe(small.id);

    await mutate(app, [
      {
        op: 'setDisplay',
        match: { id: small.id },
        set: { enabled: true, x: small.x, y: small.y, width: small.width, height: small.height },
      },
    ]);
    const back = value(await service.state());
    expect(back.widgets[0]!.place).toEqual({
      screen: small.id,
      screenName: 'USB_Monitor (1 of 3)',
      at: { x: 0, y: 0 },
    });
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: small.x, y: small.y });
  });

  it('screens rearranged while flying are noticed on a press, but not more often than every ten seconds', async () => {
    const { app, service, seen } = await flying();
    const small = await smallScreen(app);
    value(await service.place(RECENT_PRESSES, { screen: small.id, at: { x: 0, y: 0 } }));
    await mutate(app, [{ op: 'setDisplay', match: { id: small.id }, set: { enabled: false } }]);

    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.clock.advance(QUICK_CHECK_MS - 1);
    app.ports.input.emit([held(stick, [5])]);
    await service.idle();
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: small.x, y: small.y });

    app.clock.advance(1);
    app.ports.input.emit([held(stick, [5, 10])]);
    await service.idle();
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 0, y: 0 });
    expect(seen.changed.at(-1)!.widgets[0]!.place.away).toBe('USB_Monitor (1 of 3)');
  });

  it('"move it": the window takes the mouse, is dragged, and locking keeps the place and the screen', async () => {
    const { app, service } = await flying();
    const small = await smallScreen(app);
    const before = { ...app.ports.overlays.panels.get(PANEL)!.box };
    // Locked, the mouse goes through it: it cannot be dragged.
    expect(app.ports.overlays.drag(PANEL, { x: 10, y: 10 })).toBe(false);

    const moving = value(await service.move(RECENT_PRESSES, true));
    expect(moving.widgets[0]).toMatchObject({ moving: true, showing: true });
    expect(app.ports.overlays.panels.get(PANEL)!.panel.movable).toBe(true);
    // The same window in the same spot: nothing jumps when placing starts.
    expect(app.ports.overlays.panels.get(PANEL)!.box).toEqual(before);

    expect(app.ports.overlays.drag(PANEL, { x: small.x + 100, y: small.y + 200 })).toBe(true);
    const locked = value(await service.move(RECENT_PRESSES, false));
    expect(locked.widgets[0]).toMatchObject({
      moving: false,
      showing: true,
      place: {
        screen: small.id,
        screenName: 'USB_Monitor (1 of 3)',
        at: { x: 0.26882, y: 0.27624 },
      },
    });
    const shown = app.ports.overlays.panels.get(PANEL)!;
    expect(shown.panel.movable).toBe(false);
    expect(shown.box).toEqual({ x: small.x + 100, y: small.y + 200, width: 396, height: 300 });
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].place).toEqual({
      monitor: {
        id: small.id,
        ...(small.serial ? { serial: small.serial } : {}),
        ...(small.usbSerial ? { usbSerial: small.usbSerial } : {}),
        name: 'USB_Monitor (1 of 3)',
      },
      at: { x: 0.26882, y: 0.27624 },
    });
  });

  it('placing by hand needs the overlay on, and ending what never started changes nothing', async () => {
    const { app, service } = await overlay();
    const refused = await service.move(RECENT_PRESSES, true);
    expect(refused).toMatchObject({
      ok: false,
      error: { code: 'overlay.off', message: 'Turn the overlay on first.' },
    });
    expect(app.ports.overlays.panels.size).toBe(0);

    value(await service.setOn(true));
    const calls = app.ports.overlays.panelCalls.length;
    const ended = value(await service.move(RECENT_PRESSES, false));
    expect(ended.widgets[0]!.moving).toBe(false);
    expect(app.ports.overlays.panelCalls).toHaveLength(calls);
    expect((await savedSettings(app)).widgets).toEqual({});
  });

  it('when the new place cannot be read the overlay is back where it was, and says so', async () => {
    const { app, service } = await flying();
    value(await service.move(RECENT_PRESSES, true));
    app.ports.overlays.drag(PANEL, { x: 40, y: 40 });
    // The window is gone before it could be asked where it is.
    app.ports.overlays.panels.delete(PANEL);

    const ended = await service.move(RECENT_PRESSES, false);
    expect(ended).toMatchObject({ ok: false, error: { code: 'overlay.place' } });
    const state = value(await service.state());
    expect(state.widgets[0]).toMatchObject({
      moving: false,
      showing: true,
      place: { at: { x: 0.5, y: 1 } },
    });
    const shown = app.ports.overlays.panels.get(PANEL)!;
    expect(shown.panel.movable).toBe(false);
    expect(shown.box).toEqual({ x: 2362, y: 1140, width: 396, height: 300 });
  });

  it('"The main screen" goes with whichever monitor is main, and is where it starts', async () => {
    const { app, service } = await overlay();
    // Never placed: it follows the main screen.
    expect(value(await service.state()).widgets[0]!.place).toMatchObject({
      screenName: 'LC49G95T',
      main: true,
    });
    value(await service.setOn(true));
    const small = await smallScreen(app);
    const put = value(
      await service.place(RECENT_PRESSES, { screen: small.id, at: { x: 0, y: 0 } })
    );
    expect(put.widgets[0]!.place.main).toBeUndefined();

    // Back to "The main screen": no monitor is kept, the place on it is.
    const back = value(await service.place(RECENT_PRESSES, { screen: null, at: { x: 1, y: 0 } }));
    expect(back.widgets[0]!.place).toMatchObject({
      screenName: 'LC49G95T',
      main: true,
      at: { x: 1, y: 0 },
    });
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].place).toEqual({
      at: { x: 1, y: 0 },
    });
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 5120 - 396, y: 0 });

    // Another monitor layout makes another monitor the main one: the overlay goes with it.
    await mutate(app, [
      { op: 'setDisplay', match: { name: 'LC49G95T' }, set: { primary: false } },
      { op: 'setDisplay', match: { id: small.id }, set: { primary: true } },
    ]);
    const moved = value(await service.state());
    expect(moved.widgets[0]!.place).toMatchObject({
      screen: small.id,
      screenName: 'USB_Monitor (1 of 3)',
      main: true,
    });
    expect(moved.widgets[0]!.place.away).toBeUndefined();
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({
      x: small.x + small.width - 396,
      y: small.y,
    });
  });

  it('let go on the main screen it goes on following it; let go on another it belongs there', async () => {
    const { app, service } = await flying();
    value(await service.move(RECENT_PRESSES, true));
    app.ports.overlays.drag(PANEL, { x: 100, y: 200 });
    const kept = value(await service.move(RECENT_PRESSES, false));
    expect(kept.widgets[0]!.place).toMatchObject({ screenName: 'LC49G95T', main: true });
    const saved = (await savedSettings(app)).widgets[RECENT_PRESSES].place;
    expect(saved).not.toHaveProperty('monitor');
    expect(app.ports.overlays.panels.get(PANEL)!.box).toMatchObject({ x: 100, y: 200 });

    const small = await smallScreen(app);
    value(await service.move(RECENT_PRESSES, true));
    app.ports.overlays.drag(PANEL, { x: small.x + 10, y: small.y + 10 });
    const there = value(await service.move(RECENT_PRESSES, false));
    expect(there.widgets[0]!.place.main).toBeUndefined();
    expect((await savedSettings(app)).widgets[RECENT_PRESSES].place.monitor.id).toBe(small.id);
  });

  it('says so when the screen it was put on is off in the monitor layout of a setup that has it on', async () => {
    const { app, service } = await flying();
    const { profiles, layouts } = app.wiring.context;
    const small = await smallScreen(app);
    value(await service.place(RECENT_PRESSES, { screen: small.id, at: { x: 0, y: 0 } }));
    // A saved layout with that screen off, and the Hornet setup applying it at Make ready.
    const targets = layoutToTargets({ displays: await displays(app) }).map((t) =>
      t.id === small.id ? { ...t, enabled: false, primary: false } : t
    );
    const flyingLayout = value(await layouts.create('Flying', targets));
    const check = {
      id: 'monitors',
      type: 'display.layout',
      title: 'Monitor layout',
      required: true,
      params: { layoutId: flyingLayout.id, layoutName: 'Flying', displays: targets },
    };
    const hornet = value(await profiles.get('dcs-bindings-hornet'));
    value(await profiles.save({ ...hornet, checks: [...hornet.checks, check] }));
    // A setup with the overlay off that turns it off too: it does not count.
    value(
      await profiles.save(
        setup('sunday-race', 'Sunday race', { game: 'iracing' }, undefined, {
          checks: [{ ...check, params: { displays: targets } }],
        })
      )
    );
    await service.idle();
    let place = value(await service.state()).widgets[0]!.place;
    expect(place.offIn).toEqual([{ setup: 'DCS F/A-18C', layout: 'Flying' }]);
    // It is on now, where it was put: nothing is away.
    expect(place).toMatchObject({ screen: small.id, screenName: 'USB_Monitor (1 of 3)' });

    // Turned on there, the race counts too, by the layout it keeps of its own.
    const race = value(await profiles.get('sunday-race'));
    value(await profiles.save({ ...race, extensions: { overlay: { on: true } } }));
    await service.idle();
    place = value(await service.state()).widgets[0]!.place;
    expect(place.offIn).toEqual([
      { setup: 'DCS F/A-18C', layout: 'Flying' },
      { setup: 'Sunday race' },
    ]);

    // A check switched off is not applied by Make ready.
    value(
      await profiles.save({
        ...race,
        checks: [{ ...check, params: { displays: targets }, disabled: true }],
        extensions: { overlay: { on: true } },
      })
    );
    place = value(await service.state()).widgets[0]!.place;
    expect(place.offIn).toEqual([{ setup: 'DCS F/A-18C', layout: 'Flying' }]);

    // Following the main screen there is nothing to warn of.
    place = value(await service.place(RECENT_PRESSES, { screen: null, at: { x: 0, y: 0 } }))
      .widgets[0]!.place;
    expect(place.offIn).toBeUndefined();
    expect(place.main).toBe(true);
  });
});

describe('when something is in the way', () => {
  it('says why when the window cannot be shown, and shows it once it can', async () => {
    const { app, service } = await overlay();
    app.ports.overlays.panelFailure = {
      code: 'overlay.window',
      message: 'Windows refused the window.',
    };
    const state = value(await service.setOn(true));
    expect(state.on).toBe(true);
    expect(state.widgets[0]).toMatchObject({
      showing: false,
      problem: 'Windows refused the window.',
    });
    const moved = await service.move(RECENT_PRESSES, true);
    expect(moved).toMatchObject({
      ok: false,
      error: { code: 'overlay.notShown', message: 'Windows refused the window.' },
    });
    expect(value(await service.state()).widgets[0]!.moving).toBe(false);

    app.ports.overlays.panelFailure = undefined;
    const later = value(await service.state());
    expect(later.widgets[0]!.showing).toBe(true);
    expect(later.widgets[0]!.problem).toBeUndefined();
  });

  it('with no screen on there is nothing to show it on', async () => {
    const { app, service } = await flying();
    const on = (await displays(app)).filter((d) => d.enabled);
    await mutate(
      app,
      on.map((d) => ({ op: 'setDisplay', match: { id: d.id }, set: { enabled: false } }))
    );
    const state = value(await service.state());
    expect(state.screens).toEqual([]);
    expect(state.widgets[0]).toMatchObject({
      showing: false,
      problem: 'No screen is on, so there is nothing to show the overlay on.',
    });
    expect(state.widgets[0]!.place.screen).toBeUndefined();
    expect(app.ports.overlays.panels.size).toBe(0);
  });

  it('a damaged settings file is said to be damaged and is not replaced', async () => {
    const { app, service } = await overlay();
    const file = settingsFile(app);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ "on": tru');

    const state = value(await service.state());
    expect(state.on).toBe(false);
    expect(state.problem).toMatch(/settings\.json is not valid JSON/);
    const on = await service.setOn(true);
    expect(on).toMatchObject({ ok: false, error: { code: 'store.invalid' } });
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(await fs.readFile(file, 'utf8')).toBe('{ "on": tru');
  });

  // On a rig without a game: the bindings of DCS are themselves read with the list of
  // attached controllers, so there the reader is waited for before anything is shown.
  it('says so while the input reader is still starting, and tells the page when it reads', async () => {
    app = await wiredApp('dcs-bindings-no-dcs', { files: [] });
    let started: (answer: Result<InputDevice[]>) => void = () => undefined;
    app.ports.input.start = () =>
      new Promise((resolve) => {
        started = resolve;
      });
    const { service, seen } = make(app, 5);

    const state = value(await service.setOn(true));
    expect(state.input).toEqual({ ok: false, problem: STARTING });
    // The window does not wait for the reader.
    expect(state.widgets[0]!.showing).toBe(true);

    started(ok(app.ports.input.devices()));
    await service.idle();
    expect(seen.changed.at(-1)!.input).toEqual({ ok: true });
    expect(value(await service.state()).input).toEqual({ ok: true });
  });

  it('says why when the controllers cannot be read', async () => {
    app = await wiredApp('dcs-bindings-hornet', { files: BINDING_FILES });
    app.ports.input.start = async () =>
      err('input.unavailable', 'The controllers could not be opened.');
    const refused = make(app);
    expect(value(await refused.service.setOn(true)).input).toEqual({
      ok: false,
      problem: 'The controllers could not be opened.',
    });
    await refused.service.dispose();

    app.ports.input.start = () => {
      throw new Error('the reader fell over');
    };
    const broken = make(app);
    expect(value(await broken.service.state()).input).toEqual({
      ok: false,
      problem: 'The controllers could not be read.',
    });
  });

  it('turned off while the reader was starting, nothing more is said about it', async () => {
    app = await wiredApp('dcs-bindings-no-dcs', { files: [] });
    let started: (answer: Result<InputDevice[]>) => void = () => undefined;
    app.ports.input.start = () =>
      new Promise((resolve) => {
        started = resolve;
      });
    const { service, seen } = make(app, 5);
    value(await service.setOn(true));
    value(await service.setOn(false));
    const told = seen.changed.length;

    started(ok(app.ports.input.devices()));
    await service.idle();
    expect(seen.changed).toHaveLength(told);
    expect(value(await service.state()).input).toBeUndefined();
  });
});

describe('which game and aircraft the words come from', () => {
  it('the aircraft the setup in use names, until the user chooses another', async () => {
    const { app, service } = await flying();
    const state = value(await service.state());
    expect(state.source).toMatchObject({
      setup: { id: 'dcs-bindings-hornet', name: 'DCS F/A-18C' },
      game: { id: 'dcs' },
      aircraft: { id: 'FA-18C_hornet', name: 'F/A-18C', how: 'setup' },
    });
    expect(state.source.problem).toBeUndefined();
    expect(state.source.choices.map((c) => c.id)).toContain('UH-1H');

    const chosen = value(await service.chooseAircraft('UH-1H'));
    expect(chosen.source.aircraft).toMatchObject({ id: 'UH-1H', how: 'chosen' });
    expect((await savedSettings(app)).aircraft).toEqual({
      'dcs-bindings-hornet': { game: 'dcs', aircraftId: 'UH-1H' },
    });
    // The trigger is the Hornet's trigger no longer.
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)).toHaveLength(1);
    expect(actionsOf(rowsOf(service)[0])).not.toContain(TRIGGER);

    const back = value(await service.chooseAircraft(null));
    expect(back.source.aircraft).toMatchObject({ id: 'FA-18C_hornet', how: 'setup' });
    expect((await savedSettings(app)).aircraft).toEqual({});
    app.clock.advance(1000);
    app.ports.input.emit([held(stick)]);
    app.clock.advance(1000);
    app.ports.input.emit([held(stick, [5])]);
    expect(actionsOf(rowsOf(service)[0])).toEqual([TRIGGER]);
  });

  it('an aircraft the game has no bindings for cannot be chosen', async () => {
    const { app, service } = await overlay();
    const answer = await service.chooseAircraft('Su-99');
    expect(answer).toMatchObject({ ok: false, error: { code: 'overlay.aircraft' } });
    expect(await app.ports.files.exists(settingsFile(app))).toBe(false);
  });

  it('another setup played while flying is picked up at once: the words are never those of another game', async () => {
    const { app, service, seen } = await flying();
    const { profiles } = app.wiring.context;
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({ known: true, actions: [{ action: TRIGGER }] });

    // A game RigReady cannot read the bindings of, with the overlay turned on in its setup.
    value(
      await profiles.save(
        setup('falcon', 'Falcon', { game: 'other', gameName: 'Falcon BMS' }, true)
      )
    );
    value(await profiles.setLastProfileId('falcon'));
    await service.idle();
    expect(seen.changed.at(-1)!.source).toEqual({
      setup: { id: 'falcon', name: 'Falcon' },
      game: { id: 'other', name: 'Falcon BMS' },
      choices: [],
      problem:
        'RigReady cannot read the bindings of Falcon BMS, so presses are shown without what they do.',
    });
    app.ports.input.emit([held(stick, [5, 10, 11])]);
    expect(rowsOf(service)[0]).toMatchObject({ control: 'Button 11', actions: [], known: false });
  });

  it('a setup for a game whose bindings are not on this PC gives presses without words, and says why', async () => {
    const { app, service } = await overlay();
    const { profiles } = app.wiring.context;
    // Turned on in the setup by the user: without that, it would be off there to begin with.
    value(await profiles.save(setup('sunday-race', 'Sunday race', { game: 'iracing' }, true)));
    value(await profiles.setLastProfileId('sunday-race'));
    const state = value(await service.setOn(true));
    expect(state.widgets[0]!.showing).toBe(true);
    expect(state.source).toEqual({
      setup: { id: 'sunday-race', name: 'Sunday race' },
      game: { id: 'iracing', name: 'iRacing' },
      choices: [],
      problem:
        'The bindings of iRacing were not found on this PC, so presses are shown without what they do.',
    });
    const none = await service.chooseAircraft('all');
    expect(none).toMatchObject({ ok: false, error: { code: 'overlay.aircraft' } });
  });

  it('a racing game: the one set of bindings it has, by the control a press is on', async () => {
    app = await wiredApp('racing-not-ready', {
      files: ['Documents/iRacing/**', 'Program Files (x86)/Steam/steamapps/**'],
    });
    const { service } = make(app);
    const state = value(await service.setOn(true));
    expect(state.source).toMatchObject({
      setup: { id: 'racing-iracing', name: 'iRacing' },
      game: { id: 'iracing', name: 'iRacing' },
      aircraft: { id: 'all', how: 'only' },
    });
    expect(state.source.problem).toBeUndefined();

    const wheel = controller(app, 'FANATEC');
    app.ports.input.emit([held(wheel)]);
    app.ports.input.emit([held(wheel, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({
      control: 'Button 5',
      actions: [{ action: 'Shift up', modifiers: [] }],
      known: true,
    });
  });

  it('without a setup, and with the bindings of several games here, none is guessed', async () => {
    app = await wiredApp('mark-racing', {
      files: ['Documents/iRacing/**', 'Program Files (x86)/Steam/steamapps/**'],
    });
    const { service } = make(app);
    const state = value(await service.setOn(true));
    expect(state.source).toEqual({
      choices: [],
      problem:
        'RigReady can read the bindings of more than one game here and no setup says which one you play, so presses are shown without what they do.',
    });
    const wheel = controller(app, 'FANATEC');
    app.ports.input.emit([held(wheel)]);
    app.ports.input.emit([held(wheel, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({ control: 'Button 5', actions: [], known: false });
  });

  it('without a setup and without any game, it says that no bindings were found', async () => {
    const { service } = await overlay('dcs-bindings-no-dcs', []);
    const state = value(await service.state());
    expect(state.source).toEqual({
      choices: [],
      problem:
        'No game whose bindings RigReady can read was found on this PC, so presses are shown without what they do.',
    });
  });

  it('a binding changed in RigReady is in the next press', async () => {
    const { app, service } = await flying();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [7])]);
    expect(actionsOf(rowsOf(service)[0])).not.toContain(TRIGGER);

    await moveTrigger(app);
    app.wiring.context.bindings.notifyChanged({ game: 'dcs' });
    await service.idle();
    app.clock.advance(1000);
    app.ports.input.emit([held(stick)]);
    app.clock.advance(1000);
    app.ports.input.emit([held(stick, [7])]);
    expect(actionsOf(rowsOf(service)[0])).toContain(TRIGGER);
  });

  it('a binding changed in the game is read again after two minutes, on a press', async () => {
    const { app, service } = await flying();
    const stick = controller(app, 'WINWING Orion');
    await moveTrigger(app);
    app.ports.input.emit([held(stick)]);

    app.clock.advance(FULL_CHECK_MS - 1);
    app.ports.input.emit([held(stick, [7])]);
    await service.idle();
    app.ports.input.emit([held(stick)]);
    expect(actionsOf(rowsOf(service)[0])).not.toContain(TRIGGER);

    app.clock.advance(1);
    app.ports.input.emit([held(stick, [10])]);
    await service.idle();
    app.ports.input.emit([held(stick, [10, 7])]);
    expect(actionsOf(rowsOf(service)[0])).toContain(TRIGGER);
  });
});

describe('each setup has its own switch for the overlay', () => {
  const XPLANE =
    'RigReady cannot read the bindings of X-Plane 12, so the overlay cannot say what a press does.';
  const NO_IRACING =
    'The bindings of iRacing were not found on this PC, so the overlay cannot say what a press does.';

  it('on to begin with where RigReady can read the game’s bindings, off with the reason where it cannot', async () => {
    const { app, service } = await overlay();
    const { profiles } = app.wiring.context;
    // A game with no binding reader, and one whose reader finds nothing on this PC.
    value(await profiles.save(setup('xplane', 'X-Plane evening', { game: 'x-plane-12' })));
    value(await profiles.save(setup('sunday-race', 'Sunday race', { game: 'iracing' })));
    const state = value(await service.state());
    expect(state.setups).toEqual([
      { id: 'dcs-bindings-hornet', name: 'DCS F/A-18C', on: true, chosen: false },
      { id: 'sunday-race', name: 'Sunday race', on: false, chosen: false, why: NO_IRACING },
      { id: 'xplane', name: 'X-Plane evening', on: false, chosen: false, why: XPLANE },
    ]);

    // What the setup editor is told for a game, and whether the overlay itself is on.
    expect(value(await service.setupDefault({ game: 'dcs' }))).toEqual({
      startsOn: true,
      overlayOn: false,
    });
    expect(value(await service.setupDefault({ game: 'x-plane-12' }))).toEqual({
      startsOn: false,
      why: XPLANE,
      overlayOn: false,
    });
    expect(value(await service.setupDefault({ game: 'other', gameName: 'Falcon BMS' }))).toEqual({
      startsOn: false,
      why: 'RigReady cannot read the bindings of Falcon BMS, so the overlay cannot say what a press does.',
      overlayOn: false,
    });
    // A setup for no game in particular: the one game whose bindings are here.
    expect(value(await service.setupDefault({}))).toMatchObject({ startsOn: true });
    value(await service.setOn(true));
    expect(value(await service.setupDefault({ game: 'iracing' }))).toEqual({
      startsOn: false,
      why: NO_IRACING,
      overlayOn: true,
    });
  });

  it('down when a setup that has it off is played, and up again with one that has it on, at once', async () => {
    const { app, service, seen } = await flying();
    const { profiles } = app.wiring.context;
    expect(app.ports.overlays.panels.size).toBe(1);
    value(await profiles.save(setup('sunday-race', 'Sunday race', { game: 'iracing' })));
    value(await profiles.setLastProfileId('sunday-race'));
    await service.idle();

    // Nothing pressed, the page not opened: it went with the setup all the same.
    expect(app.ports.overlays.panels.size).toBe(0);
    const down = seen.changed.at(-1)!;
    expect(down).toMatchObject({
      on: true,
      offInSetup: { id: 'sunday-race', name: 'Sunday race' },
    });
    expect(down.input).toBeUndefined();
    expect(down.widgets[0]).toMatchObject({ showing: false });
    expect(down.widgets[0]!.problem).toBeUndefined();
    // The preview shows its examples again, as while it is off.
    expect(down.widgets[0]!.examples).toHaveLength(2);
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)).toEqual([]);
    // Placing it by hand needs it up.
    expect(await service.move(RECENT_PRESSES, true)).toMatchObject({
      ok: false,
      error: {
        code: 'overlay.offInSetup',
        message:
          'The overlay is off in the setup in use, “Sunday race”. Turn it on in that setup first.',
      },
    });
    // The overlay's own switch was not touched.
    expect((await savedSettings(app)).on).toBe(true);

    value(await profiles.setLastProfileId('dcs-bindings-hornet'));
    await service.idle();
    expect(app.ports.overlays.panels.size).toBe(1);
    const up = seen.changed.at(-1)!;
    expect(up.offInSetup).toBeUndefined();
    expect(up.widgets[0]).toMatchObject({ showing: true });
    expect(up.widgets[0]!.examples).toBeUndefined();
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(actionsOf(rowsOf(service)[0])).toEqual([TRIGGER]);
  });

  it('the user’s switch in the setup goes before what its game gives, both ways', async () => {
    const { app, service, seen } = await flying();
    const { profiles } = app.wiring.context;
    const hornet = value(await profiles.get('dcs-bindings-hornet'));
    const read = vi.spyOn(app.wiring.context.bindings.get('dcs')!, 'bindings');

    // Off in the Hornet setup, whose bindings RigReady reads: down, and said so.
    value(await profiles.save({ ...hornet, extensions: { overlay: { on: false } } }));
    await service.idle();
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(seen.changed.at(-1)!.setups).toEqual([
      { id: 'dcs-bindings-hornet', name: 'DCS F/A-18C', on: false, chosen: true },
    ]);
    // The bindings were not read again for a change of the switch alone.
    expect(read).not.toHaveBeenCalled();
    expect(seen.changed.at(-1)!.source.aircraft).toMatchObject({ id: 'FA-18C_hornet' });

    // On in a setup for a game RigReady cannot read: up, presses without what they do.
    value(await profiles.save(setup('xplane', 'X-Plane evening', { game: 'x-plane-12' }, true)));
    value(await profiles.setLastProfileId('xplane'));
    await service.idle();
    expect(app.ports.overlays.panels.size).toBe(1);
    const state = value(await service.state());
    expect(state.setups.find((s) => s.id === 'xplane')).toEqual({
      id: 'xplane',
      name: 'X-Plane evening',
      on: true,
      chosen: true,
      why: XPLANE,
    });
    expect(state.offInSetup).toBeUndefined();
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)[0]).toMatchObject({ control: 'Button 5', actions: [], known: false });
  });

  it('at the owner’s desk: on in the flight and the racing setup, off in X-Plane, and the Dell is off in both layouts', async () => {
    app = await wiredApp('overlay-setups', {
      files: [...BINDING_FILES, 'Documents/iRacing/**', 'Program Files (x86)/Steam/steamapps/**'],
    });
    const { service } = make(app);
    const state = value(await service.setOn(true));
    expect(state.setups).toEqual([
      { id: 'dcs-f-a-18c', name: 'DCS F/A-18C', on: true, chosen: false },
      { id: 'racing-iracing', name: 'iRacing', on: true, chosen: false },
      { id: 'overlay-x-plane', name: 'X-Plane evening', on: false, chosen: false, why: XPLANE },
    ]);
    // The Dell is the main screen at the desk: put on it, it is warned about.
    const dell = state.screens.find((s) => s.name === 'DELL G3223D')!;
    expect(dell.primary).toBe(true);
    const put = value(
      await service.place(RECENT_PRESSES, { screen: dell.id, at: { x: 0.5, y: 1 } })
    );
    expect(put.widgets[0]!.place.offIn).toEqual([{ setup: 'DCS F/A-18C' }, { setup: 'iRacing' }]);
  });

  /**
   * The overlay turned on over the Hornet setup, which never had its switch set, with the
   * controllers it listens to counted; then the bindings of DCS are gone from the PC, so the
   * setup's switch is off from then on.
   */
  async function bindingsGoAway(): Promise<Made & { listening: () => number }> {
    const made = await overlay();
    let listening = 0;
    const input = made.app.ports.input;
    const subscribe = input.subscribe.bind(input);
    vi.spyOn(input, 'subscribe').mockImplementation((listener) => {
      listening++;
      const stop = subscribe(listener);
      return () => {
        listening--;
        stop();
      };
    });
    value(await made.service.setOn(true));
    expect(made.app.ports.overlays.panels.size).toBe(1);
    expect(listening).toBe(1);
    vi.spyOn(made.app.wiring.context.bindings.get('dcs')!, 'available').mockResolvedValue(false);
    return { ...made, listening: () => listening };
  }

  /** What the page and the windows were last told is what is up, and nothing is read for it. */
  function downAndSaidSo(made: Made & { listening: () => number }): void {
    const { app, service, seen, listening } = made;
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(listening()).toBe(0);
    const told = seen.changed.at(-1)!;
    expect(told.offInSetup).toEqual({ id: 'dcs-bindings-hornet', name: 'DCS F/A-18C' });
    expect(told.widgets[0]!.showing).toBe(false);
    expect(told.input).toBeUndefined();
    expect(value(service.current())).toEqual(told);
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    expect(rowsOf(service)).toEqual([]);
  }

  it('bindings gone while it is up: a bindings change takes it down before anyone is told', async () => {
    const made = await bindingsGoAway();
    made.app.wiring.context.bindings.notifyChanged({ game: 'dcs' });
    await made.service.idle();
    downAndSaidSo(made);
  });

  it('bindings gone while it is up: choosing an aircraft takes it down, also when the choice is refused', async () => {
    const made = await bindingsGoAway();
    const refused = await made.service.chooseAircraft('UH-1H');
    expect(refused).toMatchObject({ ok: false, error: { code: 'overlay.aircraft' } });
    downAndSaidSo(made);
  });

  it('turned off on the Overlay page it shows in no setup, and nothing is done when setups change', async () => {
    const { app, service, seen } = await overlay();
    const { profiles } = app.wiring.context;
    value(await service.state());
    const told = seen.changed.length;
    value(await profiles.save(setup('xplane', 'X-Plane evening', { game: 'x-plane-12' }, true)));
    value(await profiles.setLastProfileId('xplane'));
    await service.idle();
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(seen.changed).toHaveLength(told);
    // The page reads them when it opens.
    const state = value(await service.state());
    expect(state.offInSetup).toBeUndefined();
    expect(state.source.setup).toEqual({ id: 'xplane', name: 'X-Plane evening' });
  });

  it('quit, it no longer hears of setups', async () => {
    const { app, service, seen } = await flying();
    await service.dispose();
    const told = seen.changed.length;
    value(
      await app.wiring.context.profiles.save(setup('xplane', 'X-Plane', { game: 'x-plane-12' }))
    );
    value(await app.wiring.context.profiles.setLastProfileId('xplane'));
    await service.idle();
    expect(app.ports.overlays.panels.size).toBe(0);
    expect(seen.changed).toHaveLength(told);
  });
});

describe('the examples the page shows while the overlay is off', () => {
  it('two lines from the bindings in use, as a press of those buttons shows; they are no presses', async () => {
    const { app, service, seen } = await overlay();
    const state = value(await service.state());
    expect(state.on).toBe(false);
    expect(state.widgets[0]!.examples).toEqual(HORNET_EXAMPLES);
    // Nothing was pressed, and no window is there to show anything in.
    expect(rowsOf(service)).toEqual([]);
    expect(seen.presses).toEqual([]);
    expect(app.ports.overlays.panels.size).toBe(0);
  });

  it('a press of the first of them shows the same words once the overlay is on', async () => {
    const { app, service } = await flying();
    const [first] = HORNET_EXAMPLES;
    const panel = controller(app, 'WINWING UFC1');
    app.ports.input.emit([held(panel)]);
    app.ports.input.emit([held(panel, [1])]);
    const [row] = rowsOf(service);
    expect({
      control: row!.control,
      device: row!.device,
      actions: row!.actions,
      known: row!.known,
    }).toEqual(first);
  });

  it('turned on there are none, in what the page is told and in what a window is; turned off they are back', async () => {
    const { app, service, seen } = await overlay();
    const on = value(await service.setOn(true));
    expect('examples' in on.widgets[0]!).toBe(false);
    const stick = controller(app, 'WINWING Orion');
    app.ports.input.emit([held(stick)]);
    app.ports.input.emit([held(stick, [5])]);
    // The window of the overlay asks for the state as the page does.
    expect('examples' in value(await service.state()).widgets[0]!).toBe(false);
    expect('examples' in value(service.current()).widgets[0]!).toBe(false);
    const whileOn = seen.changed.filter((state) => state.on);
    expect(whileOn.length).toBeGreaterThan(0);
    for (const state of whileOn) {
      for (const widget of state.widgets) expect('examples' in widget).toBe(false);
    }
    // What is pressed is what is listed, and nothing else.
    expect(seen.presses.flat().map((row) => row.control)).toEqual(['Button 5']);

    const off = value(await service.setOn(false));
    expect(off.widgets[0]!.examples).toEqual(HORNET_EXAMPLES);
    expect(rowsOf(service)).toEqual([]);
  });

  it('they name a controller as the user named it, and are those of the aircraft chosen', async () => {
    const { app, service } = await overlay('cheat-sheets-hornet');
    // On this rig the stick and the throttle have names; the panel gets one here.
    const file = path.join(app.ports.folders.dataRoot(), 'devices.json');
    const kept = JSON.parse(await fs.readFile(file, 'utf8')) as { names: unknown[] };
    kept.names.push({ vendorId: '4098', productId: 'BEDE', name: 'Up front' });
    await fs.writeFile(file, JSON.stringify(kept));
    const state = value(await service.state());
    expect(state.widgets[0]!.examples).toEqual(
      HORNET_EXAMPLES.map((line) => ({ ...line, device: 'Up front' }))
    );
    const huey = value(await service.chooseAircraft('UH-1H'));
    expect(huey.widgets[0]!.examples).toHaveLength(2);
    expect(huey.widgets[0]!.examples).not.toEqual(state.widgets[0]!.examples);
    for (const line of huey.widgets[0]!.examples!) {
      expect(line.known).toBe(true);
      expect(line.actions.length).toBeGreaterThan(0);
    }
  });

  it('on a PC with no game: a button and a hat as a press shows them there, and no hardware by name', async () => {
    const { service } = await overlay('dcs-bindings-no-dcs', []);
    const state = value(await service.state());
    expect(state.widgets[0]!.examples).toEqual([
      { control: 'Button 1', device: 'Your controller', actions: [], known: false },
      { control: 'Hat 1 up', device: 'Your controller', actions: [], known: false },
    ]);
  });
});

describe('controllers that are not the user’s hands', () => {
  const pad = {
    op: 'plugDevice',
    device: {
      instanceId: 'USB\\VID_045E&PID_028E\\01',
      vendorId: '045E',
      productId: '028E',
      name: 'Xbox 360 Controller for Windows',
      isHid: true,
      isGameController: true,
      isHub: false,
      hubChain: [],
    },
    controller: {
      name: 'Controller (XBOX 360 For Windows)',
      guid: 'BBBBBBBB-0000-0000-0000-444553540000',
      productGuid: '',
      vendorId: '045E',
      productId: '028E',
      axisNames: [],
    },
  };

  it('the virtual controller RigReady itself plugged in is not shown: it repeats the real ones', async () => {
    const { app, service } = await overlay();
    await mutate(app, [pad]);
    value(await app.ports.pads.plug('xbox360', 'RigReady'));
    value(await service.setOn(true));

    const virtual = controller(app, 'Controller (XBOX');
    app.ports.input.emit([held(virtual)]);
    app.ports.input.emit([held(virtual, [1])]);
    expect(rowsOf(service)).toEqual([]);

    // A real gamepad of that make, once RigReady's own is unplugged, is a controller like any.
    value(await app.ports.pads.unplug());
    app.clock.advance(QUICK_CHECK_MS);
    app.ports.input.emit([held(virtual)]);
    await service.idle();
    app.ports.input.emit([held(virtual, [2])]);
    expect(rowsOf(service).map((r) => r.control)).toEqual(['Button 2']);
  });
});

/** The game's own file changes: the trigger's second detent moves from button 5 to button 7. */
async function moveTrigger(on: WiredApp): Promise<void> {
  const file = await diffFile(on.home, 'WINWING Orion');
  const text = await fs.readFile(file, 'utf8');
  const moved = text.replace('["key"] = "JOY_BTN5",', '["key"] = "JOY_BTN7",');
  if (moved === text) throw new Error('The recorded stick file has no JOY_BTN5');
  await fs.writeFile(file, moved);
}
