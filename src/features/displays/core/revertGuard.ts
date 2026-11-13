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
export type LayoutDecision = 'kept' | 'reverted' | 'revertFailed';

/**
 * The least time the question waits when an assistant asked for the change. Whoever sits
 * at the screens did not click anything: they have to notice the question, read it and
 * look at the monitors first. It is as long as an assistant's own "may I?" question waits.
 */
export const ASSISTANT_SECONDS = 60;

/** The countdown that is running: how long it was given, and who asked for the change. */
export interface Countdown {
  seconds: number;
  /** The assistant that asked for the change. Not set when it was done in RigReady's window. */
  askedBy?: string;
}

export class RevertGuard {
  private cancel: (() => void) | undefined;
  private decide: ((outcome: LayoutDecision) => void) | undefined;
  private current: Countdown | undefined;

  constructor(
    private readonly displays: DisplayProvider,
    private readonly events: {
      /** A layout was applied; the countdown started. `askedBy`: the assistant that asked. */
      armed(seconds: number, askedBy?: string): void;
      /** The countdown ended, by keep, by revert or by timeout. */
      settled(outcome: LayoutDecision): void;
    },
    /** How long the user has to keep the new layout. Follows the app settings. */
    public seconds = 15,
    private readonly schedule: Schedule = realSchedule
  ) {}

  get pending(): boolean {
    return this.cancel !== undefined;
  }

  /** The countdown that is running now, when one is. */
  get running(): Countdown | undefined {
    return this.pending ? this.current : undefined;
  }

  /**
   * Starts the countdown. Resolves when this layout change has its answer: kept,
   * reverted (by the user or by the countdown), or a revert that failed. A newer change
   * arming the guard again answers the older one as kept (it was built upon).
   *
   * `askedBy` names the assistant that asked for the change. The person at the screens is
   * then not the one who clicked, so the countdown is never shorter than ASSISTANT_SECONDS.
   */
  arm(askedBy?: string): Promise<LayoutDecision> {
    this.cancel?.();
    this.answer('kept');
    const seconds = askedBy ? Math.max(this.seconds, ASSISTANT_SECONDS) : this.seconds;
    this.current = askedBy ? { seconds, askedBy } : { seconds };
    this.cancel = this.schedule(() => {
      this.cancel = undefined;
      void this.revertNow();
    }, seconds * 1000);
    const decision = new Promise<LayoutDecision>((resolve) => (this.decide = resolve));
    if (askedBy) this.events.armed(seconds, askedBy);
    else this.events.armed(seconds);
    return decision;
  }

  private answer(outcome: LayoutDecision): void {
    const decide = this.decide;
    this.decide = undefined;
    decide?.(outcome);
  }

  /** The user confirmed the new layout. It can still be reverted later through Stand down. */
  keep(): void {
    if (!this.cancel) return;
    this.cancel();
    this.cancel = undefined;
    this.events.settled('kept');
    this.answer('kept');
  }

  async revertNow(): Promise<Result<DisplayLayout>> {
    this.cancel?.();
    this.cancel = undefined;
    if (!this.displays.canRevert()) {
      this.answer('kept');
      return err('display.norevert', 'There is no earlier monitor layout to go back to.');
    }
    const reverted = await this.displays.revert();
    const outcome = reverted.ok ? 'reverted' : 'revertFailed';
    this.events.settled(outcome);
    this.answer(outcome);
    return reverted;
  }
}
