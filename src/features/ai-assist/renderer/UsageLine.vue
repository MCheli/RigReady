<script setup lang="ts">
import { computed } from 'vue';
import type { UsageView } from '../core/model';
import { estimated } from './estimateText';

/**
 * One request: the tokens as the provider counted them and, where there are prices for the
 * model, RigReady's estimate in dollars with the prices it was worked out from.
 */
const props = defineProps<{ usage: UsageView }>();
const n = (v: number): string => v.toLocaleString('en-US');
const figure = computed(() => estimated(props.usage.cost, props.usage.prices));
</script>

<template>
  <div class="usage rr-muted" data-testid="ai-usage">
    {{ usage.model }} · {{ n(usage.input + usage.cacheRead + usage.cacheWrite) }} tokens in
    <template v-if="usage.cacheRead > 0">({{ n(usage.cacheRead) }} from cache)</template>
    · {{ n(usage.output) }} out
    <template v-if="figure">· {{ figure }}</template>
  </div>
</template>

<style scoped>
.usage {
  font-size: 12px;
}
</style>
