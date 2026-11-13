import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, CheckResult, ChecklistReport } from '../../../core/checks/engine';
import type { CheckItem, Profile } from '../../../core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { ScreensPreview, ScreensState } from '../contract';
import { readOptions } from './options';
import type { ScreenSetup } from './screens';
import { followFix, followItem, followSetup, valuesPhrase } from './setupFollow';

/**
 * "Use in DCS" and the setups made before it (13 Nov 2026, on the owner's rig): the MFD
 * screens were moved below the ultrawide, "Use in DCS" sized the DCS window from 7424 × 1440
 * to 5120 × 2464, and the setup "DCS F/A-18C" still expected 7424 × 1440. Its fix "Set the
 * DCS options" would have put the old window back and undone "Use in DCS".
 */

let app: WiredApp;
afterEach(() => app?.cleanup());

const FILES = [
  'Saved Games/DCS/**',
  'Program Files (x86)/Steam/**',
  'AppData/Roaming/SimAppPro/**',
  'AppData/Local/Programs/SimAppPro/**',
];
const HORNET = 'dcs-setup-hornet';
const optionsLua = (): string =>
  path.join(app.ports.folders.savedGames(), 'DCS', 'Config', 'options.lua');
const options = async () => {
  const read = readOptions(await fs.readFile(optionsLua(), 'utf8'));
  if (!read.ok) throw new Error(read.error.message);
  return read.value;
};
const setupOf = (id: string) => app.invoke<Profile>('profiles:get', { id });
const itemOf = async (id: string, itemId: string): Promise<CheckItem> =>
  (await setupOf(id)).checks.find((c) => c.id === itemId)!;
const resultOf = async (id: string, itemId: string): Promise<CheckResult> =>
  (await app.invoke<ChecklistReport>('fly:check', { profileId: id })).results.find(
    (r) => r.itemId === itemId
  )!;

/** The first "Use in DCS", on 12 Nov: SimAppPro's plan on the flying layout, MFDs right of the ultrawide. */
async function firstUse(followSetups: string[] = []): Promise<ScreenSetup> {
  const { setup } = await app.invoke<{ setup: ScreenSetup }>('dcs-setup:importSimAppPro', {
    desktopId: 'current',
  });
  await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true, followSetups });
  return setup;
}

/** 13 Nov, 13:03: the owner moves the three MFD screens below the ultrawide in the Flying layout. */
async function mfdsBelow(): Promise<void> {
  await mutate(app, [
    { op: 'setDisplay', match: { name: 'USB_Monitor', index: 0 }, set: { x: 0, y: 1440 } },
    { op: 'setDisplay', match: { name: 'USB_Monitor', index: 1 }, set: { x: 2156, y: 1440 } },
    { op: 'setDisplay', match: { name: 'USB_Monitor', index: 2 }, set: { x: 4352, y: 1440 } },
  ]);
}

/** The same screen setup on the monitors as they are now ("Monitors as they are now"). */
async function onMonitorsNow(setup: ScreenSetup): Promise<ScreenSetup> {
  const state = await app.invoke<ScreensState>('dcs-setup:screens');
  const current = state.desktops.find((d) => d.id === 'current')!;
  return { ...setup, desktop: current.displays, desktopLabel: current.label };
}

describe('setups follow "Use in DCS"', () => {
  it("the owner's sequence: offered with each change named, updated in the same change, and the check passes", async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    expect(await options()).toMatchObject({ width: 7424, height: 1440, fullScreen: false });
    const first = await firstUse();
    await mfdsBelow();
    const setup = await onMonitorsNow(first);

    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.window).toMatchObject({ width: 5120, height: 2464 });
    expect(preview.optionChanges).toEqual(
      expect.arrayContaining(['width 7424 → 5120', 'height 1440 → 2464'])
    );
    // Named, with what changes: the check and its fix. The Huey expects nothing that changes.
    expect(preview.setups).toEqual([
      {
        id: HORNET,
        name: 'DCS F/A-18C',
        items: [
          {
            itemId: 'c4',
            title: 'DCS graphics options',
            changes: ['width 7424 → 5120', 'height 1440 → 2464'],
            fix: true,
          },
        ],
      },
    ]);
    // Offering changed nothing.
    expect((await itemOf(HORNET, 'c4')).params).toMatchObject({ width: 7424, height: 1440 });

    const applied = await app.invoke<{ message: string; changes: string[] }>(
      'dcs-setup:applyScreens',
      { setup, followSetups: [HORNET] }
    );
    expect(applied.changes).toContain(
      'Updated the setup "DCS F/A-18C": DCS graphics options: width 7424 → 5120, height 1440 → 2464'
    );
    expect(await options()).toMatchObject({ width: 5120, height: 2464, fullScreen: false });
    const item = await itemOf(HORNET, 'c4');
    expect(item.params).toEqual({ width: 5120, height: 2464, fullScreen: false, vr: false });
    expect(item.remediation?.params).toEqual({
      width: 5120,
      height: 2464,
      fullScreen: false,
      vr: false,
    });
    const result = await resultOf(HORNET, 'c4');
    expect(result.status).toBe('pass');
    expect(result.summary).toBe('5120x2464, windowed, VR off');

    // One action on the Safety page: the DCS files and the setup, and one Undo takes back all.
    const groups = await app.ports.files.journalGroups();
    if (!groups.ok) throw new Error(groups.error.message);
    const used = groups.value[0]!;
    expect(used.reason).toBe('Use the RigReady screen setup in DCS');
    expect(used.entries.map((e) => path.basename(e.path)).sort()).toEqual([
      'RigReady.lua',
      `${HORNET}.yaml`,
      'options.lua',
    ]);
    const undone = await app.ports.files.undoGroup(used.id);
    expect(undone.ok).toBe(true);
    expect((await itemOf(HORNET, 'c4')).params).toMatchObject({ width: 7424, height: 1440 });
    expect(await options()).toMatchObject({ width: 7424, height: 1440 });
  });

  it('declined: the Play screen says "Use in DCS" set the values, offers to update the setup, and Make ready asks before undoing it', async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    const first = await firstUse();
    await mfdsBelow();
    const setup = await onMonitorsNow(first);
    await app.invoke('dcs-setup:applyScreens', { setup, followSetups: [] });
    expect((await itemOf(HORNET, 'c4')).params).toMatchObject({ width: 7424, height: 1440 });

    const result = await resultOf(HORNET, 'c4');
    expect(result.status).toBe('warn');
    expect(result.summary).toBe('2 options differ');
    expect(result.details).toEqual([
      'width is 5120, expected 7424',
      'height is 2464, expected 1440',
      '"Use in DCS" set width 5120 and height 2464 for the RigReady screen setup, and this setup still expects the older values. Update the setup to keep the new ones.',
    ]);
    expect(result.acknowledge).toBe('Update the setup');
    expect(result.fix).toBe('Set width, height, full screen, VR in options.lua');
    expect(result.fixWarning).toBe(
      'This fix would undo "Use in DCS": it sets width 7424 and height 1440, so DCS\'s window would no longer cover USB_Monitor (1 of 3), USB_Monitor (2 of 3) and USB_Monitor (3 of 3).'
    );

    // Make ready from the tray or the palette cannot ask: the fix is not run.
    const unasked = await app.invoke<ActionReport>('fly:makeReady', { profileId: HORNET });
    const step = unasked.steps.find((s) => s.itemId === 'c4')!;
    expect(step).toMatchObject({ ok: false, skipped: true });
    expect(step.message).toContain('Not run: This fix would undo "Use in DCS"');
    expect(unasked.needsYou.map((n) => n.itemId)).toContain('c4');
    expect(await options()).toMatchObject({ width: 5120, height: 2464 });

    // "Update the setup": the check and its fix take the new values, and the check passes.
    const after = await app.invoke<CheckResult>('fly:acknowledge', {
      profileId: HORNET,
      itemId: 'c4',
    });
    expect(after.status).toBe('pass');
    const item = await itemOf(HORNET, 'c4');
    expect(item.params).toEqual({ width: 5120, height: 2464, fullScreen: false, vr: false });
    expect(item.remediation?.params).toEqual(item.params);
    // Asked again with nothing left to take over, it is refused and changes nothing.
    await expect(
      app.invoke('fly:acknowledge', { profileId: HORNET, itemId: 'c4' })
    ).rejects.toThrow(/nothing to confirm/);
  });

  it('a yes in the RigReady window runs the fix as the setup says', async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    const first = await firstUse();
    await mfdsBelow();
    await app.invoke('dcs-setup:applyScreens', { setup: await onMonitorsNow(first) });
    const made = await app.invoke<ActionReport>('fly:makeReady', {
      profileId: HORNET,
      approved: ['c4'],
    });
    expect(made.steps.find((s) => s.itemId === 'c4')).toMatchObject({ ok: true });
    expect(await options()).toMatchObject({ width: 7424, height: 1440 });
  });

  it('never touches a setup that expects something else, nor one that was not chosen', async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    const hornet = await setupOf(HORNET);
    const own = {
      ...hornet,
      id: 'dcs-own-window',
      name: 'DCS own window',
      checks: hornet.checks.map((c) =>
        c.id === 'c4'
          ? {
              ...c,
              params: { width: 3840, height: 1080 },
              remediation: { type: 'dcs.setOptions', params: { width: 3840, height: 1080 } },
            }
          : c
      ),
    };
    const saved = await app.wiring.context.profiles.save(own);
    expect(saved.ok).toBe(true);
    const first = await firstUse();
    await mfdsBelow();
    const setup = await onMonitorsNow(first);
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.setups.map((s) => s.id)).toEqual([HORNET]);
    // Named anyway: it is refused by the service, not only left out by the page.
    await app.invoke('dcs-setup:applyScreens', { setup, followSetups: ['dcs-own-window'] });
    expect((await itemOf('dcs-own-window', 'c4')).params).toEqual({ width: 3840, height: 1080 });
    expect((await itemOf(HORNET, 'c4')).params).toMatchObject({ width: 7424, height: 1440 });
    // Its fix sets another window on purpose, and still the user is told what it does.
    expect((await resultOf('dcs-own-window', 'c4')).fixWarning).toBe(
      'This fix would undo "Use in DCS": it sets width 3840 and height 1080, so DCS\'s window would no longer cover LC49G95T, USB_Monitor (1 of 3), USB_Monitor (2 of 3) and USB_Monitor (3 of 3).'
    );
  });

  it('the monitor setup check follows the monitor setup key of the first "Use in DCS"', async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    const { setup } = await app.invoke<{ setup: ScreenSetup }>('dcs-setup:importSimAppPro', {
      desktopId: 'current',
    });
    const preview = await app.invoke<ScreensPreview>('dcs-setup:previewScreens', { setup });
    expect(preview.setups).toEqual([
      {
        id: HORNET,
        name: 'DCS F/A-18C',
        items: [
          {
            itemId: 'c2',
            title: 'DCS monitor setup',
            changes: ['monitor setup "wwtMonitor" → "rigready"'],
            fix: false,
          },
        ],
      },
    ]);
    const before = await resultOf(HORNET, 'c2');
    expect(before.acknowledge).toBeUndefined();
    await app.invoke('dcs-setup:applyScreens', { setup, pairingChecked: true });
    const declined = await resultOf(HORNET, 'c2');
    expect(declined.status).toBe('warn');
    expect(declined.details).toContain(
      '"Use in DCS" set monitor setup "rigready" for the RigReady screen setup, and this setup still expects the older value. Update the setup to keep the new one.'
    );
    expect(declined.acknowledge).toBe('Update the setup');
    const after = await app.invoke<CheckResult>('fly:acknowledge', {
      profileId: HORNET,
      itemId: 'c2',
    });
    expect(after.status).toBe('pass');
    expect((await itemOf(HORNET, 'c2')).params).toEqual({ setup: 'rigready' });
  });

  it('a change made by another program is not taken for one "Use in DCS" made', async () => {
    app = await wiredApp('dcs-setup-flying', { files: FILES });
    const first = await firstUse();
    await mfdsBelow();
    await app.invoke('dcs-setup:applyScreens', { setup: await onMonitorsNow(first) });
    // SimAppPro's wizard writes its own window size.
    const text = await fs.readFile(optionsLua(), 'utf8');
    await fs.writeFile(optionsLua(), text.replace('["width"] = 5120', '["width"] = 6000'));
    const result = await resultOf(HORNET, 'c4');
    expect(result.details).toEqual([
      'width is 6000, expected 7424',
      'height is 2464, expected 1440',
      '"Use in DCS" set height 2464 for the RigReady screen setup, and this setup still expects the older value. Update the setup to keep the new one.',
    ]);
  });
});

describe('which items follow', () => {
  const before = { multiMonitorSetup: 'wwtMonitor', width: 7424, height: 1440, fullScreen: false };
  const after = { multiMonitorSetup: 'rigready', width: 5120, height: 2464, fullScreen: false };
  const options = (params: Record<string, unknown>, fix?: Record<string, unknown>): CheckItem => ({
    id: 'o',
    type: 'dcs.options',
    title: 'DCS graphics options',
    required: false,
    params,
    ...(fix ? { remediation: { type: 'dcs.setOptions', params: fix } } : {}),
  });

  it('moves the old values, leaves keys that did not change, and skips an item the fix disagrees with', () => {
    const moved = followItem(
      options({ width: 7424, vr: true }, { width: 7424, vr: true }),
      before,
      after
    );
    expect(moved?.item.params).toEqual({ width: 5120, vr: true });
    expect(moved?.item.remediation?.params).toEqual({ width: 5120, vr: true });
    expect(moved?.follow.changes).toEqual(['width 7424 → 5120']);
    // Already the new values, or none that change: nothing to do.
    expect(followItem(options({ width: 5120 }), before, after)).toBeUndefined();
    expect(followItem(options({ vr: false }), before, after)).toBeUndefined();
    // The check and the fix expect different windows: the user's own doing, left alone.
    expect(followItem(options({ width: 7424 }, { width: 3840 }), before, after)).toBeUndefined();
    // Any key with a value of its own keeps the whole item as it is.
    expect(followItem(options({ width: 7424, height: 1080 }), before, after)).toBeUndefined();
    // A monitor setup name is compared as DCS does, without regard to case.
    expect(
      followItem(options({ multiMonitorSetup: 'WWTMONITOR' }), before, after)?.item.params
    ).toEqual({ multiMonitorSetup: 'rigready' });
  });

  it('moves the window of a monitor setup check only from the old size', () => {
    const monitor = (params: Record<string, unknown>): CheckItem => ({
      id: 'm',
      type: 'dcs.monitorSetup',
      title: 'DCS monitor setup',
      required: false,
      params,
    });
    expect(
      followItem(monitor({ window: { width: 7424, height: 1440 } }), before, after)?.follow
    ).toEqual({
      itemId: 'm',
      title: 'DCS monitor setup',
      changes: ['window 7424 × 1440 → 5120 × 2464'],
      fix: false,
    });
    expect(
      followItem(monitor({ window: { width: 2560, height: 1440 } }), before, after)
    ).toBeUndefined();
    expect(followItem(monitor({ setup: 'Camera' }), before, after)).toBeUndefined();
    // Other check types are not this feature's to move.
    expect(followItem({ ...monitor({}), type: 'display.layout' }, before, after)).toBeUndefined();
  });

  it('a setup without such an item is not offered', () => {
    const profile: Profile = {
      schemaVersion: 1,
      id: 'p',
      name: 'P',
      createdAt: '2026-11-13T12:00:00.000Z',
      updatedAt: '2026-11-13T12:00:00.000Z',
      checks: [options({ vr: false })],
      extensions: {},
    };
    expect(followSetup(profile, before, after)).toBeUndefined();
    expect(followSetup(profile, after, after)).toBeUndefined();
  });

  it('the fix follows its check when the setup is updated from the Play screen', () => {
    expect(
      followFix(
        { width: 7424, height: 1440, vr: false },
        { width: 7424, height: 1440 },
        {
          width: 5120,
          height: 2464,
        }
      )
    ).toEqual({ width: 5120, height: 2464, vr: false });
    expect(followFix({ width: 3840 }, { width: 7424 }, { width: 5120 })).toBeUndefined();
  });

  it('says the values in words', () => {
    expect(valuesPhrase({ width: 5120 })).toBe('width 5120');
    expect(valuesPhrase({ multiMonitorSetup: 'rigready', width: 5120, fullScreen: false })).toBe(
      'monitor setup "rigready", width 5120 and full screen off'
    );
  });
});
