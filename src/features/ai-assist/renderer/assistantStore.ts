import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { aiAssistContract } from '../contract';
import { assistantOpen } from '../panel';
import {
  type Drafts,
  type SavedScript,
  type TurnPreview,
  type ConversationView,
} from '../core/assistantModel';

/**
 * The assistant panel: one conversation at a time, the request waiting for the user's Send,
 * what assistants drafted, and the scripts that need the user's approval again.
 */
export const useAssistantStore = defineStore('ai-assistant', () => {
  const api = useClient(aiAssistContract);
  const open = assistantOpen;
  const keyPresent = ref(false);
  const conversation = ref<ConversationView>();
  const preview = ref<TurnPreview>();
  const sending = ref(false);
  const error = ref<string>();
  /** "Don't show this again for this conversation": later requests go without the preview. */
  const skipPreview = ref(false);
  /** The user pressed Stop: requests that follow tool use are not sent by themselves. */
  const stopped = ref(false);
  const drafts = ref<Drafts>({ setups: [], scripts: [] });
  const scripts = ref<SavedScript[]>([]);
  /** What the last Save did, by draft id: the words of main's answer. */
  const saved = ref<Record<string, { message: string; setupId?: string }>>({});
  const draftErrors = ref<Record<string, string>>({});

  const waitingScripts = computed(() => scripts.value.filter((s) => s.state !== 'approved'));
  const pendingCount = computed(
    () => drafts.value.setups.length + drafts.value.scripts.length + waitingScripts.value.length
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

  async function prepare(text: string): Promise<boolean> {
    error.value = undefined;
    const result = await api.assistantPrepare({
      text,
      ...(conversation.value ? { conversationId: conversation.value.conversationId } : {}),
    });
    if (!result.ok) {
      error.value = errorText(result.error);
      return false;
    }
    stopped.value = false;
    preview.value = result.value;
    if (skipPreview.value) await send();
    return true;
  }

  async function send(): Promise<void> {
    const request = preview.value;
    if (!request || sending.value) return;
    sending.value = true;
    error.value = undefined;
    const result = await api.assistantSend({ requestId: request.requestId });
    sending.value = false;
    if (!result.ok) {
      error.value = errorText(result.error);
      return;
    }
    preview.value = result.value.next;
    conversation.value = result.value.conversation;
    // A tool may have changed the rig: the screens that show it read it again.
    if (result.value.conversation.entries.some((e) => e.kind === 'tool' && e.tier !== 'read')) {
      notifyMachineChanged();
    }
    await refreshDrafts();
    if (preview.value && skipPreview.value && !stopped.value) await send();
  }

  function stop(): void {
    stopped.value = true;
  }

  function discardPreview(): void {
    preview.value = undefined;
  }

  async function newConversation(): Promise<void> {
    if (conversation.value) {
      await api.assistantForget({ conversationId: conversation.value.conversationId });
    }
    conversation.value = undefined;
    preview.value = undefined;
    skipPreview.value = false;
    stopped.value = false;
    error.value = undefined;
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
    preview,
    sending,
    error,
    skipPreview,
    stopped,
    drafts,
    scripts,
    saved,
    draftErrors,
    waitingScripts,
    pendingCount,
    refreshStatus,
    refreshDrafts,
    prepare,
    send,
    stop,
    discardPreview,
    newConversation,
    saveSetup,
    saveScript,
    discard,
    approve,
  };
});
