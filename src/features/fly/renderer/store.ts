import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ActionReport, CheckResult, NeedsYou, StepResult } from '../../../core/checks/engine';
import { CHECK_GROUPS, type CheckGroup } from '../../../core/profile/schema';
import { err, ok, type Result } from '../../../core/result';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import {
  flyContract,
  type LaunchResult,
  type LaunchStep,
  type ProfileSummary,
  type ProfileView,
} from '../contract';
import {
  fixesLine,
  flightSteps,
  runFlight,
  type FlightStage,
  type FlightStep,
} from '../core/flight';
import type { SegmentState } from './dial';

export type Busy = 'makeReady' | 'standDown' | 'launch' | null;
export type ProgressState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface ActivityEntry {
  id: string;
  title: string;
  state: ProgressState;
  message?: string;
  output?: string;
  phase?: 'preLaunch' | 'launch' | 'postLaunch';
  /** For a fix: the checklist group of its item, which decides the phase it runs in. */
  group?: CheckGroup;
}

export interface Activity {
  /** flight: Make ready and Launch as one run. */
  kind: 'makeReady' | 'standDown' | 'launch' | 'flight';
  title: string;
  headline?: string;
  entries: ActivityEntry[];
  needsYou: NeedsYou[];
  /** True while the action is still going. */
  running: boolean;
  /** Make ready, alone or before a launch: where the run is. */
  stage?: FlightStage;
}

/** What a launch came to, for the screen: a step that stopped it, or whether to get out of the way. */
export interface LaunchOutcome {
  paused?: { at: number; message: string; output?: string };
  minimize?: boolean;
  /** Make ready and launch stopped before the launch: something required still needs the user. */
  held?: boolean;
}

let runCounter = 0;
const newRunId = (prefix: string): string => `${prefix}-${Date.now()}-${++runCounter}`;

const stateOf = (step: StepResult): ProgressState =>
  step.skipped ? 'skipped' : step.ok ? 'done' : 'failed';

const ENDED: ProgressState[] = ['done', 'failed', 'skipped'];

export const useFlyStore = defineStore('fly', () => {
  const api = useClient(flyContract);
  const loaded = ref(false);
  const profiles = ref<ProfileSummary[]>([]);
  const invalid = ref<{ id: string; file: string; message: string; detail?: string }[]>([]);
  const activeId = ref<string>();
  const view = ref<ProfileView>();
  const notice = ref<string>();
  /** Latest result per item. */
  const results = ref<Record<string, CheckResult>>({});
  /** Items being checked right now. */
  const checking = ref<Record<string, boolean>>({});
  /** Items whose fix is running. */
  const fixing = ref<Record<string, boolean>>({});
  /** What the last per-item fix said, by item. */
  const fixMessages = ref<Record<string, { ok: boolean; message: string }>>({});
  const busy = ref<Busy>(null);
  const error = ref<string>();
  const activity = ref<Activity>();
  const minimizeOnLaunch = ref(true);
  let runId: string | undefined;
  let launchRunId: string | undefined;
  let makeReadyRunId: string | undefined;
  /** The checklist run under way, when there is one. */
  let checkRun: Promise<void> | undefined;
  const offs: (() => void)[] = [];

  const active = computed(() => profiles.value.find((p) => p.id === activeId.value));
  const items = computed(() => view.value?.items ?? []);
  const anyChecking = computed(() => Object.values(checking.value).some(Boolean));

  const counts = computed(() => {
    const list = items.value.map((i) => results.value[i.itemId]).filter(Boolean) as CheckResult[];
    const missed = (r: CheckResult): boolean => r.status === 'fail' || r.status === 'error';
    return {
      checked: list.length,
      failed: list.filter((r) => r.required && missed(r)).length,
      warnings: list.filter((r) => !r.required && r.status !== 'pass').length,
      fixable: list.filter((r) => r.fix && r.fixKind === 'action').length,
      failing: list.filter((r) => r.required && missed(r)),
      optional: list.filter((r) => !r.required && r.status !== 'pass'),
    };
  });

  /**
   * What the dial draws: one state per item in the order the checklist shows them, and
   * how many of the items that count are met.
   */
  const dial = computed(() => {
    const ordered = CHECK_GROUPS.flatMap((group) => items.value.filter((i) => i.group === group));
    const states = ordered.map((item): SegmentState => {
      const result = results.value[item.itemId];
      if (result?.disabled ?? item.disabled) return 'off';
      if (!result || checking.value[item.itemId]) return 'pending';
      if (result.status === 'pass') return 'pass';
      return result.required ? 'fail' : 'warn';
    });
    const off = states.filter((state) => state === 'off').length;
    const met = ordered.filter((item) => {
      const result = results.value[item.itemId];
      return result !== undefined && !result.disabled && result.status === 'pass';
    }).length;
    return { states, met, total: ordered.length - off };
  });

  /** Ready, Ready with warnings or Not ready; undefined until every item has a result. */
  const readiness = computed<'ready' | 'warnings' | 'notReady' | undefined>(() => {
    if (counts.value.failed > 0) return 'notReady';
    if (counts.value.checked < items.value.length) return undefined;
    return counts.value.warnings > 0 ? 'warnings' : 'ready';
  });

  /** The steps of Make ready (and of the launch after it), each in its state. */
  const steps = computed<FlightStep[]>(() => {
    const current = activity.value;
    if (!current?.stage) return [];
    const fixes = current.entries
      .filter((entry) => entry.phase === undefined)
      .map((entry) => ({ group: entry.group ?? ('other' as const), state: entry.state }));
    // Every fix has ended and Make ready has not answered yet: it is checking again.
    const rechecking =
      current.stage === 'fixing' &&
      fixes.length > 0 &&
      fixes.every((fix) => ENDED.includes(fix.state));
    return flightSteps({
      fixes,
      stage: rechecking ? 'checking' : current.stage,
      withLaunch: current.kind === 'flight',
    });
  });

  const groupOf = (itemId: string): CheckGroup =>
    items.value.find((item) => item.itemId === itemId)?.group ?? 'other';

  function listen(): void {
    if (offs.length > 0) return;
    offs.push(
      api.on('result', (payload) => {
        if (payload.runId !== runId || payload.profileId !== activeId.value) return;
        results.value = { ...results.value, [payload.result.itemId]: payload.result };
        checking.value = { ...checking.value, [payload.result.itemId]: false };
      }),
      api.on('progress', (payload) => {
        if (payload.runId !== makeReadyRunId || !activity.value) return;
        upsert({
          id: payload.itemId,
          title: payload.title,
          state: payload.state,
          group: groupOf(payload.itemId),
          ...(payload.message ? { message: payload.message } : {}),
        });
      }),
      api.on('launchProgress', (payload) => {
        if (payload.runId !== launchRunId || !activity.value) return;
        upsert({
          id: `${payload.phase}:${payload.id}`,
          title: payload.title,
          state: payload.state,
          phase: payload.phase,
          ...(payload.message ? { message: payload.message } : {}),
        });
      })
    );
  }

  function upsert(entry: ActivityEntry): void {
    if (!activity.value) return;
    const entries = [...activity.value.entries];
    const at = entries.findIndex((e) => e.id === entry.id);
    if (at >= 0) entries[at] = { ...entries[at]!, ...entry };
    else entries.push(entry);
    activity.value = { ...activity.value, entries };
  }

  function reset(next?: ProfileView): void {
    view.value = next;
    results.value = {};
    checking.value = {};
    fixing.value = {};
    fixMessages.value = {};
    activity.value = undefined;
  }

  async function load(): Promise<void> {
    listen();
    const state = await api.state();
    loaded.value = true;
    if (!state.ok) {
      error.value = errorText(state.error);
      return;
    }
    profiles.value = state.value.profiles;
    invalid.value = state.value.invalid;
    notice.value = state.value.notice;
    if (activeId.value !== state.value.activeProfileId || !view.value) {
      activeId.value = state.value.activeProfileId;
      reset(state.value.active);
    } else if (state.value.active) {
      // Same setup, possibly edited: new items appear, removed ones go.
      view.value = state.value.active;
    }
    error.value = undefined;
    void api.preferences().then((prefs) => {
      if (prefs.ok) minimizeOnLaunch.value = prefs.value.minimizeOnLaunch;
    });
    await check();
  }

  /** Re-checks every item. Quiet: keep showing the current statuses (background refresh). */
  async function check(quiet = false): Promise<void> {
    const run = runCheck(quiet);
    checkRun = run;
    try {
      await run;
    } finally {
      if (checkRun === run) checkRun = undefined;
    }
  }

  /** Resolves once no checklist run is under way: every item has its answer. */
  async function settled(): Promise<void> {
    while (checkRun) await checkRun;
  }

  async function runCheck(quiet: boolean): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || busy.value === 'makeReady' || busy.value === 'standDown') return;
    const mine = newRunId('check');
    runId = mine;
    if (!quiet) {
      checking.value = Object.fromEntries(items.value.map((i) => [i.itemId, true]));
    }
    // A background refresh does not count as using the setup.
    const result = await api.check({ profileId, runId: mine, remember: !quiet });
    // A newer run, or a switch to another setup, makes this answer stale.
    if (mine !== runId || profileId !== activeId.value) return;
    checking.value = {};
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    results.value = Object.fromEntries(result.value.results.map((r) => [r.itemId, r]));
  }

  async function checkOne(itemId: string): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || checking.value[itemId]) return;
    checking.value = { ...checking.value, [itemId]: true };
    const result = await api.checkItem({ profileId, itemId });
    if (profileId !== activeId.value) return;
    checking.value = { ...checking.value, [itemId]: false };
    if (result.ok) results.value = { ...results.value, [itemId]: result.value };
    else error.value = errorText(result.error);
  }

  async function select(profileId: string): Promise<void> {
    if (profileId === activeId.value) return;
    runId = undefined;
    activeId.value = profileId;
    reset(undefined);
    const next = await api.view({ profileId });
    if (profileId !== activeId.value) return;
    if (!next.ok) {
      error.value = errorText(next.error);
      return;
    }
    view.value = next.value;
    await check();
    // The list's "last used" moves with the switch.
    const state = await api.state();
    if (state.ok) profiles.value = state.value.profiles;
  }

  /** Runs one item's fix (the caller asked for confirmation when the fix needs it). */
  async function fix(itemId: string, confirmed = false): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || fixing.value[itemId] || busy.value === 'makeReady') return;
    fixing.value = { ...fixing.value, [itemId]: true };
    const result = await api.fix({ profileId, itemId, confirmed });
    fixing.value = { ...fixing.value, [itemId]: false };
    if (profileId !== activeId.value) return;
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    results.value = { ...results.value, [itemId]: result.value.result };
    fixMessages.value = {
      ...fixMessages.value,
      [itemId]: { ok: result.value.step.ok, message: result.value.step.message },
    };
    notifyMachineChanged();
  }

  async function acknowledge(itemId: string): Promise<void> {
    const profileId = activeId.value;
    if (!profileId) return;
    fixing.value = { ...fixing.value, [itemId]: true };
    const result = await api.acknowledge({ profileId, itemId });
    fixing.value = { ...fixing.value, [itemId]: false };
    if (result.ok) results.value = { ...results.value, [itemId]: result.value };
    else error.value = errorText(result.error);
  }

  /**
   * Every available fix in order, then a re-check. As part of "Make ready and launch" the
   * screen stays busy afterwards: the launch follows, or the run says why it does not.
   */
  async function runMakeReady(
    kind: 'makeReady' | 'flight',
    approved: string[]
  ): Promise<Result<ActionReport>> {
    const profileId = activeId.value;
    if (!profileId) return err('fly.noSetup', 'No setup is open.');
    const title = kind === 'flight' ? 'Make ready and launch' : 'Make ready';
    busy.value = 'makeReady';
    makeReadyRunId = newRunId('ready');
    runId = undefined;
    activity.value = { kind, title, entries: [], needsYou: [], running: true, stage: 'fixing' };
    const result = await api.makeReady({ profileId, runId: makeReadyRunId, approved });
    if (!result.ok) {
      busy.value = null;
      activity.value = undefined;
      error.value = errorText(result.error);
      return result;
    }
    error.value = undefined;
    results.value = Object.fromEntries(result.value.report.results.map((r) => [r.itemId, r]));
    activity.value = {
      kind,
      title,
      headline: fixesLine(result.value.steps),
      entries: result.value.steps.map((s) => ({
        id: s.itemId,
        title: s.title,
        state: stateOf(s),
        message: s.message,
        group: groupOf(s.itemId),
        ...(s.output ? { output: s.output } : {}),
      })),
      needsYou: result.value.needsYou,
      running: kind === 'flight',
      stage: 'checked',
    };
    if (kind === 'makeReady') busy.value = null;
    notifyMachineChanged();
    return result;
  }

  async function makeReady(approved: string[]): Promise<void> {
    if (!activeId.value || busy.value) return;
    await runMakeReady('makeReady', approved);
  }

  async function gameStatus(): Promise<{ running: boolean; name?: string }> {
    const profileId = activeId.value;
    if (!profileId) return { running: false };
    const status = await api.gameStatus({ profileId });
    return status.ok ? status.value : { running: false };
  }

  async function standDown(closeGame: boolean): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || busy.value) return;
    busy.value = 'standDown';
    runId = undefined;
    const result = await api.standDown({ profileId, closeGame });
    busy.value = null;
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    results.value = Object.fromEntries(result.value.report.results.map((r) => [r.itemId, r]));
    activity.value = {
      kind: 'standDown',
      title: 'Stand down',
      headline: result.value.headline,
      entries: result.value.steps.map((s) => ({
        id: s.itemId,
        title: s.title,
        state: stateOf(s),
        message: s.message,
      })),
      needsYou: [],
      running: false,
    };
    notifyMachineChanged();
  }

  /**
   * Pre-launch actions, the game, post-launch actions. `keep` goes on in the panel that is
   * open (the launch after Make ready, or "Launch anyway" from it); a resumed launch does
   * the same.
   */
  async function runLaunch(
    options: { resumeAfter?: number; approved?: string[]; keep?: boolean } = {}
  ): Promise<Result<LaunchResult>> {
    const profileId = activeId.value;
    if (!profileId) return err('fly.noSetup', 'No setup is open.');
    busy.value = 'launch';
    launchRunId = newRunId('launch');
    const open = activity.value;
    const goesOn =
      open !== undefined &&
      (options.keep === true || options.resumeAfter !== undefined) &&
      (open.kind === 'launch' || open.kind === 'flight');
    const flight = goesOn && open.kind === 'flight';
    const before = flight
      ? fixesLine(
          open.entries
            .filter((e) => e.phase === undefined)
            .map((e) => ({ ok: e.state === 'done', skipped: e.state === 'skipped' }))
        )
      : '';
    activity.value = goesOn
      ? { ...open, running: true, ...(flight ? { stage: 'launching' as const } : {}) }
      : { kind: 'launch', title: 'Launch', entries: [], needsYou: [], running: true };
    const result = await api.launch({
      profileId,
      runId: launchRunId,
      approved: options.approved ?? [],
      ...(options.resumeAfter !== undefined ? { resumeAfter: options.resumeAfter } : {}),
    });
    busy.value = null;
    if (!result.ok) {
      error.value = errorText(result.error);
      activity.value = {
        ...activity.value,
        running: false,
        ...(flight ? { stage: 'launchFailed' as const } : {}),
      };
      return result;
    }
    for (const step of result.value.steps as LaunchStep[]) {
      upsert({
        id: `${step.phase}:${step.itemId}`,
        title: step.title,
        state: stateOf(step),
        message: step.message,
        phase: step.phase,
        ...(step.output ? { output: step.output } : {}),
      });
    }
    const launched = result.value.outcome === 'launched';
    activity.value = {
      ...activity.value,
      headline: flight ? `${before} · ${result.value.message}` : result.value.message,
      running: result.value.postLaunchPending > 0,
      ...(flight ? { stage: launched ? ('launched' as const) : ('launchFailed' as const) } : {}),
    };
    return result;
  }

  function launchOutcome(result: Result<LaunchResult>): LaunchOutcome {
    if (!result.ok) return {};
    if (result.value.outcome === 'paused') {
      const failed = result.value.steps[result.value.steps.length - 1];
      return {
        paused: {
          at: result.value.pausedAt ?? 0,
          message: result.value.message,
          ...(failed?.output ? { output: failed.output } : {}),
        },
      };
    }
    return { minimize: result.value.outcome === 'launched' && result.value.minimize };
  }

  /**
   * Runs pre-launch actions and starts the game. Resolves with the paused action when one
   * that must not fail did, so the screen can ask "Launch anyway / Cancel".
   */
  async function launch(
    options: { resumeAfter?: number; approved?: string[]; keep?: boolean } = {}
  ): Promise<LaunchOutcome> {
    if (!activeId.value || busy.value) return {};
    return launchOutcome(await runLaunch(options));
  }

  /**
   * Make ready and launch as one action: every fix in order, a re-check, and the game only
   * when everything required is met. Otherwise it stops there (`held`) and the screen says
   * what is missing and offers "Launch anyway".
   */
  async function readyAndLaunch(options: {
    approvedFixes: string[];
    approvedActions: string[];
  }): Promise<LaunchOutcome> {
    if (!activeId.value || busy.value) return {};
    const outcome = await runFlight({
      makeReady: () => runMakeReady('flight', options.approvedFixes),
      launch: () => runLaunch({ approved: options.approvedActions, keep: true }),
    });
    busy.value = null;
    if (outcome.stage === 'held') {
      if (activity.value) {
        activity.value = {
          ...activity.value,
          running: false,
          stage: 'held',
          headline: `${fixesLine(outcome.ready.steps)} · not launched`,
        };
      }
      return { held: true };
    }
    if (outcome.stage === 'launched' || outcome.stage === 'launchFailed') {
      return launchOutcome(ok(outcome.launch));
    }
    return {};
  }

  async function setMinimizeOnLaunch(value: boolean): Promise<void> {
    const saved = await api.setPreferences({ minimizeOnLaunch: value });
    if (saved.ok) minimizeOnLaunch.value = saved.value.minimizeOnLaunch;
    else error.value = errorText(saved.error);
  }

  async function watch(onChange: (ids: string[]) => void): Promise<() => void> {
    const off = api.on('profilesChanged', (payload) => onChange(payload.ids));
    await api.watch();
    return off;
  }

  return {
    loaded,
    profiles,
    invalid,
    activeId,
    active,
    view,
    notice,
    results,
    checking,
    fixing,
    fixMessages,
    busy,
    error,
    activity,
    steps,
    minimizeOnLaunch,
    items,
    anyChecking,
    counts,
    dial,
    readiness,
    load,
    check,
    settled,
    checkOne,
    select,
    fix,
    acknowledge,
    makeReady,
    gameStatus,
    standDown,
    launch,
    readyAndLaunch,
    setMinimizeOnLaunch,
    watch,
  };
});
