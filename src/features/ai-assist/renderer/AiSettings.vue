<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Result } from '../../../core/result';
import { errorText, useClient } from '../../../renderer/ipc';
import { aiAssistContract } from '../contract';
import type { AiStatus } from '../core/model';
import { useAssistantStore } from './assistantStore';
import { ceilingHint, parseDollars } from './assistantText';
import {
  ACKNOWLEDGE_TICK,
  acknowledgedLine,
  acknowledgeLines,
  acknowledgeTitle,
  budgetHint,
  ESTIMATE_NOTE,
  monthLine,
  parsePrices,
  PRICE_FIELDS,
  pricesHint,
  priceText,
  resetLabel,
  type Limit,
  type PriceKey,
} from './estimateText';

/**
 * The AI binding help's settings: who answers (Anthropic, OpenAI, or a server that speaks
 * OpenAI's API, with presets for Gemini, OpenRouter, Mistral, Ollama and LM Studio), its
 * key (stored encrypted, only the last four characters shown again), the model, a test, and
 * exactly what is sent and to which host, use by use.
 *
 * And the money side, which is all estimates: the prices per million tokens that every dollar
 * figure is worked out from (RigReady's built-in ones with the month they were recorded, or
 * the user's own), the estimate one question may reach before RigReady asks, and the estimate
 * a calendar month may reach before it stops sending. A limit is turned on only through the
 * dialog that says it works on estimates and not on the provider's bill.
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
const ceiling = ref('');
const budget = ref('');
const prices = ref<Record<PriceKey, string>>({
  input: '',
  output: '',
  cacheRead: '',
  cacheWrite: '',
});
/** A limit about to be turned on: the dialog asks for the acknowledgement first. */
const asking = ref<{ limit: Limit; dollars: number }>();
const understood = ref(false);

/** The fields show what is stored. */
function fill(s: AiStatus): void {
  baseUrl.value = s.baseUrl;
  model.value = s.model;
  ceiling.value = s.questionCeiling.toFixed(2);
  budget.value = s.month.budget.toFixed(2);
  for (const field of PRICE_FIELDS) {
    prices.value[field.key] = s.prices ? priceText(s.prices[field.key]) : '';
  }
}

watch(status, (s) => {
  if (s) fill(s);
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
/** The prices of a model are in the row of their own, where they say where they come from. */
const modelHint = computed(() => {
  const m = status.value?.models.find((x) => x.id === status.value?.model);
  return m ? `${m.name}.` : 'Any model id the service offers can be typed here.';
});
/** Something else is typed than the prices in force. */
const pricesTyped = computed(() => {
  const s = status.value;
  if (!s) return false;
  return PRICE_FIELDS.some(
    (field) => prices.value[field.key].trim() !== (s.prices ? priceText(s.prices[field.key]) : '')
  );
});
const reset = computed(() => (status.value ? resetLabel(status.value) : ''));
/** Said under a limit that is on and was acknowledged. */
const ceilingAcknowledged = computed(() => {
  const s = status.value;
  return s && s.priceKnown && s.questionCeiling > 0
    ? acknowledgedLine(s.acknowledged.questionCeiling)
    : '';
});
const budgetAcknowledged = computed(() => {
  const s = status.value;
  return s && s.month.budget > 0 ? acknowledgedLine(s.acknowledged.monthlyBudget) : '';
});
const monthTone = computed(() => {
  const state = status.value?.month.state;
  if (state === 'stopped') return 'rr-bad';
  return state === 'warn' ? 'rr-warn' : 'rr-row-sub';
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

/**
 * The settings change that is on its way, done or not. Test waits for it: pressed straight
 * after "Store key", it tests the key that was just stored and never the one it replaces.
 * A change that failed says so itself, in `change`; here only its end matters.
 */
let changing: Promise<void> = Promise.resolve();

/** Runs a settings change; the page shows the new state, or the reason it was refused. */
async function change(action: Promise<Result<AiStatus>>, message: string): Promise<boolean> {
  error.value = undefined;
  saved.value = undefined;
  changing = action.then(
    () => undefined,
    () => undefined
  );
  const result = await action;
  if (!result.ok) {
    error.value = errorText(result.error);
    // The fields go back to what is stored.
    if (status.value) fill(status.value);
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

function savePrices(): void {
  const typed = parsePrices(prices.value);
  if (!typed) {
    saved.value = undefined;
    error.value =
      'Type all four prices in dollars per million tokens, each from 0 to 10,000. Where your provider charges nothing, type 0.';
    return;
  }
  void change(
    api.setPrices(typed),
    'Saved your prices: estimates for this model are worked out from them from now on'
  );
}

function resetPrices(): void {
  void change(
    api.resetPrices(),
    status.value?.builtInPrices
      ? 'Back to the built-in prices for this model'
      : 'Removed your prices: no dollar figure is shown for this model'
  );
}

/**
 * Sets a limit. Main decides whether turning it on needs the acknowledgement (from none, or
 * the first amount the user sets at all); where it does, the dialog asks before anything is
 * changed, and only its button sends `acknowledged`.
 */
async function sendLimit(limit: Limit, dollars: number, acknowledged: boolean): Promise<void> {
  const monthly = limit === 'monthlyBudget';
  error.value = undefined;
  saved.value = undefined;
  const result = await (monthly
    ? api.setMonthlyBudget({ dollars, acknowledged })
    : api.setQuestionCeiling({ dollars, acknowledged }));
  if (!result.ok && result.error.code === 'ai.acknowledge' && !acknowledged) {
    understood.value = false;
    asking.value = { limit, dollars };
    return;
  }
  const off = monthly ? 'Saved: no monthly budget' : 'Saved: no ceiling';
  const on = monthly ? 'Saved the monthly budget' : 'Saved the ceiling';
  await change(Promise.resolve(result), dollars === 0 ? off : on);
}

function setLimit(limit: Limit, dollars: number): void {
  const s = status.value;
  if (!s) return;
  const current = limit === 'monthlyBudget' ? s.month.budget : s.questionCeiling;
  // The same rule as main's, so the dialog opens without a refused call first.
  if (dollars > 0 && (current === 0 || s.acknowledged[limit] === undefined)) {
    error.value = undefined;
    saved.value = undefined;
    understood.value = false;
    asking.value = { limit, dollars };
    return;
  }
  void sendLimit(limit, dollars, false);
}

function saveCeiling(): void {
  // While the dialog asks, the field losing focus is not a second request.
  if (asking.value) return;
  const dollars = parseDollars(ceiling.value);
  if (dollars === undefined) {
    saved.value = undefined;
    error.value = 'Type an amount in dollars, such as 0.25. 0 means no ceiling.';
    return;
  }
  if (dollars === status.value?.questionCeiling) {
    ceiling.value = dollars.toFixed(2);
    return;
  }
  setLimit('questionCeiling', dollars);
}

function saveBudget(): void {
  if (asking.value) return;
  const dollars = parseDollars(budget.value);
  if (dollars === undefined) {
    saved.value = undefined;
    error.value = 'Type an amount in dollars, such as 5. 0 means no monthly budget.';
    return;
  }
  if (dollars === status.value?.month.budget) {
    budget.value = dollars.toFixed(2);
    return;
  }
  setLimit('monthlyBudget', dollars);
}

/** The dialog's button: the limit is turned on, with the acknowledgement that was ticked. */
function turnOn(): void {
  const ask = asking.value;
  if (!ask || !understood.value) return;
  asking.value = undefined;
  void sendLimit(ask.limit, ask.dollars, true);
}

/** Closed without the tick and the button: nothing was changed, and the field says so. */
function notNow(): void {
  if (!asking.value) return;
  asking.value = undefined;
  if (status.value) fill(status.value);
}

async function testKey(): Promise<void> {
  testing.value = true;
  error.value = undefined;
  saved.value = undefined;
  await changing;
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

// The Anthropic key can also change elsewhere: main says when the settings changed. It also
// says what the month is estimated at each time a request was counted, so the line here is
// never behind the assistant beside it. Only that line changes: what is being typed stays.
let off: (() => void) | undefined;
let offMonth: (() => void) | undefined;
onMounted(() => {
  void refresh();
  off = api.on('settingsChanged', () => void refresh());
  offMonth = api.on('monthChanged', (month) => {
    if (status.value) status.value = { ...status.value, month };
  });
});
onBeforeUnmount(() => {
  off?.();
  offMonth?.();
});

// The assistant's panel leads here when the monthly budget held a message back: the row comes
// into view with its amount ready to be typed over, whether this page was open behind the
// panel or is opened now.
const assistant = useAssistantStore();
const budgetRow = ref<HTMLElement>();
watch(
  [() => assistant.showBudget, status],
  async ([asked, loaded]) => {
    if (!asked || !loaded) return;
    assistant.showBudget = false;
    await nextTick();
    budgetRow.value?.scrollIntoView({ block: 'center' });
    const amount = budgetRow.value?.querySelector('input');
    amount?.focus({ preventScroll: true });
    amount?.select();
  },
  { immediate: true }
);
</script>

<template>
  <div class="ais" data-testid="ai-settings">
    <template v-if="status">
      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Who answers</div>
          <div class="rr-row-sub" data-testid="ai-who-answers">
            Optional. With it, the assistant answers questions about your rig, proposes setups and
            drafts scripts, whatever you play. For DCS aircraft and iRacing cars, the Binding guide
            page can also explain actions and draft guides, and for DCS suggest bindings on your
            devices. Everything else works without AI. You use your own key; RigReady has no account
            or server of its own.
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
          <div class="rr-row-title">Prices for this model, in dollars per million tokens</div>
          <div class="rr-row-sub" data-testid="ai-prices-hint">{{ pricesHint(status) }}</div>
          <div class="ais-prices">
            <v-text-field
              v-for="field in PRICE_FIELDS"
              :key="field.key"
              v-model="prices[field.key]"
              class="ais-price"
              density="compact"
              prefix="$"
              inputmode="decimal"
              :label="field.label"
              :aria-label="`${field.label} price in dollars per million tokens`"
              :data-testid="`ai-price-${field.key}`"
              @keydown.enter="savePrices"
            />
            <v-btn
              color="primary"
              :disabled="!pricesTyped"
              data-testid="ai-prices-save"
              @click="savePrices"
            >
              Save prices
            </v-btn>
            <v-btn v-if="reset" variant="text" data-testid="ai-prices-reset" @click="resetPrices">
              {{ reset }}
            </v-btn>
          </div>
          <div class="rr-row-sub" data-testid="ai-estimate-note">{{ ESTIMATE_NOTE }}</div>
        </div>
      </div>

      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Ask before the estimate for one question passes</div>
          <div class="rr-row-sub" data-testid="ai-ceiling-hint">{{ ceilingHint(status) }}</div>
          <div v-if="ceilingAcknowledged" class="rr-row-sub" data-testid="ai-ceiling-acknowledged">
            {{ ceilingAcknowledged }}
          </div>
        </div>
        <v-text-field
          v-model="ceiling"
          class="ais-amount"
          density="compact"
          prefix="$"
          inputmode="decimal"
          :disabled="!status.priceKnown"
          aria-label="Ask before the estimate for one question passes this many dollars"
          data-testid="ai-question-ceiling"
          @keydown.enter="saveCeiling"
          @blur="saveCeiling"
        />
      </div>

      <div ref="budgetRow" class="rr-row" data-testid="ai-budget-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Stop sending when the estimate for a month reaches</div>
          <div class="rr-row-sub" data-testid="ai-budget-hint">{{ budgetHint(status) }}</div>
          <div :class="monthTone" class="ais-month" data-testid="ai-budget-month">
            {{ monthLine(status.month) }}
          </div>
          <div v-if="budgetAcknowledged" class="rr-row-sub" data-testid="ai-budget-acknowledged">
            {{ budgetAcknowledged }}
          </div>
        </div>
        <v-text-field
          v-model="budget"
          class="ais-amount"
          density="compact"
          prefix="$"
          inputmode="decimal"
          :disabled="!status.priceKnown"
          aria-label="Stop sending when the estimate for a month reaches this many dollars"
          data-testid="ai-monthly-budget"
          @keydown.enter="saveBudget"
          @blur="saveBudget"
        />
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
          <div data-testid="ai-what-is-sent">
            <section
              v-for="part in status.whatIsSent"
              :key="part.title"
              class="ais-part"
              data-testid="ai-what-is-sent-part"
            >
              <h4 class="ais-part-title">{{ part.title }}</h4>
              <ul class="ais-sent">
                <li v-for="(line, i) in part.lines" :key="i">{{ line }}</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </template>
    <div v-else-if="error" class="rr-bad ais-pad">{{ error }}</div>

    <v-dialog
      :model-value="asking !== undefined"
      max-width="620"
      @update:model-value="(open: boolean) => !open && notNow()"
    >
      <v-card v-if="asking && status" data-testid="ai-acknowledge">
        <v-card-title class="ais-ask-title" data-testid="ai-acknowledge-title">
          {{ acknowledgeTitle(asking.limit, asking.dollars) }}
        </v-card-title>
        <v-card-text>
          <ul class="ais-ask" data-testid="ai-acknowledge-lines">
            <li v-for="(line, i) in acknowledgeLines(asking.limit, status)" :key="i">
              {{ line }}
            </li>
          </ul>
          <v-checkbox
            v-model="understood"
            :label="ACKNOWLEDGE_TICK"
            data-testid="ai-acknowledge-check"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="ai-acknowledge-cancel" @click="notNow">Cancel</v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!understood"
            data-testid="ai-acknowledge-confirm"
            @click="turnOn"
          >
            Turn on the limit
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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
.ais-amount {
  max-width: 140px;
  min-width: 120px;
}
.ais-prices {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 10px 0 8px;
}
.ais-price {
  flex: 0 0 132px;
}
.ais-month {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.45;
}
.ais-ask-title {
  white-space: normal;
  font-size: 17px;
}
.ais-ask {
  margin: 0 0 12px;
  padding-left: 18px;
  font-size: 13.5px;
  line-height: 1.5;
}
.ais-ask > li + li {
  margin-top: 6px;
}
.ais-part-title {
  margin: 10px 0 0;
  font-size: 13px;
  font-weight: 600;
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
