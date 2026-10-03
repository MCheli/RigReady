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
 * Stand down applies the desk layout named in the settings, with the same keep-or-revert
 * countdown as any other layout change. Monitors of the desk layout that are not connected
 * are left out. Without a desk layout it does nothing (and the per-setup stand-down puts
 * back the layout from before Make ready instead).
 */
export function createDeskLayoutStep(
  ctx: Ctx,
  applier: Pick<LayoutApplier, 'applyAndWait'>,
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
          'The desk layout chosen in Settings no longer exists.',
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
      const applied = await applier.applyAndWait(analysis.targets);
      if (!applied.ok) return applied;
      const skipped = layout.value.displays.length - analysis.targets.length;
      const note =
        skipped > 0
          ? ` (${skipped} ${skipped === 1 ? 'monitor is' : 'monitors are'} not connected)`
          : '';
      return ok(`Applied desk layout "${layout.value.name}"${note}`);
    },
  };
}
