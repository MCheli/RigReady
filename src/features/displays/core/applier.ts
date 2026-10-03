import { layoutToTargets } from '../../../core/displays/layouts';
import type {
  AppWindow,
  DisplayApplyOutcome,
  DisplayProvider,
  ScreenArea,
} from '../../../core/ports';
import { err, type Result } from '../../../core/result';
import type { DisplayInfo, DisplayLayout, DisplayTarget } from '../../../shared/models';
import type { LayoutDecision, RevertGuard } from './revertGuard';
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

const areaOf = (d: DisplayInfo): ScreenArea => ({
  x: d.x,
  y: d.y,
  width: d.width,
  height: d.height,
});
/** The main display first: that is where the window goes when it has to move. */
const mainFirst = (a: DisplayInfo, b: DisplayInfo): number => Number(b.primary) - Number(a.primary);

/** Monitors that are on now and still on after the change, where they are now. */
export function areasStayingOn(before: DisplayLayout, targets: DisplayTarget[]): ScreenArea[] {
  const wanted = new Map(targets.map((t) => [t.id.toLowerCase(), t]));
  const main = targets.find((t) => t.enabled && t.primary)?.id.toLowerCase();
  return before.displays
    .filter((d) => d.enabled && (wanted.get(d.id.toLowerCase())?.enabled ?? true))
    .sort((a, b) => Number(b.id.toLowerCase() === main) - Number(a.id.toLowerCase() === main))
    .map(areaOf);
}

/**
 * Every monitor layout change goes through here:
 * 1. the layout as it is now is written to disk (so it can be offered back after a crash),
 * 2. the RigReady window is put on a monitor that stays on,
 * 3. the change is applied,
 * 4. if that fails part-way, the previous layout is put back and the error reported,
 * 5. otherwise the keep-or-revert countdown starts, with the window on a monitor that is on.
 */
export class LayoutApplier {
  private decision: Promise<LayoutDecision> = Promise.resolve('kept');

  constructor(
    private readonly displays: DisplayProvider,
    private readonly guard: Pick<RevertGuard, 'arm'>,
    private readonly recovery: Pick<RecoveryStore, 'save' | 'clear'>,
    private readonly window?: AppWindow
  ) {}

  /**
   * Applies the change and waits for the user's answer (or the countdown). Ok only when
   * the new layout was kept: this is what Make ready and Stand down use, so they go on
   * knowing which layout is really there.
   */
  async applyAndWait(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const applied = await this.apply(targets);
    if (!applied.ok) return applied;
    const decision = await this.decision;
    if (decision === 'reverted') {
      return err(
        'display.reverted',
        'The new monitor layout was not kept, so the previous one is back.'
      );
    }
    if (decision === 'revertFailed') {
      return err(
        'display.revert',
        'The new monitor layout was not kept, and the previous one could not be put back.'
      );
    }
    return applied;
  }

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
    // The question that follows must not open on a screen that is about to go dark.
    await this.window?.showOn(areasStayingOn(before.value, targets));
    const applied = await this.displays.apply(targets);
    if (!applied.ok) {
      const restored = await this.rollBack(before.value);
      await this.recovery.clear();
      const detail = [applied.error.detail, restored].filter(Boolean).join(' ');
      return err(applied.error.code, applied.error.message, detail || undefined);
    }
    // Positions may have shifted (another main display): make sure it is still on one.
    await this.window?.showOn(
      applied.value.current.displays
        .filter((d) => d.enabled)
        .sort(mainFirst)
        .map(areaOf)
    );
    this.decision = this.guard.arm();
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
