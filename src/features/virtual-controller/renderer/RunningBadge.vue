<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { virtualControllerContract } from '../contract';
import type { Running } from '../core/running';

/**
 * On every screen, the Play screen included, while a virtual controller runs: which one,
 * and a way to stop it. A controller that went away by itself says why, once.
 */
const api = useClient(virtualControllerContract);
const router = useRouter();
const running = ref<Running>();
const note = ref<string>();
const error = ref<string>();
const stopping = ref(false);

let off: (() => void) | undefined;
onMounted(async () => {
  off = api.on('changed', (event) => {
    running.value = event.running;
    note.value = event.note;
  });
  const now = await api.running();
  if (now.ok) running.value = now.value.running ?? undefined;
});
onBeforeUnmount(() => off?.());

async function stop(): Promise<void> {
  stopping.value = true;
  error.value = undefined;
  const result = await api.stop();
  stopping.value = false;
  if (result.ok) running.value = undefined;
  else error.value = errorText(result.error);
  notifyMachineChanged();
}
</script>

<template>
  <div v-if="running" class="vc-badge" role="status" data-testid="vc-badge">
    <v-icon icon="mdi-controller" size="18" class="rr-ok" />
    <button
      type="button"
      class="vc-badge-text"
      data-testid="vc-badge-open"
      @click="router.push('/configure/virtual-controller')"
    >
      Virtual controller on: {{ running.profileName }}
    </button>
    <v-btn
      size="x-small"
      variant="tonal"
      :loading="stopping"
      data-testid="vc-badge-stop"
      @click="stop"
      >Stop</v-btn
    >
    <span v-if="error" class="rr-bad vc-badge-error" data-testid="vc-badge-error">
      <v-icon icon="mdi-close-circle" size="14" /> {{ error }}</span
    >
  </div>
  <div v-else-if="note" class="vc-badge" role="status" data-testid="vc-badge-lost">
    <v-icon icon="mdi-alert" size="18" class="rr-warn" />
    <span class="rr-warn">Virtual controller stopped: {{ note }}</span>
    <v-btn
      size="x-small"
      variant="text"
      aria-label="Close this notice"
      icon="mdi-close"
      data-testid="vc-badge-dismiss"
      @click="note = undefined"
    />
  </div>
</template>

<style scoped>
.vc-badge {
  position: fixed;
  right: 16px;
  /* Above the Save bar of an editor while one is on screen (src/renderer/components/SaveBar.vue). */
  bottom: calc(16px + var(--rr-save-bar-height, 0px));
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--rr-surface-2);
  border: 1px solid var(--rr-border-strong);
  box-shadow: var(--rr-elev-2);
  font-size: var(--rr-text-sm);
}
.vc-badge-text {
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
.vc-badge-error {
  font-size: var(--rr-text-xs);
}
</style>
