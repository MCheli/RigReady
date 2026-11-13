import { afterEach, describe, expect, it } from 'vitest';
import { runAsAssistant } from '../../../core/assistantScripts';
import { layoutToTargets } from '../../../core/displays/layouts';
import { err } from '../../../core/result';
import type { DisplayTarget } from '../../../shared/models';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { LayoutApplier, type KnownToWork } from './applier';
import { analyzeLayout } from './plan';
import { proofOf } from './proven';
import { RevertGuard, type Schedule } from './revertGuard';
import { ProvenStore, RecoveryStore } from './stores';

/**
 * When a monitor layout is applied without "Keep this monitor layout?": only by Make ready
 * and Stand down (applyKnown), and only for a change a person kept before on this PC with
 * the same monitors connected. Everything else, and any doubt, is asked.
 */

let rig: TestRig;
afterEach(() => rig?.cleanup());

const NO_FILES = { files: [] };
const WITHOUT = 'display layout applied without the question: kept before with these monitors';
const NOT_KEPT = {
  ok: false,
  error: {
    code: 'display.reverted',
    message: 'The new monitor layout was not kept, so the previous one is back.',
  },
};
const FLYING_ON = ['LC49G95T', 'USB_Monitor', 'USB_Monitor', 'USB_Monitor'];

async function targetsOf(scenario: string): Promise<DisplayTarget[]> {
  const r = await scenarioRig(scenario, NO_FILES);
  try {
    const layout = await r.ports.displays.read();
    if (!layout.ok) throw new Error('read failed');
    return layoutToTargets(layout.value);
  } finally {
    await r.cleanup();
  }
}

/** The desk arrangement, an applier wired as the app wires it, and the flying layout to apply. */
async function onTheDesk(options: { known?: false; proven?: Partial<KnownToWork['proven']> } = {}) {
  rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
  const { displays, files, folders, window } = rig.ports;
  const start = await displays.read();
  if (!start.ok) throw new Error('read failed');
  const desk = layoutToTargets(start.value);
  const deskOn = start.value.displays.filter((d) => d.enabled).map((d) => d.name);
  // The flying layout, for the monitors as they are connected here.
  const flying = analyzeLayout(await targetsOf('flying-all-good'), start.value.displays).targets;
  const proof = proofOf(flying, start.value.displays)!;

  const events: string[] = [];
  let fire: (() => void) | undefined;
  const schedule: Schedule = (fn) => {
    fire = fn;
    return () => (fire = undefined);
  };
  // Who waits for the question: woken when the guard asks, so no test waits on a clock.
  const askWaiters: Array<() => void> = [];
  const guard = new RevertGuard(
    displays,
    {
      armed: (seconds, askedBy) => {
        events.push(askedBy ? `asked for ${seconds} s by ${askedBy}` : `asked for ${seconds} s`);
        for (const wake of askWaiters.splice(0)) wake();
      },
      settled: (outcome) => events.push(outcome),
    },
    15,
    schedule
  );
  const recovery = new RecoveryStore(files, folders.dataRoot(), rig.clock);
  const store = new ProvenStore(files, folders.dataRoot(), rig.clock);
  const log: string[] = [];
  const count = { unasked: 0 };
  const known: KnownToWork = {
    proven: {
      has: (p) => store.has(p),
      add: (p) => store.add(p),
      forget: (p) => store.forget(p),
      ...options.proven,
    },
    unasked: () => void count.unasked++,
    log: (line) => void log.push(line),
  };
  const applier = new LayoutApplier(
    displays,
    guard,
    recovery,
    window,
    options.known === false ? undefined : known
  );
  const asked = (): Promise<void> =>
    guard.pending ? Promise.resolve() : new Promise((resolve) => askWaiters.push(resolve));
  const backToDesk = async (): Promise<void> => {
    const back = await displays.apply(desk);
    if (!back.ok) throw new Error(back.error.message);
  };
  return {
    applier,
    guard,
    recovery,
    events,
    log,
    count,
    desk,
    deskOn,
    flying,
    asked,
    backToDesk,
    /** The countdown runs out. */
    timeout: () => fire?.(),
    /** True when the flying layout is known to work with these monitors. */
    kept: () => store.has(proof),
    on: () => rig.ports.state.displays.filter((d) => d.enabled).map((d) => d.name),
    /** Make ready applies the flying layout, a person keeps it, and the desk is put back. */
    async keepOnce(): Promise<void> {
      const running = applier.applyKnown(flying);
      await asked();
      await applier.keep();
      await running;
      await backToDesk();
    },
  };
}

describe('a layout applied by Make ready or Stand down', () => {
  it('is asked about the first time, and the question says it is asked once', async () => {
    const t = await onTheDesk();
    let done = false;
    const running = t.applier.applyKnown(t.flying).finally(() => (done = true));
    await t.asked();
    // Whatever follows in Make ready waits for the answer.
    expect(done).toBe(false);
    expect(t.events).toEqual(['asked for 15 s']);
    expect(t.applier.firstTime).toBe(true);
    expect(t.on()).toEqual(FLYING_ON);
    expect(await t.kept()).toBe(false);

    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.applier.firstTime).toBe(false);
    expect(await t.kept()).toBe(true);
    expect(t.count.unasked).toBe(0);
    expect(t.log).toEqual([]);
  });

  it('is applied without the question once it was kept with these monitors: no countdown, and nothing left to offer after a restart', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    expect(t.on()).toEqual(t.deskOn);

    expect(await t.applier.applyKnown(t.flying)).toMatchObject({ ok: true });
    expect(t.on()).toEqual(FLYING_ON);
    // No second question was asked.
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.guard.pending).toBe(false);
    expect(t.applier.firstTime).toBe(false);
    expect(await t.recovery.read()).toBeUndefined();
    expect(t.count.unasked).toBe(1);
    expect(t.log).toEqual([WITHOUT]);
    // And the next time, and the one after.
    await t.backToDesk();
    expect(await t.applier.applyKnown(t.flying)).toMatchObject({ ok: true });
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.count.unasked).toBe(2);
  });

  it('is applied without the question when it was kept by hand on the Monitors page', async () => {
    const t = await onTheDesk();
    const byHand = t.applier.applyAndWait(t.flying);
    await t.asked();
    // A change made by hand is always asked about, and never called "asked once".
    expect(t.applier.firstTime).toBe(false);
    expect(await t.applier.keep()).toBe(true);
    expect(await byHand).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(true);
    await t.backToDesk();

    expect(await t.applier.applyKnown(t.flying)).toMatchObject({ ok: true });
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.count.unasked).toBe(1);
  });

  it('is asked about again when another monitor is connected', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    const dell = rig.ports.state.displays.find((d) => d.name === 'DELL G3223D')!;
    rig.ports.state.displays.push({
      ...structuredClone(dell),
      id: '\\\\?\\display#tv00001#5&1509d400&0&uid4999#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}',
      name: 'TV',
      enabled: false,
      primary: false,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });

    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(t.events).toEqual(['asked for 15 s', 'kept', 'asked for 15 s']);
    expect(t.applier.firstTime).toBe(true);
    expect(t.count.unasked).toBe(0);
    t.timeout();
    expect(await running).toEqual(NOT_KEPT);
    expect(t.on()).toEqual(t.deskOn);
  });

  it('says exactly what Windows refused, puts the monitors back, and asks the next time', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    const real = rig.ports.displays.apply.bind(rig.ports.displays);
    let calls = 0;
    rig.ports.displays.apply = async (targets) => {
      calls++;
      if (calls === 1) {
        // Windows turned the Dell off, then refused a mode.
        rig.ports.state.displays.find((d) => d.name === 'DELL G3223D')!.enabled = false;
        return err(
          'display.mode',
          'Could not apply the monitor layout.',
          'USB_Monitor does not offer 768x1024'
        );
      }
      return real(targets);
    };

    expect(await t.applier.applyKnown(t.flying)).toEqual({
      ok: false,
      error: {
        code: 'display.mode',
        message: 'Could not apply the monitor layout.',
        detail: 'USB_Monitor does not offer 768x1024 The previous layout was put back.',
      },
    });
    expect(t.on()).toEqual(t.deskOn);
    // Nothing was reported as applied, and no question was put up for a change that is not there.
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.count.unasked).toBe(0);
    expect(t.log).toEqual([]);
    expect(await t.recovery.read()).toBeUndefined();
    // It worked before and did not now: it is no longer known to work.
    expect(await t.kept()).toBe(false);

    rig.ports.displays.apply = real;
    const again = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(t.applier.firstTime).toBe(true);
    t.timeout();
    expect(await again).toEqual(NOT_KEPT);
  });

  it('is asked about after all when Windows took it but the monitors are not as they were kept', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    const real = rig.ports.displays.apply.bind(rig.ports.displays);
    rig.ports.displays.apply = async (targets) => {
      const applied = await real(targets);
      // Windows said yes, but one small screen stayed in landscape.
      const mfd = rig.ports.state.displays.find((d) => d.name === 'USB_Monitor')!;
      Object.assign(mfd, { rotation: 0, width: mfd.height, height: mfd.width });
      return applied;
    };

    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(t.events).toEqual(['asked for 15 s', 'kept', 'asked for 15 s']);
    // Keeping this one would not end the asking, so the question does not say so.
    expect(t.applier.firstTime).toBe(false);
    expect(t.count.unasked).toBe(0);
    expect(t.log).toHaveLength(1);
    expect(t.log[0]).toMatch(
      /^display layout not as it was kept \(USB_Monitor is rotated 0°, asked 90°; .+\): asking$/
    );
    expect(await t.kept()).toBe(false);
    // The way back is still on disk while the question is open.
    expect(await t.recovery.read()).toBeDefined();

    t.timeout();
    expect(await running).toEqual(NOT_KEPT);
    expect(t.on()).toEqual(t.deskOn);
  });

  it('does not count a "Keep it" for monitors that are not as the layout says', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    const real = rig.ports.displays.apply.bind(rig.ports.displays);
    rig.ports.displays.apply = async (targets) => {
      const applied = await real(targets);
      const mfd = rig.ports.state.displays.find((d) => d.name === 'USB_Monitor')!;
      Object.assign(mfd, { rotation: 0, width: mfd.height, height: mfd.width });
      return applied;
    };
    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(false);
  });

  it('is asked about while another change is still waiting for its answer', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    // Someone switched the Dell off by hand and has not answered yet.
    const byHand = await t.applier.apply(t.flying.filter((target) => !target.enabled));
    expect(byHand.ok).toBe(true);
    expect(t.guard.pending).toBe(true);

    const running = t.applier.applyKnown(t.flying);
    await expect.poll(() => t.events.length).toBe(4);
    expect(t.events).toEqual(['asked for 15 s', 'kept', 'asked for 15 s', 'asked for 15 s']);
    expect(t.count.unasked).toBe(0);
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
  });

  it('is always asked about when nothing remembers what was kept', async () => {
    const t = await onTheDesk({ known: false });
    for (let round = 0; round < 2; round++) {
      const running = t.applier.applyKnown(t.flying);
      await t.asked();
      // Keeping it would not end the asking, so the question does not say so.
      expect(t.applier.firstTime).toBe(false);
      expect(await t.applier.keep()).toBe(true);
      expect(await running).toMatchObject({ ok: true });
      await t.backToDesk();
    }
    expect(t.events).toEqual(['asked for 15 s', 'kept', 'asked for 15 s', 'kept']);
  });

  it('is asked about, and not called "asked once", when it cannot be said what the change comes to', async () => {
    const t = await onTheDesk();
    // The same monitor named twice: which of the two counts cannot be said.
    const twice = [...t.flying, t.flying[0]!];
    const running = t.applier.applyKnown(twice);
    await t.asked();
    expect(t.applier.firstTime).toBe(false);
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(false);
  });

  it('changes nothing when the monitors cannot be read, or the way back cannot be saved', async () => {
    const t = await onTheDesk();
    await t.keepOnce();
    const before = structuredClone(rig.ports.state.displays);
    const realWrite = rig.ports.files.write.bind(rig.ports.files);
    rig.ports.files.write = async () => err('file.write', 'Disk full.');
    expect(await t.applier.applyKnown(t.flying)).toEqual({
      ok: false,
      error: {
        code: 'display.recovery',
        message:
          'Could not save the current monitor layout before changing it, so nothing was changed.',
        detail: 'Disk full.',
      },
    });
    expect(rig.ports.state.displays).toEqual(before);
    rig.ports.files.write = realWrite;

    const realRead = rig.ports.displays.read.bind(rig.ports.displays);
    rig.ports.displays.read = async () => err('display.read', 'Could not read the monitors.');
    const unread = { ok: false, error: { code: 'display.read' } };
    expect(await t.applier.applyKnown(t.flying)).toMatchObject(unread);
    expect(await t.applier.apply(t.flying)).toMatchObject(unread);
    rig.ports.displays.read = realRead;
    expect(rig.ports.state.displays).toEqual(before);
    expect(t.events).toEqual(['asked for 15 s', 'kept']);
    expect(t.count.unasked).toBe(0);
  });
});

describe('what counts as kept', () => {
  it('is not a countdown that ran out: the layout goes back and is asked about again', async () => {
    const t = await onTheDesk();
    const first = t.applier.applyKnown(t.flying);
    await t.asked();
    t.timeout();
    expect(await first).toEqual(NOT_KEPT);
    expect(t.events).toEqual(['asked for 15 s', 'reverted']);
    expect(t.on()).toEqual(t.deskOn);
    expect(await t.kept()).toBe(false);
    // Nothing is open any more, so there is nothing to keep.
    expect(await t.applier.keep()).toBe(false);

    const second = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(t.applier.firstTime).toBe(true);
    t.timeout();
    expect(await second).toEqual(NOT_KEPT);
  });

  it('is not a "Keep it" after a monitor was unplugged or turned while the question was open', async () => {
    const t = await onTheDesk();
    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    const mfd = rig.ports.state.displays.find((d) => d.name === 'USB_Monitor')!;
    rig.ports.state.displays = rig.ports.state.displays.filter((d) => d !== mfd);
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(false);

    // Plugged in again, but someone turned it in Windows before answering.
    rig.ports.state.displays.push(mfd);
    await t.backToDesk();
    const again = t.applier.applyKnown(t.flying);
    await t.asked();
    const turned = rig.ports.state.displays.find((d) => d.id === mfd.id)!;
    Object.assign(turned, { rotation: 0, width: turned.height, height: turned.width });
    expect(await t.applier.keep()).toBe(true);
    expect(await again).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(false);
  });

  it('is not a "Keep it" when the monitors cannot be read back', async () => {
    const t = await onTheDesk();
    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    rig.ports.displays.read = async () => err('display.read', 'Could not read the monitors.');
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(await t.kept()).toBe(false);
  });

  it('keeps the layout all the same when it cannot be remembered, and notes why', async () => {
    const t = await onTheDesk({
      proven: { add: async () => err('file.write', 'The disk is full.') },
    });
    const running = t.applier.applyKnown(t.flying);
    await t.asked();
    expect(await t.applier.keep()).toBe(true);
    expect(await running).toMatchObject({ ok: true });
    expect(t.on()).toEqual(FLYING_ON);
    expect(t.log).toEqual(['could not remember the kept monitor layout: The disk is full.']);
    expect(await t.kept()).toBe(false);
  });
});

describe('a change an assistant asked for', () => {
  it('waits at least a minute and names the assistant, and its own "keep" proves nothing', async () => {
    const t = await onTheDesk();
    const applied = await runAsAssistant('Claude Desktop', () => t.applier.apply(t.flying));
    expect(applied.ok).toBe(true);
    expect(t.events).toEqual(['asked for 60 s by Claude Desktop']);
    expect(t.guard.running).toEqual({ seconds: 60, askedBy: 'Claude Desktop' });
    // The assistant cannot see the screens. Its "keep" keeps the layout and nothing more.
    expect(await runAsAssistant('Claude Desktop', () => t.applier.keep())).toBe(true);
    expect(t.events).toEqual(['asked for 60 s by Claude Desktop', 'kept']);
    expect(t.guard.running).toBeUndefined();
    expect(await t.kept()).toBe(false);
  });

  it('waits as long as the setting when that is longer, and counts when the person at the screens keeps it', async () => {
    const t = await onTheDesk();
    t.guard.seconds = 90;
    await runAsAssistant('Claude Desktop', () => t.applier.apply(t.flying));
    expect(t.events).toEqual(['asked for 90 s by Claude Desktop']);
    // "Keep it" pressed in RigReady's window, by whoever is looking at the monitors.
    expect(await t.applier.keep()).toBe(true);
    expect(await t.kept()).toBe(true);
  });

  it('goes back by itself when nobody answers', async () => {
    const t = await onTheDesk();
    const running = runAsAssistant('Claude Desktop', () => t.applier.applyAndWait(t.flying));
    await t.asked();
    t.timeout();
    expect(await running).toEqual(NOT_KEPT);
    expect(t.on()).toEqual(t.deskOn);
    expect(await t.kept()).toBe(false);
  });
});
