<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useAssistantStore } from './assistantStore';

/**
 * The assistant's button in the app bar. Only there once a provider is ready to answer: without
 * one the assistant cannot work, and the bar stays as it was. It is always mounted, so what the
 * panel must hear while it is closed (settings changed, progress of a request) is heard here.
 */
const store = useAssistantStore();
const offs: (() => void)[] = [];
onMounted(() => {
  void store.refreshStatus();
  void store.refreshDrafts();
  offs.push(
    store.api.on('settingsChanged', () => void store.settingsChanged()),
    store.api.on('assistantProgress', (now) => store.onProgress(now)),
    store.api.on('draftsChanged', () => void store.refreshDrafts())
  );
});
onBeforeUnmount(() => {
  for (const off of offs) off();
});
</script>

<template>
  <button
    v-if="store.keyPresent"
    type="button"
    class="aib"
    aria-haspopup="dialog"
    :aria-expanded="store.open"
    :aria-label="
      store.pendingCount > 0
        ? `Assistant, ${store.pendingCount} waiting for you`
        : 'Open the assistant'
    "
    data-testid="assistant-open"
    @click="store.open = !store.open"
  >
    <v-icon icon="mdi-message-processing-outline" size="17" />
    <span>Assistant</span>
    <span v-if="store.pendingCount > 0" class="aib-count" data-testid="assistant-pending">{{
      store.pendingCount
    }}</span>
  </button>
</template>

<style scoped>
.aib {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-bg);
  color: var(--rr-muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.aib:hover,
.aib[aria-expanded='true'] {
  color: var(--rr-text);
  border-color: var(--rr-border-strong);
}
.aib-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--rr-accent);
  color: var(--rr-bg);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
</style>
