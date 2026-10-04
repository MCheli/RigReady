import { afterEach, describe, expect, it } from 'vitest';
import type { ActionReport, ChecklistReport } from '../../src/core/checks/engine';
import type { CaptureCandidate } from '../../src/core/checks/registry';
import type { Profile } from '../../src/core/profile/schema';
import type { DisplayInfo, LaunchTarget } from '../../src/shared/models';
import { mutate, wiredApp, type WiredApp } from '../helpers';

/**
 * mark-racing: the owner's rig as he races on it, made from mark-full by scenario
 * mutations. `mark-racing` is what the recording supports as it is (wheel, ultrawide,
 * Dell off); `mark-racing-tv` adds the TV above the ultrawide and SimHub, which the ledger's
 * racing fixture names but which were not on the PC when it was recorded.
 */

let apps: WiredApp[] = [];
afterEach(async () => {
  for (const app of apps) await app.cleanup();
  apps = [];
});

async function start(scenario: string): Promise<WiredApp> {
  const app = await wiredApp(scenario);
  apps.push(app);
  return app;
}

const monitor = (app: WiredApp, name: string): DisplayInfo | undefined =>
  app.ports.state.displays.find((d) => d.name === name);
const running = (app: WiredApp, name: string): boolean =>
  app.ports.state.processes.some((p) => p.name.toLowerCase() === name.toLowerCase());

/** An iRacing setup the way the capture screen makes it: iRacing chosen, its two own checks ticked. */
async function captureIracing(app: WiredApp): Promise<Profile> {
  const { candidates, problems } = await app.invoke<{
    candidates: CaptureCandidate[];
    problems: string[];
  }>('profiles:capture');
  expect(problems).toEqual([]);
  const ticked = new Set(['racing:iracing-service', 'racing:iracing-devices']);
  const chosen = candidates.filter((c) =>
    c.key.startsWith('file:') || c.key.startsWith('game:')
      ? c.key.startsWith('file:iracing:') || c.key === 'game:iracing'
      : ticked.has(c.key) || (c.selectedByDefault && (!c.game || c.game === 'iracing'))
  );
  const games =
    await app.invoke<{ id: string; installs: { launch?: LaunchTarget }[] }[]>('profiles:games');
  const launch = games.find((g) => g.id === 'iracing')!.installs.find((i) => i.launch)!.launch!;
  return app.invoke<Profile>('profiles:create', {
    name: 'iRacing',
    game: 'iracing',
    launch,
    checks: chosen.map((c) => c.check),
  });
}

/** The desk: Dell on and main, the ultrawide to its right, the TV (when there is one) off, racing apps closed. */
async function goToTheDesk(app: WiredApp, apps: string[]): Promise<void> {
  await mutate(app, [
    {
      op: 'setDisplay',
      match: { name: 'DELL G3223D' },
      set: { enabled: true, primary: true, x: 0, y: 0, width: 2560, height: 1440 },
    },
    { op: 'setDisplay', match: { name: 'LC49G95T' }, set: { primary: false, x: 2560, y: 0 } },
    ...(monitor(app, 'TV')
      ? [{ op: 'setDisplay', match: { name: 'TV' }, set: { enabled: false } }]
      : []),
    ...apps.map((name) => ({ op: 'stopProcess', name })),
  ]);
}

describe('the mark-racing scenarios', () => {
  it('mark-racing is the recorded rig without flight gear: wheel and ultrawide, Dell off', async () => {
    const app = await start('mark-racing');
    const { devices, displays, input } = app.ports.state;
    expect(devices.some((d) => d.vendorId === '0EB7' && d.productId === '0007')).toBe(true);
    // No WinWing, TPR pedals, Virpil panel, TrackIR camera or MFD screen adapters.
    const flightGear = (d: { vendorId: string; productId: string }): boolean =>
      ['4098', '3344', '131D', '17E9'].includes(d.vendorId) ||
      (d.vendorId === '044F' && d.productId === 'B68F');
    expect(devices.filter(flightGear)).toEqual([]);
    expect(input.map((i) => i.name)).toEqual(['FANATEC Podium Wheel Base DD2']);
    expect(displays.map((d) => [d.name, d.enabled, d.primary])).toEqual([
      ['DELL G3223D', false, false],
      ['LC49G95T', true, true],
    ]);
    expect(running(app, 'TrackIR5.exe') || running(app, 'SimAppPro.exe')).toBe(false);
    expect(running(app, 'FanatecService.exe')).toBe(true);
    expect(running(app, 'SimHubWPF.exe')).toBe(false);
  });

  it('mark-racing-tv adds the TV above the ultrawide, and SimHub running', async () => {
    const app = await start('mark-racing-tv');
    expect(monitor(app, 'TV')).toMatchObject({
      enabled: true,
      primary: false,
      x: 640,
      y: -2160,
      width: 3840,
      height: 2160,
      connector: 'HDMI',
    });
    expect(monitor(app, 'LC49G95T')).toMatchObject({ primary: true, x: 0, y: 0 });
    expect(running(app, 'SimHubWPF.exe')).toBe(true);
    // The Monitors page draws it above the ultrawide.
    const view = await app.invoke<{ monitors: { name: string; y: number; enabled: boolean }[] }>(
      'displays:view'
    );
    expect(view.monitors.find((m) => m.name === 'TV')).toMatchObject({ y: -2160, enabled: true });
  });
});

describe.each([
  { scenario: 'mark-racing', tv: false, helpers: ['FanatecService.exe', 'trophi.ai.exe'] },
  {
    scenario: 'mark-racing-tv',
    tv: true,
    helpers: ['FanatecService.exe', 'SimHubWPF.exe', 'trophi.ai.exe'],
  },
])('a racing setup on $scenario', ({ scenario, tv, helpers }) => {
  it('an iRacing setup captured from the rig passes every check on the unchanged rig', async () => {
    const app = await start(scenario);
    const profile = await captureIracing(app);
    const titles = profile.checks.map((c) => c.title);
    expect(titles).toEqual(
      expect.arrayContaining([
        'FANATEC Podium Wheel Base DD2',
        'Wheel base in PC mode',
        'Fanatec Service',
        'iRacing helper service',
        'iRacing knows the wheel',
        'Monitor layout',
        'Bindings (controls.cfg)',
        'iRacing not updated since verified',
      ])
    );
    expect(titles.includes('SimHub')).toBe(tv);
    // Nothing of the flight rig and nothing of another game.
    expect(titles.filter((t) => /WINWING|TrackIR|DCS|SimAppPro|Pendular|VPC/i.test(t))).toEqual([]);

    const layout = profile.checks.find((c) => c.type === 'display.layout')!;
    const wanted = (layout.params['displays'] as { name: string; enabled: boolean; y: number }[])
      .filter((d) => d.enabled)
      .map((d) => [d.name, d.y]);
    expect(wanted).toEqual(
      tv
        ? [
            ['LC49G95T', 0],
            ['TV', -2160],
          ]
        : [['LC49G95T', 0]]
    );

    const report = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(report.results.filter((r) => r.status !== 'pass').map((r) => r.title)).toEqual([]);
    expect(report).toMatchObject({ ready: true, failed: 0, warnings: 0, errors: 0 });
  });

  it('Make ready applies the racing layout and starts the missing apps; Stand down returns to Desk', async () => {
    const app = await start(scenario);
    const profile = await captureIracing(app);

    // At the desk, with the desk arrangement saved as the layout Stand down goes back to.
    await goToTheDesk(app, helpers);
    const saved = await app.invoke<{ layouts: { id: string; name: string }[] }>(
      'settings:saveCurrentLayout',
      { name: 'Desk' }
    );
    const desk = saved.layouts.find((l) => l.name === 'Desk')!;
    await app.invoke('settings:update', { deskLayoutId: desk.id });

    const before = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
    expect(before.ready).toBe(false);
    const notMet = before.results.filter((r) => r.status !== 'pass').map((r) => r.title);
    expect(notMet).toEqual(
      expect.arrayContaining(['Monitor layout', 'Fanatec Service', ...(tv ? ['SimHub'] : [])])
    );
    const layoutProblem = before.results.find((r) => r.title === 'Monitor layout')!;
    expect(layoutProblem.details.join(' ')).toContain('DELL G3223D is on, expected off');
    if (tv) expect(layoutProblem.details.join(' ')).toMatch(/TV is off, expected on/);

    const made = await app.invoke<ActionReport>('fly:makeReady', {
      profileId: profile.id,
      approved: profile.checks.map((c) => c.id),
    });
    expect(made.steps.filter((s) => !s.ok).map((s) => `${s.title}: ${s.message}`)).toEqual([]);
    expect(made.report.ready).toBe(true);
    expect(made.report.results.filter((r) => r.status !== 'pass')).toEqual([]);
    // The racing layout is what Windows now has.
    expect(monitor(app, 'DELL G3223D')!.enabled).toBe(false);
    expect(monitor(app, 'LC49G95T')).toMatchObject({ enabled: true, primary: true, x: 0, y: 0 });
    if (tv) expect(monitor(app, 'TV')).toMatchObject({ enabled: true, x: 640, y: -2160 });
    // The apps that were closed were started.
    for (const helper of helpers) expect(running(app, helper), helper).toBe(true);
    expect(app.ports.processes.started.map((s) => s.exe.split('\\').pop())).toEqual(
      expect.arrayContaining(helpers)
    );

    const down = await app.invoke<ActionReport & { headline: string }>('fly:standDown', {
      profileId: profile.id,
    });
    expect(down.steps.filter((s) => !s.ok)).toEqual([]);
    expect(down.steps.map((s) => s.message).join(' | ')).toContain('Applied desk layout "Desk"');
    expect(monitor(app, 'DELL G3223D')).toMatchObject({ enabled: true, primary: true, x: 0, y: 0 });
    expect(monitor(app, 'LC49G95T')).toMatchObject({ enabled: true, primary: false, x: 2560 });
    if (tv) expect(monitor(app, 'TV')!.enabled).toBe(false);
  });
});
