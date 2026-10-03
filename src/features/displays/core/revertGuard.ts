import type { DisplayProvider } from '../../../core/ports';
import { err, type Result } from '../../../core/result';
import type { DisplayLayout } from '../../../shared/models';

export type Schedule = (fn: () => void, ms: number) => () => void;

const realSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

/**
 * After a layout is applied the user has a fixed time to keep it. If they do not
 * (for example because the screen they would click on went dark), the previous
 * layout comes back by itself.
 */
export class RevertGuard {
  private cancel: (() => void) | undefined;

  constructor(
    private readonly displays: DisplayProvider,
    private readonly events: {
      /** A layout was applied; the countdown started. */
      armed(seconds: number): void;
      /** The countdown ended, by keep, by revert or by timeout. */
      settled(outcome: 'kept' | 'reverted' | 'revertFailed'): void;
    },
    /** How long the user has to keep the new layout. Follows the app settings. */
    public seconds = 15,
    private readonly schedule: Schedule = realSchedule
  ) {}

  get pending(): boolean {
    return this.cancel !== undefined;
  }

  arm(): void {
    this.cancel?.();
    this.cancel = this.schedule(() => {
      this.cancel = undefined;
      void this.revertNow();
    }, this.seconds * 1000);
    this.events.armed(this.seconds);
  }

  /** The user confirmed the new layout. It can still be reverted later through Stand down. */
  keep(): void {
    if (!this.cancel) return;
    this.cancel();
    this.cancel = undefined;
    this.events.settled('kept');
  }

  async revertNow(): Promise<Result<DisplayLayout>> {
    this.cancel?.();
    this.cancel = undefined;
    if (!this.displays.canRevert()) {
      return err('display.norevert', 'There is no earlier monitor layout to go back to.');
    }
    const reverted = await this.displays.revert();
    this.events.settled(reverted.ok ? 'reverted' : 'revertFailed');
    return reverted;
  }
}
