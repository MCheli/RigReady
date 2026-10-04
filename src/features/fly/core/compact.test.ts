import { afterEach, describe, expect, it } from 'vitest';
import type { DisplayInfo } from '../../../shared/models';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { FlyState } from '../contract';

/**
 * The compact view's side of the main process: the small window it opens in, the way back
 * to the full window, and the word every window gets when the setup in use changes.
 */
let app: WiredApp;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
});

async function monitors(): Promise<DisplayInfo[]> {
  const layout = await app.ports.displays.read();
  if (!layout.ok) throw new Error(layout.error.message);
  return layout.value.displays;
}
const area = ({ x, y, width, height }: DisplayInfo): object => ({ x, y, width, height });

describe('the compact view', () => {
  it('opens as one small window that stays on top, on its own route', async () => {
    app = await wiredApp('fly-two-setups');
    expect(await app.invoke('fly:openCompact')).toEqual({ opened: true });
    expect(app.ports.window.panels).toEqual([
      {
        id: 'fly-compact',
        route: '/fly/compact?panel=1',
        title: 'RigReady compact',
        width: 400,
        height: 336,
        alwaysOnTop: true,
      },
    ]);
    // Asked for again it is the same window (one per id), brought forward by the port.
    await app.invoke('fly:openCompact');
    expect(app.ports.window.panels.map((panel) => panel.id)).toEqual([
      'fly-compact',
      'fly-compact',
    ]);
  });

  it('brings the full window back on a monitor that is on, the main one first', async () => {
    app = await wiredApp('fly-two-setups');
    const all = await monitors();
    const on = all.filter((d) => d.enabled);
    expect(on.length).toBeGreaterThan(1);
    const main = on.find((d) => d.primary)!;

    expect(await app.invoke('fly:showMain')).toEqual({ shown: true });
    const [first] = app.ports.window.shown;
    expect(first).toHaveLength(on.length);
    expect(first![0]).toEqual(area(main));
    expect(first).toEqual(expect.arrayContaining(on.map(area)));

    // A monitor a game layout switched off is not somewhere to show a window.
    const off = on.find((d) => !d.primary)!;
    await mutate(app, [{ op: 'setDisplay', match: { id: off.id }, set: { enabled: false } }]);
    await app.invoke('fly:showMain');
    const second = app.ports.window.shown[1]!;
    expect(second).toHaveLength(on.length - 1);
    expect(second).not.toContainEqual(area(off));
  });

  it('still shows the full window, where it is, when the monitors cannot be read', async () => {
    app = await wiredApp('fly-two-setups');
    await mutate(app, [{ op: 'failProvider', port: 'displays' }]);
    expect(await app.invoke('fly:showMain')).toEqual({ shown: true });
    const [areas] = app.ports.window.shown;
    expect(areas).toHaveLength(1);
    // One area that every place on the desktop is inside of.
    const [everywhere] = areas!;
    for (const d of await monitorsAfterRepair()) {
      expect(everywhere!.x).toBeLessThan(d.x);
      expect(everywhere!.y).toBeLessThan(d.y);
      expect(everywhere!.x + everywhere!.width).toBeGreaterThan(d.x + d.width);
      expect(everywhere!.y + everywhere!.height).toBeGreaterThan(d.y + d.height);
    }
  });

  it('tells every window when the setup in use changes, and only then', async () => {
    app = await wiredApp('fly-two-setups');
    const state = await app.invoke<FlyState>('fly:state');
    const active = state.activeProfileId!;
    const other = state.profiles.find((p) => p.id !== active)!.id;
    const told = (): unknown[] =>
      app.events.filter((e) => e.channel === 'fly:event:activeChanged').map((e) => e.payload);

    // Checking the setup that is in use already is not a switch.
    await app.invoke('fly:check', { profileId: active });
    expect(told()).toEqual([]);
    // A refresh in the background (another window, the tray) is not one either.
    await app.invoke('fly:check', { profileId: other, remember: false });
    expect(told()).toEqual([]);

    await app.invoke('fly:check', { profileId: other });
    expect(told()).toEqual([{ profileId: other }]);
    await app.invoke('fly:check', { profileId: other });
    expect(told()).toHaveLength(1);
    expect((await app.invoke<FlyState>('fly:state')).activeProfileId).toBe(other);

    await app.invoke('fly:check', { profileId: active });
    expect(told()).toEqual([{ profileId: other }, { profileId: active }]);
  });

  it('the first setup ever noted as in use is not a switch', async () => {
    // Nothing is remembered yet: every window opened on this setup already.
    app = await wiredApp('flying-all-good');
    const state = await app.invoke<FlyState>('fly:state');
    expect(await app.wiring.context.profiles.lastProfileId()).toBeUndefined();
    await app.invoke('fly:check', { profileId: state.activeProfileId! });
    expect(await app.wiring.context.profiles.lastProfileId()).toBe(state.activeProfileId);
    expect(app.events.filter((e) => e.channel === 'fly:event:activeChanged')).toEqual([]);
  });
});

async function monitorsAfterRepair(): Promise<DisplayInfo[]> {
  await mutate(app, [{ op: 'failProvider', port: 'displays', fail: false }]);
  return monitors();
}
