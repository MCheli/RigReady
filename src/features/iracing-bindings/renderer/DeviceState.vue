<script setup lang="ts">
import { computed } from 'vue';

/**
 * Whether a controller an iRacing binding set names is plugged in, as a small label: an
 * icon of its own shape, the words, and the status colour. Never the colour alone.
 */
const props = defineProps<{ state: 'connected' | 'moved' | 'missing' | 'unknown' }>();

const LOOK = {
  connected: { text: 'Connected', cls: 'rr-ok', icon: 'mdi-check-circle' },
  moved: { text: 'New Windows id', cls: 'rr-warn', icon: 'mdi-alert' },
  missing: { text: 'Not connected', cls: 'rr-bad', icon: 'mdi-close-circle' },
  unknown: { text: 'Cannot tell', cls: 'rr-muted', icon: 'mdi-help-circle-outline' },
} as const;

const look = computed(() => LOOK[props.state]);
</script>

<template>
  <span
    class="ib-state"
    :class="look.cls"
    :data-state="state"
    data-testid="iracing-bindings-device-state"
  >
    <v-icon :icon="look.icon" size="15" />
    {{ look.text }}
  </span>
</template>

<style scoped>
.ib-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
