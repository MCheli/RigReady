<script setup lang="ts">
import EmptyArt, { type EmptyArtName } from './EmptyArt.vue';

/**
 * The one way a page says that there is nothing to show yet: a small line drawing, what is
 * missing in a few words, why or what to do in a sentence, and one action that leads there.
 *
 *   <EmptyState art="backup" title="No backups yet" data-testid="backups-empty">
 *     "Back up now" saves one here.
 *     <template #action><v-btn color="primary" @click="backUp">Back up now</v-btn></template>
 *   </EmptyState>
 *
 * It is a panel of its own unless `bare` is set (inside a panel that is already there).
 * Never for an error and never in a status colour: nothing is wrong, something is not there.
 */
defineProps<{
  /** What is missing, in a few words. Left out when the sentence says it all. */
  title?: string;
  art?: EmptyArtName;
  /** Inside a panel that is already there: no panel of its own. */
  bare?: boolean;
}>();
</script>

<template>
  <div class="rr-empty rr-empty-state" :class="{ 'rr-panel': !bare }">
    <EmptyArt :name="art ?? 'nothing'" class="rr-empty-art" />
    <div v-if="title" class="rr-empty-title">{{ title }}</div>
    <div v-if="$slots.default" class="rr-empty-text"><slot /></div>
    <div v-if="$slots.action" class="rr-empty-action"><slot name="action" /></div>
  </div>
</template>

<style>
.rr-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 24px 44px;
}
.rr-empty-art {
  margin-bottom: 14px;
}
.rr-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--rr-text);
}
.rr-empty-text {
  max-width: 560px;
  margin-top: 4px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--rr-muted);
}
.rr-empty-action {
  margin-top: 16px;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}
</style>
