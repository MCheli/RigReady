<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useAiStore } from './store';

/**
 * Shows exactly what will be sent to Anthropic, and sends it only when the user says so.
 * While the answer arrives it says how far it is (what was really received, no estimate)
 * and offers Cancel for the requests that are streamed.
 */
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

/** What the entries of each streamed answer are called. */
const ITEMS: Record<string, [string, string]> = {
  suggest: ['suggestion', 'suggestions'],
  draft: ['guide item', 'guide items'],
};

const phase = computed(() => {
  if (!request.value?.streamed) return 'waiting';
  return store.progress?.phase ?? 'sent';
});

const progressText = computed(() => {
  if (store.cancelling) return 'Cancelling…';
  const progress = store.progress;
  if (phase.value === 'waiting') return 'Waiting for the answer.';
  if (!progress) return 'Sent. Waiting for Anthropic to start answering.';
  if (progress.phase === 'started') return 'The model is working on it. No text has arrived yet.';
  const [one, many] = ITEMS[request.value?.kind ?? ''] ?? ['item', 'items'];
  const chars = `${n(progress.chars)} characters`;
  return progress.items === 0
    ? `Receiving the answer: ${chars} so far.`
    : `Receiving the answer: ${n(progress.items)} ${progress.items === 1 ? one : many} so far (${chars}).`;
});

// Seconds since Send, counted here while a request is on its way.
const elapsed = ref(0);
let ticking: ReturnType<typeof setInterval> | undefined;
function stopTicking(): void {
  if (ticking !== undefined) clearInterval(ticking);
  ticking = undefined;
}
watch(
  () => store.sending,
  (sending) => {
    stopTicking();
    elapsed.value = 0;
    if (!sending) return;
    const since = store.sentAt ?? Date.now();
    ticking = setInterval(() => (elapsed.value = Math.floor((Date.now() - since) / 1000)), 250);
  },
  { immediate: true }
);
onBeforeUnmount(stopTicking);

function close(): void {
  // A request on its way is ended with its own button, not by clicking beside the dialog.
  if (!store.sending) store.prepared = undefined;
}
</script>

<template>
  <v-dialog
    :model-value="request !== undefined"
    max-width="820"
    scrollable
    :persistent="store.sending"
    @update:model-value="close"
  >
    <v-card v-if="request" data-testid="ai-payload-dialog">
      <v-card-title class="pl-title"
        >{{ KIND[request.kind] }}:
        {{ store.sending ? 'this was sent' : 'this is what will be sent' }}</v-card-title
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
        <div v-if="store.sending" class="pl-progress" data-testid="ai-progress" :data-phase="phase">
          <v-progress-circular indeterminate size="16" width="2" color="primary" />
          <div class="pl-progress-main">
            <div role="status" data-testid="ai-progress-text">{{ progressText }}</div>
            <div class="pl-progress-sub">
              <span data-testid="ai-progress-elapsed">{{ elapsed }} s since it was sent.</span>
              Nothing is used until the answer is complete and has been checked.
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          v-if="store.sending && request.streamed"
          variant="text"
          :disabled="store.cancelling"
          data-testid="ai-cancel-request"
          @click="store.cancelSend()"
          >Cancel the request</v-btn
        >
        <v-btn
          v-else
          variant="text"
          :disabled="store.sending"
          data-testid="ai-payload-cancel"
          @click="close"
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
.pl-progress {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  font-size: 13.5px;
}
.pl-progress > :first-child {
  flex: 0 0 auto;
  margin-top: 2px;
}
.pl-progress-sub {
  font-size: 12.5px;
  color: var(--rr-muted);
  margin-top: 2px;
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
