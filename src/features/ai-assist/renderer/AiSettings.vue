<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { aiAssistContract } from '../contract';
import type { AiStatus } from '../core/model';

/**
 * The AI binding help's own settings, below Settings' "AI assistance" key field: which key
 * is stored (last four characters only), testing it, the model, and exactly what is sent.
 */
const api = useClient(aiAssistContract);
const status = ref<AiStatus>();
const error = ref<string>();
const test = ref<{ valid: boolean; message: string }>();
const testing = ref(false);

async function refresh(): Promise<void> {
  const result = await api.status();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  // The key is stored or removed by the Settings section above; forget an old test result.
  if (status.value && status.value.keyHint !== result.value.keyHint) test.value = undefined;
  status.value = result.value;
}

async function testKey(): Promise<void> {
  testing.value = true;
  error.value = undefined;
  const result = await api.testKey();
  testing.value = false;
  if (result.ok) test.value = result.value;
  else error.value = errorText(result.error);
}

async function setModel(model: string): Promise<void> {
  const result = await api.setModel({ model });
  if (result.ok) {
    status.value = result.value;
    test.value = undefined;
  } else error.value = errorText(result.error);
}

// The key field is another section of the page: main says when the settings changed.
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
          <div class="rr-row-title" data-testid="ai-settings-key">
            <template v-if="status.keyPresent">Key ending in {{ status.keyHint }}</template>
            <template v-else>No key yet: paste one in the field above to turn AI help on</template>
          </div>
          <div class="rr-row-sub">
            The binding guide and the walkthrough work without a key. With one, the Binding guide
            page can suggest a setup on your devices, explain actions and answer questions.
          </div>
          <div
            v-if="test"
            :class="test.valid ? 'rr-ok' : 'rr-bad'"
            class="ais-test"
            data-testid="ai-key-test-result"
          >
            <v-icon :icon="test.valid ? 'mdi-check' : 'mdi-close'" size="16" /> {{ test.message }}
          </div>
          <div v-if="error" class="rr-bad ais-test" data-testid="ai-settings-error">
            {{ error }}
          </div>
        </div>
        <v-btn
          v-if="status.keyPresent"
          variant="tonal"
          :loading="testing"
          data-testid="ai-key-test"
          @click="testKey"
        >
          Test key
        </v-btn>
      </div>
      <div class="rr-row">
        <div class="rr-row-main">
          <div class="rr-row-title">Model</div>
          <div class="rr-row-sub">
            Opus is the most capable; Sonnet costs about half as much. Prices per million tokens, in
            and out.
          </div>
        </div>
        <v-select
          class="ais-model"
          density="compact"
          :items="
            status.models.map((m) => ({
              title: `${m.name} ($${m.input} / $${m.output})`,
              value: m.id,
            }))
          "
          :model-value="status.model"
          aria-label="Model"
          data-testid="ai-model"
          @update:model-value="setModel(String($event))"
        />
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
.ais-model {
  max-width: 320px;
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
