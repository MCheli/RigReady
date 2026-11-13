import { afterEach, describe, expect, it } from 'vitest';
import type { OverlayPanel } from '../../src/core/ports';
import { headlessPorts } from '../../src/platform/node';
import { markFull, mutate, rigFromState, type TestRig } from '../helpers';

let rig: TestRig | undefined;
afterEach(async () => {
  await rig?.cleanup();
  rig = undefined;
});

/** The recorded rig: a 2560x1440 main screen, a 5120x1440 ultrawide right of it, three small screens. */
const MAIN = { x: 0, y: 0, width: 2560, height: 1440 };
const WIDE = { x: 2560, y: 0, width: 5120, height: 1440 };

const panel = (over: Partial<OverlayPanel> = {}): OverlayPanel => ({
  id: 'recent-presses',
  route: '/overlay/recent-presses',
  screen: WIDE,
  width: 400,
  height: 300,
  at: { x: 1, y: 0 },
  movable: false,
  ...over,
});

describe('the overlay panels of the fake machine (ports.overlays)', () => {
  it('shows a panel on the screen asked for, at the place asked for, and answers where it is', async () => {
    rig = await rigFromState(await markFull());
    const { overlays } = rig.ports;
    expect(await overlays.showPanel(panel())).toEqual({
      ok: true,
      value: { screen: WIDE, at: { x: 1, y: 0 } },
    });
    // Top right of the ultrawide, in desktop pixels.
    expect(overlays.panels.get('recent-presses')?.box).toEqual({
      x: 2560 + 5120 - 400,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(await overlays.panelPlace('recent-presses')).toEqual({
      ok: true,
      value: { screen: WIDE, at: { x: 1, y: 0 } },
    });
    // Asked again, the one window moves: there is still one panel.
    await overlays.showPanel(panel({ at: { x: 0.5, y: 1 } }));
    expect(overlays.panels.size).toBe(1);
    expect(overlays.panels.get('recent-presses')?.box).toMatchObject({ x: 2560 + 2360, y: 1140 });
    expect(overlays.panelCalls).toHaveLength(2);
  });

  it('a screen that is off has the main screen take its place, and the answer says so', async () => {
    rig = await rigFromState(await markFull());
    await mutate(rig, [{ op: 'setDisplay', match: { name: 'LC49G95T' }, set: { enabled: false } }]);
    const shown = await rig.ports.overlays.showPanel(panel());
    expect(shown).toEqual({ ok: true, value: { screen: MAIN, at: { x: 1, y: 0 } } });
    expect(rig.ports.overlays.panels.get('recent-presses')?.box).toMatchObject({ x: 2160, y: 0 });
  });

  it('only a panel that is being placed can be dragged; its place is read back from where it was dropped', async () => {
    rig = await rigFromState(await markFull());
    const { overlays } = rig.ports;
    await overlays.showPanel(panel());
    expect(overlays.drag('recent-presses', { x: 100, y: 100 })).toBe(false);
    expect(overlays.drag('something-else', { x: 100, y: 100 })).toBe(false);

    await overlays.showPanel(panel({ movable: true }));
    // Dropped on the main screen, at its bottom left corner.
    expect(overlays.drag('recent-presses', { x: 0, y: 1140 })).toBe(true);
    expect(await overlays.panelPlace('recent-presses')).toEqual({
      ok: true,
      value: { screen: MAIN, at: { x: 0, y: 1 } },
    });
  });

  it('hiding takes it away, and a panel that is not shown has no place', async () => {
    rig = await rigFromState(await markFull());
    const { overlays } = rig.ports;
    await overlays.showPanel(panel());
    expect(await overlays.hidePanel('recent-presses')).toEqual({ ok: true, value: undefined });
    expect(overlays.panels.size).toBe(0);
    expect(await overlays.panelPlace('recent-presses')).toEqual({ ok: true, value: undefined });
    // Hiding what is not there is not an error.
    expect((await overlays.hidePanel('recent-presses')).ok).toBe(true);
  });

  it('a window Windows refuses is an error, and with no monitor on there is nowhere to show it', async () => {
    rig = await rigFromState(await markFull());
    const { overlays } = rig.ports;
    overlays.panelFailure = { code: 'overlay.panel', message: 'Could not show the overlay.' };
    expect(await overlays.showPanel(panel())).toEqual({
      ok: false,
      error: { code: 'overlay.panel', message: 'Could not show the overlay.' },
    });
    expect(overlays.panels.size).toBe(0);
    overlays.panelFailure = undefined;

    rig.ports.state.displays = [];
    expect(await overlays.showPanel(panel())).toMatchObject({
      ok: false,
      error: { code: 'overlay.screen' },
    });
  });
});

describe('outside the app (a script, the MCP bridge) there is no overlay', () => {
  it('says that it is only available inside the app, for the labels and for the panels', async () => {
    const { overlays } = headlessPorts;
    for (const answer of [
      await overlays.showLabels([], 1000),
      await overlays.showPanel(panel()),
      await overlays.panelPlace('recent-presses'),
      await overlays.hidePanel('recent-presses'),
    ]) {
      expect(answer.ok).toBe(false);
    }
  });
});
