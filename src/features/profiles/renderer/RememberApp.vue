<script setup lang="ts">
import { ref } from 'vue';
import type { z } from 'zod';
import type { CaptureCandidateSchema } from '../../../core/checks/engine';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract } from '../contract';

/**
 * "Always offer this app" on a row of the New setup page: a program RigReady does not know
 * is offered, ticked, in every new setup from now on; "Stop offering it" undoes that. What
 * the row shows afterwards is the candidate as main read it back, never a guess.
 */
type Candidate = z.infer<typeof CaptureCandidateSchema>;

const props = defineProps<{ candidate: Candidate }>();
const emit = defineEmits<{ changed: [candidate: Candidate | undefined] }>();

const api = useClient(profilesContract);
const busy = ref(false);
const error = ref<string>();

async function toggle(): Promise<void> {
  const remember = props.candidate.remember;
  if (!remember) return;
  busy.value = true;
  error.value = undefined;
  const result = await api.remember({
    capture: remember.capture,
    key: props.candidate.key,
    on: !remember.remembered,
  });
  busy.value = false;
  if (!result.ok) error.value = errorText(result.error);
  else emit('changed', result.value.candidate);
}
</script>

<template>
  <div v-if="candidate.remember" class="remember">
    <v-btn
      size="x-small"
      color="primary"
      class="remember-btn"
      variant="text"
      :prepend-icon="candidate.remember.remembered ? 'mdi-pin-off-outline' : 'mdi-pin-outline'"
      :loading="busy"
      :data-testid="candidate.remember.remembered ? 'candidate-forget' : 'candidate-remember'"
      @click="toggle"
    >
      {{ candidate.remember.remembered ? 'Stop offering it' : 'Always offer this app' }}
    </v-btn>
    <div v-if="error" class="rr-row-sub rr-bad" data-testid="candidate-remember-error">
      {{ error }}
    </div>
  </div>
</template>

<style scoped>
.remember {
  margin: 0 0 0 -6px;
}
.remember-btn {
  font-size: var(--rr-text-xs);
  letter-spacing: 0;
  text-transform: none;
  height: 20px !important;
  padding: 0 6px !important;
}
</style>
