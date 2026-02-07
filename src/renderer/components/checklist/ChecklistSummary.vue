<script setup lang="ts">
import { computed } from 'vue';
import type { ChecklistResult } from '../../../shared/profileTypes';

const props = defineProps<{
  result: ChecklistResult;
}>();

const passCount = computed(() => props.result.results.filter((r) => r.status === 'pass').length);
const failCount = computed(() => props.result.results.filter((r) => r.status === 'fail').length);
const warnCount = computed(() => props.result.results.filter((r) => r.status === 'warn').length);
const total = computed(() => props.result.results.length);

const statusColor = computed(() => {
  if (props.result.overallStatus === 'pass') return 'success';
  if (props.result.overallStatus === 'fail') return 'error';
  return 'warning';
});

const statusText = computed(() => {
  if (props.result.allRequiredPassed && props.result.overallStatus !== 'fail') {
    return 'Ready to Launch';
  }
  if (props.result.overallStatus === 'fail') {
    return 'Not Ready';
  }
  return 'Warnings';
});
</script>

<template>
  <v-card :color="statusColor" variant="tonal">
    <v-card-text class="text-center">
      <v-icon :color="statusColor" size="48" class="mb-2">
        {{ result.allRequiredPassed ? 'mdi-check-circle' : 'mdi-alert-circle' }}
      </v-icon>
      <div class="text-h5 font-weight-bold">{{ statusText }}</div>
      <div class="text-body-2 mt-2">
        {{ passCount }}/{{ total }} passed
        <span v-if="failCount > 0"> · {{ failCount }} failed</span>
        <span v-if="warnCount > 0"> · {{ warnCount }} warnings</span>
      </div>
    </v-card-text>
  </v-card>
</template>
