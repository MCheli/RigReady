import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ChecklistReport, StepResult } from '../../../core/checks/engine';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { flyContract } from '../contract';

export type Busy = 'loading' | 'checking' | 'makeReady' | 'standDown' | 'launch' | null;

export const useFlyStore = defineStore('fly', () => {
  const api = useClient(flyContract);
  const profiles = ref<{ id: string; name: string; canLaunch: boolean }[]>([]);
  const activeId = ref<string>();
  const report = ref<ChecklistReport>();
  const busy = ref<Busy>('loading');
  const error = ref<string>();
  /** What the last Make ready / Stand down / Launch did. */
  const activity = ref<{ title: string; steps: StepResult[] }>();
  let generation = 0;

  const active = computed(() => profiles.value.find((p) => p.id === activeId.value));

  async function load(): Promise<void> {
    busy.value = 'loading';
    const state = await api.state();
    if (!state.ok) {
      error.value = errorText(state.error);
      busy.value = null;
      return;
    }
    profiles.value = state.value.profiles;
    if (!profiles.value.some((p) => p.id === activeId.value)) {
      activeId.value = state.value.activeProfileId;
      report.value = undefined;
      activity.value = undefined;
    }
    busy.value = null;
    await check();
  }

  /** Re-runs the checklist. A quiet check does not show the busy state (used for background refresh). */
  async function check(quiet = false): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || (busy.value !== null && busy.value !== 'checking')) return;
    const mine = ++generation;
    if (!quiet) busy.value = 'checking';
    const result = await api.check({ profileId });
    // A newer check or a profile switch makes this answer stale.
    if (mine !== generation || profileId !== activeId.value) return;
    if (result.ok) {
      report.value = result.value;
      error.value = undefined;
    } else {
      error.value = errorText(result.error);
    }
    if (!quiet) busy.value = null;
  }

  async function select(profileId: string): Promise<void> {
    if (profileId === activeId.value) return;
    generation++;
    activeId.value = profileId;
    report.value = undefined;
    activity.value = undefined;
    busy.value = null;
    await check();
  }

  async function act(kind: 'makeReady' | 'standDown', title: string): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || busy.value) return;
    generation++;
    busy.value = kind;
    const result = await api[kind]({ profileId });
    busy.value = null;
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    report.value = result.value.report;
    activity.value = { title, steps: result.value.steps };
    notifyMachineChanged();
  }

  const makeReady = (): Promise<void> => act('makeReady', 'Make ready');
  const standDown = (): Promise<void> => act('standDown', 'Stand down');

  async function launch(): Promise<void> {
    const profileId = activeId.value;
    if (!profileId || busy.value) return;
    busy.value = 'launch';
    const result = await api.launch({ profileId });
    busy.value = null;
    activity.value = {
      title: 'Launch',
      steps: [
        {
          itemId: 'launch',
          title: active.value?.name ?? 'Launch',
          ok: result.ok,
          message: result.ok ? result.value.message : errorText(result.error),
        },
      ],
    };
  }

  return {
    profiles,
    activeId,
    active,
    report,
    busy,
    error,
    activity,
    load,
    check,
    select,
    makeReady,
    standDown,
    launch,
  };
});
