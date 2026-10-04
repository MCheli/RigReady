<script setup lang="ts">
import type { UsageView } from '../core/model';

/** Tokens and approximate cost of one request. */
defineProps<{ usage: UsageView }>();
const n = (v: number): string => v.toLocaleString('en-US');
</script>

<template>
  <div class="usage rr-muted" data-testid="ai-usage">
    {{ usage.model }} · {{ n(usage.input + usage.cacheRead + usage.cacheWrite) }} tokens in
    <template v-if="usage.cacheRead > 0">({{ n(usage.cacheRead) }} from cache)</template>
    · {{ n(usage.output) }} out · about ${{
      usage.cost < 0.01 ? usage.cost.toFixed(4) : usage.cost.toFixed(2)
    }}
  </div>
</template>

<style scoped>
.usage {
  font-size: 12px;
}
</style>
