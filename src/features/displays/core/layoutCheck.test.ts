import { afterEach, describe, expect, it } from 'vitest';
import { err } from '../../../core/result';
import type { DisplayProvider } from '../../../core/ports';
import { scenarioRig, type TestRig } from '../../../../tests/helpers';
import {
  createApplyLayoutRemediation,
  diffLayout,
  displayCapture,
  displayLabels,
  displayLayoutCheck,
  LayoutParamsSchema,
  targetFromDisplay,
  type LayoutParams,
} from './layoutCheck';
import { RevertGuard, type Schedule } from './revertGuard';

let rig: TestRig;
afterEach(() => rig?.cleanup());

/** The layout a scenario is in right now, as a profile would store it. */
async function currentLayout(r: TestRig): Promise<LayoutParams> {
  const layout = await r.ports.displays.read();
  if (!layout.ok) throw new Error('read failed');
  return LayoutParamsSchema.parse({ displays: layout.value.displays.map(targetFromDisplay) });
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

describe('display.layout', () => {
  it('passes when the monitors are arranged as the setup expects', async () => {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    expect(await displayLayoutCheck.run(good, rig.ctx)).toEqual({
      pass: true,
      summary: '4 monitors arranged as expected',
    });
  });

  it('names the one MFD screen that is rotated wrong, telling identical monitors apart', async () => {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    await rig.cleanup();
    rig = await scenarioRig('flying-mfd-rotated');
    const outcome = await displayLayoutCheck.run(good, rig.ctx);
    expect(outcome.pass).toBe(false);
    expect(outcome.summary).toBe('2 differences');
    expect(outcome.details).toEqual([
      'USB_Monitor (2 of 3) is rotated 0°, expected 90°',
      'USB_Monitor (2 of 3) is 1024x768, expected 768x1024',
    ]);
  });

  it('lists every difference between the desk state and the flying layout', async () => {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    await rig.cleanup();
    rig = await scenarioRig('desk-mfds-wrong');
    const layout = await rig.ports.displays.read();
    if (!layout.ok) throw new Error('read failed');
    const differences = diffLayout(good.displays, layout.value);
    expect(differences).toContain('DELL G3223D is on, expected off');
    expect(differences).toContain('LC49G95T is at 2560,0, expected 0,0');
    expect(differences).toContain('LC49G95T is not the main display');
    expect(differences).toContain('USB_Monitor (1 of 3) is rotated 0°, expected 90°');
    expect(differences.filter((d) => d.startsWith('USB_Monitor'))).toHaveLength(9);
  });

  it('reports missing and switched-off monitors, and a single difference inline', async () => {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    const ghost = {
      id: 'ghost',
      name: 'TV',
      enabled: true,
      primary: false,
      x: 0,
      y: 0,
      rotation: 0 as const,
    };
    const one = await displayLayoutCheck.run({ displays: [ghost] }, rig.ctx);
    expect(one).toEqual({ pass: false, summary: 'TV is not connected', details: [] });
    const layout = await rig.ports.displays.read();
    if (!layout.ok) throw new Error('read failed');
    expect(diffLayout([{ ...ghost, enabled: false }], layout.value)).toEqual([
      'TV is not connected (expected off)',
    ]);
    const dellOn = good.displays.map((d) =>
      d.name === 'DELL G3223D' ? { ...d, enabled: true, x: 9000, width: 2560, height: 1440 } : d
    );
    expect(diffLayout(dellOn, layout.value)).toEqual(['DELL G3223D is off, expected on']);
    rig.ports.displays.read = async () =>
      err('display.read', 'Could not read the monitor configuration.');
    expect(await displayLayoutCheck.run(good, rig.ctx)).toEqual({
      pass: false,
      summary: 'Could not read the monitor configuration.',
    });
  });

  it('labels unnamed and duplicate monitors', () => {
    const labels = displayLabels([
      { id: 'A', name: 'USB_Monitor' },
      { id: 'b', name: '' },
      { id: 'c', name: 'USB_Monitor' },
    ]);
    expect([...labels.entries()]).toEqual([
      ['a', 'USB_Monitor (1 of 2)'],
      ['b', 'Monitor'],
      ['c', 'USB_Monitor (2 of 2)'],
    ]);
  });
});

describe('display.applyLayout', () => {
  it('turns the desk state into the flying layout and arms the timed revert', async () => {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    await rig.cleanup();
    rig = await scenarioRig('desk-mfds-wrong');
    const { guard, events } = manualGuard(rig.ports.displays);
    const remediation = createApplyLayoutRemediation(guard);
    expect(remediation.describe(good)).toBe('Apply the monitor layout');
    expect((await displayLayoutCheck.run(good, rig.ctx)).pass).toBe(false);
    expect(await remediation.run(good, rig.ctx)).toEqual({
      ok: true,
      value: 'Applied the layout to 4 monitors',
    });
    expect((await displayLayoutCheck.run(good, rig.ctx)).pass).toBe(true);
    expect(events).toEqual(['armed 15']);
    expect(guard.pending).toBe(true);
  });

  it('does not arm anything when the apply fails', async () => {
    rig = await scenarioRig('desk-mfds-wrong');
    const { guard, events } = manualGuard(rig.ports.displays);
    const params = {
      displays: [
        {
          id: 'ghost',
          name: 'TV',
          enabled: true,
          primary: false,
          x: 0,
          y: 0,
          rotation: 0 as const,
        },
      ],
    };
    expect(await createApplyLayoutRemediation(guard).run(params, rig.ctx)).toMatchObject({
      ok: false,
      error: { code: 'display.missing' },
    });
    expect(events).toEqual([]);
  });
});

describe('RevertGuard', () => {
  async function applied() {
    rig = await scenarioRig('flying-all-good');
    const good = await currentLayout(rig);
    await rig.cleanup();
    rig = await scenarioRig('desk-mfds-wrong');
    const desk = await currentLayout(rig);
    const harness = manualGuard(rig.ports.displays, 15);
    await createApplyLayoutRemediation(harness.guard).run(good, rig.ctx);
    return { ...harness, good, desk };
  }

  it('reverts by itself when nobody confirms in time', async () => {
    const { guard, events, timeout, desk } = await applied();
    timeout();
    await expect.poll(() => events).toEqual(['armed 15', 'reverted']);
    expect(guard.pending).toBe(false);
    expect((await displayLayoutCheck.run(desk, rig.ctx)).pass).toBe(true);
  });

  it('keep stops the countdown and leaves the layout, which Stand down can still revert', async () => {
    const { guard, events, good, desk, cancelled } = await applied();
    guard.keep();
    guard.keep();
    expect(events).toEqual(['armed 15', 'kept']);
    expect(cancelled()).toBe(1);
    expect((await displayLayoutCheck.run(good, rig.ctx)).pass).toBe(true);
    const reverted = await guard.revertNow();
    expect(reverted.ok).toBe(true);
    expect((await displayLayoutCheck.run(desk, rig.ctx)).pass).toBe(true);
    expect(await guard.revertNow()).toMatchObject({
      ok: false,
      error: { code: 'display.norevert' },
    });
  });

  it('reports a revert that fails', async () => {
    const { guard, events } = await applied();
    rig.ports.displays.revert = async () => err('display.revert', 'Could not restore.');
    expect(await guard.revertNow()).toMatchObject({ ok: false });
    expect(events).toEqual(['armed 15', 'revertFailed']);
  });

  it('uses a real timer by default', async () => {
    rig = await scenarioRig('desk-mfds-wrong');
    const events: string[] = [];
    const guard = new RevertGuard(
      rig.ports.displays,
      { armed: () => events.push('armed'), settled: (o) => events.push(o) },
      0.01
    );
    guard.arm();
    guard.arm();
    guard.keep();
    expect(events).toEqual(['armed', 'armed', 'kept']);
  });
});

describe('display capture', () => {
  it('proposes one layout check with a matching fix that passes right now', async () => {
    rig = await scenarioRig('flying-fresh');
    const result = await displayCapture.capture(rig.ctx);
    if (!result.ok) throw new Error('capture failed');
    expect(result.value).toHaveLength(1);
    const candidate = result.value[0]!;
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
    expect((await displayLayoutCheck.run(params, rig.ctx)).pass).toBe(true);
  });

  it('proposes nothing without monitors and passes read failures through', async () => {
    rig = await scenarioRig('flying-fresh');
    rig.ports.state.displays = [];
    expect(await displayCapture.capture(rig.ctx)).toEqual({ ok: true, value: [] });
    rig.ports.displays.read = async () => err('display.read', 'nope');
    expect(await displayCapture.capture(rig.ctx)).toMatchObject({ ok: false });
  });
});
