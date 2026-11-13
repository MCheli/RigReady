import { layoutToTargets } from '../../../core/displays/layouts';
import type {
  AppWindow,
  DisplayApplyOutcome,
  DisplayProvider,
  ScreenArea,
} from '../../../core/ports';
import { actingAssistant } from '../../../core/assistantScripts';
import { err, ok, type Result } from '../../../core/result';
import type { DisplayInfo, DisplayLayout, DisplayTarget } from '../../../shared/models';
import { notAsAsked, proofOf, type Proof } from './proven';
import type { LayoutDecision, RevertGuard } from './revertGuard';
import type { ProvenStore, RecoveryStore } from './stores';

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

/** What the applier needs to apply a change that is known to work without asking. */
export interface KnownToWork {
  proven: Pick<ProvenStore, 'has' | 'add' | 'forget'>;
  /** A change was applied without the question (other windows show the monitors as they are now). */
  unasked?(): void;
  log?(line: string): void;
}

/**
 * Every monitor layout change goes through here:
 * 1. the layout as it is now is written to disk (so it can be offered back after a crash),
 * 2. the RigReady window is put on a monitor that stays on,
 * 3. the change is applied,
 * 4. if that fails part-way, the previous layout is put back and the error reported,
 * 5. otherwise the keep-or-revert countdown starts, with the window on a monitor that is on.
 *
 * Step 5 is left out in one case only: `applyKnown`, which Make ready and Stand down use,
 * for a change that is known to work on this PC (`proven.ts` says exactly what that means).
 */
export class LayoutApplier {
  private decision: Promise<LayoutDecision> = Promise.resolve('kept');
  /**
   * The change the open question is about. Its `proof` is what a "Keep it" would show;
   * `once` says Make ready or Stand down asked, and a "Keep it" ends the asking.
   */
  private asked: { targets: DisplayTarget[]; proof: Proof | undefined; once: boolean } | undefined;

  constructor(
    private readonly displays: DisplayProvider,
    private readonly guard: Pick<RevertGuard, 'arm' | 'keep' | 'pending'>,
    private readonly recovery: Pick<RecoveryStore, 'save' | 'clear'>,
    private readonly window?: AppWindow,
    private readonly known?: KnownToWork
  ) {}

  /**
   * Applies the change and waits for the user's answer (or the countdown). Ok only when
   * the new layout was kept, so whoever called goes on knowing which layout is really
   * there. This is every change made by hand: the Monitors page, the command palette,
   * turning a screen.
   */
  async applyAndWait(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const applied = await this.apply(targets);
    return applied.ok ? this.answered(applied.value) : applied;
  }

  /**
   * True while the open question is one Make ready or Stand down had to ask because the
   * change was never kept on this PC with these monitors, and keeping it now means it is
   * not asked again. The question says so.
   */
  get firstTime(): boolean {
    return this.guard.pending && this.asked?.once === true;
  }

  /**
   * For Make ready and Stand down. A change that is known to work on this PC is applied
   * without the question: nobody is asked to confirm, in the middle of a launch, what
   * they kept before with these same monitors. It is still saved first, read back after,
   * and reported exactly when Windows refuses it. Any other change, and any doubt, goes
   * through `applyAndWait`: the countdown is the only way back from a screen nobody can see.
   */
  async applyKnown(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const before = await this.displays.read();
    if (!before.ok) return before;
    const proof = proofOf(targets, before.value.displays);
    // An open question is about a change nobody has answered yet, and this one would be
    // built on it: that is doubt enough.
    const known =
      proof !== undefined &&
      this.known !== undefined &&
      !this.guard.pending &&
      (await this.known.proven.has(proof));
    if (!proof || !this.known || !known) {
      const asked = await this.start(before.value, targets, true);
      return asked.ok ? this.answered(asked.value) : asked;
    }
    const applied = await this.change(before.value, targets);
    if (!applied.ok) {
      // It worked before and does not now. Next time it is asked about again.
      await this.known.proven.forget(proof);
      return applied;
    }
    const after = await this.displays.read();
    const wrong = after.ok ? notAsAsked(targets, after.value.displays) : [after.error.message];
    if (wrong.length > 0) {
      // Windows took it, but the monitors are not as they were kept. Ask after all.
      this.known.log?.(`display layout not as it was kept (${wrong.join('; ')}): asking`);
      await this.known.proven.forget(proof);
      this.ask(targets, undefined, false);
      return this.answered(applied.value);
    }
    // There is no question, so nothing is left to offer after a restart.
    await this.recovery.clear();
    this.known.log?.(
      'display layout applied without the question: kept before with these monitors'
    );
    this.known.unasked?.();
    return ok(applied.value);
  }

  /** Applies the change and starts the countdown. Returns as soon as it runs. */
  async apply(targets: DisplayTarget[]): Promise<Result<DisplayApplyOutcome>> {
    const before = await this.displays.read();
    if (!before.ok) return before;
    return this.start(before.value, targets, false);
  }

  /** Applies the change and asks. `fromSetup`: Make ready or Stand down is asking. */
  private async start(
    before: DisplayLayout,
    targets: DisplayTarget[],
    fromSetup: boolean
  ): Promise<Result<DisplayApplyOutcome>> {
    const applied = await this.change(before, targets);
    if (!applied.ok) return applied;
    const proof = proofOf(targets, before.displays);
    // "Asked once" is only said when keeping it really ends the asking.
    this.ask(targets, proof, fromSetup && proof !== undefined && this.known !== undefined);
    return applied;
  }

  /**
   * "Keep it". True when a question was open. When a person (not an assistant, which
   * cannot see the screens) keeps a change and the monitors are read back as it asked, the
   * change is remembered as known to work.
   */
  async keep(): Promise<boolean> {
    if (!this.guard.pending) return false;
    const asked = this.asked;
    this.asked = undefined;
    this.guard.keep();
    if (!asked?.proof || !this.known || actingAssistant() !== undefined) return true;
    const now = await this.displays.read();
    if (!now.ok) return true;
    const still = proofOf(asked.targets, now.value.displays);
    const asAsked =
      still !== undefined &&
      still.monitors.join('\n') === asked.proof.monitors.join('\n') &&
      notAsAsked(asked.targets, now.value.displays).length === 0;
    if (!asAsked) return true;
    const saved = await this.known.proven.add(asked.proof);
    if (!saved.ok) {
      // The layout is kept either way; it is only asked about again next time.
      this.known.log?.(`could not remember the kept monitor layout: ${saved.error.message}`);
    }
    return true;
  }

  /** Starts the countdown for a change that was just applied. */
  private ask(targets: DisplayTarget[], proof: Proof | undefined, once: boolean): void {
    const asked = { targets, proof, once };
    this.asked = asked;
    const decision = this.guard.arm(actingAssistant());
    this.decision = decision;
    // Answered some other way than "Keep it" (went back, or a newer change replaced it).
    void decision.then(() => {
      if (this.asked === asked) this.asked = undefined;
    });
  }

  /** Waits for the answer to the question that was just asked. */
  private async answered(applied: DisplayApplyOutcome): Promise<Result<DisplayApplyOutcome>> {
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
    return ok(applied);
  }

  /** Steps 1 to 4: save, move the window, apply, put back on failure. */
  private async change(
    before: DisplayLayout,
    targets: DisplayTarget[]
  ): Promise<Result<DisplayApplyOutcome>> {
    const saved = await this.recovery.save(layoutToTargets(before));
    if (!saved.ok) {
      return err(
        'display.recovery',
        'Could not save the current monitor layout before changing it, so nothing was changed.',
        saved.error.message
      );
    }
    // RigReady's window (and the question, when one follows) must not be on a screen that
    // is about to go dark.
    await this.window?.showOn(areasStayingOn(before, targets));
    const applied = await this.displays.apply(targets);
    if (!applied.ok) {
      const restored = await this.rollBack(before);
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
