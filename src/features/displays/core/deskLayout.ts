import type { CheckContext, StandDownStep } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import type { NamedLayout } from '../../../core/displays/layouts';
import { err, ok, type Result } from '../../../core/result';
import type { DisplayInfo } from '../../../shared/models';
import type { LayoutApplier } from './applier';
import type { MonitorNames } from './labels';
import { analyzeLayout, type LayoutAnalysis } from './plan';

type Ctx = Pick<MainContext, 'settings' | 'layouts'>;

/** The id of the layout Stand down goes back to, when one is chosen. */
export async function deskLayoutId(ctx: Ctx): Promise<string | undefined> {
  const settings = await ctx.settings.get();
  return settings.ok ? settings.value.deskLayoutId : undefined;
}

/**
 * Said after "The new monitor layout was not kept, so the previous one is back" when the
 * desk layout went back. A Stand down by itself may have asked with nobody there, and
 * whoever reads it later has to know what makes it work next time.
 */
export const DESK_NOT_KEPT_NEXT_TIME = 'Next time, stay for the question and press Keep it.';

/**
 * Said with the countdown before a Stand down by itself, when the desk layout has not
 * been kept with the monitors that are connected: Stand down will ask, and with nobody
 * there to answer, the monitors go back to how they are now.
 */
export function deskNotKeptYetText(name: string): string {
  return `The desk layout "${name}" has not been kept with these monitors yet. Stay and press Keep it when RigReady asks, or the monitors stay as they are.`;
}

/** What Stand down would do with the desk layout now: nothing, an error, or a change. */
type DeskPlan =
  | { kind: 'nothing' }
  | { kind: 'error'; error: Result<never> }
  | { kind: 'change'; layout: NamedLayout; analysis: LayoutAnalysis; current: DisplayInfo[] };

async function planDesk(
  ctx: Ctx,
  check: CheckContext,
  names: () => Promise<MonitorNames>
): Promise<DeskPlan> {
  const id = await deskLayoutId(ctx);
  if (!id) return { kind: 'nothing' };
  const layout = await ctx.layouts.get(id);
  if (!layout.ok) {
    return {
      kind: 'error',
      error: err(
        'display.deskLayout',
        'The desk layout no longer exists. Choose another on the Monitors page ("Use as desk layout") or in Settings ("Desk layout").',
        layout.error.message
      ),
    };
  }
  const current = await check.ports.displays.read();
  if (!current.ok) return { kind: 'error', error: current };
  const analysis = analyzeLayout(layout.value.displays, current.value.displays, await names());
  if (analysis.targets.length === 0) {
    return {
      kind: 'error',
      error: err(
        'display.deskLayout',
        `None of the monitors of the "${layout.value.name}" layout are connected.`
      ),
    };
  }
  if (analysis.problems.length > 0) {
    return {
      kind: 'error',
      error: err(
        'display.deskLayout',
        `The "${layout.value.name}" layout cannot be applied.`,
        analysis.problems.join(' ')
      ),
    };
  }
  if (analysis.changes.length === 0) return { kind: 'nothing' };
  return { kind: 'change', layout: layout.value, analysis, current: current.value.displays };
}

/**
 * Stand down applies the desk layout (chosen on the Monitors page with "Use as desk layout"
 * or in Settings under "Desk layout"; the setting is the same). When the desk layout has
 * been kept before on this PC with the same monitors connected, it is applied without the
 * "Keep this monitor layout?" question; otherwise with the question and its countdown, as
 * any change made by hand (`proven.ts` has the exact rule). Monitors of the desk layout
 * that are not connected are left out. Without a desk layout it does nothing (and the
 * per-setup stand-down puts back the layout from before Make ready instead).
 *
 * Before a Stand down by itself, its countdown says when the question will be asked, so
 * that whoever is there stays to answer it (`needsYou`). A layout nobody kept goes back
 * all the same: the question is the only way back from a screen nobody can see.
 */
export function createDeskLayoutStep(
  ctx: Ctx,
  applier: Pick<LayoutApplier, 'applyKnown' | 'wouldAsk'>,
  names: () => Promise<MonitorNames>
): StandDownStep {
  return {
    id: 'displays.deskLayout',
    label: 'Desk monitor layout',
    order: 200,
    async run(check) {
      const plan = await planDesk(ctx, check, names);
      if (plan.kind === 'nothing') return ok(null);
      if (plan.kind === 'error') return plan.error;
      const { layout, analysis } = plan;
      // Without the question when this PC has kept it before with these monitors.
      const applied = await applier.applyKnown(analysis.targets);
      if (!applied.ok) {
        if (applied.error.code !== 'display.reverted') return applied;
        return err(applied.error.code, applied.error.message, DESK_NOT_KEPT_NEXT_TIME);
      }
      // Read back: the desk layout is only reported as applied when it is there.
      const after = await check.ports.displays.read();
      if (!after.ok) return after;
      const left = analyzeLayout(layout.displays, after.value.displays, await names());
      if (left.changes.length > 0) {
        return err(
          'display.notApplied',
          `Windows accepted the "${layout.name}" layout, but the monitors are not arranged as it says.`,
          left.changes.join('; ')
        );
      }
      const skipped = layout.displays.length - analysis.targets.length;
      const note =
        skipped > 0
          ? ` (${skipped} ${skipped === 1 ? 'monitor is' : 'monitors are'} not connected)`
          : '';
      return ok(`Applied desk layout "${layout.name}"${note}`);
    },
    async needsYou(check) {
      const plan = await planDesk(ctx, check, names);
      // Nothing to change, or a step that will fail and say why: nobody needs to stay.
      if (plan.kind !== 'change') return null;
      const asks = await applier.wouldAsk(plan.analysis.targets, plan.current);
      return asks ? deskNotKeptYetText(plan.layout.name) : null;
    },
  };
}
