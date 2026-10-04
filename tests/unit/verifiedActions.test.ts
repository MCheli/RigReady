/**
 * NFR-006: no success message for something that did not happen.
 *
 * The audit makes the fake machine accept every change and carry out none (tests/sabotage.ts:
 * a program that is started and never shows up, a close that leaves the program running, a
 * layout that is accepted and not applied, a default audio device that stays, a file that is
 * written and put back), and then runs:
 *
 *   - every registered fix (remediation), with the parameters of every scenario setup whose
 *     check fails, of the capture screen, and a generated sample when neither has the type;
 *   - Stand down, Launch and every other IPC channel of every feature, with the ids the
 *     app itself hands out.
 *
 * None of them may answer "done". Features, fix types, channels and scenarios are all
 * discovered; a new feature folder is audited as soon as it exists.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureCandidates, runCheckItem } from '../../src/core/checks/engine';
import { withProfile, type RemediationDefinition } from '../../src/core/checks/registry';
import { isWithin } from '../../src/core/paths';
import type { ProcessProvider } from '../../src/core/ports';
import { verifiedProcesses } from '../../src/core/processes';
import { err, ok } from '../../src/core/result';
import { loadScenario } from '../../src/platform/fake';
import type { Envelope } from '../../src/shared/ipc';
import { channelName } from '../../src/shared/channels';
import { fixturesDir, wiredApp, type WiredApp } from '../helpers';
import { sabotage } from '../sabotage';
import { discoverContracts, leaves, sample, withValueAt } from '../schemaWalk';

// ---- what the audit collects ------------------------------------------------------------------

interface FixRun {
  where: string;
  type: string;
  /** The fix said it worked. */
  ok: boolean;
  message: string;
  /** What it asked of the machine while every change silently failed. */
  attempts: string[];
}

interface ChannelRun {
  scenario: string;
  channel: string;
  input: unknown;
  /** Changes asked of the machine outside RigReady's own data folder. */
  attempts: string[];
  envelope: Envelope;
  /**
   * Set for an answer that claims plain success: whether the same call changes the machine
   * when the machine works. False means it already was as asked, so "fine" was true.
   */
  changesWhenReal?: boolean;
}

/** How many scenarios get the sweep over every channel. */
const CHANNEL_SWEEPS = 6;

const fixRuns: FixRun[] = [];
const channelRuns: ChannelRun[] = [];
let registeredFixes: { type: string; kind: string }[] = [];
let standDownSteps: string[] = [];
const hung: string[] = [];
let scenariosAudited: string[] = [];

/**
 * Fixes whose result is read from the program itself, not from the machine afterwards. The
 * list must stay this short, and each entry is proven honest by a test of its own below.
 */
const VERIFIED_BY_EXIT_CODE: Record<string, string> = {
  'script.run':
    'a script succeeds by its exit code: that is the read-back. A script that exits with another code, cannot be found, or gets no process is an error (tested below); the check is run again afterwards by the engine',
};

/**
 * Channels that hand a file or a game to another program and have nothing to read back: Explorer
 * passes the request to the Explorer that is already running and exits at once. Their
 * answer says what was asked, not that a window is open.
 */
const HAND_OFF: Record<string, string> = {
  'profiles:openFile': 'asks Explorer to open the setup file with its default program',
  'profiles:showFile': 'asks Explorer to show the setup file in its folder',
  'backup:reveal': 'asks Explorer to show the backup file in its folder',
  'diagnostics:openLogFolder': 'asks Explorer to open the folder that holds the log files',
  'games:launch':
    'hands the game to Steam ("Asked Steam to start ..."): with Steam already running, the steam.exe that carries the request exits at once, so there is nothing to see; with Steam not running and not showing up, it is an error (tested below)',
};

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** A clock that moves a minute every time it is read, so "wait until" loops end. */
function fastClock(app: WiredApp): void {
  let tick = Date.parse('2026-10-03T12:00:00.000Z');
  app.ports.clock.now = () => new Date((tick += 60_000));
}

/** Ids and names the app hands out, by the key they were under. */
function harvest(value: unknown, into: Set<string>, key = ''): void {
  if (typeof value === 'string') {
    if (/^(id|\w+Id|guid|key|scope)$/.test(key) && value.length > 0 && value.length < 200) {
      into.add(value);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) harvest(item, into, key);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) harvest(v, into, k);
  }
}

/** Every `ok: true` step in an answer that says something was done (not skipped). */
function claimedSteps(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) claimedSteps(item, out);
  else if (value && typeof value === 'object') {
    const step = value as Record<string, unknown>;
    if (step['ok'] === true && typeof step['message'] === 'string' && step['skipped'] !== true) {
      out.push(step['message']);
    }
    for (const child of Object.values(step)) claimedSteps(child, out);
  }
  return out;
}

/** True when the answer itself says it did not work. */
function saysItFailed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(saysItFailed);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (object['ok'] === false) return true;
    if (object['outcome'] === 'failed' || object['outcome'] === 'paused') return true;
    return Object.values(object).some(saysItFailed);
  }
  return false;
}

async function auditFix(
  app: WiredApp,
  where: string,
  definition: RemediationDefinition,
  rawParams: unknown,
  profile?: Parameters<typeof withProfile>[1]
): Promise<void> {
  const params = definition.params.safeParse(rawParams);
  if (!params.success) return;
  const base = { ports: app.wiring.context.ports, log: app.wiring.context.log };
  const ctx = profile ? withProfile(base, profile) : base;
  const broken = sabotage(app.ports);
  try {
    const outcome = await withTimeout(
      definition
        .run(params.data, { ...ctx, output: () => {} })
        .catch((e: unknown) => err('threw', e instanceof Error ? e.message : String(e))),
      30_000
    );
    if (outcome === 'timeout') {
      hung.push(`${where} ${definition.type}`);
      return;
    }
    fixRuns.push({
      where,
      type: definition.type,
      ok: outcome.ok,
      message: outcome.ok ? outcome.value : `${outcome.error.code}: ${outcome.error.message}`,
      attempts: [...broken.attempts],
    });
  } finally {
    broken.restore();
  }
}

async function auditScenario(
  scenario: string,
  wantsChannels: (failing: string) => boolean
): Promise<string> {
  const app = await wiredApp(scenario);
  try {
    fastClock(app);
    const { checks: registry, profiles } = app.wiring.context;
    registeredFixes = registry
      .remediationTypes()
      .map((type) => ({ type, kind: registry.remediation(type)!.kind ?? 'action' }));
    standDownSteps = registry.standDownSteps().map((s) => s.id);
    const listed = await profiles.list();
    const failing: string[] = [];
    const failingItems: { profileId: string; itemId: string }[] = [];

    // 1. Every fix of every setup whose check is not met right now.
    for (const profile of listed.ok ? listed.value : []) {
      const ctx = withProfile(
        { ports: app.wiring.context.ports, log: app.wiring.context.log },
        profile
      );
      for (const item of profile.checks) {
        if (!item.remediation || item.disabled) continue;
        const definition = registry.remediation(item.remediation.type);
        if (!definition || (definition.kind ?? 'action') !== 'action') continue;
        const before = await runCheckItem(item, registry, ctx, { timeoutMs: 5000 });
        if (before.status === 'pass') continue;
        failing.push(`${item.type}>${definition.type}`);
        failingItems.push({ profileId: profile.id, itemId: item.id });
        await auditFix(
          app,
          `${scenario}/${profile.id}/${item.id}`,
          definition,
          item.remediation.params,
          profile
        );
      }
    }
    const dataRoot = app.ports.folders.dataRoot();
    const outsideDataRoot = (attempt: string): boolean => {
      if (!attempt.startsWith('files.')) return true;
      return !isWithin(dataRoot, attempt.slice(attempt.indexOf(' ') + 1));
    };
    /** One IPC call on the sabotaged machine; kept when it asked the machine for a change. */
    const audit = async (name: string, input: unknown): Promise<boolean> => {
      const handler = app.wiring.handlers.get(name)!;
      const broken = sabotage(app.ports);
      const envelope = await withTimeout(handler(input), 20_000);
      broken.restore();
      if (envelope === 'timeout') {
        hung.push(name);
        return false;
      }
      const attempts = broken.attempts.filter(outsideDataRoot);
      if (attempts.length === 0) return true;
      const run: ChannelRun = { scenario, channel: name, input, attempts, envelope };
      channelRuns.push(run);
      if (
        envelope.ok &&
        !saysItFailed(envelope.value) &&
        claimedSteps(envelope.value).length === 0
      ) {
        // It answered "fine". That is true when the machine already was as asked, and a lie
        // when the same call changes the machine once the machine works: try it for real,
        // then put the fake machine back.
        const machine = (): string =>
          JSON.stringify([
            app.ports.state.processes.map((p) => p.name).sort(),
            app.ports.state.displays,
            app.ports.state.audio,
          ]);
        const saved = structuredClone({
          processes: app.ports.state.processes,
          displays: app.ports.state.displays,
          audio: app.ports.state.audio,
        });
        const before = machine();
        await withTimeout(handler(input), 20_000);
        run.changesWhenReal = machine() !== before;
        Object.assign(app.ports.state, saved);
      }
      return true;
    };

    // 2. The fix button of every item that is not met, through IPC as the Fly screen calls it.
    for (const { profileId, itemId } of failingItems) {
      await audit('fly:fix', { profileId, itemId, confirmed: true });
    }
    const signature = failing.sort().join(',');
    if (!wantsChannels(signature)) return signature;

    // 3. Every IPC channel, with the ids this app hands out.
    const contracts = discoverContracts().filter((c) => c.feature !== 'app');
    const ids = new Map<string, Set<string>>();
    for (const contract of contracts) {
      const set = new Set<string>((listed.ok ? listed.value : []).map((p) => p.id));
      ids.set(contract.feature, set);
      for (const [key, def] of Object.entries(contract.channels)) {
        const name = channelName(contract.feature, key);
        if (!def.input.safeParse(undefined).success || hung.includes(name)) continue;
        // Under sabotage, so asking every channel changes nothing on the fake machine either.
        const broken = sabotage(app.ports);
        const answer = await withTimeout(app.wiring.handlers.get(name)!(undefined), 2000);
        broken.restore();
        if (answer === 'timeout') hung.push(name);
        else if (answer.ok) harvest(answer.value, set);
      }
    }
    for (const contract of contracts) {
      for (const [key, def] of Object.entries(contract.channels)) {
        const name = channelName(contract.feature, key);
        if (hung.includes(name)) continue;
        const base = sample(def.input);
        const fields = leaves(def.input);
        const idFields = fields.filter(
          (l) => l.type === 'string' && /^(id|\w+Id|guid|key|scope)$/.test(l.path.at(-1) ?? '')
        );
        const inputs: unknown[] = [base];
        // The same with every switch on ("close the game too", "close the app first").
        let allOn = base;
        for (const leaf of fields.filter((l) => l.type === 'boolean')) {
          const next = withValueAt(allOn, leaf.path, true);
          if (def.input.safeParse(next).success) allOn = next;
        }
        inputs.push(allOn);
        for (const id of [...(ids.get(contract.feature) ?? [])].slice(0, 6)) {
          let next = allOn;
          for (const leaf of idFields) {
            const candidate = withValueAt(next, leaf.path, id);
            if (def.input.safeParse(candidate).success) next = candidate;
          }
          if (idFields.length > 0) inputs.push(next);
        }
        const sent = new Set<string>();
        for (const input of inputs) {
          const text = JSON.stringify(input) ?? 'undefined';
          if (sent.has(text) || !def.input.safeParse(input).success) continue;
          sent.add(text);
          if (!(await audit(name, input))) break;
        }
      }
    }
    return signature;
  } finally {
    await app.cleanup();
  }
}

beforeAll(async () => {
  const dir = path.join(fixturesDir, 'scenarios');
  const names = (await fs.readdir(dir)).filter((f) => f.endsWith('.yaml')).sort();
  const seen = new Set<string>();
  for (const file of names) {
    const loaded = await loadScenario(path.join(dir, file), fixturesDir);
    if (loaded.profileFiles.length === 0) continue;
    const scenario = file.replace(/\.yaml$/, '');
    // The sweep over every channel is the slow part: once per distinct set of failing
    // checks (and once for a rig where everything is ready), six scenarios at most.
    await auditScenario(scenario, (failing) => {
      if (seen.has(failing) || seen.size >= CHANNEL_SWEEPS) return false;
      seen.add(failing);
      return true;
    });
    scenariosAudited.push(scenario);
  }

  // 3. Fix types no failing setup uses: the capture screen's parameters, then a sample.
  const app = await wiredApp('flying-all-good');
  try {
    fastClock(app);
    const registry = app.wiring.context.checks;
    const base = { ports: app.wiring.context.ports, log: app.wiring.context.log };
    const captured = await captureCandidates(registry, base);
    // Nothing is running any more, so "start it" and "it is already there" cannot be confused.
    app.ports.state.processes.length = 0;
    for (const type of registry.remediationTypes()) {
      const definition = registry.remediation(type)!;
      if ((definition.kind ?? 'action') !== 'action') continue;
      if (fixRuns.some((run) => run.type === type && run.attempts.length > 0)) continue;
      const candidates = captured.candidates
        .filter((c) => c.check.remediation?.type === type)
        .map((c) => c.check.remediation!.params as unknown);
      for (const params of [...candidates, sample(definition.params)]) {
        await auditFix(app, 'capture or sample', definition, params);
      }
    }
  } finally {
    await app.cleanup();
  }
}, 900_000);

afterAll(() => {
  scenariosAudited = [];
});

// ---- the verifying process port ---------------------------------------------------------------

describe('verifiedProcesses: a close is believed only when the process is gone', () => {
  const provider = (stays: boolean, listFails = false): ProcessProvider => {
    const running = [{ pid: 7, name: 'TrackIR5.exe' }];
    return {
      list: async () => (listFails ? err('process.list', 'no list') : ok([...running])),
      start: async () => ok({ pid: 8 }),
      stop: async () => {
        if (!stays) running.length = 0;
        return ok(undefined);
      },
      close: async () => {
        if (!stays) running.length = 0;
        return ok({ outcome: 'closed' as const });
      },
    };
  };

  it('passes a real close and stop through', async () => {
    const processes = verifiedProcesses(provider(false));
    expect(await processes.close(7)).toEqual(ok({ outcome: 'closed' }));
    expect(await verifiedProcesses(provider(false)).stop(7)).toEqual(ok(undefined));
    expect(await processes.start({ exe: 'C:\\x.exe', args: [] })).toEqual(ok({ pid: 8 }));
    expect(await processes.list()).toEqual(ok([]));
  });

  it('turns "closed" into process.stillRunning when the process is still in the list', async () => {
    const processes = verifiedProcesses(provider(true));
    expect(await processes.close(7, { waitMs: 10, force: true })).toMatchObject({
      ok: false,
      error: { code: 'process.stillRunning' },
    });
    expect(await processes.stop(7)).toMatchObject({
      ok: false,
      error: { code: 'process.stillRunning' },
    });
  });

  it('keeps the provider’s own error, and its answer when the list cannot be read', async () => {
    const failing: ProcessProvider = {
      ...provider(true),
      close: async () => err('process.stop', 'Access is denied.'),
      stop: async () => err('process.stop', 'Access is denied.'),
    };
    expect(await verifiedProcesses(failing).close(7)).toMatchObject({
      error: { code: 'process.stop' },
    });
    expect(await verifiedProcesses(failing).stop(7)).toMatchObject({
      error: { code: 'process.stop' },
    });
    expect(await verifiedProcesses(provider(true, true)).close(7)).toEqual(
      ok({ outcome: 'closed' })
    );
  });
});

// ---- the audit --------------------------------------------------------------------------------

describe('NFR-006 every registered fix verifies what it did', () => {
  it('the audit met every fix type that changes the machine, and none of them hung', () => {
    expect(scenariosAudited.length).toBeGreaterThan(20);
    expect(hung.filter((h) => h.includes(' '))).toEqual([]);
    const actions = registeredFixes.filter((f) => f.kind === 'action').map((f) => f.type);
    expect(actions.length).toBeGreaterThan(8);
    const attempted = new Set(fixRuns.filter((r) => r.attempts.length > 0).map((r) => r.type));
    const ran = new Set(fixRuns.map((r) => r.type));
    console.log(
      `  NFR-006: ${fixRuns.length} fix runs under sabotage over ${scenariosAudited.length} scenarios; fix types that tried to change the machine: ${[...attempted].sort().join(', ')}`
    );
    // Every action fix ran at least once with valid parameters.
    expect(actions.filter((type) => !ran.has(type))).toEqual([]);
  });

  it('no fix reports success when the change it asked for did not happen', () => {
    const lied = fixRuns.filter(
      (run) => run.ok && run.attempts.length > 0 && !(run.type in VERIFIED_BY_EXIT_CODE)
    );
    expect(lied.map((run) => `${run.where} ${run.type}: "${run.message}"`)).toEqual([]);
    // The honest ones say what is wrong, in words.
    const refused = fixRuns.filter((run) => !run.ok && run.attempts.length > 0);
    expect(refused.length).toBeGreaterThan(15);
    for (const run of refused) expect(run.message.length).toBeGreaterThan(10);
    expect(Object.keys(VERIFIED_BY_EXIT_CODE)).toEqual(['script.run']);
  });

  it('starting a program, applying a layout, setting an audio device and restoring a file were each caught', () => {
    const caught = (type: string, attempt: string): boolean =>
      fixRuns.some(
        (run) => run.type === type && !run.ok && run.attempts.some((a) => a.startsWith(attempt))
      );
    expect(caught('process.launch', 'processes.start')).toBe(true);
    expect(caught('display.applyLayout', 'displays.apply')).toBe(true);
    expect(caught('audio.setDefault', 'audio.setDefault')).toBe(true);
    expect(caught('file.restore', 'files.')).toBe(true);
  });
});

describe('NFR-006 a script fix is judged by what the script reports', () => {
  let app: WiredApp;
  afterAll(() => app?.cleanup());

  it('exit code 0 is success; another exit code, a missing script and a start without a process are errors', async () => {
    app = await wiredApp('generic-fresh', { files: [] });
    const definition = app.wiring.context.checks.remediation('script.run')!;
    const script = path.join(app.home, 'Documents', 'fix.cmd');
    await fs.mkdir(path.dirname(script), { recursive: true });
    await fs.writeFile(script, '');
    const ctx = { ports: app.wiring.context.ports, log: app.wiring.context.log };
    const run = (params: Record<string, unknown>) =>
      definition.run(definition.params.parse({ exe: script, ...params }), ctx);

    expect(await run({})).toEqual(ok('Ran fix.cmd'));
    app.ports.shell.scripts.push({
      match: { exe: 'fix.cmd', args: [] },
      result: { code: 3, stdout: 'no', stderr: '' },
    });
    expect(await run({})).toMatchObject({ ok: false, error: { code: 'script.exit' } });
    expect(await run({ exe: path.join(app.home, 'Documents', 'gone.cmd') })).toMatchObject({
      ok: false,
      error: { code: 'script.missing' },
    });
    // Started without waiting: Windows accepted the start, but there is no process.
    app.ports.state.faults = { hang: [], startFails: { 'fix.cmd': 'neverRuns' } };
    expect(await run({ waitForCompletion: false })).toMatchObject({
      ok: false,
      error: { code: 'script.notStarted' },
    });
    app.ports.state.faults = { hang: [], startFails: {} };
    expect(await run({ waitForCompletion: false })).toEqual(ok('Started fix.cmd'));
  });
});

describe('NFR-006 Stand down, Launch and every other action over IPC', () => {
  it('the audit reached the actions: Make ready, Stand down, Launch, layouts, audio, starts', () => {
    const reached = new Set(channelRuns.map((run) => run.channel));
    console.log(
      `  NFR-006: ${channelRuns.length} IPC calls asked the sabotaged machine for a change, on ${reached.size} channels: ${[...reached].sort().join(', ')}`
    );
    for (const channel of ['fly:makeReady', 'fly:standDown', 'fly:launch', 'fly:fix']) {
      expect(reached.has(channel), channel).toBe(true);
    }
    expect(standDownSteps).toContain('displays.deskLayout');
    // Channels that wait for the user (a key press, a countdown) are the only ones allowed to hang.
    expect(hung.filter((h) => !h.includes(' ')).length).toBeLessThan(6);
  });

  it('no answer contains a step that says "done" for a change that did not happen', () => {
    const lies = channelRuns.flatMap((run) =>
      run.envelope.ok
        ? claimedSteps(run.envelope.value).map(
            (message) => `${run.scenario} ${run.channel}: "${message}" (${run.attempts.join(', ')})`
          )
        : []
    );
    expect([...new Set(lies)]).toEqual([]);
  });

  it('every answer after a failed change is an error or says what failed, except the hand-offs to Explorer', () => {
    const unverified = channelRuns
      .filter((run) => run.envelope.ok && !saysItFailed(run.envelope.value))
      // "Fine" is true when the machine already was as asked (the control run changed nothing).
      .filter((run) => run.changesWhenReal !== false)
      .filter((run) => !(run.channel in HAND_OFF))
      .map(
        (run) =>
          `${run.scenario} ${run.channel} ${JSON.stringify(run.input)} -> ${JSON.stringify(run.envelope).slice(0, 200)} (${run.attempts.join(', ')})`
      );
    expect([...new Set(unverified)]).toEqual([]);
    // Four hand-offs to Explorer (three for a file, one for the log folder) and one to Steam.
    expect(Object.keys(HAND_OFF).length).toBeLessThanOrEqual(5);
  });

  it('Launch never says "launched" and Stand down never says "closed" under sabotage', () => {
    const launches = channelRuns.filter((run) => run.channel === 'fly:launch');
    expect(launches.length).toBeGreaterThan(0);
    for (const run of launches) {
      expect(run.envelope).toMatchObject({ ok: true });
      if (run.envelope.ok) {
        expect((run.envelope.value as { outcome: string }).outcome).not.toBe('launched');
      }
    }
    const standDowns = channelRuns.filter((run) => run.channel === 'fly:standDown');
    expect(standDowns.length).toBeGreaterThan(0);
    for (const run of standDowns) {
      const text = JSON.stringify(run.envelope);
      expect(text).not.toMatch(/"ok":true,"message":"Closed /);
      expect(text).toMatch(/still running/);
    }
  });

  it('a game handed to Steam is an error when Steam is not running and does not show up', async () => {
    const app = await wiredApp('flying-all-good', { files: ['Program Files (x86)/Steam/**'] });
    try {
      const games = await app.invoke<{ id: string }[]>('games:list');
      app.ports.state.processes = app.ports.state.processes.filter(
        (p) => p.name.toLowerCase() !== 'steam.exe'
      );
      const broken = sabotage(app.ports);
      let handedOff = 0;
      for (const game of games) {
        broken.attempts.length = 0;
        const answer = await app.wiring.handlers.get('games:launch')!({ gameId: game.id });
        if (!broken.attempts.some((a) => a === 'processes.start steam.exe')) continue;
        handedOff++;
        expect(answer, game.id).toMatchObject({ ok: false, error: { code: 'games.notStarted' } });
      }
      broken.restore();
      expect(handedOff).toBeGreaterThan(0);
      // The machine works again: Steam starts, and the answer says what was done.
      const steamGame = games.find((g) => g.id === 'dcs') ?? games[0]!;
      const answer = await app.wiring.handlers.get('games:launch')!({ gameId: steamGame.id });
      if (answer.ok) expect(JSON.stringify(answer.value)).toMatch(/Asked Steam|Started/);
    } finally {
      await app.cleanup();
    }
  });
});
