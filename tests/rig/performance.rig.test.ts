/**
 * Timings on the real PC, read-only: nothing is started, stopped, written outside a temp
 * data root, or changed. The numbers are printed; three of them are limits.
 *
 *   NFR-001  the full F/A-18C checklist against the real providers: under 5 s
 *   NFR-002  a full device enumeration (USB/HID devices and DirectInput identities): under 2 s
 *   NFR-003  how long each provider read keeps the main thread from doing anything else
 *
 * Other programs (and other test runs) share this PC, so each measurement is the best of
 * several runs, and every run is printed.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import * as yaml from 'js-yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidates, type ChecklistReport } from '../../src/core/checks/engine';
import { readDirectInputIdentities } from '../../src/core/directInput';
import { createZip, createZipInSteps, readZip, type ZipEntry } from '../../src/core/files/zip';
import { allPathVariables } from '../../src/core/pathVariables';
import { nullLogger } from '../../src/core/logger';
import { ProfileSchema, type CheckItem, type Profile } from '../../src/core/profile/schema';
import type { Ports } from '../../src/core/ports';
import { discoverFeatures, wireFeatures, type Wiring } from '../../src/main/bootstrap';
import { createWindowsPorts } from '../../src/platform/windows';

const projectRoot = path.resolve(__dirname, '../..');
const profilesDir = path.join(projectRoot, 'fixtures', 'scenarios', 'profiles');

let dataRoot: string;
let ports: Ports;
let wiring: Wiring;

beforeAll(async () => {
  // RigReady's own data goes to a temp folder: the real ~/.rigready is never touched.
  dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rigready-test-rig-'));
  ports = createWindowsPorts({
    log: nullLogger,
    projectRoot,
    env: { ...process.env, RIGREADY_HOME: dataRoot },
  });
  expect(ports.folders.dataRoot()).toBe(dataRoot);
  wiring = wireFeatures({ features: discoverFeatures(), ports, log: nullLogger, send: () => {} });
});

afterAll(async () => {
  for (const feature of wiring?.features ?? []) await feature.dispose?.();
  await ports?.input.stop();
  await fs.rm(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const ms = (value: number): string => `${value.toFixed(0)} ms`;

async function timed<T>(work: () => Promise<T>): Promise<{ value: T; elapsed: number }> {
  const started = performance.now();
  const value = await work();
  return { value, elapsed: performance.now() - started };
}

/** The two Hornet setups of the fixtures (recorded from this rig), then what capture adds. */
async function fullHornetProfile(): Promise<Profile> {
  const seen = new Set<string>();
  const checks: CheckItem[] = [];
  const add = (item: Omit<CheckItem, 'id'>): void => {
    const key = `${item.type} ${JSON.stringify(item.params)}`;
    if (seen.has(key)) return;
    seen.add(key);
    checks.push({ ...item, id: `c${checks.length + 1}` });
  };
  let base: Profile | undefined;
  for (const file of ['fly-hornet-full.yaml', 'dcs-f-a-18c.yaml']) {
    const profile = ProfileSchema.parse(
      yaml.load(await fs.readFile(path.join(profilesDir, file), 'utf8'))
    );
    base ??= profile;
    for (const item of profile.checks) add(item);
  }
  const captured = await captureCandidates(wiring.context.checks, { ports, log: nullLogger });
  for (const candidate of captured.candidates) {
    if (checks.length >= 30) break;
    if (candidate.selectedByDefault && (!candidate.game || candidate.game === 'dcs')) {
      add(candidate.check);
    }
  }
  return { ...base!, id: 'full-hornet', name: 'F/A-18C full', checks };
}

describe('NFR-001 the full F/A-18C checklist on the real rig', () => {
  it('runs in under 5 s against the real providers', async () => {
    const profile = await fullHornetProfile();
    expect(profile.checks.length).toBeGreaterThanOrEqual(25);
    const saved = await wiring.context.profiles.save(profile);
    expect(saved.ok).toBe(true);
    const check = wiring.handlers.get('fly:check')!;

    const times: number[] = [];
    let report: ChecklistReport | undefined;
    for (let run = 0; run < 4; run++) {
      const { value, elapsed } = await timed(() => check({ profileId: profile.id }));
      expect(value.ok).toBe(true);
      if (value.ok) report = value.value as ChecklistReport;
      times.push(elapsed);
    }
    const byStatus: Record<string, number> = {};
    for (const result of report!.results) {
      byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    }
    const timedOut = report!.results.filter((r) => r.summary.startsWith('Timed out'));
    console.log(
      `  NFR-001 (real providers): ${profile.checks.length} checks, runs ${times.map(ms).join(', ')}; best ${ms(Math.min(...times))} (limit 5000 ms); results ${JSON.stringify(byStatus)}`
    );
    expect(report!.results).toHaveLength(profile.checks.length);
    // A check that timed out would hide a slow provider behind the 5 s check timeout.
    expect(timedOut.map((r) => r.title)).toEqual([]);
    expect(Math.min(...times)).toBeLessThan(5000);
    // The first run is the cold one (the DirectInput reader starts, files are read first).
    expect(times[0]).toBeLessThan(10_000);
  });
});

describe('NFR-002 device enumeration on the real rig', () => {
  it('a full enumeration (USB/HID devices and DirectInput identities) takes under 2000 ms', async () => {
    const times: number[] = [];
    let devices = 0;
    let identities = 0;
    for (let run = 0; run < 5; run++) {
      const { value, elapsed } = await timed(async () => {
        const listed = await ports.devices.list();
        const directInput = await readDirectInputIdentities(ports.registry);
        return { listed, directInput };
      });
      expect(value.listed.ok).toBe(true);
      if (value.listed.ok) devices = value.listed.value.length;
      expect(value.directInput.ok).toBe(true);
      if (value.directInput.ok) identities = value.directInput.value.length;
      times.push(elapsed);
    }
    expect(devices).toBeGreaterThan(0);
    console.log(
      `  NFR-002: ${devices} USB devices and ${identities} DirectInput identities; runs ${times.map(ms).join(', ')}; best ${ms(Math.min(...times))} (limit 2000 ms)`
    );
    expect(Math.min(...times)).toBeLessThan(2000);
  });

  it('prints how long the live controller list takes (the DirectInput reader, started once per app run)', async () => {
    const first = await timed(() => ports.input.start());
    const again = await timed(() => ports.input.start());
    console.log(
      `  DirectInput reader: first start ${ms(first.elapsed)}${first.value.ok ? ` (${first.value.value.length} controllers)` : ' (not available)'}, asked again ${ms(again.elapsed)}`
    );
    // Asking again while it runs is answered at once.
    if (first.value.ok) expect(again.elapsed).toBeLessThan(500);
  });
});

describe('NFR-003 how long provider reads hold the main thread', () => {
  it('measures the longest event-loop stall of each real provider read', async () => {
    const reads: [string, () => Promise<{ ok: boolean }>][] = [
      ['devices.list', () => ports.devices.list()],
      ['displays.read', () => ports.displays.read()],
      ['audio.read', () => ports.audio.read()],
      ['processes.list', () => ports.processes.list()],
      ['services.list', () => ports.services.list()],
      ['registry (DirectInput identities)', () => readDirectInputIdentities(ports.registry)],
    ];
    const lines: string[] = [];
    const stalls: Record<string, number> = {};
    for (const [name, read] of reads) {
      const runs: { elapsed: number; stall: number }[] = [];
      for (let run = 0; run < 5; run++) {
        // Two probes of the same thing. A timer that should tick every millisecond: the
        // longest gap between two ticks is how long nothing else could run. And Node's own
        // event-loop delay histogram.
        const loop = monitorEventLoopDelay({ resolution: 1 });
        let last = performance.now();
        let gap = 0;
        const ticker = setInterval(() => {
          const now = performance.now();
          gap = Math.max(gap, now - last);
          last = now;
        }, 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        gap = 0;
        last = performance.now();
        loop.enable();
        const { value, elapsed } = await timed(read);
        // Let the loop turn so a stall that ended with the call is recorded.
        await new Promise((resolve) => setTimeout(resolve, 5));
        loop.disable();
        clearInterval(ticker);
        expect(value.ok, name).toBe(true);
        runs.push({ elapsed, stall: Math.max(gap, loop.max / 1e6) });
      }
      const best = runs.reduce((a, b) => (b.stall < a.stall ? b : a));
      stalls[name] = best.stall;
      lines.push(
        `    ${name.padEnd(34)} call ${ms(best.elapsed).padStart(7)}, longest stall ${ms(best.stall).padStart(7)}  (stalls of 5 runs: ${runs.map((r) => ms(r.stall)).join(', ')})`
      );
    }
    console.log(`  NFR-003 main-thread stall per provider read (best of 5):\n${lines.join('\n')}`);
    // The native calls are synchronous, so a read holds the main process for as long as it
    // takes. Measured on this rig on 2026-10-03: 35-40 ms for the USB device list, 25 ms for
    // the monitors, under 20 ms for the rest. That is why they stay on the main thread
    // (the renderer is its own process and never waits on them to draw). A read that holds
    // the thread for a quarter of a second would change that decision, so that is the limit.
    for (const [name, stall] of Object.entries(stalls)) {
      expect(stall, name).toBeLessThan(250);
    }
  });

  it('measures the stall of building a backup archive of the real DCS settings (read-only, nothing written)', async () => {
    const variables = await allPathVariables({ ports, log: nullLogger }, wiring.context.games);
    const user = variables['DCS_USER'];
    if (!user) {
      console.log('  NFR-003 backup archive: no DCS on this PC, nothing to measure');
      return;
    }
    // What "Back up now" reads for DCS: Config and Scripts of the Saved Games folder.
    const entries: ZipEntry[] = [];
    let bytes = 0;
    const reading = await stallOf(async () => {
      for (const folder of ['Config', 'Scripts']) {
        const tree = await ports.files.listTree(path.join(user, folder), { maxEntries: 5000 });
        if (!tree.ok) continue;
        for (const file of tree.value) {
          const data = await ports.files.readBytes(file.path);
          if (!data.ok) continue;
          entries.push({ path: `${folder}/${file.relativePath}`, data: data.value });
          bytes += data.value.length;
        }
      }
    });
    let zipped = 0;
    const atOnce = await stallOf(async () => {
      const zip = createZip(entries);
      expect(zip.ok).toBe(true);
      if (zip.ok) zipped = zip.value.length;
    });
    let stepped: Uint8Array | undefined;
    const inSteps = await stallOf(async () => {
      const zip = await createZipInSteps(entries);
      expect(zip.ok).toBe(true);
      if (zip.ok) stepped = zip.value;
    });
    // The same archive, file for file.
    const back = stepped ? readZip(stepped, { maxTotalBytes: 4 * 1024 ** 3 }) : undefined;
    expect(back?.ok && back.value.length).toBe(entries.length);
    console.log(
      `  NFR-003 backup archive of the real DCS Config and Scripts: ${entries.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${(zipped / 1024 / 1024).toFixed(1)} MB\n` +
        `    reading the files                  took ${ms(reading.elapsed).padStart(7)}, longest stall ${ms(reading.stall).padStart(7)}\n` +
        `    zipping at once (createZip)        took ${ms(atOnce.elapsed).padStart(7)}, longest stall ${ms(atOnce.stall).padStart(7)}\n` +
        `    zipping file by file (in steps)    took ${ms(inSteps.elapsed).padStart(7)}, longest stall ${ms(inSteps.stall).padStart(7)}`
    );
    // The backup uses the file-by-file form: the main process answers between files.
    expect(inSteps.stall).toBeLessThan(250);
  });
});

/** Runs the work and reports how long it took and the longest time nothing else could run. */
async function stallOf(work: () => Promise<void>): Promise<{ elapsed: number; stall: number }> {
  let last = performance.now();
  let gap = 0;
  const ticker = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
  }, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  gap = 0;
  last = performance.now();
  const { elapsed } = await timed(work);
  await new Promise((resolve) => setTimeout(resolve, 5));
  clearInterval(ticker);
  return { elapsed, stall: gap };
}
