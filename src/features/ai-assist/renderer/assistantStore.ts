import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { Result, RigError } from '../../../core/result';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { aiAssistContract } from '../contract';
import { assistantOpen } from '../panel';
import {
  type AssistantProgress,
  type ConversationView,
  type Drafts,
  type SavedScript,
  type TurnPreview,
} from '../core/assistantModel';

/**
 * The assistant panel: one conversation at a time, the message being written, the request
 * waiting for the user's Send, what the assistant is doing while it works, what assistants
 * drafted, and the scripts that need the user's approval again.
 *
 * Three things hold whatever happens:
 * - A Send button is on screen only for a request RigReady still holds. A request that was
 *   dropped (who answers changed, a new one replaced it) is made ready again or taken away,
 *   never left to fail on the next press.
 * - The user's message is never lost: it is in the box until it has been taken by the
 *   provider, and back in the box when a send fails.
 * - After a failure, trying again is one press on the same button.
 */
export const useAssistantStore = defineStore('ai-assistant', () => {
  const api = useClient(aiAssistContract);
  const open = assistantOpen;
  const keyPresent = ref(false);
  const conversation = ref<ConversationView>();
  /** The message being written. It lives here so that closing the panel cannot lose it. */
  const draft = ref('');
  const preview = ref<TurnPreview>();
  /** A request is being made ready. */
  const preparing = ref(false);
  /** A request is on its way, or requests that follow each other by themselves are. */
  const sending = ref(false);
  /** Something went wrong: said in red. */
  const error = ref<string>();
  /** Which kind of failure `error` tells of. */
  const errorCode = ref<string>();
  /**
   * The monthly budget holds the message back. Its way out is in Settings, which the panel
   * covers: the panel offers a button that leads there.
   */
  const budgetStopped = computed(
    () => error.value !== undefined && errorCode.value === 'ai.budget'
  );
  /** Asked from that button: Settings brings the monthly budget into view, then takes this back. */
  const showBudget = ref(false);
  /** Something the user should know that is no failure: a stop, a request made ready again. */
  const notice = ref<string>();
  /** The request on screen was sent and came back with a failure: its button reads "Try again". */
  const failed = ref(false);
  /**
   * "Don't show this again for this conversation": the conversation the tick belongs to.
   * It is tied to the conversation's id, so it cannot carry over to another one.
   */
  const skipFor = ref<string>();
  /** The user pressed Stop: requests that follow tool use are not sent by themselves. */
  const stopped = ref(false);
  /** What the assistant is doing right now, while a request is on its way. */
  const progress = ref<AssistantProgress>();
  /** The request on its way was answered: its message is part of the conversation now. */
  const taken = ref(false);
  const drafts = ref<Drafts>({ setups: [], scripts: [] });
  const scripts = ref<SavedScript[]>([]);
  /** What the last Save did, by draft id: the words of main's answer. */
  const saved = ref<Record<string, { message: string; setupId?: string }>>({});
  const draftErrors = ref<Record<string, string>>({});

  /** Goes up with every new conversation: what an older one still answers is ignored. */
  let epoch = 0;
  /** Goes up with every request made ready: only the latest is shown. */
  let builds = 0;
  /** Goes up with every request sent: a late look at the conversation is not applied. */
  let sends = 0;

  const waitingScripts = computed(() => scripts.value.filter((s) => s.state !== 'approved'));
  const pendingCount = computed(
    () => drafts.value.setups.length + drafts.value.scripts.length + waitingScripts.value.length
  );
  /** The conversation on screen: the one a ready request belongs to, or the one being read. */
  const currentId = computed(
    () => preview.value?.conversationId ?? conversation.value?.conversationId
  );
  const skipPreview = computed<boolean>({
    get: () => skipFor.value !== undefined && skipFor.value === currentId.value,
    set: (on) => {
      skipFor.value = on ? currentId.value : undefined;
    },
  });
  /** The user's message while it is on its way and not yet part of the conversation. */
  const pendingText = computed(() =>
    sending.value && !taken.value ? preview.value?.text : undefined
  );
  /** Tool results wait and no request is ready for them: "Continue" builds one. */
  const canResume = computed(
    () => !!conversation.value?.waiting && !preview.value && !sending.value && !preparing.value
  );

  async function refreshStatus(): Promise<void> {
    const status = await api.status();
    // Ready: a provider is set up, with a key when it needs one.
    keyPresent.value = status.ok && status.value.ready;
  }

  async function refreshDrafts(): Promise<void> {
    const [got, listed] = await Promise.all([api.drafts(), api.assistantScripts()]);
    if (got.ok) drafts.value = got.value;
    if (listed.ok) scripts.value = listed.value.scripts;
  }

  /** Says what went wrong, and remembers which kind of failure it was. */
  function fail(message: string, code: string): void {
    error.value = message;
    errorCode.value = code;
  }

  function clearMessages(): void {
    error.value = undefined;
    notice.value = undefined;
    failed.value = false;
  }

  /**
   * A request that carries a message stays on screen only while the box holds that message:
   * what is shown as "ready to send" is always what Send would send.
   */
  function settle(): void {
    const request = preview.value;
    if (!request || request.text === undefined || sending.value) return;
    if (request.text === draft.value.trim()) return;
    preview.value = undefined;
    failed.value = false;
    notice.value = undefined;
    void api.assistantDiscard({ requestId: request.requestId });
  }

  /** The box changed. */
  function edit(text: string): void {
    draft.value = text;
    settle();
  }

  /** A message that did not go is put back in the box, in front of anything written since. */
  function restore(text: string | undefined): void {
    if (text === undefined) return;
    const now = draft.value.trim();
    if (now === '') draft.value = text;
    else if (now !== text) draft.value = `${text}\n${draft.value}`;
  }

  /** Shows a request that was made ready, unless a newer one or a new conversation came since. */
  function take(result: Result<TurnPreview>, at: number, build: number): TurnPreview | undefined {
    if (at !== epoch || build !== builds) {
      // Left over from before: thrown away, unless it belongs to the conversation on screen
      // (there the newer request has already replaced it).
      if (result.ok && result.value.conversationId !== currentId.value) {
        void api.assistantDiscard({ requestId: result.value.requestId });
      }
      return undefined;
    }
    if (!result.ok) {
      fail(errorText(result.error), result.error.code);
      return undefined;
    }
    preview.value = result.value;
    settle();
    return preview.value;
  }

  /**
   * Makes the message in the box ready to send and shows what would be sent. With that very
   * message already shown, it sends it: Enter twice sends.
   */
  async function prepare(): Promise<boolean> {
    const text = draft.value.trim();
    if (text === '' || sending.value || preparing.value) return false;
    const ready = preview.value;
    if (ready && ready.text === text) {
      if (ready.overCeiling) return false;
      await send();
      return true;
    }
    clearMessages();
    const at = epoch;
    const build = ++builds;
    preparing.value = true;
    const result = await api.assistantPrepare({
      text,
      ...(conversation.value ? { conversationId: conversation.value.conversationId } : {}),
    });
    if (at === epoch) preparing.value = false;
    const request = take(result, at, build);
    if (!request) return false;
    stopped.value = false;
    if (skipPreview.value && !request.overCeiling) await send();
    return true;
  }

  /** Builds the request for tool results that wait, after a stop or a request not sent. */
  async function resume(): Promise<void> {
    const id = conversation.value?.conversationId;
    if (!id || sending.value || preparing.value || preview.value) return;
    clearMessages();
    const at = epoch;
    const build = ++builds;
    preparing.value = true;
    const result = await api.assistantResume({ conversationId: id });
    if (at === epoch) preparing.value = false;
    const request = take(result, at, build);
    if (!request) return;
    stopped.value = false;
    if (skipPreview.value && !request.overCeiling) await send();
  }

  /**
   * Makes a request ready again that RigReady no longer holds, or that was made for other
   * settings. What comes back is shown and never sent by itself.
   */
  async function rebuild(request: TurnPreview): Promise<TurnPreview | undefined> {
    const at = epoch;
    const build = ++builds;
    preview.value = undefined;
    preparing.value = true;
    let result: Result<TurnPreview>;
    if (request.text === undefined) {
      result = await api.assistantResume({ conversationId: request.conversationId });
    } else {
      result = await api.assistantPrepare({
        conversationId: request.conversationId,
        text: request.text,
      });
      // Nothing was ever sent in it and it is gone: the message begins a new conversation.
      if (!result.ok && result.error.code === 'ai.conversation' && !conversation.value) {
        result = await api.assistantPrepare({ text: request.text });
      }
    }
    if (at === epoch) preparing.value = false;
    const rebuilt = take(result, at, build);
    // The tick stays with the conversation the message is in.
    if (rebuilt && skipFor.value === request.conversationId) {
      skipFor.value = rebuilt.conversationId;
    }
    return rebuilt;
  }

  async function sendFailed(request: TurnPreview, failure: RigError): Promise<void> {
    const message = errorText(failure);
    restore(request.text);
    switch (failure.code) {
      case 'ai.stopped':
        // Stopped before the answer came: the request is still ready.
        notice.value = message;
        return;
      case 'ai.ceiling':
        // Held back at the ceiling: it goes when the user says so.
        preview.value = { ...request, overCeiling: true };
        notice.value = message;
        return;
      case 'ai.busy':
        fail(message, failure.code);
        return;
      case 'ai.budget':
        // Held back by the monthly budget, on the estimate: it stays ready, and goes once
        // the budget is raised or turned off in Settings.
        fail(message, failure.code);
        return;
      case 'ai.conversation':
        // The conversation is gone in RigReady: nothing more can be sent in it.
        preview.value = undefined;
        conversation.value = undefined;
        fail(message, failure.code);
        return;
      case 'ai.expired':
      case 'ai.changed': {
        const rebuilt = await rebuild(request);
        if (!rebuilt) return;
        const same = rebuilt.to === request.to && rebuilt.model === request.model;
        if (failure.code !== 'ai.changed') {
          notice.value =
            'The request was made ready again. Nothing was sent: look it over and send.';
        } else if (same) {
          notice.value =
            'Settings were changed after this request was shown, so it was made ready again and its estimate worked out anew. Nothing was sent: look it over and send.';
        } else {
          notice.value = `Who answers was changed in Settings, so the request was made ready again for ${rebuilt.to}. Nothing was sent: look it over and send.`;
        }
        return;
      }
      default:
        // The provider refused or could not be reached: the request is still ready.
        failed.value = true;
        fail(message, failure.code);
    }
  }

  /**
   * Sends the request on screen. With the tick set, the requests that follow tool use go by
   * themselves until the answer is there, Stop is pressed, or the ceiling is reached: going
   * past the ceiling is only ever the user's own press (`pastCeiling`).
   */
  async function send(pastCeiling = false): Promise<void> {
    let request = preview.value;
    if (!request || sending.value || preparing.value) return;
    if (request.overCeiling && !pastCeiling) return;
    const at = epoch;
    sending.value = true;
    stopped.value = false;
    clearMessages();
    let past = pastCeiling;
    try {
      for (;;) {
        sends += 1;
        taken.value = false;
        progress.value = undefined;
        // The message leaves the box: it is shown above as on its way.
        if (request.text !== undefined && draft.value.trim() === request.text) draft.value = '';
        const before = conversation.value?.entries.length ?? 0;
        const result = await api.assistantSend({
          requestId: request.requestId,
          ...(past ? { pastCeiling: true } : {}),
        });
        if (at !== epoch) return;
        if (!result.ok) {
          await sendFailed(request, result.error);
          return;
        }
        past = false;
        conversation.value = result.value.conversation;
        preview.value = result.value.next;
        // A tool may have changed the rig: the screens that show it read it again.
        const added = result.value.conversation.entries.slice(before);
        if (added.some((e) => e.kind === 'tool' && e.tier !== 'read')) notifyMachineChanged();
        await refreshDrafts();
        if (at !== epoch) return;
        const next = preview.value;
        if (!next || !skipPreview.value || stopped.value || next.overCeiling) return;
        request = next;
      }
    } finally {
      if (at === epoch) {
        sending.value = false;
        progress.value = undefined;
        taken.value = false;
        settle();
      }
    }
  }

  /** Stop: the request on its way ends, no further tool runs, nothing more goes by itself. */
  async function stop(): Promise<void> {
    stopped.value = true;
    const id = currentId.value;
    if (sending.value && id) await api.assistantStop({ conversationId: id });
  }

  /** "Don't send": the request is thrown away in RigReady too; the message stays in the box. */
  async function drop(): Promise<void> {
    const request = preview.value;
    if (!request || sending.value) return;
    preview.value = undefined;
    clearMessages();
    await api.assistantDiscard({ requestId: request.requestId });
  }

  async function newConversation(): Promise<void> {
    const id = currentId.value;
    epoch += 1;
    conversation.value = undefined;
    preview.value = undefined;
    skipFor.value = undefined;
    preparing.value = false;
    sending.value = false;
    stopped.value = false;
    progress.value = undefined;
    taken.value = false;
    clearMessages();
    // Ends a send under way too, and throws away what was ready.
    if (id) await api.assistantForget({ conversationId: id });
  }

  /**
   * Settings > AI changed (provider, model, key, prices, ceiling, monthly budget). A request
   * on screen was made for the old settings: it is made ready again for the new ones, or
   * taken away when no provider is ready any more or the monthly budget holds it back. An old
   * failure is no longer true and goes.
   */
  async function settingsChanged(): Promise<void> {
    await refreshStatus();
    if (sending.value) return;
    error.value = undefined;
    failed.value = false;
    const request = preview.value;
    if (!request) return;
    if (!keyPresent.value) {
      await drop();
      return;
    }
    const rebuilt = await rebuild(request);
    if (!rebuilt) return;
    if (rebuilt.to !== request.to || rebuilt.model !== request.model) {
      notice.value = `Who answers was changed in Settings: this request now goes to ${rebuilt.to}, ${rebuilt.model}. Nothing was sent.`;
    } else if (rebuilt.prices !== request.prices || rebuilt.approxCost !== request.approxCost) {
      notice.value =
        'The prices were changed in Settings: the estimate for this request was worked out again. Nothing was sent.';
    }
  }

  /** The assistant got further: what it is doing, and what the tools answered so far. */
  function onProgress(now: AssistantProgress): void {
    if (!sending.value || now.conversationId !== currentId.value) return;
    progress.value = now;
    if (now.phase !== 'tool') return;
    // The answer was taken and tools run: the conversation up to here can be shown.
    const at = epoch;
    const sent = sends;
    void api.assistantConversation({ conversationId: now.conversationId }).then((got) => {
      if (!got.ok || at !== epoch || sent !== sends || !sending.value) return;
      if (got.value.entries.length < (conversation.value?.entries.length ?? 0)) return;
      conversation.value = got.value;
      taken.value = true;
    });
  }

  async function saveSetup(draftId: string): Promise<void> {
    const result = await api.saveSetupDraft({ draftId });
    if (!result.ok) {
      draftErrors.value = { ...draftErrors.value, [draftId]: errorText(result.error) };
      return;
    }
    saved.value = {
      ...saved.value,
      [draftId]: { message: result.value.message, setupId: result.value.setupId },
    };
    notifyMachineChanged();
    await refreshDrafts();
  }

  async function saveScript(draftId: string): Promise<void> {
    const result = await api.saveScriptDraft({ draftId });
    if (!result.ok) {
      draftErrors.value = { ...draftErrors.value, [draftId]: errorText(result.error) };
      return;
    }
    saved.value = {
      ...saved.value,
      [draftId]: {
        message: result.value.message,
        ...(result.value.setupId ? { setupId: result.value.setupId } : {}),
      },
    };
    notifyMachineChanged();
    await refreshDrafts();
  }

  async function discard(draftId: string): Promise<void> {
    await api.discardDraft({ draftId });
    await refreshDrafts();
  }

  async function approve(script: SavedScript): Promise<void> {
    const result = await api.approveScript({ file: script.file, sha256: script.sha256 });
    if (!result.ok) {
      draftErrors.value = { ...draftErrors.value, [script.file]: errorText(result.error) };
    } else {
      saved.value = {
        ...saved.value,
        [script.file]: { message: `Approved ${script.file} as it is now.` },
      };
    }
    await refreshDrafts();
  }

  return {
    api,
    open,
    keyPresent,
    conversation,
    draft,
    preview,
    preparing,
    sending,
    error,
    budgetStopped,
    showBudget,
    notice,
    failed,
    skipPreview,
    stopped,
    progress,
    pendingText,
    canResume,
    drafts,
    scripts,
    saved,
    draftErrors,
    waitingScripts,
    pendingCount,
    refreshStatus,
    refreshDrafts,
    edit,
    prepare,
    resume,
    send,
    stop,
    drop,
    newConversation,
    settingsChanged,
    onProgress,
    saveSetup,
    saveScript,
    discard,
    approve,
  };
});
