import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { aiAssistContract } from '../contract';
import type {
  AiStatus,
  AircraftList,
  AppliedView,
  GuideView,
  ItemView,
  PlanView,
  Prepared,
  RequestKind,
  Sent,
} from '../core/model';

type SuggestRound = Extract<Sent, { kind: 'suggest' }>;
type Answer = Extract<Sent, { kind: 'answer' }>;

/** What the review dialog is about to write. */
export interface Review {
  source: 'staged' | 'suggestions';
  plan?: PlanView;
  error?: string;
  busy: boolean;
}

export const useAiStore = defineStore('ai-assist', () => {
  const api = useClient(aiAssistContract);
  const list = ref<AircraftList>();
  const aircraftId = ref<string>();
  const guide = ref<GuideView>();
  const status = ref<AiStatus>();
  const loading = ref(true);
  const error = ref<string>();
  /** The item shown in the walkthrough. */
  const itemId = ref<string>();
  /** The action waiting for a press, and what the last unusable press was. */
  const listeningFor = ref<string>();
  const pressNote = ref<string>();
  const review = ref<Review>();
  const saved = ref<AppliedView & { undone?: boolean }>();
  /** A request built and shown to the user, waiting for "Send". */
  const prepared = ref<Prepared>();
  const sending = ref(false);
  const aiError = ref<string>();
  const round = ref<SuggestRound>();
  const selected = ref(new Set<string>());
  const answers = ref<Answer[]>([]);
  const lastUsage = ref<Sent['usage']>();
  const drafted = ref<string>();
  /** Answers to "explain this action", by action id, shown beside the action. */
  const explanations = ref<Record<string, Answer>>({});
  let explaining: string | undefined;
  let generation = 0;

  const items = computed<ItemView[]>(() => (guide.value?.tiers ?? []).flatMap((t) => t.items));
  const item = computed(() => items.value.find((i) => i.id === itemId.value) ?? items.value[0]);
  const keyPresent = computed(() => status.value?.keyPresent === true);

  async function loadGuide(id: string): Promise<void> {
    const mine = ++generation;
    aircraftId.value = id;
    const result = await api.guide({ aircraftId: id });
    if (mine !== generation) return;
    if (!result.ok) {
      guide.value = undefined;
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    guide.value = result.value;
    const known = items.value.some((i) => i.id === itemId.value);
    if (!known) itemId.value = result.value.progress.current ?? items.value[0]?.id;
  }

  async function load(): Promise<void> {
    const [aircraft, ai] = await Promise.all([api.aircraft(), api.status()]);
    if (ai.ok) status.value = ai.value;
    if (!aircraft.ok) {
      error.value = errorText(aircraft.error);
      loading.value = false;
      return;
    }
    list.value = aircraft.value;
    const known = aircraft.value.aircraft.some((a) => a.id === aircraftId.value);
    const id = known ? aircraftId.value : aircraft.value.aircraft[0]?.id;
    if (id) await loadGuide(id);
    loading.value = false;
  }

  async function selectAircraft(id: string): Promise<void> {
    if (id === aircraftId.value) return;
    itemId.value = undefined;
    round.value = undefined;
    answers.value = [];
    explanations.value = {};
    drafted.value = undefined;
    await loadGuide(id);
  }

  async function goTo(id: string): Promise<void> {
    itemId.value = id;
    if (aircraftId.value) await api.setCurrent({ aircraftId: aircraftId.value, itemId: id });
  }

  /** Marks the item done or skipped and moves to the next one that is neither. */
  async function finish(state: 'done' | 'skipped'): Promise<void> {
    const current = item.value;
    if (!current || !aircraftId.value || !guide.value) return;
    const all = items.value;
    const at = all.findIndex((i) => i.id === current.id);
    const settled = new Set([
      ...guide.value.progress.done,
      ...guide.value.progress.skipped,
      current.id,
    ]);
    const next =
      [...all.slice(at + 1), ...all.slice(0, at)].find((i) => !settled.has(i.id)) ?? all[at + 1];
    const result = await api.setProgress({
      aircraftId: aircraftId.value,
      itemId: current.id,
      state,
      ...(next ? { current: next.id } : {}),
    });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    guide.value = {
      ...guide.value,
      progress: {
        done: result.value.done,
        skipped: result.value.skipped,
        ...(result.value.current ? { current: result.value.current } : {}),
      },
    };
    if (next) itemId.value = next.id;
  }

  async function reopen(id: string): Promise<void> {
    if (!aircraftId.value || !guide.value) return;
    const result = await api.setProgress({
      aircraftId: aircraftId.value,
      itemId: id,
      state: 'open',
    });
    if (result.ok)
      guide.value = {
        ...guide.value,
        progress: {
          ...guide.value.progress,
          done: result.value.done,
          skipped: result.value.skipped,
        },
      };
  }

  async function resetProgress(): Promise<void> {
    if (!aircraftId.value) return;
    const result = await api.resetProgress({ aircraftId: aircraftId.value });
    if (!result.ok) error.value = errorText(result.error);
    await loadGuide(aircraftId.value);
    itemId.value = items.value[0]?.id;
  }

  // ---------------------------------------------------------------- pressing a control

  async function listen(actionId: string): Promise<void> {
    pressNote.value = undefined;
    const started = await api.listenStart();
    if (!started.ok) {
      pressNote.value = errorText(started.error);
      return;
    }
    listeningFor.value = actionId;
  }

  async function stopListening(): Promise<void> {
    listeningFor.value = undefined;
    await api.listenStop();
  }

  async function pressed(press: {
    guid: string;
    input: string;
    label: string;
    kind: string;
    deviceName: string;
  }): Promise<void> {
    const actionId = listeningFor.value;
    const action = item.value?.actions.find((a) => a.actionId === actionId);
    if (!actionId || !action || !aircraftId.value) return;
    const isAxis = press.kind === 'axis';
    if (isAxis !== (action.kind === 'axis')) {
      pressNote.value =
        action.kind === 'axis'
          ? `That was ${press.label} on ${press.deviceName}. This action needs an axis: move a lever, slider or stick.`
          : `That was ${press.label} on ${press.deviceName}. This action needs a button or a hat.`;
      return;
    }
    await stopListening();
    const result = await api.stage({
      aircraftId: aircraftId.value,
      actionId,
      deviceGuid: press.guid,
      input: press.input,
    });
    if (result.ok) {
      guide.value = result.value;
      pressNote.value = undefined;
    } else pressNote.value = errorText(result.error);
  }

  async function unstage(id?: string): Promise<void> {
    if (!aircraftId.value) return;
    const result = await api.unstage({ aircraftId: aircraftId.value, ...(id ? { id } : {}) });
    if (result.ok) guide.value = result.value;
    else error.value = errorText(result.error);
  }

  // ---------------------------------------------------------------- review and write

  async function reviewStaged(): Promise<void> {
    if (!aircraftId.value) return;
    review.value = { source: 'staged', busy: true };
    const result = await api.reviewStaged({ aircraftId: aircraftId.value });
    if (!review.value) return;
    review.value = result.ok
      ? { source: 'staged', plan: result.value, busy: false }
      : { source: 'staged', error: errorText(result.error), busy: false };
  }

  async function reviewSuggestions(): Promise<void> {
    if (!round.value) return;
    review.value = { source: 'suggestions', busy: true };
    const result = await api.reviewSuggestions({
      roundId: round.value.roundId,
      selected: [...selected.value],
    });
    if (!review.value) return;
    review.value = result.ok
      ? { source: 'suggestions', plan: result.value, busy: false }
      : { source: 'suggestions', error: errorText(result.error), busy: false };
  }

  async function applyReview(): Promise<void> {
    const current = review.value;
    if (!current?.plan || current.busy || !aircraftId.value) return;
    review.value = { ...current, busy: true };
    const result =
      current.source === 'staged'
        ? await api.applyStaged({ aircraftId: aircraftId.value })
        : await api.applySuggestions({
            roundId: round.value!.roundId,
            selected: [...selected.value],
          });
    if (!result.ok) {
      review.value = { ...current, busy: false, error: errorText(result.error) };
      return;
    }
    review.value = undefined;
    saved.value = result.value;
    if (current.source === 'suggestions') {
      round.value = undefined;
      selected.value = new Set();
    }
    notifyMachineChanged();
    await loadGuide(aircraftId.value);
  }

  async function undoSaved(): Promise<void> {
    const last = saved.value;
    if (!last || last.undone || !aircraftId.value) return;
    const result = await api.undo({ groupId: last.groupId });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    saved.value = { ...last, undone: true };
    notifyMachineChanged();
    await loadGuide(aircraftId.value);
  }

  // ---------------------------------------------------------------- AI requests

  async function prepare(
    kind: RequestKind,
    extra: { question?: string; actionId?: string } = {}
  ): Promise<void> {
    if (!aircraftId.value) return;
    aiError.value = undefined;
    explaining = kind === 'explain' ? extra.actionId : undefined;
    const result = await api.prepare({ aircraftId: aircraftId.value, kind, ...extra });
    if (result.ok) prepared.value = result.value;
    else aiError.value = errorText(result.error);
  }

  async function send(): Promise<void> {
    const request = prepared.value;
    if (!request || sending.value) return;
    sending.value = true;
    aiError.value = undefined;
    const result = await api.send({ requestId: request.requestId });
    sending.value = false;
    prepared.value = undefined;
    if (!result.ok) {
      aiError.value = errorText(result.error);
      return;
    }
    lastUsage.value = result.value.usage;
    if (result.value.kind === 'suggest') {
      round.value = result.value;
      selected.value = new Set(result.value.suggestions.filter((s) => s.selected).map((s) => s.id));
    } else if (result.value.kind === 'answer') {
      if (explaining) explanations.value = { ...explanations.value, [explaining]: result.value };
      else answers.value = [result.value, ...answers.value];
    } else {
      drafted.value = `Drafted a guide with ${result.value.items} items${result.value.dropped > 0 ? ` (${result.value.dropped} more did not name real actions and were left out)` : ''}.`;
      await load();
    }
  }

  function toggle(id: string, on: boolean): void {
    const next = new Set(selected.value);
    if (on) next.add(id);
    else next.delete(id);
    selected.value = next;
  }

  async function deleteDraft(): Promise<void> {
    if (!aircraftId.value) return;
    const result = await api.deleteDraft({ aircraftId: aircraftId.value });
    if (!result.ok) error.value = errorText(result.error);
    drafted.value = undefined;
    await load();
  }

  return {
    api,
    list,
    aircraftId,
    guide,
    status,
    loading,
    error,
    itemId,
    item,
    items,
    keyPresent,
    listeningFor,
    pressNote,
    review,
    saved,
    prepared,
    sending,
    aiError,
    round,
    selected,
    answers,
    lastUsage,
    drafted,
    explanations,
    load,
    loadGuide,
    selectAircraft,
    goTo,
    finish,
    reopen,
    resetProgress,
    listen,
    stopListening,
    pressed,
    unstage,
    reviewStaged,
    reviewSuggestions,
    applyReview,
    undoSaved,
    prepare,
    send,
    toggle,
    deleteDraft,
  };
});
