<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import ConnectAssistants from './ConnectAssistants.vue';
import { mcpContract, type McpStatus } from '../contract';
import type { ActivityEntry } from '../core/activity';
import { CLIENT_KINDS, needsToken, type ClientKind } from '../core/clientConfig';
import { outcomeLine, textAsShown } from './outcomeWords';

/**
 * Settings > AI assistants: turn the MCP server on, choose when RigReady asks, connect a
 * client (the text to paste, with a Copy button), pair one over HTTP, forget a pairing,
 * and see what assistants did in this run.
 *
 * A pairing's token is on this page only from Pair until the page is left or "Done" is
 * pressed, and it is never drawn unless the user presses "Show the token": the text to paste
 * shows a placeholder in its place, and Copy takes the real one along.
 */
const api = useClient(mcpContract);
const status = ref<McpStatus>();
const error = ref<string>();
const busy = ref(false);
const kind = ref<ClientKind>('claude-desktop');
const config = ref<{ text: string; hint: string }>();
const copied = ref(false);
const pairName = ref('');
const fresh = ref<{ name: string; token: string }>();
const tokenShown = ref(false);
const activity = ref<ActivityEntry[]>([]);

const policies = [
  {
    value: 'ask',
    title: 'Always ask',
    sub: 'Before every change to the rig and every launch',
  },
  {
    value: 'launchOnly',
    title: 'Ask before a launch only',
    sub: 'Changes run at once; they are backed up and can be undone on the Safety page',
  },
  { value: 'never', title: 'Never ask', sub: 'The assistant does what it is asked straight away' },
] as const;

const surfaces = [
  {
    value: 'guided',
    title: 'Task tools',
    sub: 'A short list of tools, plus one that reaches every other part of RigReady',
  },
  {
    value: 'full',
    title: 'Every channel as its own tool',
    sub: 'Over 200 tools; for assistants that handle long tool lists well',
  },
] as const;

const kinds = CLIENT_KINDS.map((c) => ({ value: c.kind, title: c.title }));
const tokenFor = computed(() =>
  fresh.value && needsToken(kind.value) ? fresh.value.token : undefined
);
/** The text to paste as it is drawn: the token only when the user asked to see it. */
const shownText = computed(() =>
  textAsShown(config.value?.text ?? '', tokenFor.value, tokenShown.value)
);
const others = computed(() => status.value?.pairings.filter((p) => p.kind === 'http') ?? []);
const bridge = computed(() => status.value?.pairings.find((p) => p.kind === 'bridge'));

async function load(): Promise<void> {
  const got = await api.status();
  if (!got.ok) {
    error.value = errorText(got.error);
    return;
  }
  status.value = got.value;
  const listed = await api.activity({ limit: 10 });
  if (listed.ok) activity.value = listed.value.entries;
  await loadConfig();
}

async function loadConfig(): Promise<void> {
  copied.value = false;
  const token = tokenFor.value;
  const got = await api.clientConfig({ kind: kind.value, ...(token ? { token } : {}) });
  if (got.ok) config.value = got.value;
  else error.value = errorText(got.error);
}

async function act(work: () => Promise<{ ok: boolean } & object>): Promise<void> {
  busy.value = true;
  error.value = undefined;
  try {
    const result = (await work()) as
      | { ok: true; value: McpStatus }
      | { ok: false; error: { code: string; message: string; detail?: string } };
    if (result.ok) status.value = result.value;
    else error.value = errorText(result.error);
  } finally {
    busy.value = false;
  }
  await loadConfig();
}

const toggle = (on: boolean | null): Promise<void> =>
  act(() => (on ? api.enable() : api.disable()));
const setPolicy = (confirm: McpStatus['confirm'] | null): Promise<void> | undefined =>
  confirm ? act(() => api.setOptions({ confirm })) : undefined;
const setSurface = (surface: McpStatus['surface'] | null): Promise<void> | undefined =>
  surface ? act(() => api.setOptions({ surface })) : undefined;
const forget = (id: string): Promise<void> => act(() => api.revoke({ id }));
const rotate = (): Promise<void> => act(() => api.rotateBridgeToken());

async function pair(): Promise<void> {
  const name = pairName.value.trim();
  if (!name) {
    error.value = 'Give the assistant a name first, for example "Claude Code".';
    return;
  }
  busy.value = true;
  error.value = undefined;
  const paired = await api.pair({ name });
  busy.value = false;
  if (!paired.ok) {
    error.value = errorText(paired.error);
    return;
  }
  fresh.value = { name, token: paired.value.token };
  tokenShown.value = false;
  status.value = paired.value.status;
  pairName.value = '';
  // A token is only of use in a form that takes one. The plain one is offered: the address
  // and the header, for whatever settings the assistant has.
  if (!needsToken(kind.value)) kind.value = 'http';
  await loadConfig();
}

/** The token leaves the page: what is drawn and what Copy takes go back to the placeholder. */
async function doneWithToken(): Promise<void> {
  fresh.value = undefined;
  tokenShown.value = false;
  await loadConfig();
}

async function copy(): Promise<void> {
  const token = tokenFor.value;
  const done = await api.copyClientConfig({ kind: kind.value, ...(token ? { token } : {}) });
  if (done.ok) copied.value = true;
  else error.value = errorText(done.error);
}

const calls = (n: number): string => (n === 1 ? '1 call' : `${n} calls`);
const when = (iso?: string): string => (iso ? new Date(iso).toLocaleString() : 'never');

let offChanged: (() => void) | undefined;
let offActivity: (() => void) | undefined;
const route = useRoute();
const root = ref<HTMLElement>();
onMounted(() => {
  // Opened from the welcome screen's "Use an AI assistant" step: this section comes into view.
  void load().then(async () => {
    if (route.query['connect'] === undefined) return;
    await nextTick();
    root.value?.scrollIntoView({ block: 'start' });
  });
  offChanged = api.on('changed', () => {
    void api.status().then((got) => {
      if (got.ok) status.value = got.value;
    });
  });
  offActivity = api.on('activity', (entry) => {
    activity.value = [entry, ...activity.value].slice(0, 10);
  });
});
onBeforeUnmount(() => {
  offChanged?.();
  offActivity?.();
});
</script>

<template>
  <div ref="root" class="mcp" data-testid="mcp-settings">
    <p>
      Let an AI assistant on this PC (Claude Desktop, LM Studio, AnythingLLM, Jan, Claude Code,
      Cursor, VS Code and others that speak MCP) check the rig, make it ready, help with bindings
      and read this manual. It only reaches RigReady while RigReady runs, and only from this PC.
    </p>
    <p v-if="!status && !error" class="rr-muted">Reading the server's state…</p>
    <template v-if="status">
      <v-switch
        :model-value="status.enabled"
        :loading="busy"
        color="primary"
        density="compact"
        hide-details
        label="Let AI assistants use RigReady"
        data-testid="mcp-enable"
        @update:model-value="toggle"
      />
      <p class="mt-2" data-testid="mcp-state" :data-running="String(status.running)">
        <template v-if="status.running && status.endpoint">
          <span class="rr-ok"><v-icon size="16" icon="mdi-check-circle" /> On</span>, listening at
          <span class="rr-mono">{{ status.endpoint.url }}</span
          >. Offers {{ status.catalogue.tools }} tools, {{ status.catalogue.resources }} kinds of
          resource and {{ status.catalogue.prompts }} guided conversations.
        </template>
        <template v-else-if="status.problem">
          <span class="rr-bad"><v-icon size="16" icon="mdi-alert-circle" /> Not listening</span>:
          {{ status.problem }}
        </template>
        <template v-else>Off. Nothing listens and no assistant can reach RigReady.</template>
      </p>

      <ConnectAssistants class="mt-4" />

      <template v-if="status.enabled">
        <div class="rr-section-title mt-4">When RigReady asks you first</div>
        <v-radio-group
          :model-value="status.confirm"
          density="compact"
          hide-details
          data-testid="mcp-confirm"
          @update:model-value="setPolicy"
        >
          <v-radio
            v-for="p in policies"
            :key="p.value"
            :value="p.value"
            :data-testid="`mcp-confirm-${p.value}`"
          >
            <template #label>
              <div>
                <div>{{ p.title }}</div>
                <div class="rr-row-sub">{{ p.sub }}</div>
              </div>
            </template>
          </v-radio>
        </v-radio-group>

        <div class="rr-section-title mt-4">What the assistant sees</div>
        <v-radio-group
          :model-value="status.surface"
          density="compact"
          hide-details
          data-testid="mcp-surface"
          @update:model-value="setSurface"
        >
          <v-radio
            v-for="s in surfaces"
            :key="s.value"
            :value="s.value"
            :data-testid="`mcp-surface-${s.value}`"
          >
            <template #label>
              <div>
                <div>{{ s.title }}</div>
                <div class="rr-row-sub">{{ s.sub }}</div>
              </div>
            </template>
          </v-radio>
        </v-radio-group>

        <div class="rr-section-title mt-4">Set it up by hand</div>
        <p class="rr-row-sub">
          For an assistant not listed above, or to connect it yourself: pick it, copy the text and
          paste it where the hint says.
        </p>
        <v-select
          v-model="kind"
          :items="kinds"
          label="Assistant"
          density="compact"
          hide-details
          class="mcp-kind"
          data-testid="mcp-client-kind"
          @update:model-value="loadConfig"
        />
        <template v-if="config">
          <p class="rr-row-sub mt-2" data-testid="mcp-client-hint">{{ config.hint }}</p>
          <pre class="rr-mono mcp-config" data-testid="mcp-client-config">{{ shownText }}</pre>
          <v-btn size="small" variant="tonal" data-testid="mcp-copy" @click="copy">
            <v-icon start icon="mdi-content-copy" />{{ tokenFor ? 'Copy with the token' : 'Copy' }}
          </v-btn>
          <v-btn
            v-if="tokenFor"
            size="small"
            variant="text"
            class="ml-1"
            data-testid="mcp-token-toggle"
            @click="tokenShown = !tokenShown"
            >{{ tokenShown ? 'Hide the token' : 'Show the token' }}</v-btn
          >
          <span v-if="copied" class="ml-2 rr-ok" data-testid="mcp-copied"
            ><v-icon size="16" icon="mdi-check" />
            {{
              tokenFor
                ? 'Copied with the token. It stays on the clipboard until you copy something else.'
                : 'Copied'
            }}</span
          >
        </template>

        <div class="rr-section-title mt-4">Assistants that connect over HTTP</div>
        <p class="rr-row-sub" data-testid="mcp-pair-intro">
          Most assistants need none of this: Connect and the forms above that start RigReady use no
          token you ever see, type or paste. Pair only an assistant that has to connect to the
          address itself. It gets a token of its own, which then sits in that assistant's settings
          in plain text, and what it does is recorded under its name.
        </p>
        <div class="d-flex ga-2 align-center">
          <v-text-field
            v-model="pairName"
            label="Name, for example Workshop agent"
            density="compact"
            hide-details
            maxlength="60"
            data-testid="mcp-pair-name"
            @keydown.enter="pair"
          />
          <v-btn variant="tonal" :loading="busy" data-testid="mcp-pair" @click="pair">Pair</v-btn>
        </div>
        <v-alert
          v-if="fresh"
          type="info"
          variant="tonal"
          class="mt-2"
          data-testid="mcp-fresh-token"
        >
          {{ fresh.name }} is paired. Its token is in the text above, hidden: copy the text and
          paste it into that assistant's settings before you leave this page. RigReady keeps only a
          fingerprint of the token and cannot show it again.
          <div class="mt-1">
            Treat it like a password: whoever holds it can use RigReady from this PC under this
            name. <strong>Forget</strong> below ends it at once.
          </div>
          <v-btn
            size="small"
            variant="text"
            class="mt-1"
            data-testid="mcp-token-done"
            @click="doneWithToken"
            >Done, take it off this page</v-btn
          >
        </v-alert>
        <div v-for="p in others" :key="p.id" class="rr-row" data-testid="mcp-pairing">
          <div class="rr-row-main">
            <div class="rr-row-title">{{ p.name }}</div>
            <div class="rr-row-sub">
              Paired {{ when(p.createdAt) }}, last call {{ when(p.lastUsedAt) }},
              {{ calls(p.calls) }}
            </div>
          </div>
          <v-btn
            size="small"
            variant="text"
            :aria-label="`Forget ${p.name}`"
            data-testid="mcp-forget"
            @click="forget(p.id)"
            >Forget</v-btn
          >
        </div>
        <div v-if="bridge" class="rr-row" data-testid="mcp-bridge">
          <div class="rr-row-main">
            <div class="rr-row-title">RigReady.exe --mcp</div>
            <div class="rr-row-sub">
              The assistants started with the command above. Its token is a file in RigReady's data
              folder that only this Windows account reads; it is never shown or pasted. Last call
              {{ when(bridge.lastUsedAt) }}, {{ calls(bridge.calls) }}.
            </div>
          </div>
          <v-btn size="small" variant="text" data-testid="mcp-rotate" @click="rotate"
            >New token</v-btn
          >
        </div>

        <div class="rr-section-title mt-4">What assistants did</div>
        <p v-if="activity.length === 0" class="rr-muted" data-testid="mcp-activity-empty">
          Nothing yet in this run of RigReady.
        </p>
        <div v-for="a in activity" :key="a.id" class="rr-row" data-testid="mcp-activity">
          <div class="rr-row-main">
            <div class="rr-row-title">{{ a.client }}: {{ a.summary }}</div>
            <div v-if="a.detail" class="rr-row-sub rr-mono" data-testid="mcp-activity-detail">
              {{ a.detail }}
            </div>
            <div class="rr-row-sub">
              {{ outcomeLine(a) }}
              <template v-if="a.journalGroups.length > 0">
                Changed files; see the Safety page to undo.</template
              >
            </div>
          </div>
        </div>
      </template>
    </template>
    <p v-if="error" class="rr-bad" data-testid="mcp-error">
      <v-icon size="16" icon="mdi-alert-circle" /> {{ error }}
    </p>
  </div>
</template>

<style scoped>
.mcp {
  padding: 14px 16px;
  font-size: 13.5px;
}
.mcp p {
  margin: 0 0 8px;
}
.mcp-kind {
  max-width: 320px;
}
.mcp-config {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 10px 12px;
  margin: 8px 0;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-variant), 0.35);
  font-size: 12.5px;
}
</style>
