<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAiStore } from './store';

/** Shows exactly what will be sent to Anthropic, and sends it only when the user says so. */
const store = useAiStore();
const request = computed(() => store.prepared);
const showBody = ref(false);
watch(request, () => (showBody.value = false));

const KIND: Record<string, string> = {
  suggest: 'Suggest a setup',
  explain: 'Explain an action',
  ask: 'Ask a question',
  draft: 'Draft a guide',
};
const n = (v: number): string => v.toLocaleString('en-US');
</script>

<template>
  <v-dialog
    :model-value="request !== undefined"
    max-width="820"
    scrollable
    @update:model-value="store.prepared = undefined"
  >
    <v-card v-if="request" data-testid="ai-payload-dialog">
      <v-card-title class="pl-title"
        >{{ KIND[request.kind] }}: this is what will be sent</v-card-title
      >
      <v-card-text class="pl-body">
        <p class="pl-lead">
          To Anthropic's API (api.anthropic.com), using {{ request.model }}. About
          {{ n(request.approxTokens) }} tokens ({{ n(request.chars) }} characters), roughly ${{
            request.approxCost.toFixed(request.approxCost < 0.01 ? 4 : 2)
          }}
          to read before any answer.
        </p>
        <ul class="pl-contents" data-testid="ai-payload-contents">
          <li v-for="(c, i) in request.contents" :key="i">{{ c }}</li>
        </ul>
        <div class="pl-never">
          <v-icon icon="mdi-shield-check-outline" size="16" /> Not sent: file paths, device ids,
          serial numbers, names you gave devices, your user or PC name. Your key is sent only as the
          request's credential and is not part of the text below.
        </div>
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="showBody ? 'mdi-chevron-down' : 'mdi-chevron-right'"
          data-testid="ai-payload-toggle"
          @click="showBody = !showBody"
        >
          {{ showBody ? 'Hide the exact request' : 'Show the exact request' }}
        </v-btn>
        <pre v-if="showBody" class="pl-json rr-mono" data-testid="ai-payload-body">{{
          request.body
        }}</pre>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="ai-payload-cancel" @click="store.prepared = undefined"
          >Cancel</v-btn
        >
        <v-btn
          color="primary"
          :loading="store.sending"
          data-testid="ai-payload-send"
          @click="store.send()"
        >
          Send
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.pl-title {
  white-space: normal;
  font-size: 17px;
}
.pl-body {
  max-height: 70vh;
}
.pl-lead {
  font-size: 13.5px;
  margin: 0 0 8px;
}
.pl-contents {
  font-size: 13.5px;
  margin: 0 0 10px;
  padding-left: 18px;
}
.pl-never {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-bottom: 8px;
}
.pl-json {
  max-height: 340px;
  overflow: auto;
  padding: 10px 12px;
  background: var(--rr-bg);
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
