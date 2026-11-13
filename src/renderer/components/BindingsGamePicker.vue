<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { BindingsPage } from '../../shared/feature';

/**
 * The game picker of Bindings, above every game's bindings page: which game's bindings are
 * on screen, and the others that have a page. The pages come from the features' manifests
 * (`bindings`); with one game on the list it still says which game it is.
 */
const props = defineProps<{ pages: readonly BindingsPage[]; current: BindingsPage }>();
const router = useRouter();

const items = computed(() => props.pages.map((page) => ({ title: page.name, value: page.game })));

function choose(game: unknown): void {
  const page = props.pages.find((p) => p.game === game);
  if (page && page.game !== props.current.game) void router.push(page.to);
}
</script>

<template>
  <div class="game-picker" data-testid="bindings-game-picker">
    <v-select
      v-if="pages.length > 1"
      class="game-picker-select"
      label="Game"
      :items="items"
      :model-value="current.game"
      density="compact"
      variant="outlined"
      hide-details
      data-testid="bindings-game"
      @update:model-value="choose"
    />
    <div v-else class="game-picker-one" data-testid="bindings-game">
      <span class="rr-muted">Game</span>
      <span>{{ current.name }}</span>
    </div>
  </div>
</template>

<style scoped>
/* A strip of the Bindings section above the page, not part of the page itself. */
.game-picker {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 32px 12px;
  border-bottom: 1px solid var(--rr-border);
  background: var(--rr-surface);
}
.game-picker-select {
  flex: 0 0 220px;
}
.game-picker-one {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  font-size: var(--rr-text-md);
}
</style>
