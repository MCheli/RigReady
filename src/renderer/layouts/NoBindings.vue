<script setup lang="ts">
import { computed } from 'vue';
import EmptyState from '../components/EmptyState.vue';
import { bindingsPages } from '../features';

/**
 * Bindings on a PC where no game with a bindings page is found: it says so plainly, names
 * the games whose bindings RigReady reads, and where to point it at one it did not find.
 */
const names = computed(() => {
  const all = bindingsPages.map((page) => page.name);
  return all.length <= 1 ? (all[0] ?? '') : `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
});
</script>

<template>
  <div class="rr-page" data-testid="bindings-none">
    <h1 class="rr-page-title">Bindings</h1>
    <p class="rr-page-sub">
      Every action of a game and what it is bound to, for each game whose bindings RigReady reads.
    </p>
    <EmptyState art="game" title="No game whose bindings RigReady can read was found on this PC.">
      RigReady reads the bindings of {{ names }}. Once one of them is installed, Bindings opens it.
      If one is installed where RigReady did not look, open it under Games and choose its folder.
      <template #action>
        <v-btn to="/configure/games" color="primary" data-testid="bindings-none-games"
          >Open Games</v-btn
        >
      </template>
    </EmptyState>
  </div>
</template>
