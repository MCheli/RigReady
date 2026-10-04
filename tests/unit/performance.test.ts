/**
 * NFR-001 and NFR-002 on the fake platform with the recorded rig's inputs.
 *
 *   - The full F/A-18C checklist (every check of the two Hornet setups in the fixtures plus
 *     what the capture screen adds, 25 items or more) runs in well under 5 seconds. The
 *     time is printed; the real providers are measured by `npm run rig:smoke`.
 *   - One run asks the machine each question once: the USB device list is enumerated one
 *     time for all the device checks, not once per check, and the next run (a device was
 *     plugged in, Re-check) enumerates again.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { captureCandidates, runChecks, type ChecklistReport } from '../../src/core/checks/engine';
import { cachedReads } from '../../src/core/checks/readCache';
import type { CheckItem, Profile } from '../../src/core/profile/schema';
import { mutate, wiredApp, type WiredApp } from '../helpers';

let app: WiredApp | undefined;
afterEach(async () => {
  await app?.cleanup();
  app = undefined;
});

/** The fullest Hornet checklist the fixtures can give: both Hornet setups and the capture. */
export async function fullHornetProfile(target: WiredApp): Promise<Profile> {
  const { profiles, checks: registry } = target.wiring.context;
  const listed = await profiles.list();
  if (!listed.ok) throw new Error(listed.error.message);
  const seen = new Set<string>();
  const checks: CheckItem[] = [];
  const add = (item: Omit<CheckItem, 'id'>): void => {
    const key = `${item.type} ${JSON.stringify(item.params)}`;
    if (seen.has(key)) return;
    seen.add(key);
    checks.push({ ...item, id: `c${checks.length + 1}` });
  };
  const base = listed.value.find((p) => p.id === 'fly-hornet-full') ?? listed.value[0]!;
  for (const profile of listed.value) for (const item of profile.checks) add(item);
  const captured = await captureCandidates(registry, {
    ports: target.wiring.context.ports,
    log: target.wiring.context.log,
  });
  for (const candidate of captured.candidates) {
    if (candidate.selectedByDefault && (!candidate.game || candidate.game === 'dcs')) {
      add(candidate.check);
    }
  }
  const profile: Profile = { ...base, id: 'full-hornet', name: 'F/A-18C full', checks };
  const saved = await profiles.save(profile);
  if (!saved.ok) throw new Error(saved.error.message);
  return profile;
}

const READS = [
  ['devices', 'list'],
  ['displays', 'read'],
  ['processes', 'list'],
  ['services', 'list'],
  ['audio', 'read'],
] as const;

/** Counts every machine read the fake providers answer. */
function countReads(target: WiredApp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [port, method] of READS) {
    const provider = target.ports[port] as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = provider[method]!.bind(provider);
    counts[`${port}.${method}`] = 0;
    provider[method] = (...args: unknown[]) => {
      counts[`${port}.${method}`]!++;
      return original(...args);
    };
  }
  return counts;
}

describe('NFR-001 the full checklist is fast', () => {
  it('the full F/A-18C checklist (25+ items) runs in under 5000 ms on the recorded rig', async () => {
    app = await wiredApp('fly-make-ready-all');
    // The flying state where everything is as the setups expect, so every check does its whole job.
    const profile = await fullHornetProfile(app);
    expect(profile.checks.length).toBeGreaterThanOrEqual(25);
    const groups = new Set(
      profile.checks.map((c) => app!.wiring.context.checks.check(c.type)?.group ?? 'other')
    );
    expect([...groups].sort()).toEqual(['apps', 'audio', 'devices', 'displays', 'files', 'other']);

    const times: number[] = [];
    let report: ChecklistReport | undefined;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      report = await app.invoke<ChecklistReport>('fly:check', { profileId: profile.id });
      times.push(performance.now() - started);
    }
    expect(report!.results).toHaveLength(profile.checks.length);
    // Nothing timed out or could not be evaluated: the time is that of real work.
    expect(report!.results.filter((r) => r.summary.startsWith('Timed out'))).toEqual([]);
    const best = Math.min(...times);
    const worst = Math.max(...times);
    console.log(
      `  NFR-001 (fake platform, recorded inputs): ${profile.checks.length} checks, best ${best.toFixed(0)} ms, worst ${worst.toFixed(0)} ms of 5 runs (limit 5000 ms)`
    );
    // Even the slowest of the runs, on a machine that is busy with other test files.
    expect(worst).toBeLessThan(5000);
  }, 120_000);
});

describe('NFR-002 one enumeration per check run', () => {
  it('the device checks of a run share one USB enumeration, however many there are, and the app checks one process list', async () => {
    app = await wiredApp('fly-make-ready-all');
    const profile = await fullHornetProfile(app);
    const deviceChecks = profile.checks.filter((c) => c.type === 'device.connected').length;
    expect(deviceChecks).toBeGreaterThanOrEqual(12);
    const counts = countReads(app);
    /** The machine reads one check run makes. */
    const readsOf = async (profileId: string): Promise<Record<string, number>> => {
      const before = { ...counts };
      const report = await app!.invoke<ChecklistReport>('fly:check', { profileId });
      expect(report.results.some((r) => r.summary.startsWith('Timed out'))).toBe(false);
      return Object.fromEntries(
        Object.entries(counts).map(([key, value]) => [key, value - before[key]!])
      );
    };

    const full = await readsOf(profile.id);
    console.log(
      `  NFR-002: ${profile.checks.length} checks (${deviceChecks} device checks) made these machine reads: ${JSON.stringify(full)}`
    );
    // Not once per check. The engine's shared answer serves every check that goes through
    // the run's context: one enumeration for all the device checks, one process list for
    // all the app checks, one audio read. (The DCS bindings check asks through its own
    // service for the owner's device names and whether DCS is running: one more each.)
    expect(full['devices.list']).toBeLessThanOrEqual(2);
    expect(full['processes.list']).toBeLessThanOrEqual(3);
    expect(full['audio.read']).toBe(1);
    expect(full['displays.read']).toBeLessThanOrEqual(2);
    expect(full['services.list']).toBeLessThanOrEqual(1);

    // And it does not grow with the checklist: one device check costs what fourteen do.
    const devicesOnly = profile.checks.filter((c) => c.type === 'device.connected');
    const { profiles } = app.wiring.context;
    await profiles.save({ ...profile, id: 'one-device', checks: devicesOnly.slice(0, 1) });
    await profiles.save({ ...profile, id: 'all-devices', checks: devicesOnly });
    const one = await readsOf('one-device');
    const many = await readsOf('all-devices');
    expect(one['devices.list']).toBe(1);
    expect(many['devices.list']).toBe(1);
    // The same for the apps.
    const apps = profile.checks.filter((c) => c.type === 'process.running');
    expect(apps.length).toBeGreaterThanOrEqual(3);
    await profiles.save({ ...profile, id: 'all-apps', checks: apps });
    expect((await readsOf('all-apps'))['processes.list']).toBe(1);
  });

  it('the next run enumerates again, so a device change is seen at once', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const counts = countReads(app);
    const enumerations = async (work: () => Promise<unknown>): Promise<number> => {
      const before = counts['devices.list']!;
      await work();
      return counts['devices.list']! - before;
    };
    let first: ChecklistReport | undefined;
    expect(
      await enumerations(async () => {
        first = await app!.invoke<ChecklistReport>('fly:check', { profileId: 'dcs-f-a-18c' });
      })
    ).toBe(1);
    expect(first!.ready).toBe(true);

    // The device change event is what makes the Fly screen check again.
    let changed = 0;
    app.ports.devices.subscribe(() => changed++);
    await mutate(app, [{ op: 'unplugDevice', match: { vendorId: '044F', productId: 'B68F' } }]);
    expect(changed).toBe(1);
    let second: ChecklistReport | undefined;
    expect(
      await enumerations(async () => {
        second = await app!.invoke<ChecklistReport>('fly:check', { profileId: 'dcs-f-a-18c' });
      })
    ).toBe(1);
    expect(second!.results.find((r) => r.title === 'T-Pendular-Rudder')!.status).toBe('fail');

    // Checking one item, and a fix's own re-check, always read the machine afresh.
    expect(
      await enumerations(() =>
        app!.invoke('fly:checkItem', { profileId: 'dcs-f-a-18c', itemId: 'c3' })
      )
    ).toBe(1);
  });

  it('cachedReads shares reads within a run, hands out copies, and passes changes straight through', async () => {
    app = await wiredApp('flying-all-good', { files: [] });
    const counts = countReads(app);
    const ports = cachedReads(app.ports);
    const [a, b] = await Promise.all([ports.devices.list(), ports.devices.list()]);
    expect(counts['devices.list']).toBe(1);
    expect(a).toEqual(b);
    // A copy each: one check sorting or trimming its list cannot disturb another.
    if (a.ok && b.ok) {
      a.value.length = 0;
      expect(b.value.length).toBeGreaterThan(50);
    }
    await ports.displays.read();
    await ports.displays.read();
    await ports.audio.read();
    await ports.audio.read();
    await ports.processes.list();
    await ports.processes.list();
    await ports.services.list();
    await ports.services.get('Audiosrv');
    await ports.services.get('AUDIOSRV');
    expect(counts).toMatchObject({
      'displays.read': 1,
      'audio.read': 1,
      'processes.list': 1,
      'services.list': 1,
    });
    // Changes are never cached: they reach the machine, and an uncached read sees them.
    const started = await ports.processes.start({ exe: 'C:\\Tools\\tool.exe', args: [] });
    expect(started.ok).toBe(true);
    expect(app.ports.processes.started).toHaveLength(1);
    const fresh = await app.ports.processes.list();
    expect(fresh.ok && fresh.value.some((p) => p.name === 'tool.exe')).toBe(true);
    const pid = started.ok ? started.value.pid! : 0;
    expect((await ports.processes.close(pid)).ok).toBe(true);
    expect((await ports.processes.stop(999_999)).ok).toBe(false);
    expect(ports.displays.canRevert()).toBe(false);
    expect((await ports.displays.revert()).ok).toBe(false);
    const audio = await app.ports.audio.read();
    const speaker = audio.ok ? audio.value.devices[0]! : undefined;
    expect((await ports.audio.setDefault(speaker!.id)).ok).toBe(true);
    const layout = await app.ports.displays.read();
    expect((await ports.displays.apply([])).ok).toBe(layout.ok);
    let events = 0;
    const off = ports.devices.subscribe(() => events++);
    app.ports.devices.emitChanged();
    off();
    expect(events).toBe(1);
    // A whole profile through the engine: one enumeration.
    const profile = await app.wiring.context.profiles.get('dcs-f-a-18c');
    if (!profile.ok) throw new Error(profile.error.message);
    const before = counts['devices.list']!;
    await runChecks(profile.value, app.wiring.context.checks, {
      ports: app.wiring.context.ports,
      log: app.wiring.context.log,
    });
    expect(counts['devices.list']).toBe(before + 1);
  });
});
