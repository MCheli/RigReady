import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { aiAssistContract } from '../contract';
import type { IracingWanted } from '../core/iracing';
import type {
  AiStatus,
  AircraftList,
  AppliedView,
  GuideGames,
  GuideView,
  IracingReviewView,
  ItemView,
  PlanView,
  Prepared,
  RequestKind,
  SendProgress,
  Sent,
} from '../core/model';
import type { GuideGame } from '../core/pack';

/** One iRacing binding the walkthrough is about to save, after the user pressed it. */
export interface IracingBinding {
  actionId: string;
  binding: IracingWanted;
  review?: IracingReviewView;
  error?: string;
  busy: boolean;
}

/** Keys that only modify another: while one is held the walkthrough waits for the key. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS']);

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
  /** The games the guide covers, and whether each is on this PC. */
  const games = ref<GuideGames['games']>([]);
  /** The game shown; undefined while none of them is on this PC. */
  const game = ref<GuideGame>();
  /** iRacing: the binding just pressed, shown before it is saved. */
  const iracingBinding = ref<IracingBinding>();
  /** iRacing: what the last save said ("Saved in iRacing's file ..."). */
  const iracingSaved = ref<string>();
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
  /** How far the request being answered is (streamed requests only), and when it was sent. */
  const progress = ref<SendProgress>();
  const sentAt = ref<number>();
  const cancelling = ref(false);
  const aiError = ref<string>();
  /** Something that happened to a request and is not a failure (the user cancelled it). */
  const aiNote = ref<string>();
  const round = ref<SuggestRound>();
  const selected = ref(new Set<string>());
  const answers = ref<Answer[]>([]);
  const lastUsage = ref<Sent['usage']>();
  const drafted = ref<string>();
  /** What was just done with the guide file of the aircraft shown: imported, started, opened. */
  const guideNote = ref<string>();
  /** Answers to "explain this action", by action id, shown beside the action. */
  const explanations = ref<Record<string, Answer>>({});
  let explaining: string | undefined;
  let generation = 0;
  /** Bumped by every progress write, so a guide read that started earlier cannot undo it. */
  let progressWrites = 0;

  const items = computed<ItemView[]>(() => (guide.value?.tiers ?? []).flatMap((t) => t.items));
  const item = computed(() => items.value.find((i) => i.id === itemId.value) ?? items.value[0]);
  /** AI help can be used: a provider is set up, with a key when it needs one. */
  const aiReady = computed(() => status.value?.ready === true);

  async function loadGuide(id: string): Promise<void> {
    const mine = ++generation;
    const writesBefore = progressWrites;
    aircraftId.value = id;
    const result = await api.guide({ aircraftId: id });
    if (mine !== generation) return;
    if (!result.ok) {
      guide.value = undefined;
      error.value = errorText(result.error);
      return;
    }
    error.value = undefined;
    // A reload (after a file changed) can be answered after Done was pressed: the
    // bindings it read are new, but the progress it read is older than that write.
    const kept = writesBefore !== progressWrites ? guide.value?.progress : undefined;
    guide.value = kept ? { ...result.value, progress: kept } : result.value;
    const known = items.value.some((i) => i.id === itemId.value);
    if (!known) itemId.value = result.value.progress.current ?? items.value[0]?.id;
  }

  /**
   * Reads which games are here, then the list of the game shown: the one asked for, the one
   * shown before while it is still here, or the first that is.
   */
  async function load(wanted?: GuideGame): Promise<void> {
    const [found, ai] = await Promise.all([api.games(), api.status()]);
    if (ai.ok) status.value = ai.value;
    if (!found.ok) {
      error.value = errorText(found.error);
      loading.value = false;
      return;
    }
    games.value = found.value.games;
    const here = found.value.games.filter((g) => g.available).map((g) => g.id);
    const pick =
      wanted && found.value.games.some((g) => g.id === wanted)
        ? wanted
        : game.value && here.includes(game.value)
          ? game.value
          : here[0];
    game.value = pick;
    if (!pick) {
      list.value = undefined;
      guide.value = undefined;
      loading.value = false;
      return;
    }
    const aircraft = await api.aircraft({ game: pick });
    if (!aircraft.ok) {
      error.value = errorText(aircraft.error);
      loading.value = false;
      return;
    }
    // Another game was chosen while this one was read.
    if (game.value !== pick) return;
    list.value = aircraft.value;
    error.value = undefined;
    const known = aircraft.value.aircraft.some((a) => a.id === aircraftId.value);
    const id = known ? aircraftId.value : aircraft.value.aircraft[0]?.id;
    if (id) await loadGuide(id);
    else guide.value = undefined;
    loading.value = false;
  }

  /** Forgets what belongs to the aircraft or class shown, before another is shown. */
  function forgetShown(): void {
    itemId.value = undefined;
    round.value = undefined;
    answers.value = [];
    explanations.value = {};
    drafted.value = undefined;
    guideNote.value = undefined;
    iracingBinding.value = undefined;
    iracingSaved.value = undefined;
    pressNote.value = undefined;
  }

  async function selectGame(id: GuideGame): Promise<void> {
    if (id === game.value) return;
    if (listeningFor.value) await stopListening();
    forgetShown();
    aircraftId.value = undefined;
    guide.value = undefined;
    saved.value = undefined;
    // What went wrong for the other game is not this one's.
    error.value = undefined;
    list.value = undefined;
    await load(id);
  }

  async function selectAircraft(id: string): Promise<void> {
    if (id === aircraftId.value) return;
    if (listeningFor.value) await stopListening();
    forgetShown();
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
    progressWrites++;
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
    progressWrites++;
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

  const iracingShown = (): boolean => guide.value?.game === 'iracing';

  async function listen(actionId: string): Promise<void> {
    pressNote.value = undefined;
    iracingSaved.value = undefined;
    const started = await api.listenStart();
    if (!started.ok) {
      pressNote.value = errorText(started.error);
      // In iRacing a key can still be bound without the controllers.
      if (!iracingShown()) return;
    }
    listeningFor.value = actionId;
    if (iracingShown()) window.addEventListener('keydown', onKey, true);
  }

  async function stopListening(): Promise<void> {
    listeningFor.value = undefined;
    window.removeEventListener('keydown', onKey, true);
    await api.listenStop();
  }

  /** iRacing: a key pressed while the walkthrough listens is the binding asked for. */
  function onKey(event: KeyboardEvent): void {
    if (!listeningFor.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      void stopListening();
      return;
    }
    // While it listens, a key is the answer: it must not click a button or open the palette.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || MODIFIER_KEYS.has(event.key)) return;
    void previewIracing(listeningFor.value, {
      kind: 'keyPress',
      key: event.key,
      code: event.code,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
  }

  /** iRacing: asks what this binding would change, for the user to look at. Writes nothing. */
  async function previewIracing(actionId: string, binding: IracingWanted): Promise<void> {
    const id = aircraftId.value;
    if (!id) return;
    await stopListening();
    pressNote.value = undefined;
    iracingBinding.value = { actionId, binding, busy: true };
    const result = await api.iracingBindPreview({ aircraftId: id, actionId, binding });
    // Closed, or another action chosen, meanwhile.
    if (iracingBinding.value?.actionId !== actionId || aircraftId.value !== id) return;
    if (!result.ok) {
      iracingBinding.value = undefined;
      pressNote.value = errorText(result.error);
      return;
    }
    iracingBinding.value = { actionId, binding, review: result.value, busy: false };
  }

  /** iRacing: saves the binding shown, through the iRacing bindings feature. */
  async function saveIracing(): Promise<void> {
    const current = iracingBinding.value;
    const id = aircraftId.value;
    if (!current?.review || current.busy || !id) return;
    iracingBinding.value = { ...current, busy: true, error: undefined };
    const result = await api.iracingBind({
      aircraftId: id,
      actionId: current.actionId,
      binding: current.binding,
      seen: current.review.seen,
    });
    if (!result.ok) {
      iracingBinding.value = { ...current, busy: false, error: errorText(result.error) };
      return;
    }
    iracingBinding.value = undefined;
    iracingSaved.value = result.value.message;
    notifyMachineChanged();
    await loadGuide(id);
  }

  function cancelIracing(): void {
    iracingBinding.value = undefined;
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
    if (iracingShown()) {
      const button = /^JOY_BTN(\d+)$/.exec(press.input);
      if (press.kind === 'axis') {
        pressNote.value = `That was an axis on ${press.deviceName}. This action needs a button or a key; an axis is bound in iRacing.`;
      } else if (press.kind !== 'button' || !button) {
        pressNote.value = `That was a hat switch on ${press.deviceName}. RigReady binds buttons and keys in iRacing. Bind a hat switch in iRacing: Options, then Controls.`;
      } else if (Number(button[1]) > 128) {
        pressNote.value = 'iRacing bindings hold buttons 1 to 128 of a controller.';
      } else {
        await previewIracing(actionId, {
          kind: 'button',
          device: press.guid,
          button: Number(button[1]),
        });
      }
      return;
    }
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
    aiNote.value = undefined;
    explaining = kind === 'explain' ? extra.actionId : undefined;
    const result = await api.prepare({ aircraftId: aircraftId.value, kind, ...extra });
    if (result.ok) prepared.value = result.value;
    else aiError.value = errorText(result.error);
  }

  async function send(): Promise<void> {
    const request = prepared.value;
    if (!request || sending.value) return;
    sending.value = true;
    progress.value = undefined;
    cancelling.value = false;
    sentAt.value = Date.now();
    aiError.value = undefined;
    aiNote.value = undefined;
    const result = await api.send({ requestId: request.requestId });
    sending.value = false;
    progress.value = undefined;
    cancelling.value = false;
    prepared.value = undefined;
    if (!result.ok) {
      if (result.error.code === 'ai.cancelled') aiNote.value = result.error.message;
      else aiError.value = errorText(result.error);
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

  /** Progress of the request being answered; anything about another request is ignored. */
  function progressed(update: SendProgress): void {
    if (sending.value && update.requestId === prepared.value?.requestId) progress.value = update;
  }

  /** Stops the request being answered. `send` then ends with the "cancelled" note. */
  async function cancelSend(): Promise<void> {
    const request = prepared.value;
    if (!request || !sending.value || cancelling.value) return;
    cancelling.value = true;
    const result = await api.cancel({ requestId: request.requestId });
    if (!result.ok) {
      cancelling.value = false;
      aiError.value = errorText(result.error);
    }
  }

  function toggle(id: string, on: boolean): void {
    const next = new Set(selected.value);
    if (on) next.add(id);
    else next.delete(id);
    selected.value = next;
  }

  /**
   * Deletes the guide file kept for the aircraft shown: the draft by AI (`draft`), or after
   * the user said yes in the dialog, whichever guide it is. A copy is kept for the Safety page.
   */
  async function deleteGuide(which: 'draft' | 'kept'): Promise<void> {
    if (!aircraftId.value) return;
    const input = { aircraftId: aircraftId.value };
    const result = await (which === 'draft' ? api.deleteDraft(input) : api.deleteGuide(input));
    if (!result.ok) error.value = errorText(result.error);
    drafted.value = undefined;
    guideNote.value = undefined;
    await load();
    if (result.ok && result.value.deleted) {
      guideNote.value = 'The guide is deleted. The Safety page can put it back.';
    }
  }

  /** A guide file the user picks in the Windows dialog, for the aircraft shown. */
  async function importGuide(): Promise<void> {
    if (!aircraftId.value) return;
    guideNote.value = undefined;
    const result = await api.importGuide({ aircraftId: aircraftId.value });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    if (!result.value.imported) return;
    const items = result.value.items;
    await load();
    guideNote.value = `Imported a guide with ${items} ${items === 1 ? 'item' : 'items'}. It is kept as a file of your own in RigReady's data folder.`;
  }

  /** A short starter guide for the aircraft shown, for the user to edit. */
  async function startOwnGuide(): Promise<void> {
    if (!aircraftId.value) return;
    guideNote.value = undefined;
    const result = await api.startOwnGuide({ aircraftId: aircraftId.value });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    await load();
    guideNote.value =
      'A short starter guide was written, with an example on real actions of this aircraft. Open the file, change it to what matters to you, save, then read it again.';
  }

  async function openGuideFile(): Promise<void> {
    if (!aircraftId.value) return;
    const result = await api.openGuideFile({ aircraftId: aircraftId.value });
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    guideNote.value = 'The file is open in Notepad. Save it there, then read it again here.';
  }

  /** Reads the guide file again, after the user changed it in an editor. */
  async function reloadGuide(): Promise<void> {
    guideNote.value = undefined;
    await load();
  }

  return {
    api,
    games,
    game,
    iracingBinding,
    iracingSaved,
    selectGame,
    saveIracing,
    cancelIracing,
    list,
    aircraftId,
    guide,
    status,
    loading,
    error,
    itemId,
    item,
    items,
    aiReady,
    listeningFor,
    pressNote,
    review,
    saved,
    prepared,
    sending,
    progress,
    sentAt,
    cancelling,
    aiError,
    aiNote,
    round,
    selected,
    answers,
    lastUsage,
    drafted,
    guideNote,
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
    progressed,
    cancelSend,
    toggle,
    deleteGuide,
    importGuide,
    startOwnGuide,
    openGuideFile,
    reloadGuide,
  };
});
