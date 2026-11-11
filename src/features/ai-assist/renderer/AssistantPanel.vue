<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAssistantStore } from './assistantStore';

/**
 * The built-in assistant, on every screen: a panel at the side, opened from the app bar or
 * the command palette. Each request is shown before it is sent (compact, with the exact
 * text a click away); what the assistant drafts waits here for the user's Save; a script
 * that changed since it was approved is shown again in full before it may run.
 */
const store = useAssistantStore();
const router = useRouter();
const message = ref('');
const exactOpen = ref(false);
const shownExact = ref<Record<string, boolean>>({});
const list = ref<HTMLElement>();

const n = (v: number): string => v.toLocaleString('en-US');
const money = (v: number): string => `$${v.toFixed(v < 0.01 ? 4 : 2)}`;

const PHASES: Record<string, string> = {
  preLaunch: 'Before launch',
  postLaunch: 'After launch',
  standDown: 'At Stand down',
};
const TIERS: Record<string, string> = {
  read: 'read',
  change: 'change',
  launch: 'launch',
  off: 'not offered',
};

watch(
  () => store.open,
  (open) => {
    if (open) {
      void store.refreshStatus();
      void store.refreshDrafts();
    }
  }
);
watch(
  () => store.preview?.requestId,
  () => (exactOpen.value = false)
);
watch(
  () => store.conversation?.entries.length,
  async () => {
    await nextTick();
    list.value?.scrollTo({ top: list.value.scrollHeight });
  }
);

async function submit(): Promise<void> {
  const text = message.value.trim();
  if (!text) return;
  if (await store.prepare(text)) message.value = '';
}

function toggle(id: string): void {
  shownExact.value = { ...shownExact.value, [id]: !shownExact.value[id] };
}

async function openSetup(id: string): Promise<void> {
  store.open = false;
  await router.push(`/configure/profiles/${id}`);
}

async function openSettings(): Promise<void> {
  store.open = false;
  await router.push('/configure/settings');
}

const busy = computed(() => store.sending);
</script>

<template>
  <v-navigation-drawer
    v-model="store.open"
    location="right"
    temporary
    width="460"
    class="asp"
    data-testid="assistant-panel"
  >
    <div class="asp-wrap">
      <header class="asp-head">
        <div>
          <h2 class="asp-title">Assistant</h2>
          <p class="asp-sub">
            Uses the AI provider you chose in Settings. Every request is shown before it is sent. A
            change it asks for is asked in RigReady first and listed on the Safety page.
          </p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          aria-label="Close the assistant"
          data-testid="assistant-close"
          @click="store.open = false"
        />
      </header>

      <div v-if="!store.keyPresent" class="asp-empty" data-testid="assistant-no-key">
        <p>
          To talk to the assistant, choose an AI provider in Settings, under AI: your own key, or a
          model on this PC. What assistants drafted is below either way.
        </p>
        <v-btn variant="tonal" data-testid="assistant-settings" @click="openSettings"
          >Open Settings</v-btn
        >
      </div>

      <template v-else>
        <div ref="list" class="asp-list" data-testid="assistant-conversation">
          <p v-if="!store.conversation" class="asp-hint">
            Ask for help with your rig: "Set up a DCS session with SimAppPro, TrackIR and SRS", "Why
            is my rig not ready?", "Write a check that SRS answers on its port".
          </p>
          <template v-for="(entry, i) in store.conversation?.entries ?? []" :key="i">
            <div v-if="entry.kind === 'user'" class="asp-msg asp-user" data-testid="assistant-user">
              {{ entry.text }}
            </div>
            <div
              v-else-if="entry.kind === 'assistant'"
              class="asp-msg asp-bot"
              data-testid="assistant-reply"
            >
              {{ entry.text }}
            </div>
            <div
              v-else-if="entry.kind === 'tool'"
              class="asp-tool"
              :data-ok="entry.ok"
              data-testid="assistant-tool"
            >
              <v-icon
                :icon="entry.ok ? 'mdi-check-circle-outline' : 'mdi-alert-circle-outline'"
                :class="entry.ok ? 'rr-ok' : 'rr-warn'"
                size="15"
              />
              <span class="asp-tool-name">{{ entry.title }}</span>
              <span class="asp-tool-tier">{{ TIERS[entry.tier] }}</span>
              <span class="asp-tool-line">{{
                entry.ok ? entry.line : `Did not run: ${entry.line}`
              }}</span>
            </div>
            <div v-else class="asp-note rr-warn" data-testid="assistant-note">{{ entry.text }}</div>
          </template>
        </div>
      </template>

      <!-- What the assistant drafted: nothing of it is saved until Save is pressed here. -->
      <section
        v-for="draft in store.drafts.setups"
        :key="draft.id"
        class="asp-card"
        data-testid="assistant-setup-draft"
      >
        <div class="asp-card-title">
          <v-icon icon="mdi-clipboard-check-outline" size="17" />
          {{
            draft.target.kind === 'new'
              ? `New setup: ${draft.target.name}`
              : `Changes to ${draft.target.name}`
          }}
        </div>
        <p class="asp-card-sub">
          {{ draft.summary }} <span class="asp-by">From {{ draft.by }}.</span>
        </p>
        <ul class="asp-items">
          <li v-for="(c, i) in draft.checks" :key="`c${i}`" data-testid="assistant-draft-check">
            <strong>{{ c.title }}</strong> <span class="asp-muted">{{ c.type }}</span>
            <div class="asp-detail rr-mono">{{ c.detail }}</div>
            <div v-if="c.fix" class="asp-detail rr-mono">Fix: {{ c.fix }}</div>
          </li>
          <li v-for="(s, i) in draft.steps" :key="`s${i}`" data-testid="assistant-draft-step">
            <strong>{{ s.title }}</strong>
            <span class="asp-muted">{{ PHASES[s.phase] }} · {{ s.type }}</span>
            <div class="asp-detail rr-mono">{{ s.detail }}</div>
          </li>
        </ul>
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="shownExact[draft.id] ? 'mdi-chevron-down' : 'mdi-chevron-right'"
          @click="toggle(draft.id)"
          >{{
            shownExact[draft.id]
              ? 'Hide the setup as it would be saved'
              : 'Show the setup as it would be saved'
          }}</v-btn
        >
        <pre v-if="shownExact[draft.id]" class="asp-pre rr-mono">{{ draft.exact }}</pre>
        <p v-if="store.draftErrors[draft.id]" class="asp-error rr-bad" role="alert">
          <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ store.draftErrors[draft.id] }}
        </p>
        <div class="asp-actions">
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            data-testid="assistant-setup-save"
            @click="store.saveSetup(draft.id)"
            >Save</v-btn
          >
          <v-btn variant="text" size="small" @click="store.discard(draft.id)">Discard</v-btn>
        </div>
      </section>

      <section
        v-for="draft in store.drafts.scripts"
        :key="draft.id"
        class="asp-card"
        data-testid="assistant-script-draft"
      >
        <div class="asp-card-title">
          <v-icon icon="mdi-script-text-outline" size="17" /> Script: {{ draft.fileName }}
        </div>
        <p class="asp-card-sub" data-testid="assistant-script-explanation">
          {{ draft.explanation }} <span class="asp-by">From {{ draft.by }}.</span>
        </p>
        <p v-if="draft.use" class="asp-muted">
          Goes into {{ draft.use.setup }} as
          {{
            draft.use.as === 'check'
              ? 'a check'
              : draft.use.as === 'fix'
                ? `the fix of ${draft.use.forCheck}`
                : PHASES[draft.use.as]?.toLowerCase()
          }}: "{{ draft.use.title }}". It asks before every run.
        </p>
        <ul v-if="draft.warnings.length > 0 || draft.replaces" class="asp-warn rr-warn">
          <li v-for="w in draft.warnings" :key="w">
            {{ w }}
          </li>
          <li v-if="draft.replaces">Replaces the script of the same name.</li>
        </ul>
        <div class="asp-muted">The whole file, as it would be saved at {{ draft.stored }}:</div>
        <pre class="asp-pre rr-mono" data-testid="assistant-script-text">{{ draft.text }}</pre>
        <p v-if="store.draftErrors[draft.id]" class="asp-error rr-bad" role="alert">
          <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ store.draftErrors[draft.id] }}
        </p>
        <div class="asp-actions">
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            data-testid="assistant-script-save"
            @click="store.saveScript(draft.id)"
            >Save</v-btn
          >
          <v-btn variant="text" size="small" @click="store.discard(draft.id)">Discard</v-btn>
        </div>
      </section>

      <section
        v-for="script in store.waitingScripts"
        :key="script.file"
        class="asp-card asp-card-warn"
        data-testid="assistant-script-changed"
      >
        <div class="asp-card-title">
          <v-icon icon="mdi-alert-outline" size="17" />
          {{
            script.state === 'changed'
              ? `${script.file} changed since you approved it`
              : `${script.file} is not approved`
          }}
        </div>
        <p class="asp-card-sub">
          RigReady does not run it until you have read it as it is now and approved it.
        </p>
        <pre class="asp-pre rr-mono" data-testid="assistant-script-current">{{ script.text }}</pre>
        <p v-if="store.draftErrors[script.file]" class="asp-error rr-bad" role="alert">
          <v-icon icon="mdi-alert-circle-outline" size="15" />
          {{ store.draftErrors[script.file] }}
        </p>
        <div class="asp-actions">
          <v-btn
            color="primary"
            variant="flat"
            size="small"
            data-testid="assistant-script-approve"
            @click="store.approve(script)"
            >Approve it as shown</v-btn
          >
        </div>
      </section>

      <div
        v-for="(done, id) in store.saved"
        :key="id"
        class="asp-saved"
        role="status"
        data-testid="assistant-saved"
      >
        <v-icon icon="mdi-check-circle-outline" size="15" class="rr-ok" /> {{ done.message }}
        <v-btn
          v-if="done.setupId"
          size="small"
          variant="text"
          data-testid="assistant-open-setup"
          @click="openSetup(done.setupId)"
          >Open in the setup editor</v-btn
        >
      </div>

      <template v-if="store.keyPresent">
        <!-- The request waiting for Send: what it carries, and the exact text a click away. -->
        <section v-if="store.preview" class="asp-preview" data-testid="assistant-preview">
          <div class="asp-preview-head">
            <v-icon icon="mdi-send-outline" size="16" />
            {{
              store.sending
                ? 'Sent, waiting for the answer'
                : `Ready to send to ${store.preview.to}`
            }}
            <span class="asp-muted" data-testid="assistant-preview-size"
              >{{ store.preview.model }}, about {{ n(store.preview.approxTokens) }} tokens{{
                store.preview.approxCost === null
                  ? ''
                  : `, ${money(store.preview.approxCost)} to read`
              }}</span
            >
          </div>
          <ul class="asp-contents" data-testid="assistant-preview-contents">
            <li v-for="(c, i) in store.preview.contents" :key="i">{{ c }}</li>
          </ul>
          <p class="asp-muted">
            Nothing else: no files and no keys. Paths in what the tools answered name your user
            folder as {USER}.
          </p>
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="exactOpen ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            data-testid="assistant-preview-toggle"
            @click="exactOpen = !exactOpen"
            >{{ exactOpen ? 'Hide the exact request' : 'Show the exact request' }}</v-btn
          >
          <pre v-if="exactOpen" class="asp-pre rr-mono" data-testid="assistant-preview-body">{{
            store.preview.body
          }}</pre>
          <div class="asp-actions">
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              :loading="busy"
              data-testid="assistant-send"
              @click="store.send()"
              >Send</v-btn
            >
            <v-btn
              v-if="!busy"
              variant="text"
              size="small"
              data-testid="assistant-discard"
              @click="store.discardPreview()"
              >Don't send</v-btn
            >
            <v-btn
              v-else-if="store.skipPreview"
              variant="text"
              size="small"
              data-testid="assistant-stop"
              @click="store.stop()"
              >Stop after this</v-btn
            >
          </div>
          <v-checkbox
            v-model="store.skipPreview"
            density="compact"
            hide-details
            label="Don't show this again for this conversation"
            data-testid="assistant-skip-preview"
          />
        </section>

        <p v-if="store.error" class="asp-error rr-bad" role="alert" data-testid="assistant-error">
          <v-icon icon="mdi-alert-circle-outline" size="15" /> {{ store.error }}
        </p>

        <form class="asp-input" @submit.prevent="submit">
          <v-textarea
            v-model="message"
            rows="2"
            auto-grow
            max-rows="6"
            hide-details
            variant="outlined"
            density="compact"
            placeholder="Ask the assistant"
            aria-label="Message to the assistant"
            data-testid="assistant-input"
            @keydown.enter.exact.prevent="submit"
          />
          <div class="asp-actions">
            <v-btn
              type="submit"
              variant="tonal"
              size="small"
              :disabled="busy || message.trim() === ''"
              data-testid="assistant-prepare"
              >Prepare</v-btn
            >
            <v-btn
              v-if="store.conversation"
              variant="text"
              size="small"
              data-testid="assistant-new"
              @click="store.newConversation()"
              >New conversation</v-btn
            >
            <span v-if="store.conversation" class="asp-muted">
              So far
              {{ n(store.conversation.usage.input + store.conversation.usage.output) }} tokens{{
                store.conversation.usage.cost === null
                  ? ''
                  : `, about ${money(store.conversation.usage.cost)}`
              }}
            </span>
          </div>
        </form>
      </template>
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.asp-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px 18px;
  min-height: 100%;
}
.asp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.asp-title {
  font-size: var(--rr-text-lg);
  font-weight: 600;
  margin: 0;
}
.asp-sub,
.asp-hint,
.asp-muted,
.asp-card-sub {
  color: var(--rr-muted);
  font-size: var(--rr-text-sm);
  margin: 2px 0 0;
}
.asp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 42vh;
  overflow-y: auto;
}
.asp-msg {
  padding: 8px 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  font-size: var(--rr-text-sm);
}
.asp-user {
  align-self: flex-end;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
}
.asp-bot {
  border: 1px solid var(--rr-border);
}
.asp-tool {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: var(--rr-text-xs);
  color: var(--rr-muted);
}
.asp-tool-name {
  font-weight: 600;
  color: var(--rr-text);
}
.asp-tool-tier {
  border: 1px solid var(--rr-border);
  border-radius: 4px;
  padding: 0 4px;
}
.asp-note {
  font-size: var(--rr-text-xs);
}
.asp-card,
.asp-preview {
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asp-card-warn {
  border-color: var(--rr-warn);
}
.asp-card-title,
.asp-preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: var(--rr-text-sm);
}
.asp-items,
.asp-contents,
.asp-warn {
  margin: 0;
  padding-left: 18px;
  font-size: var(--rr-text-sm);
}
.asp-warn {
  padding-left: 0;
}
.asp-detail {
  font-size: var(--rr-text-xs);
  color: var(--rr-muted);
  word-break: break-all;
}
.asp-pre {
  max-height: 260px;
  overflow: auto;
  font-size: var(--rr-text-xs);
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
.asp-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.asp-error {
  font-size: var(--rr-text-sm);
  margin: 0;
}
.asp-saved {
  font-size: var(--rr-text-sm);
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.asp-by {
  color: var(--rr-muted);
}
.asp-input {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.asp-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--rr-text-sm);
}
</style>
