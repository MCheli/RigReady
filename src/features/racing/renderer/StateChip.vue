<script setup lang="ts">
import { computed } from 'vue';

/** One controller's state as a small coloured label. Green, yellow and red mean status only. */
const props = defineProps<{ state: string }>();

const LOOK: Record<string, { text: string; cls: string; icon: string }> = {
  connected: { text: 'Connected', cls: 'rr-ok', icon: 'mdi-check-circle' },
  moved: { text: 'New Windows id', cls: 'rr-warn', icon: 'mdi-alert' },
  renamed: { text: 'New name', cls: 'rr-warn', icon: 'mdi-alert' },
  missing: { text: 'Not connected', cls: 'rr-bad', icon: 'mdi-close-circle' },
  'other-mode': { text: 'Compatibility mode', cls: 'rr-warn', icon: 'mdi-alert' },
  keyboard: { text: 'Keyboard', cls: 'rr-muted', icon: 'mdi-keyboard-outline' },
  unknown: { text: 'Cannot tell', cls: 'rr-muted', icon: 'mdi-help-circle-outline' },
};

const look = computed(() => LOOK[props.state] ?? LOOK['unknown']!);
</script>

<template>
  <span class="state-chip" :class="look.cls" :data-state="state" data-testid="state-chip">
    <v-icon :icon="look.icon" size="15" />
    {{ look.text }}
  </span>
</template>

<style scoped>
.state-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
