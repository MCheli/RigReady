<script setup lang="ts">
import type { ScriptResult } from '../../../shared/scriptTypes';

defineProps<{
  result: ScriptResult;
}>();
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="d-flex justify-space-between align-center">
      <span>Script Output</span>
      <v-chip :color="result.success ? 'success' : 'error'" size="small" variant="tonal">
        {{ result.success ? 'Success' : 'Failed' }}
        (exit: {{ result.exitCode ?? 'N/A' }})
      </v-chip>
    </v-card-title>
    <v-card-text>
      <div v-if="result.timedOut" class="text-warning mb-2">Script timed out</div>
      <div class="text-caption text-medium-emphasis mb-1">Duration: {{ result.duration }}ms</div>
      <div v-if="result.stdout" class="mb-3">
        <div class="text-caption font-weight-bold mb-1">stdout:</div>
        <pre class="script-output">{{ result.stdout }}</pre>
      </div>
      <div v-if="result.stderr">
        <div class="text-caption font-weight-bold mb-1 text-error">stderr:</div>
        <pre class="script-output script-error">{{ result.stderr }}</pre>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.script-output {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.script-error {
  border-left: 3px solid rgb(var(--v-theme-error));
}
</style>
