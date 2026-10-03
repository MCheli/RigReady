<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { gamesContract, type GameSummary } from '../contract';

const api = useClient(gamesContract);
const route = useRoute();
const router = useRouter();
const game = ref<GameSummary>();
const error = ref<string>();
const message = ref<string>();
const busy = ref(false);

const gameId = computed(() => String(route.params['id'] ?? ''));

async function load(): Promise<void> {
  const result = await api.get({ gameId: gameId.value });
  if (result.ok) {
    game.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
watch(gameId, () => {
  message.value = undefined;
  void load();
});

/** A page of bindings and controllers for this game, when a feature provides one. */
const deeper = computed(() => {
  for (const path of [`/configure/racing/${gameId.value}`, `/configure/${gameId.value}`]) {
    const resolved = router.resolve(path);
    if (resolved.matched.length > 0 && !resolved.matched.some((m) => m.path.includes(':rest')))
      return path;
  }
  return undefined;
});

const SOURCE: Record<string, string> = {
  steam: 'Steam',
  standalone: 'Standalone install',
  store: 'Microsoft Store',
};
const launchable = computed(() => game.value?.installs.find((i) => i.launch));

async function launch(): Promise<void> {
  busy.value = true;
  error.value = undefined;
  message.value = undefined;
  const result = await api.launch({ gameId: gameId.value });
  busy.value = false;
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
}

async function choose(): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.chooseFolder({ gameId: gameId.value });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  game.value = result.value.game;
  if (result.value.chosen) {
    message.value = `RigReady will use this folder for ${result.value.game.name}.`;
    notifyMachineChanged();
  }
}

async function forget(): Promise<void> {
  const result = await api.forgetFolder({ gameId: gameId.value });
  if (result.ok) {
    game.value = result.value;
    message.value = 'RigReady forgot the folder you chose.';
    notifyMachineChanged();
  } else error.value = errorText(result.error);
}
</script>

<template>
  <div class="rr-page" data-testid="game-page">
    <router-link to="/configure/games" class="crumb"
      ><v-icon icon="mdi-chevron-left" size="16" />Games</router-link
    >
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="game-error">{{
      error
    }}</v-alert>

    <template v-if="game">
      <div class="head">
        <div>
          <h1 class="rr-page-title" data-testid="game-title">{{ game.name }}</h1>
          <p class="rr-page-sub">
            {{ game.kind === 'racing' ? 'Racing' : game.kind === 'flight' ? 'Flight' : 'Game' }} ·
            {{ game.installs.length ? 'found on this PC' : 'not found on this PC' }}
          </p>
        </div>
        <v-spacer />
        <v-btn
          v-if="deeper"
          variant="tonal"
          prepend-icon="mdi-tune-variant"
          :to="deeper"
          data-testid="game-bindings"
          >Bindings and controllers</v-btn
        >
        <v-btn
          v-if="launchable"
          color="primary"
          prepend-icon="mdi-play"
          :loading="busy"
          :disabled="game.running"
          data-testid="game-launch"
          @click="launch"
          >{{ game.running ? 'Running' : 'Launch' }}</v-btn
        >
      </div>

      <div v-if="message" class="message rr-ok" data-testid="game-message">
        <v-icon icon="mdi-check" size="16" /> {{ message }}
      </div>

      <section class="section">
        <h2 class="rr-section-title">At a glance</h2>
        <div class="rr-panel" data-testid="game-glance">
          <div v-for="install in game.installs" :key="install.installDir" class="rr-row">
            <v-icon icon="mdi-folder-check-outline" class="rr-ok" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ SOURCE[install.source] }}</div>
              <div class="rr-row-sub rr-mono">{{ install.installDir }}</div>
            </div>
          </div>
          <div v-if="game.installs.length === 0" class="rr-row" data-testid="game-not-found">
            <v-icon icon="mdi-minus-circle-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">Not found</div>
              <div class="rr-row-sub">
                RigReady looked in every Steam library{{
                  game.manualFolder ? ' and the usual install folder' : ''
                }}.
                <template v-if="game.manualFolder"
                  >If it is installed somewhere else, choose
                  {{ game.manualFolder.label }}.</template
                >
              </div>
            </div>
            <v-btn
              v-if="game.manualFolder"
              variant="tonal"
              size="small"
              data-testid="game-choose-folder"
              @click="choose"
              >Choose folder…</v-btn
            >
          </div>
          <div v-if="game.version" class="rr-row" data-testid="game-version">
            <v-icon
              :icon="game.version.updatePending ? 'mdi-update' : 'mdi-tag-outline'"
              :class="game.version.updatePending ? 'rr-warn' : 'rr-muted'"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">
                {{
                  game.version.version === 'unknown' ? 'Version not known' : game.version.version
                }}
              </div>
              <div v-if="!game.version.updatePending" class="rr-row-sub">Installed version</div>
              <div v-if="game.version.updatePending" class="rr-row-sub rr-warn">
                Steam has an update waiting. Let it finish before you play, or the game may not
                start.
              </div>
            </div>
          </div>
          <div v-if="game.installs.length" class="rr-row">
            <v-icon icon="mdi-play-circle-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ game.running ? 'Running now' : 'Not running' }}</div>
              <div class="rr-row-sub">
                <template v-if="launchable?.launch">
                  Launch starts
                  <span class="rr-mono"
                    >{{ launchable.launch.exe }} {{ launchable.launch.args.join(' ') }}</span
                  >
                </template>
                <template v-else>RigReady cannot start this edition directly.</template>
              </div>
            </div>
          </div>
          <div v-for="fact in game.facts" :key="fact" class="rr-row" data-testid="game-fact">
            <v-icon icon="mdi-information-outline" class="rr-muted" />
            <div class="rr-row-main rr-row-sub">{{ fact }}</div>
          </div>
          <div v-if="game.manualFolder?.chosen" class="rr-row">
            <v-icon icon="mdi-folder-account-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">Folder chosen by you</div>
              <div class="rr-row-sub rr-mono">{{ game.manualFolder.chosen }}</div>
            </div>
            <v-btn size="small" variant="text" data-testid="game-forget-folder" @click="forget"
              >Forget</v-btn
            >
          </div>
          <div v-for="problem in game.problems" :key="problem" class="rr-row rr-warn">
            <v-icon icon="mdi-alert" />
            <div class="rr-row-main">{{ problem }}</div>
          </div>
        </div>
      </section>

      <section v-if="game.configLocations.length" class="section">
        <h2 class="rr-section-title">Settings folders</h2>
        <div class="rr-panel">
          <div
            v-for="loc in game.configLocations"
            :key="loc.id"
            class="rr-row"
            data-testid="game-location"
          >
            <v-icon icon="mdi-folder-cog-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ loc.label }}</div>
              <div class="rr-row-sub rr-mono">{{ loc.path }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="section">
        <h2 class="rr-section-title">Worth backing up</h2>
        <div class="rr-panel">
          <div
            v-for="file in game.trackedFiles"
            :key="file.path"
            class="rr-row"
            data-testid="game-tracked"
          >
            <v-icon icon="mdi-file-document-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ file.label }}</div>
              <div class="rr-row-sub rr-mono">{{ file.path }}</div>
            </div>
          </div>
          <div v-if="game.trackedFiles.length === 0" class="rr-row rr-muted">
            {{
              game.installs.length
                ? 'No settings files were found yet; start the game once.'
                : 'Nothing to back up until the game is found.'
            }}
          </div>
        </div>
      </section>

      <section v-if="game.notes.length" class="section">
        <h2 class="rr-section-title">Good to know</h2>
        <div class="rr-panel">
          <div v-for="note in game.notes" :key="note" class="rr-row" data-testid="game-note">
            <v-icon icon="mdi-lightbulb-outline" class="rr-muted" />
            <div class="rr-row-main rr-row-sub">{{ note }}</div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.crumb {
  font-size: 12.5px;
  color: var(--rr-muted);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  margin-bottom: 6px;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 18px;
}
.head .rr-page-sub {
  margin-bottom: 0;
}
.section {
  margin-bottom: 24px;
}
.message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
</style>
