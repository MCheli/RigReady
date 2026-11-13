<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import { manifests } from '../../../renderer/features';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { gamePagesOf } from '../../../shared/feature';
import { gamesContract, type GameSummary, type UserGameView } from '../contract';
import AddGameDialog from './AddGameDialog.vue';

const api = useClient(gamesContract);
const route = useRoute();
const router = useRouter();
const game = ref<GameSummary>();
const error = ref<string>();
const message = ref<string>();
const busy = ref(false);
const removeBusy = ref(false);

const gameId = computed(() => String(route.params['id'] ?? ''));

// ---- a game the user added: change it, or remove it ----
/** The game as the user defined it, while it is being changed or removed. */
const own = ref<UserGameView>();
const editing = ref(false);
const removing = ref(false);
const removeError = ref<string>();
/** What a removal did, shown in place of the game that is gone. */
const removed = ref<{ name: string; setups: string[] }>();

async function ownView(): Promise<UserGameView | undefined> {
  const result = await api.userGames();
  if (!result.ok) {
    error.value = errorText(result.error);
    return undefined;
  }
  const found = result.value.games.find((g) => g.id === gameId.value);
  if (!found) error.value = 'That game is no longer among the games you added.';
  return found;
}
async function edit(): Promise<void> {
  error.value = undefined;
  own.value = await ownView();
  if (own.value) editing.value = true;
}
function edited(saved: GameSummary): void {
  editing.value = false;
  game.value = saved;
  message.value = `Saved the changes to ${saved.name}.`;
  notifyMachineChanged();
}
async function askRemove(): Promise<void> {
  error.value = undefined;
  removeError.value = undefined;
  own.value = await ownView();
  if (own.value) removing.value = true;
}
async function remove(): Promise<void> {
  removeBusy.value = true;
  removeError.value = undefined;
  const result = await api.removeUserGame({ gameId: gameId.value });
  removeBusy.value = false;
  if (!result.ok) {
    removeError.value = errorText(result.error);
    return;
  }
  removing.value = false;
  removed.value = result.value;
  game.value = undefined;
  notifyMachineChanged();
}

async function load(): Promise<void> {
  if (removed.value) return;
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
  removed.value = undefined;
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

/**
 * What the button to that page says: a page of a game's own that another feature declares
 * (DCS World: its screens, Export.lua and SimAppPro) by its name, a racing game's page by what
 * is on it.
 */
const deeperLabel = computed(() => {
  const page = gamePagesOf(manifests).find((p) => p.to === deeper.value);
  return page ? `Set up ${page.title}` : 'Bindings and controllers';
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

    <template v-if="removed">
      <h1 class="rr-page-title" data-testid="game-title">{{ removed.name }}</h1>
      <p class="rr-page-sub">Removed from the games you added.</p>
      <div class="rr-panel" data-testid="game-removed">
        <div class="rr-row">
          <v-icon icon="mdi-check" class="rr-ok" />
          <div class="rr-row-main">
            <div class="rr-row-title">RigReady no longer lists {{ removed.name }}</div>
            <div class="rr-row-sub">
              Its program and its settings are where they were; nothing on the PC was changed.
            </div>
          </div>
        </div>
        <div v-if="removed.setups.length" class="rr-row" data-testid="game-removed-setups">
          <v-icon icon="mdi-format-list-checks" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ removed.setups.join(', ') }}
              {{ removed.setups.length === 1 ? 'is now a setup' : 'are now setups' }} for “Another
              game” called {{ removed.name }}
            </div>
            <div class="rr-row-sub">
              <template v-if="removed.setups.length === 1">
                Its checks and what Launch starts are as they were. To use the game again, add it
                with the same name and choose it in the setup.
              </template>
              <template v-else>
                Their checks and what Launch starts are as they were. To use the game again, add it
                with the same name and choose it in each setup.
              </template>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-if="game">
      <div class="head">
        <div>
          <h1 class="rr-page-title" data-testid="game-title">{{ game.name }}</h1>
          <p class="rr-page-sub">
            {{ game.kind === 'racing' ? 'Racing' : game.kind === 'flight' ? 'Flight' : 'Game' }} ·
            <template v-if="game.addedByYou">added by you · </template>
            {{ game.installs.length ? 'found on this PC' : 'not found on this PC' }}
          </p>
        </div>
        <v-spacer />
        <template v-if="game.addedByYou">
          <v-btn
            variant="text"
            prepend-icon="mdi-pencil-outline"
            data-testid="game-edit"
            @click="edit"
            >Change</v-btn
          >
          <v-btn
            variant="text"
            prepend-icon="mdi-delete-outline"
            data-testid="game-remove"
            @click="askRemove"
            >Remove</v-btn
          >
        </template>
        <v-btn
          v-if="deeper"
          variant="tonal"
          prepend-icon="mdi-tune-variant"
          :to="deeper"
          data-testid="game-bindings"
          >{{ deeperLabel }}</v-btn
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
          <NotOnThisPc
            v-if="game.installs.length === 0"
            inline
            :name="game.name"
            :looked="
              game.addedByYou
                ? ['the program you chose', 'every Steam library']
                : game.manualFolder
                  ? ['every Steam library', 'the usual install folders']
                  : ['every Steam library']
            "
            data-testid="game-not-found"
          >
            <template v-if="game.addedByYou" #default>
              The program you chose for it is not there any more. Choose it again with Change.
            </template>
            <template v-else-if="game.manualFolder" #default>
              Install {{ game.name }} and start it once; this page then fills in by itself. If it is
              installed somewhere else, choose {{ game.manualFolder.label }}.
            </template>
            <template v-if="game.manualFolder" #action>
              <v-btn variant="tonal" size="small" data-testid="game-choose-folder" @click="choose"
                >Choose folder…</v-btn
              >
            </template>
          </NotOnThisPc>
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

    <AddGameDialog
      v-if="own"
      :open="editing"
      :game="own"
      @close="editing = false"
      @saved="edited"
    />
    <v-dialog :model-value="removing" max-width="520" @update:model-value="removing = false">
      <v-card v-if="own" data-testid="game-remove-dialog">
        <v-card-title>Remove {{ own.name }}?</v-card-title>
        <v-card-text>
          <p class="remove-text">
            RigReady stops listing it. Its program and its settings stay where they are on the PC.
          </p>
          <p v-if="own.usedBy.length" class="remove-text" data-testid="game-remove-used">
            {{ own.usedBy.length === 1 ? 'This setup is' : 'These setups are' }} for it:
            <strong>{{ own.usedBy.join(', ') }}</strong
            >. {{ own.usedBy.length === 1 ? 'It keeps' : 'They keep' }} working, as
            {{ own.usedBy.length === 1 ? 'a setup' : 'setups' }} for “Another game” called
            {{ own.name }}, with the same checks and the same program to launch.
          </p>
          <p v-else class="remove-text rr-muted" data-testid="game-remove-unused">
            No setup is for it.
          </p>
          <v-alert
            v-if="removeError"
            type="error"
            variant="tonal"
            data-testid="game-remove-error"
            >{{ removeError }}</v-alert
          >
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="game-remove-cancel" @click="removing = false"
            >Cancel</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            :loading="removeBusy"
            data-testid="game-remove-go"
            @click="remove"
            >Remove</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.remove-text {
  font-size: var(--rr-text-sm);
  margin: 0 0 10px;
}
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
