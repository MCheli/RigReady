<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Result } from '../../../core/result';
import { errorText, useClient } from '../../../renderer/ipc';
import { aiAssistContract } from '../contract';
import type { AiStatus } from '../core/model';

/**
 * The AI binding help's settings: who answers (Anthropic, OpenAI, or a server that speaks
 * OpenAI's API, with presets for Gemini, OpenRouter, Mistral, Ollama and LM Studio), its
 * key (stored encrypted, only the last four characters shown again), the model, a test,
 * and exactly what is sent and to which host.
 */
const api = useClient(aiAssistContract);
const status = ref<AiStatus>();
const error = ref<string>();
const saved = ref<string>();
const test = ref<{ valid: boolean; message: string }>();
const testing = ref(false);
const key = ref('');
const baseUrl = ref('');
const model = ref('');

watch(status, (s) => {
  if (!s) return;
  baseUrl.value = s.baseUrl;
  model.value = s.model;
});

const compatible = computed(() => status.value?.provider === 'compatible');
const providerName = computed(
  () => status.value?.providers.find((p) => p.id === status.value?.provider)?.name ?? ''
);
/** "Anthropic", "OpenAI", or the host of the compatible server. */
const keyOwner = computed(() => {
  const s = status.value;
  if (!s) return '';
  if (s.provider === 'anthropic') return 'Anthropic';
  if (s.provider === 'openai') return 'OpenAI';
  return s.host || 'this service';
});
const keyState = computed(() => {
  const s = status.value;
  if (!s) return '';
  if (s.provider === 'compatible') {
    if (s.keyPresent) return `A key for ${keyOwner.value} is stored`;
    return !s.keyNeeded && s.host
      ? 'No key (a server on this PC needs none)'
      : `No key for ${keyOwner.value}`;
  }
  return s.keyPresent ? `An ${keyOwner.value} API key is stored` : `No ${keyOwner.value} API key`;
});
const preset = computed(() =>
  status.value?.presets.find((p) => p.baseUrl === status.value?.baseUrl)
);
const modelHint = computed(() => {
  const m = status.value?.models.find((x) => x.id === status.value?.model);
  if (m?.input !== undefined && m.output !== undefined) {
    return `${m.name}: $${m.input} in, $${m.output} out per million tokens.`;
  }
  return 'Any model id the service offers can be typed here.';
});

async function refresh(): Promise<void> {
  const result = await api.status();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  if (status.value && status.value.keyHint !== result.value.keyHint) test.value = undefined;
  status.value = result.value;
}

/** Runs a settings change; the page shows the new state, or the reason it was refused. */
async function change(action: Promise<Result<AiStatus>>, message: string): Promise<boolean> {
  error.value = undefined;
  saved.value = undefined;
  const result = await action;
  if (!result.ok) {
    error.value = errorText(result.error);
    // The fields go back to what is stored.
    if (status.value) {
      baseUrl.value = status.value.baseUrl;
      model.value = status.value.model;
    }
    return false;
  }
  status.value = result.value;
  test.value = undefined;
  saved.value = message;
  return true;
}

async function storeKey(): Promise<void> {
  if (await change(api.setKey({ key: key.value }), 'Stored the key')) key.value = '';
}

function removeKey(): void {
  void change(api.clearKey(), 'Removed the key');
}

function saveModel(): void {
  const id = model.value.trim();
  if (id && id !== status.value?.model) void change(api.setModel({ model: id }), 'Saved the model');
}

function saveBaseUrl(): void {
  const url = baseUrl.value.trim();
  if (url !== status.value?.baseUrl) {
    void change(api.setCompatible({ baseUrl: url }), 'Saved the address');
  }
}

async function testKey(): Promise<void> {
  testing.value = true;
  error.value = undefined;
  saved.value = undefined;
  const result = await api.testKey();
  testing.value = false;
  if (result.ok) test.value = result.value;
  else error.value = errorText(result.error);
}

function pickProvider(value: unknown): void {
  void change(api.setProvider({ provider: value as AiStatus['provider'] }), 'Saved');
}

function pickPreset(value: unknown): void {
  // "Other": the address is typed below.
  if (value) void change(api.setCompatible({ preset: String(value) }), 'Saved');
}

function pickStructured(value: unknown): void {
  void change(api.setCompatible({ structured: value as AiStatus['structured'] }), 'Saved');
}

function menuToggled(open: boolean): void {
  if (!open) saveModel();
}

const STRUCTURED = [
  { value: 'schema', title: 'JSON schema (the service enforces it)' },
  { value: 'prompt', title: 'Ask for JSON (checked here, asked once more if needed)' },
];

// The Anthropic key can also change elsewhere: main says when the settings changed.
let off: (() => void) | undefined;
onMounted(() => {
  void refresh();
  off = api.on('settingsChanged', () => void refresh());
});
onBeforeUnmount(() => off?.());
</script>

<template>
  <div class="ais" data-testid="ai-settings">
    <template v-if="status">
      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Who answers</div>
          <div class="rr-row-sub">
            Optional. The binding guide and the walkthrough work without AI. With it, the Binding
            guide page can suggest a setup on your devices, explain actions and answer questions.
            You use your own key; RigReady has no account or server of its own.
          </div>
        </div>
        <v-select
          class="ais-field"
          density="compact"
          :items="status.providers.map((p) => ({ title: p.name, value: p.id }))"
          :model-value="status.provider"
          aria-label="AI provider"
          data-testid="ai-provider"
          @update:model-value="pickProvider"
        />
      </div>

      <template v-if="compatible">
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Service</div>
            <div class="rr-row-sub" data-testid="ai-preset-note">
              {{
                preset?.note ??
                'Any service with an OpenAI-compatible API (Groq, xAI, DeepSeek and others): type its address below.'
              }}
            </div>
          </div>
          <v-select
            class="ais-field"
            density="compact"
            :items="[
              ...status.presets.map((p) => ({ title: p.name, value: p.id })),
              { title: 'Other (type the address)', value: '' },
            ]"
            :model-value="preset?.id ?? ''"
            aria-label="Service"
            data-testid="ai-preset"
            @update:model-value="pickPreset"
          />
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">API address</div>
            <div class="rr-row-sub">
              https, or http only to this PC (localhost). Requests go to this host and nowhere else.
            </div>
            <v-text-field
              v-model="baseUrl"
              class="ais-wide"
              density="compact"
              placeholder="https://api.example.com/v1"
              aria-label="API address"
              data-testid="ai-base-url"
              @keydown.enter="saveBaseUrl"
              @blur="saveBaseUrl"
            />
          </div>
        </div>
        <div class="rr-row">
          <div class="rr-row-main">
            <div class="rr-row-title">Structured answers</div>
            <div class="rr-row-sub">
              Suggestions and drafted guides come back as JSON. Choose "Ask for JSON" for a service
              or model that refuses a JSON schema.
            </div>
          </div>
          <v-select
            class="ais-field"
            density="compact"
            :items="STRUCTURED"
            :model-value="status.structured"
            aria-label="Structured answers"
            data-testid="ai-structured"
            @update:model-value="pickStructured"
          />
        </div>
      </template>
    </template>

    <template v-if="status">
      <div class="rr-row">
        <v-icon
          :icon="status.keyPresent ? 'mdi-key' : 'mdi-key-outline'"
          :class="status.keyPresent ? 'rr-ok' : 'rr-muted'"
        />
        <div class="rr-row-main">
          <div class="rr-row-title" data-testid="ai-key-state">{{ keyState }}</div>
          <div class="rr-row-sub" data-testid="ai-settings-key">
            <template v-if="status.keyPresent">Key ending in {{ status.keyHint }}</template>
            <template v-else-if="status.problem">{{ status.problem }}</template>
            <template v-else>Ready: no key is needed.</template>
          </div>
          <div class="rr-row-sub">
            The key is encrypted for your Windows account and is never shown again. It is sent only
            to {{ status.host || 'the provider' }}.
          </div>
        </div>
        <v-btn
          v-if="status.keyPresent"
          variant="text"
          data-testid="ai-key-remove"
          @click="removeKey"
        >
          Remove key
        </v-btn>
      </div>
      <div class="rr-row">
        <div class="rr-row-main ais-inline">
          <v-text-field
            v-model="key"
            type="password"
            density="compact"
            autocomplete="off"
            :placeholder="status.keyPresent ? 'Replace with another key' : 'Paste your key'"
            :aria-label="`${providerName} API key`"
            data-testid="ai-key-input"
          />
          <v-btn
            color="primary"
            :disabled="key.trim().length < 8"
            data-testid="ai-key-save"
            @click="storeKey"
          >
            Store key
          </v-btn>
        </div>
      </div>

      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Model</div>
          <div class="rr-row-sub" data-testid="ai-model-hint">{{ modelHint }}</div>
        </div>
        <v-combobox
          v-model="model"
          class="ais-field"
          density="compact"
          :items="status.models.map((m) => m.id)"
          aria-label="Model"
          data-testid="ai-model"
          menu-icon=""
          @keydown.enter="saveModel"
          @blur="saveModel"
          @update:menu="menuToggled"
        >
          <!-- Vuetify's own menu icon is a nameless button; the field itself opens the list. -->
          <template #append-inner>
            <v-icon icon="mdi-menu-down" aria-hidden="true" />
          </template>
        </v-combobox>
      </div>

      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Test</div>
          <div class="rr-row-sub">
            One small request to {{ status.host || 'the provider' }} with this key and model.
          </div>
          <div
            v-if="test"
            :class="test.valid ? 'rr-ok' : 'rr-bad'"
            class="ais-test"
            data-testid="ai-key-test-result"
          >
            <v-icon :icon="test.valid ? 'mdi-check' : 'mdi-close'" size="16" />
            {{ test.valid ? 'Works.' : 'Does not work.' }} {{ test.message }}
          </div>
          <div v-if="saved" class="rr-ok ais-test" data-testid="ai-settings-saved">
            <v-icon icon="mdi-check" size="16" /> {{ saved }}
          </div>
          <div v-if="error" class="rr-bad ais-test" data-testid="ai-settings-error">
            <v-icon icon="mdi-alert-circle-outline" size="16" /> {{ error }}
          </div>
        </div>
        <v-btn
          v-if="status.ready"
          variant="tonal"
          :loading="testing"
          data-testid="ai-key-test"
          @click="testKey"
        >
          Test
        </v-btn>
      </div>

      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Exactly what is sent</div>
          <ul class="ais-sent" data-testid="ai-what-is-sent">
            <li v-for="(line, i) in status.whatIsSent" :key="i">{{ line }}</li>
          </ul>
          <div class="rr-row-sub">Every request is shown to you in full before it is sent.</div>
        </div>
      </div>
    </template>
    <div v-else-if="error" class="rr-bad ais-pad">{{ error }}</div>
  </div>
</template>

<style scoped>
.ais-test {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-top: 6px;
}
.ais-field {
  max-width: 340px;
  min-width: 240px;
}
.ais-wide {
  margin-top: 6px;
  max-width: 560px;
}
.ais-inline {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ais-sent {
  margin: 4px 0 6px;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.5;
}
.ais-pad {
  padding: 14px 16px;
}
</style>
