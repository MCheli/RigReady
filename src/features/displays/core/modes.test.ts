import { afterEach, describe, expect, it } from 'vitest';
import { DisplayLayoutStore } from '../../../core/displays/layouts';
import { mutate, scenarioRig, type TestRig } from '../../../../tests/helpers';
import { LayoutApplier } from './applier';
import {
  createApplyLayoutRemediation,
  createLayoutCheck,
  LayoutParamsSchema,
  targetFromDisplay,
  type LayoutParams,
} from './layoutCheck';
import { analyzeLayout } from './plan';
import { RevertGuard } from './revertGuard';
import { RecoveryStore } from './stores';

let rig: TestRig;
afterEach(() => rig?.cleanup());

const ULTRAWIDE = 'LC49G95T';

async function setUp(): Promise<{
  layout: (change: Record<string, unknown>) => Promise<LayoutParams>;
  fix: ReturnType<typeof createApplyLayoutRemediation>;
  check: ReturnType<typeof createLayoutCheck>;
  guard: RevertGuard;
}> {
  rig = await scenarioRig('flying-all-good', { files: [] });
  const deps = {
    names: async () => ({}),
    layouts: new DisplayLayoutStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock),
  };
  const guard = new RevertGuard(
    rig.ports.displays,
    { armed: () => {}, settled: () => {} },
    15,
    () => {
      return () => {};
    }
  );
  const recovery = new RecoveryStore(rig.ports.files, rig.ports.folders.dataRoot(), rig.clock);
  const applier = new LayoutApplier(rig.ports.displays, guard, recovery, rig.ports.window);
  return {
    guard,
    fix: createApplyLayoutRemediation({ ...deps, applier }),
    check: createLayoutCheck(deps),
    /** The layout as it is now, with the ultrawide's entry changed. */
    async layout(change) {
      const read = await rig.ports.displays.read();
      if (!read.ok) throw new Error('read failed');
      return LayoutParamsSchema.parse({
        displays: read.value.displays.map((d) =>
          d.name === ULTRAWIDE ? { ...targetFromDisplay(d), ...change } : targetFromDisplay(d)
        ),
      });
    },
  };
}

const ultrawide = () => rig.ports.state.displays.find((d) => d.name === ULTRAWIDE)!;

describe('a layout that asks for a resolution or refresh rate', () => {
  it('applies a mode the monitor lists, and the check then compares the refresh rate too', async () => {
    const { layout, fix, check, guard } = await setUp();
    expect(ultrawide()).toMatchObject({ width: 5120, height: 1440, refreshHz: 120 });
    const wanted = await layout({ refreshHz: 60 });
    expect(await check.run(wanted, rig.ctx)).toMatchObject({
      pass: false,
      summary: `${ULTRAWIDE} runs at 120 Hz, expected 60 Hz`,
    });
    const running = fix.run(wanted, rig.ctx);
    await expect.poll(() => guard.pending).toBe(true);
    guard.keep();
    expect(await running).toMatchObject({ ok: true });
    expect(ultrawide()).toMatchObject({ width: 5120, height: 1440, refreshHz: 60 });
    expect((await check.run(wanted, rig.ctx)).pass).toBe(true);

    // A smaller resolution it lists, at a rate it lists for that resolution.
    const smaller = await layout({ width: 3840, height: 1080, refreshHz: 120 });
    // The MFD screens sit at x 5120 and up, so the narrower ultrawide leaves a gap: allowed.
    const second = fix.run(smaller, rig.ctx);
    await expect.poll(() => guard.pending).toBe(true);
    guard.keep();
    expect(await second).toMatchObject({ ok: true });
    expect(ultrawide()).toMatchObject({ width: 3840, height: 1080, refreshHz: 120 });
  });

  it('hands a layout that changes resolution, refresh rate, position and rotation to the display port as one apply', async () => {
    const { layout, fix, guard } = await setUp();
    const calls: unknown[][] = [];
    const apply = rig.ports.displays.apply.bind(rig.ports.displays);
    rig.ports.displays.apply = (targets) => {
      calls.push(structuredClone(targets));
      return apply(targets);
    };
    // The ultrawide smaller and slower, and one MFD screen turned and moved, all at once.
    const wanted = await layout({ width: 3840, height: 1080, refreshHz: 60 });
    const mfd = wanted.displays.find((d) => d.name === 'USB_Monitor')!;
    Object.assign(mfd, {
      rotation: 0,
      width: mfd.height,
      height: mfd.width,
      x: 9000,
      y: 0,
    });
    const running = fix.run(wanted, rig.ctx);
    await expect.poll(() => guard.pending).toBe(true);
    guard.keep();
    expect(await running).toMatchObject({ ok: true });

    // One call, and it carries the mode with the placement: nothing is left for a second one.
    expect(calls).toHaveLength(1);
    const sent = calls[0] as {
      id: string;
      width?: number;
      height?: number;
      refreshHz?: number;
      rotation: number;
      x: number;
    }[];
    expect(sent.find((t) => t.id === ultrawide().id)).toMatchObject({
      width: 3840,
      height: 1080,
      refreshHz: 60,
    });
    expect(sent.find((t) => t.id === mfd.id)).toMatchObject({ rotation: 0, x: 9000 });
    expect(ultrawide()).toMatchObject({ width: 3840, height: 1080, refreshHz: 60 });
    expect(rig.ports.state.displays.find((d) => d.id === mfd.id)).toMatchObject({
      rotation: 0,
      x: 9000,
      width: mfd.width,
      height: mfd.height,
    });
  });

  it('refuses a mode the monitor does not list, names the monitor and the mode, and applies nothing', async () => {
    const { layout, fix } = await setUp();
    const before = structuredClone(rig.ports.state.displays);
    for (const [change, message] of [
      [{ refreshHz: 240 }, `${ULTRAWIDE} does not offer 5120x1440 at 240 Hz.`],
      [{ width: 1234, height: 777 }, `${ULTRAWIDE} does not offer 1234x777.`],
      // A resolution it has, at a rate it only has for another resolution.
      [
        { width: 3840, height: 1080, refreshHz: 240 },
        `${ULTRAWIDE} does not offer 3840x1080 at 240 Hz.`,
      ],
    ] as const) {
      const wanted = await layout(change);
      const read = await rig.ports.displays.read();
      const analysis = analyzeLayout(wanted.displays, read.ok ? read.value.displays : []);
      expect(analysis.problems).toEqual([message]);
      expect(await fix.run(wanted, rig.ctx)).toEqual({
        ok: false,
        error: {
          code: 'display.invalid',
          message: 'The layout cannot be applied.',
          detail: message,
        },
      });
      expect(rig.ports.state.displays).toEqual(before);
    }
  });

  it('the provider itself refuses an unlisted mode and leaves every monitor as it was', async () => {
    await setUp();
    const before = structuredClone(rig.ports.state.displays);
    const target = { ...targetFromDisplay(ultrawide()), refreshHz: 240 };
    expect(await rig.ports.displays.apply([target])).toMatchObject({
      ok: false,
      error: { code: 'display.mode', detail: `${ULTRAWIDE} does not offer 5120x1440 at 240 Hz` },
    });
    expect(rig.ports.state.displays).toEqual(before);
    expect(rig.ports.displays.canRevert()).toBe(false);
  });

  it('does not judge modes for a monitor whose list is unknown, or when only the rotation changes', async () => {
    const { layout } = await setUp();
    await mutate(rig, [{ op: 'setDisplay', match: { name: ULTRAWIDE }, set: {} }]);
    delete ultrawide().modes;
    const wanted = await layout({ width: 1234, height: 777 });
    const read = await rig.ports.displays.read();
    expect(analyzeLayout(wanted.displays, read.ok ? read.value.displays : []).problems).toEqual([]);
    // A portrait MFD screen back to landscape is the same 1024x768 mode, turned.
    const mfd = rig.ports.state.displays.find((d) => d.name === 'USB_Monitor')!;
    const turned = LayoutParamsSchema.parse({
      displays: [{ ...targetFromDisplay(mfd), rotation: 0, width: 1024, height: 768, x: 9000 }],
    });
    expect(analyzeLayout(turned.displays, read.ok ? read.value.displays : []).problems).toEqual([]);
  });
});
