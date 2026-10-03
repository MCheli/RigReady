<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { displaysContract } from '../contract';

/**
 * Shown on any screen after a monitor layout is applied. Main owns the countdown and
 * reverts by itself when it runs out; this only shows it and sends the decision.
 */
const api = useClient(displaysContract);
const open = ref(false);
const remaining = ref(0);
let ticker: ReturnType<typeof setInterval> | undefined;
const unsubscribe: (() => void)[] = [];

function start(seconds: number): void {
  remaining.value = seconds;
  open.value = true;
  clearInterval(ticker);
  ticker = setInterval(() => {
    remaining.value = Math.max(0, remaining.value - 1);
  }, 1000);
}

function close(): void {
  open.value = false;
  clearInterval(ticker);
}

onMounted(async () => {
  unsubscribe.push(api.on('applied', ({ seconds }) => start(seconds)));
  unsubscribe.push(
    api.on('settled', () => {
      close();
      notifyMachineChanged();
    })
  );
  // The window may have been reloaded while a decision was open.
  const state = await api.pending();
  if (state.ok && state.value.pending) start(state.value.seconds);
});

onBeforeUnmount(() => {
  clearInterval(ticker);
  unsubscribe.forEach((off) => off());
});
</script>

<template>
  <v-dialog :model-value="open" persistent max-width="460">
    <v-card data-testid="keep-layout">
      <v-card-title>Keep this monitor layout?</v-card-title>
      <v-card-text>
        The monitors were rearranged. If you do nothing, the previous layout comes back in
        <strong data-testid="keep-layout-seconds">{{ remaining }}</strong> seconds.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="keep-layout-revert" @click="api.revert()">Go back</v-btn>
        <v-btn color="primary" data-testid="keep-layout-keep" @click="api.keep()">Keep it</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
