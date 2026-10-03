import { layoutToTargets } from '../../../core/displays/layouts';
import type { DisplayApplyOutcome, DisplayProvider } from '../../../core/ports';
import { err, type Result } from '../../../core/result';
import type { DisplayLayout, DisplayTarget } from '../../../shared/models';
import type { RevertGuard } from './revertGuard';
import type { RecoveryStore } from './stores';

/** True when two layouts have the same monitors in the same places. */
export function sameArrangement(a: DisplayLayout, b: DisplayLayout): boolean {
  const key = (layout: DisplayLayout): string =>
    JSON.stringify(
      layout.displays
        .map((d) =>
          d.enabled
            ? [d.id, d.primary, d.x, d.y, d.width, d.height, d.rotation].join('|')
            : `${d.id}|off`
        )
        .sort()
    );
  return key(a) === key(b);
}

/**
 * Every monitor layout change goes through here:
 * 1. the layout as it is now is written to disk (so it can be offered back after a crash),
 * 2. the change is applied,
 * 3. if that fails part-way, the previous layout is put back and the error reported,
 * 4. otherwise the keep-or-revert countdown starts.
 */
export class LayoutApplier {
  constructor(
    private readonly displays: DisplayProvider,
    private readonly guard: Pick<RevertGuard, 'arm'>,
    private readonly recovery: Pick<RecoveryStore, 'save' | 'clear'>
  ) {}

  async apply(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const before = await this.displays.read();
    if (!before.ok) return before;
    const saved = await this.recovery.save(layoutToTargets(before.value));
    if (!saved.ok) {
      return err(
        'display.recovery',
        'Could not save the current monitor layout before changing it, so nothing was changed.',
        saved.error.message
      );
    }
    const applied = await this.displays.apply(targets);
    if (!applied.ok) {
      const restored = await this.rollBack(before.value);
      await this.recovery.clear();
      const detail = [applied.error.detail, restored].filter(Boolean).join(' ');
      return err(applied.error.code, applied.error.message, detail || undefined);
    }
    this.guard.arm();
    return applied;
  }

  /** After a failed apply: make sure the monitors are as they were. Says what happened. */
  private async rollBack(before: DisplayLayout): Promise<string | undefined> {
    const now = await this.displays.read();
    if (!now.ok) return 'The monitor layout could not be read afterwards.';
    if (sameArrangement(now.value, before)) return undefined;
    const back = await this.displays.apply(layoutToTargets(before));
    return back.ok
      ? 'The previous layout was put back.'
      : `Putting the previous layout back failed too: ${back.error.message}`;
  }
}
