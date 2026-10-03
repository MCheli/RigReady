import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { CheckResult, NeedsYou, StepResult } from '../../../core/checks/engine';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { flyContract, type LaunchStep, type ProfileSummary, type ProfileView } from '../contract';

export type Busy = 'makeReady' | 'standDown' | 'launch' | null;
export type ProgressState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface ActivityEntry {
  id: string;
  title: string;
  state: ProgressState;
  message?: string;
  output?: string;
  phase?: 'preLaunch' | 'launch' | 'postLaunch';
}

export interface Activity {
  kind: 'makeReady' | 'standDown' | 'launch';
  title: string;
  headline?: string;
  entries: ActivityEntry[];
  needsYou: NeedsYou[];
  /** True while the action is still going. */
  running: boolean;
}

let runCounter = 0;
const newRunId = (prefix: string): string => `${prefix}-${Date.now()}-${++runCounter}`;

const stateOf = (step: StepResult): ProgressState =>
  step.skipped ? 'skipped' : step.ok ? 'done' : 'failed';

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

  /** Ready, Ready with warnings or Not ready; undefined until every item has a result. */
  const readiness = computed<'ready' | 'warnings' | 'notReady' | undefined>(() => {
    if (counts.value.failed > 0) return 'notReady';
    if (counts.value.checked < items.value.length) return undefined;
    return counts.value.warnings > 0 ? 'warnings' : 'ready';
  });

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

  async function makeReady(approved: string[]): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || busy.value) return;
    busy.value = 'makeReady';
    makeReadyRunId = newRunId('ready');
    runId = undefined;
    activity.value = {
      kind: 'makeReady',
      title: 'Make ready',
      entries: [],
      needsYou: [],
      running: true,
    };
    const result = await api.makeReady({ profileId, runId: makeReadyRunId, approved });
    busy.value = null;
    if (!result.ok) {
      activity.value = undefined;
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    results.value = Object.fromEntries(result.value.report.results.map((r) => [r.itemId, r]));
    const steps = result.value.steps;
    const done = steps.filter((s) => s.ok).length;
    const failed = steps.filter((s) => !s.ok && !s.skipped).length;
    activity.value = {
      kind: 'makeReady',
      title: 'Make ready',
      headline:
        steps.length === 0
          ? 'Nothing RigReady can fix'
          : [
              `${done} of ${steps.length} ${steps.length === 1 ? 'fix' : 'fixes'} worked`,
              ...(failed > 0 ? [`${failed} failed`] : []),
            ].join(' · '),
      entries: steps.map((s) => ({
        id: s.itemId,
        title: s.title,
        state: stateOf(s),
        message: s.message,
        ...(s.output ? { output: s.output } : {}),
      })),
      needsYou: result.value.needsYou,
      running: false,
    };
    notifyMachineChanged();
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
   * Runs pre-launch actions and starts the game. Resolves with the paused action when one
   * that must not fail did, so the screen can ask "Launch anyway / Cancel".
   */
  async function launch(
    options: { resumeAfter?: number; approved?: string[] } = {}
  ): Promise<{ paused?: { at: number; message: string; output?: string }; minimize?: boolean }> {
    const profileId = activeId.value;
    if (!profileId || busy.value) return {};
    busy.value = 'launch';
    launchRunId = newRunId('launch');
    if (options.resumeAfter === undefined || activity.value?.kind !== 'launch') {
      activity.value = {
        kind: 'launch',
        title: 'Launch',
        entries: [],
        needsYou: [],
        running: true,
      };
    } else {
      activity.value = { ...activity.value, running: true };
    }
    const result = await api.launch({
      profileId,
      runId: launchRunId,
      approved: options.approved ?? [],
      ...(options.resumeAfter !== undefined ? { resumeAfter: options.resumeAfter } : {}),
    });
    busy.value = null;
    if (!result.ok) {
      error.value = errorText(result.error);
      activity.value = { ...activity.value, running: false };
      return {};
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
    activity.value = {
      ...activity.value,
      headline: result.value.message,
      running: result.value.postLaunchPending > 0,
    };
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
    minimizeOnLaunch,
    items,
    anyChecking,
    counts,
    readiness,
    load,
    check,
    checkOne,
    select,
    fix,
    acknowledge,
    makeReady,
    gameStatus,
    standDown,
    launch,
    setMinimizeOnLaunch,
    watch,
  };
});
