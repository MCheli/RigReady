import { describe, expect, it } from 'vitest';
import type { DesktopDisplay } from './screens';
import { importSimAppPro, sideOf, type PlanScreen, type SimAppProPlan } from './simAppProImport';

/**
 * SimAppPro's plan as it was on the owner's rig: the main view on the ultrawide, and three
 * small screens it knows only by where they were. In the plan the Hornet's left display is
 * on the screen at 5888, the right one at 5120 and the centre one at 6656.
 */
const PLAN = {
  currentMod: 'FA-18C',
  mainMonitorInfoById: { '005': { left: 0, top: 0, width: 5120, height: 1440 } },
  usbMonitorInfoById: {
    '002': { left: 5888, top: 0, width: 768, height: 1024 },
    '003': { left: 6656, top: 0, width: 768, height: 1024 },
    '004': { left: 5120, top: 0, width: 768, height: 1024 },
  },
  gameViewports: { Center: { id: ['005'] } },
  modsInfo: {
    'FA-18C': {
      instruments: {
        LEFT_MFCD: {
          id: ['002'],
          gameConfigKey: 'LEFT_MFCD',
          tailorMonitor: { left: 8, top: 256, right: -8, bottom: -6 },
        },
        RIGHT_MFCD: {
          id: ['004'],
          gameConfigKey: 'RIGHT_MFCD',
          tailorMonitor: { left: 8, top: 256, right: -8, bottom: -6 },
        },
        CENTER_MFCD: {
          id: ['003'],
          gameConfigKey: 'CENTER_MFCD',
          tailorMonitor: { left: 8, top: 256, right: -8, bottom: -6 },
        },
      },
    },
  },
};

const screen = (
  id: string,
  name: string,
  x: number,
  width = 768,
  height = 1024
): DesktopDisplay => ({
  id,
  name,
  x,
  y: 0,
  width,
  height,
  rotation: 0,
  primary: x === 0,
});

/** The rig with the small screens as Windows names them: nothing tells them apart. */
const UNNAMED = [
  screen('wide', 'LC49G95T', 0, 5120, 1440),
  screen('a', 'USB_Monitor', 5120),
  screen('b', 'USB_Monitor', 5888),
  screen('c', 'USB_Monitor', 6656),
];

/** The same rig after the owner named the screens as they stand: left, centre, right. */
const NAMED = [
  screen('wide', 'Ultrawide', 0, 5120, 1440),
  screen('a', 'MFD left', 5120),
  screen('b', 'MFD centre', 5888),
  screen('c', 'MFD right', 6656),
];

function plan(
  desktop: DesktopDisplay[],
  chosen?: Record<string, string | null>,
  json: unknown = PLAN
): SimAppProPlan {
  const result = importSimAppPro(json, desktop, chosen);
  if (!result.ok) throw new Error(result.message);
  return result.plan;
}

const placed = (p: SimAppProPlan): Record<string, string> =>
  Object.fromEntries(p.aircraft[0]!.placements.map((x) => [x.name, x.displayId]));
const byPlanId = (p: SimAppProPlan): Record<string, PlanScreen> =>
  Object.fromEntries(p.screens.map((s) => [s.planId, s]));

describe('which side a name speaks of', () => {
  it('reads one side from the names people and DCS use', () => {
    expect(sideOf('MFD left')).toBe('left');
    expect(sideOf('LEFT_MFCD')).toBe('left');
    expect(sideOf('Right DDI')).toBe('right');
    expect(sideOf('MFD centre')).toBe('centre');
    expect(sideOf('CENTER_MFCD')).toBe('centre');
    expect(sideOf('middle screen')).toBe('centre');
  });

  it('reads none from a name that speaks of two sides or of no side', () => {
    expect(sideOf('Left of the right one')).toBeUndefined();
    expect(sideOf('USB_Monitor')).toBeUndefined();
    expect(sideOf('Leftover')).toBeUndefined();
    expect(sideOf('')).toBeUndefined();
  });
});

describe("pairing SimAppPro's screens with monitors", () => {
  it('follows the names the user gave the screens when the plan is from another order', () => {
    const p = plan(NAMED);
    // By position alone the left display would go to the centre screen, the right one to
    // the left screen and the centre one to the right screen: the fault of the sitting.
    expect(placed(p)).toEqual({ LEFT_MFCD: 'a', RIGHT_MFCD: 'c', CENTER_MFCD: 'b' });
    expect(p.mainDisplayIds).toEqual(['wide']);
    expect(p.unmatched).toEqual([]);
    expect(p.certain).toBe(false);
    const screens = byPlanId(p);
    expect(screens['005']).toMatchObject({ main: true, how: 'position', certain: true });
    expect(screens['005']!.shows).toEqual(['Main view']);
    expect(screens['002']).toMatchObject({
      displayId: 'a',
      how: 'name',
      certain: false,
      shows: ['Left DDI'],
      aircraft: 'F/A-18C Hornet',
      rect: { x: 5888, y: 0, width: 768, height: 1024 },
      note: "Matched by the name you gave the screen. SimAppPro's plan has it where MFD centre is now, so the plan is from before the screens were put in this order.",
    });
    expect(screens['004']).toMatchObject({ displayId: 'c', how: 'name', certain: false });
    expect(screens['004']!.note).toContain('where MFD left is now');
    expect(screens['003']).toMatchObject({ displayId: 'b', how: 'name', certain: false });
    // The crop SimAppPro holds goes with the display to the screen it is paired with.
    expect(p.aircraft[0]!.placements.map((x) => x.crop)).toEqual([
      { left: 8, top: 256, right: 8, bottom: 6 },
      { left: 8, top: 256, right: 8, bottom: 6 },
      { left: 8, top: 256, right: 8, bottom: 6 },
    ]);
  });

  it('is certain when the names and the plan agree', () => {
    const agree = [
      screen('wide', 'Ultrawide', 0, 5120, 1440),
      screen('a', 'MFD right', 5120),
      screen('b', 'MFD left', 5888),
      screen('c', 'MFD centre', 6656),
    ];
    const p = plan(agree);
    expect(placed(p)).toEqual({ LEFT_MFCD: 'b', RIGHT_MFCD: 'a', CENTER_MFCD: 'c' });
    expect(p.certain).toBe(true);
    expect(p.screens.filter((s) => !s.main).map((s) => [s.how, s.note])).toEqual([
      ['name', "SimAppPro's plan and the name you gave the screen agree."],
      ['name', "SimAppPro's plan and the name you gave the screen agree."],
      ['name', "SimAppPro's plan and the name you gave the screen agree."],
    ]);
  });

  it('says so when it has only the position to go by and the screens look alike', () => {
    const p = plan(UNNAMED);
    expect(placed(p)).toEqual({ LEFT_MFCD: 'b', RIGHT_MFCD: 'a', CENTER_MFCD: 'c' });
    expect(p.certain).toBe(false);
    const screens = byPlanId(p);
    expect(screens['005']).toMatchObject({
      how: 'position',
      certain: true,
      note: 'The only screen of this size, and where the plan has it.',
    });
    for (const id of ['002', '003', '004']) {
      expect(screens[id]).toMatchObject({
        how: 'position',
        certain: false,
        note: "Matched by position alone. 3 screens of this layout are the same size, and SimAppPro's plan does not say which is which.",
      });
    }
  });

  it("takes the user's own pairing over its own, and leaves out a screen they chose none for", () => {
    // The user says SimAppPro's 002 is screen c; RigReady had 004 there.
    const swapped = plan(NAMED, { '002': 'c', '004': 'a' });
    expect(placed(swapped)).toEqual({ LEFT_MFCD: 'c', RIGHT_MFCD: 'a', CENTER_MFCD: 'b' });
    const screens = byPlanId(swapped);
    expect(screens['002']).toMatchObject({
      displayId: 'c',
      how: 'chosen',
      certain: true,
      note: 'You chose this screen.',
    });
    expect(screens['004']).toMatchObject({ displayId: 'a', how: 'chosen', certain: true });
    // The one they left alone keeps RigReady's pairing and its reason.
    expect(screens['003']).toMatchObject({ displayId: 'b', how: 'name', certain: false });

    const without = plan(NAMED, { '003': null });
    expect(placed(without)).toEqual({ LEFT_MFCD: 'a', RIGHT_MFCD: 'c' });
    expect(byPlanId(without)['003']).toMatchObject({
      how: 'chosen',
      certain: true,
      note: 'Left out: you chose no screen for it.',
    });
    expect(byPlanId(without)['003']!.displayId).toBeUndefined();
    // Left out on purpose is not reported as a screen that could not be placed.
    expect(without.unmatched).toEqual([]);
  });

  it('keeps its own reason for a pairing the user confirms as it was', () => {
    const p = plan(NAMED, { '002': 'a' });
    expect(byPlanId(p)['002']).toMatchObject({ displayId: 'a', how: 'name', certain: false });
  });

  it('pairs a screen that moved with the one monitor of its size that is left, for the user to check', () => {
    const moved = [
      screen('wide', 'Ultrawide', 2560, 5120, 1440),
      screen('desk', 'Dell', 0, 2560, 1440),
    ];
    const p = plan(moved);
    expect(p.mainDisplayIds).toEqual(['wide']);
    expect(byPlanId(p)['005']).toMatchObject({
      displayId: 'wide',
      how: 'left',
      certain: false,
      note: 'The one screen of this size that was left over.',
    });
    // The three small screens are not in this layout at all.
    expect(p.aircraft).toEqual([]);
    expect(p.unmatched).toHaveLength(3);
    expect(p.unmatched[0]).toBe(
      "F/A-18C Hornet LEFT_MFCD: SimAppPro's screen 002 (768x1024 at 5888,0) is not in this monitor layout"
    );
    expect(byPlanId(p)['002']).toMatchObject({
      how: 'none',
      certain: false,
      note: "No screen of this layout fits. SimAppPro's plan has it as 768 x 1024 at 5888,0.",
    });
  });

  it('does not guess between two monitors named for the same side', () => {
    const twoLefts = [
      screen('wide', 'Ultrawide', 0, 5120, 1440),
      screen('a', 'MFD left', 5120),
      screen('b', 'Left spare', 5888),
      screen('c', 'MFD right', 6656),
    ];
    const p = plan(twoLefts);
    // The right display has one screen named for it; the left one has two, so position decides.
    expect(byPlanId(p)['004']).toMatchObject({ displayId: 'c', how: 'name' });
    expect(byPlanId(p)['002']).toMatchObject({ displayId: 'b', how: 'position', certain: false });
    expect(p.certain).toBe(false);
  });
});
