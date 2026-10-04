<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { gamesContract, type GameSummary } from '../contract';

const api = useClient(gamesContract);
const games = ref<GameSummary[]>([]);
const error = ref<string>();
const loaded = ref(false);

async function load(): Promise<void> {
  const result = await api.list();
  if (result.ok) {
    games.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
  loaded.value = true;
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

const found = computed(() => games.value.filter((g) => g.installs.length > 0));
const missing = computed(() => games.value.filter((g) => g.installs.length === 0));

const SOURCE: Record<string, string> = {
  steam: 'Steam',
  standalone: 'Standalone',
  store: 'Microsoft Store',
};
const sources = (g: GameSummary): string =>
  [...new Set(g.installs.map((i) => SOURCE[i.source]))].join(' + ');
</script>

<template>
  <div class="rr-page" data-testid="games-page">
    <h1 class="rr-page-title">Games</h1>
    <p class="rr-page-sub">Games RigReady knows in depth, and where it found them on this PC.</p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <div v-if="!loaded" class="rr-empty">Looking for games…</div>

    <template v-if="loaded">
      <div v-if="found.length" class="rr-panel mb-6">
        <router-link
          v-for="game in found"
          :key="game.id"
          :to="`/configure/games/${game.id}`"
          class="rr-row game-row"
          data-testid="game-row"
          :data-game="game.id"
        >
          <v-icon
            :icon="
              game.version?.updatePending || game.problems.length ? 'mdi-alert' : 'mdi-check-circle'
            "
            :class="game.version?.updatePending || game.problems.length ? 'rr-warn' : 'rr-ok'"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ game.name }}
              <v-chip
                v-if="game.running"
                size="x-small"
                variant="tonal"
                color="primary"
                class="ml-2"
                >Running</v-chip
              >
            </div>
            <div class="rr-row-sub">
              {{ sources(game)
              }}<template v-if="game.version"> · {{ game.version.version }}</template>
              <span v-if="game.version?.updatePending" class="rr-warn"> · update waiting</span>
              <template v-if="game.trackedFiles.length">
                · {{ game.trackedFiles.length }} settings
                {{ game.trackedFiles.length === 1 ? 'file' : 'files' }} worth backing up
              </template>
            </div>
            <div v-for="problem in game.problems" :key="problem" class="rr-row-sub rr-warn">
              {{ problem }}
            </div>
          </div>
          <span v-if="game.kind" class="rr-row-sub">{{
            game.kind === 'racing' ? 'Racing' : 'Flight'
          }}</span>
          <v-icon icon="mdi-chevron-right" class="rr-muted" />
        </router-link>
      </div>

      <template v-if="missing.length">
        <h2 class="rr-section-title">Not found on this PC</h2>
        <div class="rr-panel">
          <router-link
            v-for="game in missing"
            :key="game.id"
            :to="`/configure/games/${game.id}`"
            class="rr-row game-row"
            data-testid="game-row"
            :data-game="game.id"
          >
            <v-icon icon="mdi-minus-circle-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ game.name }}</div>
              <div class="rr-row-sub">
                {{
                  game.manualFolder
                    ? 'Installed somewhere unusual? Open it to choose its folder.'
                    : 'RigReady did not find it where it is normally installed.'
                }}
              </div>
              <div v-for="problem in game.problems" :key="problem" class="rr-row-sub rr-warn">
                {{ problem }}
              </div>
            </div>
            <v-icon icon="mdi-chevron-right" class="rr-muted" />
          </router-link>
        </div>
      </template>

      <div v-if="games.length === 0" class="rr-panel rr-empty">No game modules are available.</div>
    </template>
  </div>
</template>

<style scoped>
.game-row {
  color: inherit;
  text-decoration: none;
}
.game-row:hover {
  background: var(--rr-surface-2);
}
</style>
