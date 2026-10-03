import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { CheckContext } from '../src/core/checks/registry';
import { nullLogger } from '../src/core/logger';
import type { Clock } from '../src/core/ports';
import {
  applyLiveMutations,
  createFakePorts,
  loadRig,
  loadScenario,
  seedScenario,
  type FakePorts,
  type LoadedScenario,
  type SeedOptions,
} from '../src/platform/fake';
import { MutationSchema, type RigState } from '../src/platform/fake/scenario';
import { discoverFeatures, wireFeatures, type Wiring } from '../src/main/bootstrap';

export const repoRoot = path.resolve(__dirname, '..');
export const fixturesDir = path.join(repoRoot, 'fixtures');

/** A fresh temp directory, removed by the returned cleanup. Tests never touch the real profile. */
export async function tempDir(
  prefix = 'rigready-test-'
): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

/** A clock that only moves when told to. */
export class TestClock implements Clock {
  constructor(private ms = Date.parse('2026-10-03T12:00:00.000Z')) {}
  now(): Date {
    return new Date(this.ms);
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

export const markFull = (): Promise<RigState> =>
  loadRig(path.join(fixturesDir, 'rigs', 'mark-full'));

export interface TestRig {
  ports: FakePorts;
  ctx: CheckContext;
  clock: TestClock;
  home: string;
  cleanup: () => Promise<void>;
}

/** Fake ports on a named scenario (fixtures/scenarios/<name>.yaml), with profiles seeded like the app does. */
export async function scenarioRig(name: string, options: SeedOptions = {}): Promise<TestRig> {
  const loaded = await loadScenario(
    path.join(fixturesDir, 'scenarios', `${name}.yaml`),
    fixturesDir
  );
  const rig = await rigFromState(loaded.state, loaded.scripts);
  await seedScenario(loaded, rig.ports, options);
  return rig;
}

/** Changes the fake machine of a running test rig with scenario mutations (as in a scenario file). */
export function mutate(rig: TestRig, mutations: unknown[]): Promise<void> {
  return applyLiveMutations(rig.ports, z.array(MutationSchema).parse(mutations));
}

export async function rigFromState(
  state: RigState,
  scenario?: LoadedScenario['scripts']
): Promise<TestRig> {
  const { dir, cleanup } = await tempDir();
  const clock = new TestClock();
  const ports = createFakePorts({ state, homeDir: dir, clock, ...(scenario ? { scenario } : {}) });
  return { ports, ctx: { ports, log: nullLogger }, clock, home: dir, cleanup };
}

export interface WiredApp extends TestRig {
  wiring: Wiring;
  events: { channel: string; payload: unknown }[];
  /** Calls an IPC channel exactly as the renderer would, through validation. */
  invoke<T = unknown>(channel: string, input?: unknown): Promise<T>;
}

/** The whole main side (every discovered feature) wired onto fake ports for a scenario. */
export async function wiredApp(scenario: string, options: SeedOptions = {}): Promise<WiredApp> {
  const rig = await scenarioRig(scenario, options);
  const events: WiredApp['events'] = [];
  const wiring = wireFeatures({
    features: discoverFeatures(),
    ports: rig.ports,
    log: nullLogger,
    send: (channel, payload) => events.push({ channel, payload }),
  });
  return {
    ...rig,
    wiring,
    events,
    async invoke<T>(channel: string, input?: unknown): Promise<T> {
      const handler = wiring.handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      const envelope = await handler(input);
      if (!envelope.ok)
        throw new Error(
          `${channel}: ${envelope.error.code} ${envelope.error.message} ${envelope.error.detail ?? ''}`
        );
      return envelope.value as T;
    },
  };
}
