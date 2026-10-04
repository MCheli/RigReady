import type { ActionReport, CheckResult, ChecklistReport } from '../../../core/checks/engine';
import type { CheckGroup } from '../../../core/profile/schema';
import type { Result, RigError } from '../../../core/result';
import type { LaunchResult } from '../contract';

/**
 * "Make ready and launch" as one run: the fixes phase by phase, a re-check, then the game.
 * What the steps are, what state each is in, and whether the launch may go ahead. The Fly
 * screen draws it and hands in the two calls (Make ready, Launch); nothing here touches
 * the machine by itself.
 */

/** The order Make ready fixes things in (monitors first, so apps open on the right screen), with the word each phase is shown as. */
export const FIX_PHASES: readonly { group: CheckGroup; label: string }[] = [
  { group: 'displays', label: 'Monitors' },
  { group: 'audio', label: 'Audio' },
  { group: 'files', label: 'Files' },
  { group: 'devices', label: 'Devices' },
  { group: 'apps', label: 'Apps' },
  { group: 'other', label: 'Scripts' },
];

/** How one fix is doing, as Make ready reports it. */
export type FixState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/**
 * none: nothing to do in this phase. held: not started, because something required still
 * needs the user.
 */
export type StepState = 'none' | 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'held';

export interface FlightStep {
  id: CheckGroup | 'check' | 'launch';
  label: string;
  state: StepState;
  /** How many fixes the phase has, and how many are finished. */
  total: number;
  finished: number;
}

/** Where the whole run is. */
export type FlightStage =
  /** Fixes are running. */
  | 'fixing'
  /** Every fix has run; the checklist is being checked again. */
  | 'checking'
  /** Checked, and the run ends here (plain Make ready, or everything required is met and the launch follows). */
  | 'checked'
  /** Something required still needs the user: the game was not started. */
  | 'held'
  | 'launching'
  | 'launched'
  /** The launch was asked for and the game did not start, or a step before it stopped it. */
  | 'launchFailed';

export interface FlightInput {
  /** The fixes of the run, each with the checklist group of its item. */
  fixes: { group: CheckGroup; state: FixState }[];
  stage: FlightStage;
  /** False for plain Make ready: the run has no launch step. */
  withLaunch: boolean;
}

const TERMINAL: readonly FixState[] = ['done', 'failed', 'skipped'];

/** The state of one phase from the fixes in it. */
export function phaseState(states: FixState[]): StepState {
  if (states.length === 0) return 'none';
  if (states.some((s) => s === 'running')) return 'running';
  const finished = states.filter((s) => TERMINAL.includes(s));
  if (finished.length === 0) return 'pending';
  // Between two fixes of one phase: the phase is still at work.
  if (finished.length < states.length) return 'running';
  if (states.some((s) => s === 'failed')) return 'failed';
  if (states.every((s) => s === 'skipped')) return 'skipped';
  return 'done';
}

/** The steps of the run, in order, each with its state. */
export function flightSteps(input: FlightInput): FlightStep[] {
  const steps: FlightStep[] = FIX_PHASES.map(({ group, label }) => {
    const states = input.fixes.filter((f) => f.group === group).map((f) => f.state);
    return {
      id: group,
      label,
      state: phaseState(states),
      total: states.length,
      finished: states.filter((s) => TERMINAL.includes(s)).length,
    };
  });
  const checkState: StepState =
    input.stage === 'fixing' ? 'pending' : input.stage === 'checking' ? 'running' : 'done';
  steps.push({ id: 'check', label: 'Re-check', state: checkState, total: 0, finished: 0 });
  if (input.withLaunch) {
    const launch: Record<FlightStage, StepState> = {
      fixing: 'pending',
      checking: 'pending',
      checked: 'pending',
      held: 'held',
      launching: 'running',
      launched: 'done',
      launchFailed: 'failed',
    };
    steps.push({
      id: 'launch',
      label: 'Launch',
      state: launch[input.stage],
      total: 0,
      finished: 0,
    });
  }
  return steps;
}

const missed = (r: CheckResult): boolean => r.status === 'fail' || r.status === 'error';

/** The required items that are not met: what stands between the rig and Ready. */
export function blockers(report: ChecklistReport): CheckResult[] {
  return report.results.filter((r) => r.required && !r.disabled && missed(r));
}

export interface Blocker {
  itemId: string;
  title: string;
  summary: string;
}

/**
 * After Make ready: the launch goes ahead only when everything required is met. Otherwise
 * the run stops, with what is still missing; nothing is launched past it without the user
 * saying so.
 */
export function afterMakeReady(
  report: Pick<ActionReport, 'report'>
): { go: true } | { go: false; blockers: Blocker[] } {
  const left = blockers(report.report);
  if (report.report.ready && left.length === 0) return { go: true };
  return {
    go: false,
    blockers: left.map((r) => ({ itemId: r.itemId, title: r.title, summary: r.summary })),
  };
}

/** One line for the end of the fixing part: "3 of 4 fixes worked · 1 failed". */
export function fixesLine(steps: { ok: boolean; skipped?: boolean | undefined }[]): string {
  if (steps.length === 0) return 'Nothing RigReady can fix';
  const done = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok && !s.skipped).length;
  return [
    `${done} of ${steps.length} ${steps.length === 1 ? 'fix' : 'fixes'} worked`,
    ...(failed > 0 ? [`${failed} failed`] : []),
  ].join(' · ');
}

/** The two calls the run is made of, as the Fly screen makes them. */
export interface FlightCalls {
  /** Every available fix in order, then a re-check of everything. Waits for "Keep this layout?". */
  makeReady(): Promise<Result<ActionReport>>;
  /** Steps before launch, the game, steps after. */
  launch(): Promise<Result<LaunchResult>>;
}

export type FlightOutcome =
  /** Make ready itself could not run. Nothing was launched. */
  | { stage: 'failed'; error: RigError }
  /** Something required still needs the user. Nothing was launched. */
  | { stage: 'held'; ready: ActionReport; blockers: Blocker[] }
  /** Launch was asked for and answered: the game runs, or it says why not (failed or paused). */
  | { stage: 'launched' | 'launchFailed'; ready: ActionReport; launch: LaunchResult }
  /** Launch was asked for and could not be carried out at all. */
  | { stage: 'launchError'; ready: ActionReport; error: RigError };

/**
 * Make ready, then Launch, as one action: the game is started only when the re-check after
 * the fixes says everything required is met. Launch is never called otherwise; the caller
 * offers "Launch anyway" with what is still missing.
 */
export async function runFlight(
  calls: FlightCalls,
  onStage: (stage: FlightStage) => void = () => undefined
): Promise<FlightOutcome> {
  onStage('fixing');
  const ready = await calls.makeReady();
  if (!ready.ok) return { stage: 'failed', error: ready.error };
  const decision = afterMakeReady(ready.value);
  if (!decision.go) {
    onStage('held');
    return { stage: 'held', ready: ready.value, blockers: decision.blockers };
  }
  onStage('launching');
  const launch = await calls.launch();
  if (!launch.ok) {
    onStage('launchFailed');
    return { stage: 'launchError', ready: ready.value, error: launch.error };
  }
  const stage = launch.value.outcome === 'launched' ? 'launched' : 'launchFailed';
  onStage(stage);
  return { stage, ready: ready.value, launch: launch.value };
}
