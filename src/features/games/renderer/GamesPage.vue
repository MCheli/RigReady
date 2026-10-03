<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { gamesContract, type GameSummary } from '../contract';

const api = useClient(gamesContract);
const games = ref<GameSummary[]>([]);
const error = ref<string>();
const loaded = ref(false);

onMounted(async () => {
  const result = await api.list();
  if (result.ok) games.value = result.value;
  else error.value = errorText(result.error);
  loaded.value = true;
});
</script>

<template>
  <div class="rr-page" data-testid="games-page">
    <h1 class="rr-page-title">Games</h1>
    <p class="rr-page-sub">Games RigReady knows in depth, and where it found them on this PC.</p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>

    <div v-if="loaded" class="rr-panel">
      <div v-for="game in games" :key="game.id" class="rr-row" data-testid="game-row">
        <v-icon
          :icon="game.installs.length ? 'mdi-check-circle' : 'mdi-minus-circle-outline'"
          :class="game.installs.length ? 'rr-ok' : 'rr-muted'"
        />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ game.name }}</div>
          <div v-for="install in game.installs" :key="install.installDir" class="rr-row-sub">
            {{ install.source }} · {{ install.installDir }}
          </div>
          <div v-if="game.installs.length === 0" class="rr-row-sub">Not found on this PC</div>
          <div v-for="location in game.configLocations" :key="location.id" class="rr-row-sub">
            Settings: {{ location.path }}
          </div>
          <div v-for="problem in game.problems" :key="problem" class="rr-row-sub rr-warn">
            {{ problem }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
