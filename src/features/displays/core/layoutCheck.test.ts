import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayLayoutStore } from '../../../core/displays/layouts';
import { err } from '../../../core/result';
import type { DisplayProvider } from '../../../core/ports';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import { LayoutApplier } from './applier';
import type { MonitorNames } from './labels';
import {
  createApplyLayoutRemediation,
  createDisplayCapture,
  createLayoutCheck,
  LayoutParamsSchema,
  targetFromDisplay,
  type LayoutDeps,
  type LayoutParams,
} from './layoutCheck';
import { RevertGuard, type Schedule } from './revertGuard';
import { RecoveryStore } from './stores';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const NO_FILES = { files: [] };

/** The layout a scenario is in right now, as a profile would store it. */
async function currentLayout(r: TestRig): Promise<LayoutParams> {
  const layout = await r.ports.displays.read();
  if (!layout.ok) throw new Error('read failed');
  return LayoutParamsSchema.parse({ displays: layout.value.displays.map(targetFromDisplay) });
}

async function flyingLayout(): Promise<LayoutParams> {
  const r = await scenarioRig('flying-all-good', NO_FILES);
  try {
    return await currentLayout(r);
  } finally {
    await r.cleanup();
  }
}

function depsFor(r: TestRig, names: MonitorNames = {}): LayoutDeps {
  return {
    names: async () => names,
    layouts: new DisplayLayoutStore(r.ports.files, r.ports.folders.dataRoot(), r.clock),
  };
}

function manualGuard(displays: DisplayProvider, seconds = 15) {
  const events: string[] = [];
  let fire: (() => void) | undefined;
  let cancelled = 0;
  const schedule: Schedule = (fn) => {
    fire = fn;
    return () => {
      cancelled++;
      fire = undefined;
    };
  };
  const guard = new RevertGuard(
    displays,
    { armed: (s) => events.push(`armed ${s}`), settled: (o) => events.push(o) },
    seconds,
    schedule
  );
  return { guard, events, timeout: () => fire?.(), cancelled: () => cancelled };
}

function fixFor(r: TestRig, names: MonitorNames = {}) {
  const harness = manualGuard(r.ports.displays);
  const recovery = new RecoveryStore(r.ports.files, r.ports.folders.dataRoot(), r.clock);
  const applier = new LayoutApplier(r.ports.displays, harness.guard, recovery, r.ports.window);
  const remediation = createApplyLayoutRemediation({ ...depsFor(r, names), applier });
  return { ...harness, recovery, applier, remediation };
}

const MFD_NAMES: MonitorNames = {
  '\\\\?\\display#reg0319#a&2c1ac5a9&0&uid256#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}': 'MFD left',
  '\\\\?\\display#reg0319#a&270816bc&0&uid256#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}': 'MFD centre',
  '\\\\?\\display#reg0319#a&2f291759&0&uid256#{e6f07b5f-ee97-4a90-b076-33f57bf4eaa7}': 'MFD right',
};

describe('display.layout check', () => {
  it('passes when the monitors are arranged as the setup expects', async () => {
    rig = await scenarioRig('flying-all-good', NO_FILES);
    const good = await currentLayout(rig);
    expect(await createLayoutCheck(depsFor(rig)).run(good, rig.ctx)).toEqual({
      pass: true,
      summary: '4 monitors arranged as expected',
    });
  });

  it('names the one MFD screen that is rotated wrong, telling identical monitors apart', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('flying-mfd-rotated', NO_FILES);
    const outcome = await createLayoutCheck(depsFor(rig)).run(good, rig.ctx);
    expect(outcome).toEqual({
      pass: false,
      summary: '2 differences',
      details: [
        'USB_Monitor (2 of 3) is rotated 0°, expected 90°',
        'USB_Monitor (2 of 3) is 1024x768, expected 768x1024',
      ],
    });
    // With the names given through Identify, the message says which physical screen it is.
    const named = await createLayoutCheck(depsFor(rig, MFD_NAMES)).run(good, rig.ctx);
    expect(named.details).toEqual([
      'MFD centre is rotated 0°, expected 90°',
      'MFD centre is 1024x768, expected 768x1024',
    ]);
  });

  it('lists every difference between the desk state and the flying layout', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const outcome = await createLayoutCheck(depsFor(rig)).run(good, rig.ctx);
    expect(outcome.pass).toBe(false);
    const details = outcome.details ?? [];
    expect(details).toContain('DELL G3223D is on, expected off');
    expect(details).toContain('LC49G95T is at 2560,0, expected 0,0');
    expect(details).toContain('LC49G95T is not the main display');
    expect(details).toContain('USB_Monitor (1 of 3) is rotated 0°, expected 90°');
    expect(details.filter((d) => d.startsWith('USB_Monitor'))).toHaveLength(9);
    expect(outcome.summary).toBe(`${details.length} differences`);
  });

  it('says a monitor is not connected rather than reporting a rotation mismatch', async () => {
    rig = await scenarioRig('flying-all-good', NO_FILES);
    const good = await currentLayout(rig);
    const check = createLayoutCheck(depsFor(rig));
    const tv = {
      id: '\\\\?\\display#tv00001#5&1509d400&0&uid4361#{x}',
      name: 'TV',
      enabled: true,
      primary: false,
      x: 640,
      y: -2160,
      width: 3840,
      height: 2160,
      rotation: 90 as const,
    };
    expect(await check.run({ displays: [...good.displays, tv] }, rig.ctx)).toEqual({
      pass: false,
      summary: 'TV is not connected',
      details: [],
    });
    // A monitor that should be off and is not connected at all is as good as off.
    expect(
      await check.run({ displays: [...good.displays, { ...tv, enabled: false }] }, rig.ctx)
    ).toMatchObject({ pass: true });
    const dellOn = good.displays.map((d) =>
      d.name === 'DELL G3223D' ? { ...d, enabled: true, x: 9000, width: 2560, height: 1440 } : d
    );
    expect(await check.run({ displays: dellOn }, rig.ctx)).toMatchObject({
      summary: 'DELL G3223D is off, expected on',
    });
    rig.ports.displays.read = async () =>
      err('display.read', 'Could not read the monitor configuration.');
    expect(await check.run(good, rig.ctx)).toEqual({
      pass: false,
      summary: 'Could not read the monitor configuration.',
    });
  });

  it('compares the refresh rate only when the layout gives one', async () => {
    rig = await scenarioRig('flying-all-good', NO_FILES);
    const good = await currentLayout(rig);
    const check = createLayoutCheck(depsFor(rig));
    // The capture does not store refresh rates, so a different rate does not matter...
    rig.ports.state.displays.find((d) => d.name === 'LC49G95T')!.refreshHz = 60;
    expect((await check.run(good, rig.ctx)).pass).toBe(true);
    // ...unless the layout asks for one.
    const wants120 = good.displays.map((d) =>
      d.name === 'LC49G95T' ? { ...d, refreshHz: 120 } : d
    );
    expect(await check.run({ displays: wants120 }, rig.ctx)).toMatchObject({
      pass: false,
      summary: 'LC49G95T runs at 60 Hz, expected 120 Hz',
    });
    rig.ports.state.displays.find((d) => d.name === 'LC49G95T')!.refreshHz = 119.88;
    expect((await check.run({ displays: wants120 }, rig.ctx)).pass).toBe(true);
  });

  it('tells the identical MFD screens apart when two of them swapped places, naming both', async () => {
    rig = await scenarioRig('displays-mfd-swapped', NO_FILES);
    const good = await flyingLayout();
    const outcome = await createLayoutCheck(depsFor(rig, MFD_NAMES)).run(good, rig.ctx);
    expect(outcome).toEqual({
      pass: false,
      summary: '2 differences',
      details: [
        'MFD left is at 5888,0, expected 5120,0',
        'MFD centre is at 5120,0, expected 5888,0',
      ],
    });
  });

  it('follows the saved layout it names, and falls back to its own copy when that is deleted', async () => {
    rig = await scenarioRig('displays-layouts', NO_FILES);
    const deps = depsFor(rig);
    const check = createLayoutCheck(deps);
    const desk = await currentLayout(rig);
    const params = { layoutId: 'flying', layoutName: 'Flying', displays: desk.displays };
    // The saved "Flying" layout counts, not the copy made when the setup was created.
    const outcome = await check.run(params, rig.ctx);
    expect(outcome.pass).toBe(false);
    expect(outcome.details).toContain('DELL G3223D is on, expected off');
    await new DisplayLayoutStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock).remove(
      'flying'
    );
    expect(await check.run(params, rig.ctx)).toEqual({
      pass: true,
      summary: 'Arranged as "Flying" (5 monitors on)',
      details: [
        'The saved layout "Flying" no longer exists; compared with the copy kept in this setup.',
      ],
    });
    const deskOnly = await check.run({ layoutId: 'desk', displays: desk.displays }, rig.ctx);
    expect(deskOnly.pass).toBe(false);
    expect(deskOnly.details).toContain('USB_Monitor (1 of 3) is on, expected off');
  });
});

describe('display.applyLayout fix', () => {
  it('turns the desk state into the flying layout, saving the old one first, and arms the timed revert', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation, events, guard, recovery } = fixFor(rig);
    const check = createLayoutCheck(depsFor(rig));
    expect(remediation.describe(good)).toBe('Apply the monitor layout');
    expect(remediation.describe({ ...good, layoutName: 'Flying' })).toBe(
      'Apply the "Flying" layout'
    );
    expect((await check.run(good, rig.ctx)).pass).toBe(false);
    // The fix applies the layout and then waits for the answer to "Keep this layout?".
    let finished = false;
    const running = remediation.run(good, rig.ctx).finally(() => (finished = true));
    await expect.poll(() => guard.pending).toBe(true);
    expect(finished).toBe(false);
    expect((await check.run(good, rig.ctx)).pass).toBe(true);
    // The Dell is off, the three MFD screens are on in portrait, the ultrawide is main.
    const state = rig.ports.state.displays;
    expect(state.filter((d) => d.enabled).map((d) => d.name)).toEqual([
      'LC49G95T',
      'USB_Monitor',
      'USB_Monitor',
      'USB_Monitor',
    ]);
    expect(state.find((d) => d.primary)?.name).toBe('LC49G95T');
    expect(events).toEqual(['armed 15']);
    expect(guard.pending).toBe(true);
    // The desk layout was on disk before anything changed.
    const saved = await recovery.read();
    expect(saved?.displays.find((d) => d.name === 'DELL G3223D')).toMatchObject({
      enabled: true,
      primary: true,
    });
    // The RigReady window was put on a monitor that stays on before the change (the
    // ultrawide, where it was then; never the Dell, which goes dark), and is on the new
    // main display afterwards: the question is always somewhere the user can see it.
    const [beforeChange, afterChange] = rig.ports.window.shown;
    expect(beforeChange).toHaveLength(4);
    expect(beforeChange![0]).toEqual({ x: 2560, y: 0, width: 5120, height: 1440 });
    expect(beforeChange!.some((a) => a.x === 0 && a.width === 2560)).toBe(false);
    expect(afterChange![0]).toEqual({ x: 0, y: 0, width: 5120, height: 1440 });
    expect(afterChange).toHaveLength(4);
    guard.keep();
    expect(await running).toEqual({ ok: true, value: 'Applied the layout to 4 monitors' });
    // Nothing to do the second time.
    expect(await remediation.run(good, rig.ctx)).toEqual({
      ok: true,
      value: 'The monitors already match the layout',
    });
  });

  it('applies nothing when a monitor of the layout is not connected', async () => {
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation, events } = fixFor(rig);
    const before = structuredClone(rig.ports.state.displays);
    const good = await flyingLayout();
    const tv = { id: 'tv', name: 'TV', enabled: true, primary: false, x: 0, y: -1080 };
    const result = await remediation.run(
      LayoutParamsSchema.parse({ displays: [...good.displays, tv] }),
      rig.ctx
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'display.missing',
        message: 'TV is not connected, so the layout was not applied.',
      },
    });
    expect(events).toEqual([]);
    expect(rig.ports.state.displays).toEqual(before);
  });

  it('refuses a layout whose monitors would overlap', async () => {
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation, events } = fixFor(rig);
    const good = await flyingLayout();
    const overlapping = good.displays.map((d) =>
      d.name === 'USB_Monitor' ? { ...d, x: 5000 } : d
    );
    const result = await remediation.run({ displays: overlapping }, rig.ctx);
    expect(result).toMatchObject({ ok: false, error: { code: 'display.invalid' } });
    if (!result.ok)
      expect(result.error.detail).toContain('LC49G95T and USB_Monitor (1 of 3) overlap.');
    expect(events).toEqual([]);
  });

  it('puts the old layout back when an apply fails part-way, and never reports success', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation, events, recovery } = fixFor(rig);
    const before = structuredClone(rig.ports.state.displays);
    const realApply = rig.ports.displays.apply.bind(rig.ports.displays);
    let calls = 0;
    rig.ports.displays.apply = async (targets) => {
      calls++;
      if (calls === 1) {
        // Windows turned the Dell off, then refused the rest.
        rig.ports.state.displays.find((d) => d.name === 'DELL G3223D')!.enabled = false;
        return err('display.apply', 'Could not apply the monitor layout.', 'SetDisplayConfig 87');
      }
      return realApply(targets);
    };
    const result = await remediation.run(good, rig.ctx);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'display.apply',
        message: 'Could not apply the monitor layout.',
        detail: 'SetDisplayConfig 87 The previous layout was put back.',
      },
    });
    expect(rig.ports.state.displays.filter((d) => d.enabled)).toHaveLength(
      before.filter((d) => d.enabled).length
    );
    expect(events).toEqual([]);
    expect(await recovery.read()).toBeUndefined();
  });

  it('reports when even the rollback fails, and when nothing changed it says nothing extra', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation } = fixFor(rig);
    rig.ports.displays.apply = async () => {
      rig.ports.state.displays[0]!.x = 123;
      return err('display.apply', 'Could not apply the monitor layout.');
    };
    const failed = await remediation.run(good, rig.ctx);
    expect(failed.ok || failed.error.detail).toBe(
      'Putting the previous layout back failed too: Could not apply the monitor layout.'
    );
    rig.ports.displays.apply = async () => err('display.apply', 'Refused.');
    const refused = await remediation.run(good, rig.ctx);
    expect(refused).toEqual({ ok: false, error: { code: 'display.apply', message: 'Refused.' } });
  });

  it('does not change anything when the current layout cannot be saved first', async () => {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const { remediation, events } = fixFor(rig);
    rig.ports.files.write = async () => err('file.write', 'Disk full.');
    const before = structuredClone(rig.ports.state.displays);
    expect(await remediation.run(good, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'display.recovery' },
    });
    expect(rig.ports.state.displays).toEqual(before);
    expect(events).toEqual([]);
  });
});

describe('RevertGuard', () => {
  async function applied() {
    const good = await flyingLayout();
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const desk = await currentLayout(rig);
    const harness = fixFor(rig);
    const running = harness.remediation.run(good, rig.ctx);
    await expect.poll(() => harness.guard.pending).toBe(true);
    return { ...harness, running, good, desk, check: createLayoutCheck(depsFor(rig)) };
  }

  it('reverts by itself when nobody confirms in time, and the fix says the layout was not kept', async () => {
    const { guard, events, timeout, desk, check, running } = await applied();
    timeout();
    await expect.poll(() => events).toEqual(['armed 15', 'reverted']);
    expect(guard.pending).toBe(false);
    expect((await check.run(desk, rig.ctx)).pass).toBe(true);
    expect(await running).toEqual({
      ok: false,
      error: {
        code: 'display.reverted',
        message: 'The new monitor layout was not kept, so the previous one is back.',
      },
    });
  });

  it('keep stops the countdown and leaves the layout, which Stand down can still revert', async () => {
    const { guard, events, good, desk, cancelled, check, running } = await applied();
    guard.keep();
    guard.keep();
    expect(await running).toMatchObject({ ok: true });
    expect(events).toEqual(['armed 15', 'kept']);
    expect(cancelled()).toBe(1);
    expect((await check.run(good, rig.ctx)).pass).toBe(true);
    const reverted = await guard.revertNow();
    expect(reverted.ok).toBe(true);
    expect((await check.run(desk, rig.ctx)).pass).toBe(true);
    expect(await guard.revertNow()).toMatchObject({
      ok: false,
      error: { code: 'display.norevert' },
    });
  });

  it('reports a revert that fails', async () => {
    const { guard, events, running } = await applied();
    rig.ports.displays.revert = async () => err('display.revert', 'Could not restore.');
    expect(await guard.revertNow()).toMatchObject({ ok: false });
    expect(events).toEqual(['armed 15', 'revertFailed']);
    expect(await running).toMatchObject({ ok: false, error: { code: 'display.revert' } });
  });

  it('uses a real timer by default', async () => {
    rig = await scenarioRig('desk-mfds-wrong', NO_FILES);
    const events: string[] = [];
    const guard = new RevertGuard(
      rig.ports.displays,
      { armed: () => events.push('armed'), settled: (o) => events.push(o) },
      0.01
    );
    const first = guard.arm();
    // A newer change builds on the first, which is thereby kept.
    const second = guard.arm();
    expect(await first).toBe('kept');
    guard.keep();
    expect(await second).toBe('kept');
    expect(events).toEqual(['armed', 'armed', 'kept']);
    // With nothing to go back to, a revert is refused and nobody is left waiting.
    const third = guard.arm();
    expect(await guard.revertNow()).toMatchObject({ ok: false });
    expect(await third).toBe('kept');
  });
});

describe('display capture', () => {
  it('proposes one layout check with a matching fix that passes right now', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    const result = await createDisplayCapture(depsFor(rig)).capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    expect(result.value).toHaveLength(1);
    const candidate = result.value[0]!;
    expect(candidate.title).toBe('Monitor layout');
    expect(candidate.selectedByDefault).toBe(true);
    expect(candidate.description).toContain('LC49G95T: 5120x1440 at 0,0, main');
    expect(candidate.description).toContain(
      'USB_Monitor (2 of 3): 768x1024 at 5888,0, rotated 90°'
    );
    expect(candidate.description).toContain('DELL G3223D: off');
    expect(candidate.check.remediation).toEqual({
      type: 'display.applyLayout',
      params: candidate.check.params,
    });
    const params = LayoutParamsSchema.parse(candidate.check.params);
    expect((await createLayoutCheck(depsFor(rig)).run(params, rig.ctx)).pass).toBe(true);
  });

  it('refers to a saved layout by name when the monitors are arranged exactly like it', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    const deps = depsFor(rig, MFD_NAMES);
    const dataRoot = rig.ports.folders.dataRoot();
    await fs.mkdir(path.join(dataRoot, 'displays'), { recursive: true });
    await fs.copyFile(
      path.join(__dirname, '../../../../fixtures/scenarios/data/displays/layouts.json'),
      path.join(dataRoot, 'displays', 'layouts.json')
    );
    const result = await createDisplayCapture(deps).capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    const candidate = result.value[0]!;
    expect(candidate.title).toBe('Monitor layout: Flying');
    expect(candidate.description).toContain('Your saved layout "Flying"');
    expect(candidate.description).toContain('MFD centre: 768x1024 at 5888,0, rotated 90°');
    expect(candidate.check.params).toMatchObject({ layoutId: 'flying', layoutName: 'Flying' });
    const params = LayoutParamsSchema.parse(candidate.check.params);
    expect(
      createApplyLayoutRemediation({
        ...deps,
        applier: { applyAndWait: async () => err('x', 'x') },
      }).describe(params)
    ).toBe('Apply the "Flying" layout');
    expect(await createLayoutCheck(deps).run(params, rig.ctx)).toEqual({
      pass: true,
      summary: 'Arranged as "Flying" (4 monitors on)',
    });
  });

  it('proposes nothing without monitors and passes read failures through', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    const capture = createDisplayCapture(depsFor(rig));
    rig.ports.state.displays = [];
    expect(await capture.capture(rig.ctx)).toEqual({ ok: true, value: [] });
    rig.ports.displays.read = async () => err('display.read', 'nope');
    expect(await capture.capture(rig.ctx)).toMatchObject({ ok: false });
  });

  it('still captures when the saved layouts cannot be read', async () => {
    rig = await scenarioRig('flying-fresh', NO_FILES);
    const deps = depsFor(rig);
    deps.layouts = { get: async () => err('x', 'x'), list: async () => err('x', 'bad file') };
    const result = await createDisplayCapture(deps).capture(rig.ctx);
    expect(result.ok && result.value[0]!.title).toBe('Monitor layout');
  });
});
