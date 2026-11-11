<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { ChangePreview } from '../../../shared/changePreview';
import { mcpContract } from '../contract';
import type { ClientKind } from '../core/clientConfig';
import type { ConnectClient, DetectedClient } from '../core/connectSchema';

/**
 * "Connect an assistant": one row per AI assistant found on this PC, with the simplest safe
 * way to put RigReady in it. Connecting turns the server on when it is off (the confirm
 * policy stays as set: "Always ask" unless the user chose otherwise).
 */
const api = useClient(mcpContract);
const clients = ref<DetectedClient[]>();
const error = ref<string>();
const busy = ref<ConnectClient>();
const done = ref<Partial<Record<ConnectClient, { message: string; output?: string }>>>({});
const texts = ref<Partial<Record<ConnectClient, string>>>({});
const copied = ref<ConnectClient>();

/** The client whose file change is being confirmed. */
const confirming = ref<DetectedClient>();
const preview = ref<ChangePreview>();
const previewError = ref<string>();

const assistants = computed(() => clients.value?.filter((c) => c.group === 'assistant') ?? []);
const developers = computed(() => clients.value?.filter((c) => c.group === 'developer') ?? []);

async function load(): Promise<void> {
  const got = await api.clients();
  if (got.ok) clients.value = got.value.clients;
  else error.value = errorText(got.error);
}

const stateWords = (c: DetectedClient): string => {
  if (c.problem) return c.problem;
  if (c.state === 'connected') return 'RigReady is in its settings.';
  if (c.state === 'different')
    return 'Its settings name an older RigReady; connecting points it at this one.';
  return `Found: ${c.found}`;
};

const actionWords = (c: DetectedClient): string => {
  const verb = c.state === 'different' ? 'Update' : 'Connect';
  switch (c.method) {
    case 'config':
      return `${verb} ${c.title}`;
    case 'link':
      return `Open ${c.title} to add RigReady`;
    case 'command':
      return 'Run it';
    case 'paste':
      return 'Show what to paste';
  }
};

async function loadText(c: DetectedClient): Promise<void> {
  if (texts.value[c.id]) return;
  const got = await api.clientConfig({ kind: c.kind as ClientKind });
  if (got.ok) texts.value = { ...texts.value, [c.id]: got.value.text };
  else error.value = errorText(got.error);
}

async function copy(c: DetectedClient): Promise<void> {
  const got = await api.copyClientConfig({ kind: c.kind as ClientKind });
  if (got.ok) copied.value = c.id;
  else error.value = errorText(got.error);
}

async function start(c: DetectedClient): Promise<void> {
  error.value = undefined;
  if (c.method === 'paste') {
    await loadText(c);
    return;
  }
  if (c.method === 'config') {
    confirming.value = c;
    preview.value = undefined;
    previewError.value = undefined;
    const got = await api.connectPreview({ client: c.id });
    if (got.ok) preview.value = got.value;
    else previewError.value = errorText(got.error);
    return;
  }
  await connect(c);
}

async function connect(c: DetectedClient): Promise<void> {
  busy.value = c.id;
  error.value = undefined;
  const got = await api.connect({ client: c.id });
  busy.value = undefined;
  confirming.value = undefined;
  if (!got.ok) {
    error.value = `${c.title}: ${errorText(got.error)}`;
    return;
  }
  done.value = {
    ...done.value,
    [c.id]: {
      message: got.value.message,
      ...(got.value.output ? { output: got.value.output } : {}),
    },
  };
  await load();
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  // A pairing or the server turned on elsewhere: the rows say so again.
  off = api.on('changed', () => void load());
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div class="connect" data-testid="mcp-connect">
    <div class="rr-section-title">Connect an assistant</div>
    <ol class="connect-steps">
      <li>
        Pick your assistant below and press its button. RigReady turns its server on if it is off.
      </li>
      <li>
        RigReady asks you in this window before an assistant changes anything ("Always ask"; change
        it below).
      </li>
      <li>Do what the line under the button says (most assistants need a restart).</li>
    </ol>
    <p v-if="!clients && !error" class="rr-muted">Looking for assistants on this PC…</p>
    <p v-else-if="clients && clients.length === 0" class="rr-muted" data-testid="mcp-connect-none">
      No assistant RigReady knows was found on this PC. Install one (Claude Desktop is the
      simplest), or set one up by hand below.
    </p>
    <template v-for="list in [assistants, developers]" :key="list === assistants ? 'a' : 'd'">
      <div
        v-if="list.length > 0"
        class="rr-row-sub mt-2"
        :data-testid="list === assistants ? 'mcp-connect-assistants' : 'mcp-connect-developers'"
      >
        {{ list === assistants ? 'Assistants' : 'For developers' }}
      </div>
      <div
        v-for="c in list"
        :key="c.id"
        class="rr-row connect-row"
        data-testid="mcp-connect-client"
        :data-client="c.id"
        :data-state="c.state"
      >
        <div class="rr-row-main">
          <div class="rr-row-title">
            {{ c.title }}
            <span
              v-if="c.state === 'connected'"
              class="rr-ok ml-1"
              data-testid="mcp-connect-connected"
              ><v-icon size="16" icon="mdi-check-circle" /> Connected</span
            >
          </div>
          <div class="rr-row-sub" :class="{ 'rr-bad': c.problem }">{{ stateWords(c) }}</div>
          <div v-if="done[c.id]" class="rr-row-sub rr-ok" data-testid="mcp-connect-done">
            <v-icon size="14" icon="mdi-check" /> {{ done[c.id]!.message }}
          </div>
          <template v-if="c.method === 'command' || texts[c.id]">
            <pre v-if="texts[c.id]" class="rr-mono connect-text" data-testid="mcp-connect-text">{{
              texts[c.id]
            }}</pre>
            <div class="d-flex ga-2 align-center mt-1">
              <v-btn
                v-if="c.method === 'command' && !texts[c.id]"
                size="small"
                variant="text"
                data-testid="mcp-connect-show"
                @click="loadText(c)"
                >Show the command</v-btn
              >
              <v-btn size="small" variant="tonal" data-testid="mcp-connect-copy" @click="copy(c)">
                <v-icon start icon="mdi-content-copy" />Copy
              </v-btn>
              <span v-if="copied === c.id" class="rr-ok" data-testid="mcp-connect-copied"
                ><v-icon size="16" icon="mdi-check" /> Copied</span
              >
            </div>
            <div v-if="c.method === 'paste' || !c.cli" class="rr-row-sub mt-1">{{ c.after }}</div>
          </template>
        </div>
        <v-btn
          v-if="
            c.state !== 'connected' &&
            !c.problem &&
            (c.method !== 'command' || c.cli) &&
            !(c.method === 'paste' && texts[c.id])
          "
          size="small"
          :color="c.method === 'paste' ? undefined : 'primary'"
          :variant="c.method === 'paste' ? 'tonal' : 'flat'"
          :loading="busy === c.id"
          :disabled="busy !== undefined"
          :data-testid="`mcp-connect-${c.id}`"
          @click="start(c)"
          >{{ actionWords(c) }}</v-btn
        >
      </div>
    </template>
    <p class="rr-row-sub mt-2" data-testid="mcp-connect-cannot">
      ChatGPT and Perplexity for Windows only reach MCP servers on the internet, and Windows' own
      agent connectors (Copilot) are a preview that needs an app packaged for the Store, so none of
      them can use RigReady yet. The manual page "Connect an assistant" says more.
    </p>
    <p v-if="error" class="rr-bad mt-2" data-testid="mcp-connect-error">
      <v-icon size="16" icon="mdi-alert-circle" /> {{ error }}
    </p>

    <ConfirmChanges
      :open="confirming !== undefined"
      :title="`Add RigReady to ${confirming?.title ?? ''}?`"
      :confirm-text="`Add to ${confirming?.title ?? ''}`"
      :preview="preview"
      :error="previewError"
      :busy="busy !== undefined"
      :max-width="560"
      testid="mcp-connect"
      @cancel="confirming = undefined"
      @confirm="confirming && connect(confirming)"
    >
      <template v-if="confirming">
        <p class="mb-2">
          RigReady adds one server, <span class="rr-mono">rigready</span>, to
          {{ confirming.title }}'s settings and keeps every other server as it is. A copy of the
          file is kept first; the Safety page can put it back.
        </p>
        <p class="rr-row-sub mb-2">After that: {{ confirming.after }}</p>
      </template>
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.connect {
  margin-bottom: 8px;
}
.connect-steps {
  margin: 4px 0 8px 18px;
  padding: 0;
  font-size: 13px;
  color: var(--rr-text-2);
}
.connect-row {
  align-items: flex-start;
}
.connect-text {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 8px 10px;
  margin: 6px 0 0;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-variant), 0.35);
  font-size: 12px;
}
</style>
