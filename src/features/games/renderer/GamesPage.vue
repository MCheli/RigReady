<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { gamesContract, type GameSummary } from '../contract';
import AddGameDialog from './AddGameDialog.vue';

const api = useClient(gamesContract);
const games = ref<GameSummary[]>([]);
const error = ref<string>();
const loaded = ref(false);
/** What is wrong with the file of the games the user added, when anything is. */
const ownProblems = ref<string[]>([]);
const adding = ref(false);
const message = ref<string>();

async function load(): Promise<void> {
  const [result, own] = await Promise.all([api.list(), api.userGames()]);
  if (result.ok) {
    games.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
  ownProblems.value = own.ok ? own.value.problems : [errorText(own.error)];
  loaded.value = true;
}

function added(game: GameSummary): void {
  adding.value = false;
  message.value = game.installs.length
    ? `Added ${game.name}, found on this PC.`
    : `Added ${game.name}. RigReady did not find it on this PC yet.`;
  notifyMachineChanged();
}

// "Add a game" in the command palette opens this page with ?add=1: the dialog opens, and the
// address loses the query, so going back or reloading does not open it again.
const route = useRoute();
const router = useRouter();
function addFromLink(): void {
  if (route.query['add'] !== '1') return;
  adding.value = true;
  void router.replace({ path: route.path });
}
watch(() => route.query['add'], addFromLink);

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  addFromLink();
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
    <div class="games-head">
      <div>
        <h1 class="rr-page-title">Games</h1>
        <p class="rr-page-sub">
          Games RigReady knows in depth, games you added, and where it found them on this PC.
        </p>
      </div>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-plus" data-testid="games-add" @click="adding = true"
        >Add a game</v-btn
      >
    </div>
    <AddGameDialog :open="adding" @close="adding = false" @saved="added" />
    <div v-if="message" class="games-message rr-ok" data-testid="games-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>
    <v-alert
      v-for="problem in ownProblems"
      :key="problem"
      type="warning"
      variant="tonal"
      class="mb-4"
      data-testid="games-own-problem"
      >{{ problem }}</v-alert
    >

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <PageSkeleton v-if="!loaded" label="Looking for games…" :rows="6" />

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
              }}<template v-if="game.version && game.version.version !== 'unknown'">
                · {{ game.version.version }}</template
              >
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
          <span v-if="game.addedByYou" class="rr-row-sub" data-testid="game-added"
            >Added by you</span
          >
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
                  game.addedByYou
                    ? 'Added by you. Its program is not where you chose it; open it to choose again.'
                    : game.manualFolder
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
.games-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.games-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.game-row {
  color: inherit;
  text-decoration: none;
}
.game-row:hover {
  background: var(--rr-surface-2);
}
</style>
