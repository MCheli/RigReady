<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { displaysContract, type RecoveryView } from '../contract';

/**
 * Shown on any screen after a monitor layout is applied. Main owns the countdown and
 * reverts by itself when it runs out; this only shows it and sends the decision.
 *
 * Also asks, once at startup, about a layout change that never got an answer because
 * RigReady was closed during the countdown.
 */
const api = useClient(displaysContract);
const open = ref(false);
const remaining = ref(0);
const recovery = ref<RecoveryView>();
const recoveryError = ref<string>();
const recovering = ref(false);
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

async function answerRecovery(restore: boolean): Promise<void> {
  recovering.value = true;
  recoveryError.value = undefined;
  const result = await api.recover({ restore });
  recovering.value = false;
  if (result.ok) {
    recovery.value = undefined;
    notifyMachineChanged();
  } else {
    recoveryError.value = errorText(result.error);
  }
}

const savedAtText = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
  if (state.ok && state.value.pending) {
    start(state.value.seconds);
    return;
  }
  const left = await api.recovery();
  if (left.ok && left.value) recovery.value = left.value;
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
        <v-btn variant="text" autofocus data-testid="keep-layout-revert" @click="api.revert()"
          >Go back</v-btn
        >
        <v-btn color="primary" data-testid="keep-layout-keep" @click="api.keep()">Keep it</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog :model-value="!open && recovery !== undefined" persistent max-width="520">
    <v-card v-if="recovery" data-testid="layout-recovery">
      <v-card-title>Put the earlier monitor layout back?</v-card-title>
      <v-card-text>
        <p class="mb-2">
          RigReady was closed while a new monitor layout was waiting for you to keep it. Before that
          change ({{ savedAtText(recovery.savedAt) }}) the monitors were:
        </p>
        <ul class="recovery-list">
          <li v-for="line in recovery.lines" :key="line">{{ line }}</li>
        </ul>
        <v-alert
          v-if="recoveryError"
          type="error"
          variant="tonal"
          class="mt-3"
          data-testid="layout-recovery-error"
        >
          {{ recoveryError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="recovering"
          data-testid="layout-recovery-dismiss"
          @click="answerRecovery(false)"
        >
          Keep them as they are
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="recovering"
          data-testid="layout-recovery-restore"
          @click="answerRecovery(true)"
        >
          Put it back
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.recovery-list {
  padding-left: 20px;
  font-size: 13px;
  color: var(--rr-muted);
}
</style>
