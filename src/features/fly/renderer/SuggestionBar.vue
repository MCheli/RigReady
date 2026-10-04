<script setup lang="ts">
import { computed } from 'vue';
import type { Suggestion } from '../contract';
import { suggestionWords } from '../core/suggestText';

/**
 * The quiet suggestion: the gear on the desk is another setup's. It offers, in one line,
 * and never switches by itself.
 */
const props = defineProps<{ suggestion: Suggestion; disabled?: boolean }>();
const emit = defineEmits<{ switch: []; dismiss: [] }>();

const words = computed(() => suggestionWords(props.suggestion));
</script>

<template>
  <div class="suggest" role="group" aria-label="Suggestion" data-testid="fly-suggestion">
    <v-icon :icon="words.icon" size="20" class="suggest-icon" />
    <div class="suggest-main" role="status">
      <div class="suggest-title" data-testid="fly-suggestion-title">{{ words.title }}</div>
      <div class="suggest-sub" data-testid="fly-suggestion-sub">{{ words.sub }}</div>
    </div>
    <v-btn
      variant="tonal"
      size="small"
      color="primary"
      :disabled="disabled"
      data-testid="fly-suggestion-switch"
      @click="emit('switch')"
    >
      Switch
    </v-btn>
    <v-btn
      variant="text"
      size="small"
      data-testid="fly-suggestion-dismiss"
      @click="emit('dismiss')"
    >
      Not now
    </v-btn>
  </div>
</template>

<style scoped>
.suggest {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding: 8px 10px 8px 14px;
  border: 1px solid var(--rr-border);
  border-left: 2px solid var(--rr-accent);
  border-radius: 8px;
  background: var(--rr-surface-2);
  animation: suggest-arrive 180ms ease-out both;
}
@keyframes suggest-arrive {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.suggest-icon {
  flex: none;
  color: var(--rr-accent);
}
.suggest-main {
  flex: 1;
  min-width: 0;
}
.suggest-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.suggest-sub {
  font-size: 12.5px;
  color: var(--rr-muted);
}
@media (prefers-reduced-motion: reduce) {
  .suggest {
    animation: none;
  }
}
</style>
