import { describe, expect, it } from 'vitest';
import { carryPairing, describeUnsure, uncertainPlacements, usesUnchecked } from './pairingChange';
import type { DesktopDisplay, Placement, ScreenSetup } from './screens';
import type { PlanScreen } from './simAppProImport';

const monitor = (id: string, x: number, width: number, height: number): DesktopDisplay => ({
  id,
  name: id,
  x,
  y: 0,
  width,
  height,
  rotation: 0,
  primary: id === 'wide',
});
const desktop = [
  monitor('wide', 0, 5120, 1440),
  monitor('a', 5120, 768, 1024),
  monitor('b', 5888, 768, 1024),
  monitor('c', 6656, 768, 1024),
  monitor('small', 7424, 640, 480),
];
const PLAN_CROP = { left: 8, top: 256, right: 8, bottom: 6 };
const on = (name: string, displayId: string, crop = PLAN_CROP): Placement => ({
  name,
  displayId,
  crop,
});
const hornet = (placements: Placement[], main = ['wide']): ScreenSetup => ({
  mainDisplayIds: main,
  aircraft: [{ unit: 'FA-18C_hornet', label: 'F/A-18C Hornet', placements }],
  desktop,
  desktopLabel: 'Current monitors',
});
const byName = (setup: ScreenSetup, unit = 'FA-18C_hornet'): Record<string, Placement> =>
  Object.fromEntries(
    setup.aircraft.find((a) => a.unit === unit)!.placements.map((p) => [p.name, p])
  );

describe('a corrected pairing keeps what the user did since the import', () => {
  // The import put the left display on a and the right one on c; the user says they are swapped.
  const before = hornet([on('LEFT_MFCD', 'a'), on('CENTER_MFCD', 'b'), on('RIGHT_MFCD', 'c')]);
  const after = hornet([on('LEFT_MFCD', 'c'), on('CENTER_MFCD', 'b'), on('RIGHT_MFCD', 'a')]);

  it('moves the two swapped displays and takes the crop the user set along', () => {
    const mine = { left: 8, top: 240, right: 8, bottom: 6 };
    const current = hornet([
      on('LEFT_MFCD', 'a', mine),
      on('CENTER_MFCD', 'b', { left: 0, top: 100, right: 0, bottom: 0 }),
      on('RIGHT_MFCD', 'c'),
    ]);
    const carried = carryPairing(before, after, current);
    expect(carried.notes).toEqual([]);
    expect(byName(carried.setup)).toEqual({
      // Moved with the user's crop: a and c are the same size.
      LEFT_MFCD: on('LEFT_MFCD', 'c', mine),
      // Not part of the correction: the user's crop stays as it is.
      CENTER_MFCD: on('CENTER_MFCD', 'b', { left: 0, top: 100, right: 0, bottom: 0 }),
      RIGHT_MFCD: on('RIGHT_MFCD', 'a'),
    });
    // The page's own setup is not changed underneath it.
    expect(byName(current)['LEFT_MFCD']!.displayId).toBe('a');
  });

  it('leaves alone a display the user moved or took off by hand', () => {
    const current = hornet([on('LEFT_MFCD', 'b'), on('CENTER_MFCD', 'a')]);
    const carried = carryPairing(before, after, current);
    expect(byName(carried.setup)).toEqual({
      // The user put it on b: the correction of a and c does not take it from there.
      LEFT_MFCD: on('LEFT_MFCD', 'b'),
      CENTER_MFCD: on('CENTER_MFCD', 'a'),
      // RIGHT_MFCD was set to "Not shown" by the user and stays so.
    });
  });

  it('keeps aircraft, displays and main screens the user added', () => {
    const current: ScreenSetup = {
      ...hornet(
        [on('LEFT_MFCD', 'a'), on('CENTER_MFCD', 'b'), on('RIGHT_MFCD', 'c'), on('IFEI', 'small')],
        ['wide', 'small']
      ),
    };
    current.aircraft.push({
      unit: 'UH-1H',
      label: 'UH-1H Huey',
      placements: [on('EXTRA', 'b', { left: 0, top: 0, right: 0, bottom: 0 })],
    });
    const carried = carryPairing(before, after, current);
    expect(carried.setup.mainDisplayIds).toEqual(['wide', 'small']);
    expect(byName(carried.setup)['IFEI']).toEqual(on('IFEI', 'small'));
    expect(byName(carried.setup)['LEFT_MFCD']!.displayId).toBe('c');
    expect(carried.setup.aircraft.map((a) => a.unit)).toEqual(['FA-18C_hornet', 'UH-1H']);
    expect(byName(carried.setup, 'UH-1H')['EXTRA']!.displayId).toBe('b');
  });

  it('does not bring back an aircraft the user removed', () => {
    const current: ScreenSetup = { ...hornet([]), aircraft: [] };
    expect(carryPairing(before, after, current).setup.aircraft).toEqual([]);
  });

  it('takes a display off when its screen is now left out, and puts it on when it is paired', () => {
    const leftOut = hornet([on('CENTER_MFCD', 'b'), on('RIGHT_MFCD', 'c')]);
    const current = hornet([
      on('LEFT_MFCD', 'a', { left: 1, top: 2, right: 3, bottom: 4 }),
      on('CENTER_MFCD', 'b'),
      on('RIGHT_MFCD', 'c'),
    ]);
    const without = carryPairing(before, leftOut, current);
    expect(Object.keys(byName(without.setup)).sort()).toEqual(['CENTER_MFCD', 'RIGHT_MFCD']);
    // And back: the screen is paired again, so the plan's placement is added as the import makes it.
    const again = carryPairing(leftOut, before, without.setup);
    expect(byName(again.setup)['LEFT_MFCD']).toEqual(on('LEFT_MFCD', 'a'));
  });

  it('says so when a crop the user set cannot go along to a screen of another size', () => {
    const toSmall = hornet([
      on('LEFT_MFCD', 'small'),
      on('CENTER_MFCD', 'b'),
      on('RIGHT_MFCD', 'c'),
    ]);
    const mine = { left: 8, top: 240, right: 8, bottom: 6 };
    const current = hornet([on('LEFT_MFCD', 'a', mine), on('RIGHT_MFCD', 'c')]);
    const carried = carryPairing(before, toSmall, current);
    expect(byName(carried.setup)['LEFT_MFCD']).toEqual(
      on('LEFT_MFCD', 'small', { left: 0, top: 0, right: 0, bottom: 0 })
    );
    expect(carried.notes).toEqual([
      'Left DDI: the crop you set was not kept, because the screen it is on now is another size. Set it again.',
    ]);
    // A crop the user never touched is the plan's, and the import's own answer is taken as it is.
    const untouched = carryPairing(before, toSmall, before);
    expect(byName(untouched.setup)['LEFT_MFCD']).toEqual(on('LEFT_MFCD', 'small'));
    expect(untouched.notes).toEqual([]);
  });

  it('moves the main view with its screen and leaves the other main screens', () => {
    const mainOnA = hornet([on('LEFT_MFCD', 'wide')], ['a']);
    const mainOnWide = hornet([on('LEFT_MFCD', 'a')], ['wide']);
    const current = hornet([on('LEFT_MFCD', 'wide')], ['a', 'b']);
    const carried = carryPairing(mainOnA, mainOnWide, current);
    expect(carried.setup.mainDisplayIds.sort()).toEqual(['b', 'wide']);
    expect(byName(carried.setup)['LEFT_MFCD']!.displayId).toBe('a');
    // Never without a main screen: when the correction takes the last one, the import's own stay.
    const fewer = carryPairing(hornet([], ['a', 'b']), hornet([], ['a']), hornet([], ['b']));
    expect(fewer.setup.mainDisplayIds).toEqual(['a']);
  });
});

describe('what an import was not sure of', () => {
  const screen = (
    planId: string,
    displayId: string | undefined,
    certain: boolean,
    shows: string[],
    main = false
  ): PlanScreen => ({
    planId,
    main,
    shows,
    ...(displayId ? { displayId } : {}),
    how: displayId ? 'position' : 'none',
    certain,
    note: '',
  });
  const setup = hornet([on('LEFT_MFCD', 'a'), on('CENTER_MFCD', 'b'), on('RIGHT_MFCD', 'small')]);
  const screens = [
    screen('001', 'wide', true, ['Main view'], true),
    screen('002', 'a', false, ['Left DDI']),
    screen('003', 'b', false, ['AMPCD']),
    screen('004', 'small', true, ['Right DDI']),
  ];

  it('is every display on a monitor whose pairing is not certain, and nothing else', () => {
    const pending = uncertainPlacements(setup, screens);
    expect(pending).toHaveLength(2);
    expect(usesUnchecked(pending, setup, undefined)).toBe(true);
    // Without the two displays nobody is sure of, there is nothing to ask about.
    expect(usesUnchecked(pending, hornet([on('RIGHT_MFCD', 'small')]), undefined)).toBe(false);
    // Moved by hand to another monitor: the user's own choice, not the import's guess.
    expect(
      usesUnchecked(pending, hornet([on('LEFT_MFCD', 'c'), on('CENTER_MFCD', 'c')]), undefined)
    ).toBe(false);
    // One of the two is enough.
    expect(usesUnchecked(pending, hornet([on('CENTER_MFCD', 'b')]), undefined)).toBe(true);
  });

  it('does not ask again about what the setup in use already has', () => {
    const pending = uncertainPlacements(setup, screens);
    expect(usesUnchecked(pending, setup, setup)).toBe(false);
    expect(usesUnchecked(pending, setup, hornet([on('LEFT_MFCD', 'a')]))).toBe(true);
  });

  it('counts the main view when its own pairing is the uncertain one', () => {
    const unsureMain = [screen('001', 'wide', false, ['Main view'], true)];
    const pending = uncertainPlacements(hornet([]), unsureMain);
    expect(usesUnchecked(pending, hornet([]), undefined)).toBe(true);
    expect(usesUnchecked(pending, hornet([], ['a']), undefined)).toBe(false);
  });

  it('counts everything when one of the screens found no monitor at all', () => {
    const pending = uncertainPlacements(hornet([on('LEFT_MFCD', 'a')]), [
      screen('001', 'wide', true, ['Main view'], true),
      screen('002', 'a', true, ['Left DDI']),
      screen('004', undefined, false, ['Right DDI']),
    ]);
    expect(usesUnchecked(pending, hornet([]), undefined)).toBe(true);
    expect(usesUnchecked(pending, hornet([], ['b']), undefined)).toBe(false);
  });

  it('is nothing when every pairing is certain', () => {
    const sure = screens.map((s) => ({ ...s, certain: true }));
    expect(uncertainPlacements(setup, sure)).toEqual([]);
  });

  it('names the pairings it is not sure of in one line', () => {
    const lost = [...screens, screen('009', undefined, false, [])];
    expect(describeUnsure(lost, (id) => `"${id}"`)).toBe(
      'Left DDI on "a"; AMPCD on "b"; SimAppPro\'s screen 009 on no screen'
    );
  });
});
