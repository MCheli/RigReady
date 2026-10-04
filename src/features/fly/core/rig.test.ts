import { afterEach, describe, expect, it } from 'vitest';
import type { Profile } from '../../../core/profile/schema';
import type { DisplayInfo, DisplayTarget } from '../../../shared/models';
import { mutate, wiredApp, type WiredApp } from '../../../../tests/helpers';
import type { RigGlance } from '../contract';
import { monitorIssues, monitorNames } from './rig';

let app: WiredApp;
afterEach(async () => {
  for (const feature of app?.wiring.features ?? []) await feature.dispose?.();
  await app?.cleanup();
});

const P = { profileId: 'dcs-f-a-18c' };
const glance = (): Promise<RigGlance> => app.invoke<RigGlance>('fly:rig', P);

const monitor = (partial: Partial<DisplayInfo> & { id: string }): DisplayInfo => ({
  name: 'Panel',
  enabled: true,
  primary: false,
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  rotation: 0,
  ...partial,
});
const target = (partial: Partial<DisplayTarget> & { id: string }): DisplayTarget => ({
  name: 'Panel',
  enabled: true,
  primary: false,
  x: 0,
  y: 0,
  rotation: 0,
  ...partial,
});
const id = (model: string, port: string): string => `\\\\?\\display#${model}#${port}#{guid}`;

describe('naming monitors', () => {
  it('numbers the ones that share a name, and prefers the name the owner gave', () => {
    const names = monitorNames(
      [
        { id: 'A', name: 'USB_Monitor' },
        { id: 'B', name: 'Ultrawide' },
        { id: 'C', name: 'USB_Monitor' },
        { id: 'D', name: '' },
      ],
      { c: ' MFD right ' }
    );
    expect([...names]).toEqual([
      ['a', 'USB_Monitor (1 of 2)'],
      ['b', 'Ultrawide'],
      ['c', 'MFD right'],
      ['d', 'Monitor'],
    ]);
  });
});

describe('what is different about each monitor', () => {
  const main = id('aaa0001', 'p1');
  const side = id('bbb0002', 'p2');
  const desk = id('ccc0003', 'p3');
  const expected = [
    target({ id: main, name: 'Main', primary: true, width: 2560, height: 1440 }),
    target({ id: side, name: 'Side', x: 2560, width: 768, height: 1024, rotation: 90 }),
    target({ id: desk, name: 'Desk', enabled: false }),
  ];
  const asExpected = [
    monitor({ id: main, name: 'Main', primary: true, width: 2560, height: 1440 }),
    monitor({ id: side, name: 'Side', x: 2560, width: 768, height: 1024, rotation: 90 }),
    monitor({ id: desk, name: 'Desk', enabled: false, width: 0, height: 0 }),
  ];
  const changed = (index: number, change: Partial<DisplayInfo>): DisplayInfo[] =>
    asExpected.map((m, i) => (i === index ? { ...m, ...change } : m));

  it('nothing, when the monitors are as the setup expects', () => {
    const found = monitorIssues(expected, asExpected);
    expect([...found.issues]).toEqual([]);
    expect(found.missing).toEqual([]);
    expect([...found.labels]).toEqual([
      [main, 'Main'],
      [side, 'Side'],
      [desk, 'Desk'],
    ]);
  });

  it('says the first thing that is off about a monitor, in a few words', () => {
    const cases: [DisplayInfo[], string, string][] = [
      [changed(2, { enabled: true, width: 1920, height: 1080 }), desk, 'on, expected off'],
      [changed(1, { enabled: false }), side, 'off, expected on'],
      [changed(1, { rotation: 0, width: 1024, height: 768 }), side, 'rotated 0°, expected 90°'],
      [changed(1, { width: 600, height: 800 }), side, '600x800, expected 768x1024'],
      [changed(1, { x: 3000 }), side, 'not where the setup expects it'],
      [changed(0, { primary: false }), main, 'not the main display'],
    ];
    for (const [actual, monitorId, issue] of cases) {
      expect([...monitorIssues(expected, actual).issues], issue).toEqual([[monitorId, issue]]);
    }
  });

  it('positions are measured from the main display, wherever the setup recorded it', () => {
    // Captured with the main display at 1920,0; Windows always puts it at 0,0.
    const shifted = expected.map((t) => (t.enabled ? { ...t, x: t.x + 1920 } : t));
    expect([...monitorIssues(shifted, asExpected).issues]).toEqual([]);
  });

  it('a monitor the setup wants on that is not connected is missing; one it wants off is not', () => {
    const found = monitorIssues(expected, [asExpected[0]!]);
    expect(found.missing).toEqual(['Side']);
    expect([...found.issues]).toEqual([]);
  });

  it('a size the setup does not name is not compared', () => {
    const loose = [target({ id: main, name: 'Main', primary: true })];
    expect([...monitorIssues(loose, [asExpected[0]!]).issues]).toEqual([]);
  });
});

describe('the rig at a glance', () => {
  it('draws the monitors as they are, named as the checklist names them, with nothing wrong when ready', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const rig = await glance();
    expect(rig.itemId).toBe('c16');
    expect(rig.missing).toEqual([]);
    expect(rig.error).toBeUndefined();
    expect(
      rig.monitors.map((m) => [m.label, m.enabled, m.primary, m.width, m.height, m.rotation])
    ).toEqual(
      expect.arrayContaining([
        ['LC49G95T', true, true, 5120, 1440, 0],
        ['USB_Monitor (1 of 3)', true, false, 768, 1024, 90],
        ['USB_Monitor (2 of 3)', true, false, 768, 1024, 90],
        ['USB_Monitor (3 of 3)', true, false, 768, 1024, 90],
        ['DELL G3223D', false, false, expect.any(Number), expect.any(Number), 0],
      ])
    );
    expect(rig.monitors).toHaveLength(5);
    expect(rig.monitors.every((m) => m.issue === undefined)).toBe(true);
  });

  it('marks the monitor that is off, in the words the checklist uses for it', async () => {
    app = await wiredApp('flying-mfd-rotated', { files: [] });
    const rig = await glance();
    const wrong = rig.monitors.filter((m) => m.issue !== undefined);
    expect(wrong.map((m) => [m.label, m.issue])).toEqual([
      ['USB_Monitor (2 of 3)', 'rotated 0°, expected 90°'],
    ]);
    // The same monitor the check names.
    const report = await app.invoke<{ results: { itemId: string; details: string[] }[] }>(
      'fly:check',
      P
    );
    expect(report.results.find((r) => r.itemId === 'c16')!.details[0]).toBe(
      'USB_Monitor (2 of 3) is rotated 0°, expected 90°'
    );
  });

  it('at the desk: the desk monitor is on and the MFD screens lie flat', async () => {
    app = await wiredApp('desk-mfds-wrong', { files: [] });
    const rig = await glance();
    const issues = Object.fromEntries(rig.monitors.map((m) => [m.label, m.issue]));
    expect(issues['DELL G3223D']).toBe('on, expected off');
    expect(issues['USB_Monitor (1 of 3)']).toBe('rotated 0°, expected 90°');
    expect(issues['LC49G95T']).toBeDefined();
  });

  it('a monitor that is not connected is named as missing', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await mutate(app, [{ op: 'unplugDisplay', match: { name: 'USB_Monitor', index: 2 } }]);
    const rig = await glance();
    expect(rig.monitors).toHaveLength(4);
    expect(rig.missing).toEqual(['USB_Monitor (3 of 3)']);
  });

  it('uses the names the owner gave the monitors', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const before = await glance();
    const left = before.monitors.find((m) => m.label === 'USB_Monitor (1 of 3)')!;
    await app.invoke('displays:setName', { id: left.id, name: 'MFD left' });
    const after = await glance();
    expect(after.monitors.find((m) => m.id === left.id)!.label).toBe('MFD left');
  });

  it('a saved layout is what counts while it exists, as for the check', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const { layouts, profiles, ports } = app.wiring.context;
    const saved = await layouts.createFromCurrent('Flying', ports.displays);
    expect(saved.ok).toBe(true);
    const profile = await profiles.get('dcs-f-a-18c');
    if (!profile.ok || !saved.ok) throw new Error('setup');
    // The copy kept in the setup is out of date: it wants the Dell on.
    const stale: Profile = {
      ...profile.value,
      checks: profile.value.checks.map((item) =>
        item.id === 'c16'
          ? {
              ...item,
              params: {
                layoutId: saved.value.id,
                displays: (item.params['displays'] as DisplayTarget[]).map((t) =>
                  t.name === 'DELL G3223D' ? { ...t, enabled: true, x: 9000 } : t
                ),
              },
            }
          : item
      ),
    };
    expect((await profiles.save(stale)).ok).toBe(true);
    expect((await glance()).monitors.every((m) => m.issue === undefined)).toBe(true);
    // The saved layout is deleted: the copy in the setup is all there is.
    expect((await layouts.remove(saved.value.id)).ok).toBe(true);
    const fallback = await glance();
    expect(fallback.missing).toEqual([]);
    expect(fallback.monitors.find((m) => m.label === 'DELL G3223D')!.issue).toBe(
      'off, expected on'
    );
  });

  it('a setup that expects nothing of the monitors still shows them, with nothing to mark', async () => {
    app = await wiredApp('flying-mfd-rotated', { files: [] });
    const { profiles } = app.wiring.context;
    const profile = await profiles.get('dcs-f-a-18c');
    if (!profile.ok) throw new Error('setup');
    // The monitor item switched off counts as not expecting anything.
    await profiles.save({
      ...profile.value,
      checks: profile.value.checks.map((item) =>
        item.id === 'c16' ? { ...item, disabled: true } : item
      ),
    });
    const rig = await glance();
    expect(rig.itemId).toBeUndefined();
    expect(rig.monitors).toHaveLength(5);
    expect(rig.monitors.every((m) => m.issue === undefined)).toBe(true);
    expect(rig.monitors.filter((m) => m.label.startsWith('USB_Monitor'))).toHaveLength(3);
  });

  it('says why when Windows does not report the monitors', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await mutate(app, [
      { op: 'failProvider', port: 'displays', message: 'The display driver did not answer.' },
    ]);
    expect(await glance()).toEqual({
      monitors: [],
      missing: [],
      error: 'The display driver did not answer.',
    });
  });

  it('a setup that cannot be opened is an error, not an empty picture', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    await expect(app.invoke('fly:rig', { profileId: 'gone' })).rejects.toThrow(/profile/);
  });
});
