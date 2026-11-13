import type { StandDownStep } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import { err, ok } from '../../../core/result';
import type { LayoutApplier } from './applier';
import type { MonitorNames } from './labels';
import { analyzeLayout } from './plan';

type Ctx = Pick<MainContext, 'settings' | 'layouts'>;

/** The id of the layout Stand down goes back to, when one is chosen. */
export async function deskLayoutId(ctx: Ctx): Promise<string | undefined> {
  const settings = await ctx.settings.get();
  return settings.ok ? settings.value.deskLayoutId : undefined;
}

/**
 * Stand down applies the desk layout (chosen on the Monitors page with "Use as desk layout"
 * or in Settings under "Desk layout"; the setting is the same). When the desk layout has
 * been kept before on this PC with the same monitors connected, it is applied without the
 * "Keep this monitor layout?" question; otherwise with the question and its countdown, as
 * any change made by hand (`proven.ts` has the exact rule). Monitors of the desk layout
 * that are not connected are left out. Without a desk layout it does nothing (and the
 * per-setup stand-down puts back the layout from before Make ready instead).
 */
export function createDeskLayoutStep(
  ctx: Ctx,
  applier: Pick<LayoutApplier, 'applyKnown'>,
  names: () => Promise<MonitorNames>
): StandDownStep {
  return {
    id: 'displays.deskLayout',
    label: 'Desk monitor layout',
    order: 200,
    async run({ ports }) {
      const id = await deskLayoutId(ctx);
      if (!id) return ok(null);
      const layout = await ctx.layouts.get(id);
      if (!layout.ok) {
        return err(
          'display.deskLayout',
          'The desk layout no longer exists. Choose another on the Monitors page ("Use as desk layout") or in Settings ("Desk layout").',
          layout.error.message
        );
      }
      const current = await ports.displays.read();
      if (!current.ok) return current;
      const analysis = analyzeLayout(layout.value.displays, current.value.displays, await names());
      if (analysis.targets.length === 0) {
        return err(
          'display.deskLayout',
          `None of the monitors of the "${layout.value.name}" layout are connected.`
        );
      }
      if (analysis.problems.length > 0) {
        return err(
          'display.deskLayout',
          `The "${layout.value.name}" layout cannot be applied.`,
          analysis.problems.join(' ')
        );
      }
      if (analysis.changes.length === 0) return ok(null);
      // Without the question when this PC has kept it before with these monitors.
      const applied = await applier.applyKnown(analysis.targets);
      if (!applied.ok) return applied;
      // Read back: the desk layout is only reported as applied when it is there.
      const after = await ports.displays.read();
      if (!after.ok) return after;
      const left = analyzeLayout(layout.value.displays, after.value.displays, await names());
      if (left.changes.length > 0) {
        return err(
          'display.notApplied',
          `Windows accepted the "${layout.value.name}" layout, but the monitors are not arranged as it says.`,
          left.changes.join('; ')
        );
      }
      const skipped = layout.value.displays.length - analysis.targets.length;
      const note =
        skipped > 0
          ? ` (${skipped} ${skipped === 1 ? 'monitor is' : 'monitors are'} not connected)`
          : '';
      return ok(`Applied desk layout "${layout.value.name}"${note}`);
    },
  };
}
