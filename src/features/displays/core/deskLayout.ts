import type { StandDownStep } from '../../../core/checks/registry';
import type { MainContext } from '../../../core/feature';
import { err, ok } from '../../../core/result';
import { diffLayout } from './layoutCheck';
import type { RevertGuard } from './revertGuard';

type Ctx = Pick<MainContext, 'settings' | 'layouts'>;

/** The id of the layout Stand down goes back to, when one is chosen and still exists. */
export async function deskLayoutId(ctx: Ctx): Promise<string | undefined> {
  const settings = await ctx.settings.get();
  return settings.ok ? settings.value.deskLayoutId : undefined;
}

/**
 * Stand down applies the desk layout named in the settings, with the same keep-or-revert
 * countdown as any other layout change. Without a desk layout it does nothing (and the
 * per-profile stand-down puts back the layout from before Make ready instead).
 */
export function createDeskLayoutStep(ctx: Ctx, guard: RevertGuard): StandDownStep {
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
      const connected = new Set(current.value.displays.map((d) => d.id));
      const targets = layout.value.displays.filter((d) => connected.has(d.id.toLowerCase()));
      const skipped = layout.value.displays.length - targets.length;
      if (targets.length === 0) {
        return err(
          'display.deskLayout',
          `None of the monitors of the "${layout.value.name}" layout are connected.`
        );
      }
      if (diffLayout(targets, current.value).length === 0) return ok(null);
      const applied = await ports.displays.apply(targets);
      if (!applied.ok) return applied;
      guard.arm();
      const note =
        skipped > 0
          ? ` (${skipped} ${skipped === 1 ? 'monitor is' : 'monitors are'} not connected)`
          : '';
      return ok(`Applied desk layout "${layout.value.name}"${note}`);
    },
  };
}
