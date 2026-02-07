<script setup lang="ts">
import { computed } from 'vue';
import type { CheckResult, Remediation } from '../../../shared/profileTypes';

const props = defineProps<{
  result: CheckResult;
  remediation?: Remediation;
}>();

defineEmits<{
  remediate: [];
}>();

const statusIcon = computed(() => {
  switch (props.result.status) {
    case 'pass':
      return 'mdi-check-circle';
    case 'fail':
      return 'mdi-close-circle';
    case 'warn':
      return 'mdi-alert-circle';
    case 'skip':
      return 'mdi-skip-next-circle';
    case 'running':
      return 'mdi-loading';
    default:
      return 'mdi-help-circle';
  }
});

const statusColor = computed(() => {
  switch (props.result.status) {
    case 'pass':
      return 'success';
    case 'fail':
      return 'error';
    case 'warn':
      return 'warning';
    case 'skip':
      return 'grey';
    case 'running':
      return 'info';
    default:
      return 'grey';
  }
});
</script>

<template>
  <v-list-item>
    <template #prepend>
      <v-icon :icon="statusIcon" :color="statusColor" />
    </template>
    <v-list-item-title>{{ result.checklistItemName }}</v-list-item-title>
    <v-list-item-subtitle>{{ result.message }}</v-list-item-subtitle>
    <template #append>
      <v-btn
        v-if="result.canRemediate && result.status === 'fail'"
        size="small"
        variant="tonal"
        color="warning"
        @click="$emit('remediate')"
      >
        Fix
      </v-btn>
    </template>
  </v-list-item>
</template>
