<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { gamesContract, type GameSummary, type UserGameView } from '../contract';

/**
 * Add a game of the user's own, or change one. The program and the settings folders are
 * chosen in Windows' own pickers and kept in main: this dialog holds only what to show and
 * the ref main gave for each, so nothing typed here is ever started or backed up.
 */
const props = defineProps<{ open: boolean; game?: UserGameView }>();
const emit = defineEmits<{ close: []; saved: [game: GameSummary] }>();

const api = useClient(gamesContract);

type Kind = 'flight' | 'racing' | 'none';
interface Chosen {
  ref: string;
  shown: string;
}

const name = ref('');
const nameTouched = ref(false);
const kind = ref<Kind>('none');
const program = ref<Chosen>();
const folders = ref<Chosen[]>([]);
const steamAppId = ref('');
const processes = ref<string[]>([]);
const error = ref<string>();
const saving = ref(false);
const picking = ref<'program' | 'folder'>();

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const game = props.game;
    name.value = game?.name ?? '';
    nameTouched.value = game !== undefined;
    kind.value = game?.kind ?? 'none';
    program.value =
      game?.program && game.programRef ? { ref: game.programRef, shown: game.program } : undefined;
    folders.value = (game?.folders ?? []).map((f) => ({ ref: f.ref, shown: f.path }));
    steamAppId.value = game?.steamAppId ?? '';
    processes.value = [...(game?.processes ?? [])];
    error.value = undefined;
  },
  { immediate: true }
);

const steam = computed(() => steamAppId.value.trim());
/** Why the game cannot be saved yet, in words; undefined when it can. */
const blocked = computed(() => {
  if (!name.value.trim()) return 'Give the game a name.';
  if (!program.value && !steam.value) {
    return 'Choose the program that starts the game, or give its Steam app id.';
  }
  if (steam.value && !/^\d{1,10}$/.test(steam.value)) {
    return 'A Steam app id is a number, such as 2014780.';
  }
  return undefined;
});

async function chooseProgram(): Promise<void> {
  error.value = undefined;
  picking.value = 'program';
  const result = await api.pickProgram();
  picking.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const picked = result.value;
  if (!picked.picked || !picked.ref || !picked.shown) return;
  const before = program.value?.shown.split('\\').pop()?.toLowerCase();
  program.value = { ref: picked.ref, shown: picked.shown };
  if (!nameTouched.value && picked.name) name.value = picked.name;
  // The program's own name means the game is running; the one it replaces no longer does.
  const kept = processes.value.filter((p) => p.toLowerCase() !== before);
  if (picked.process && !kept.some((p) => p.toLowerCase() === picked.process!.toLowerCase())) {
    kept.unshift(picked.process);
  }
  processes.value = kept;
}

async function addFolder(): Promise<void> {
  error.value = undefined;
  picking.value = 'folder';
  const result = await api.pickFolder({
    ...(name.value.trim() ? { game: name.value.trim().slice(0, 60) } : {}),
  });
  picking.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const picked = result.value;
  if (!picked.picked || !picked.ref || !picked.shown) return;
  if (folders.value.some((f) => f.shown.toLowerCase() === picked.shown!.toLowerCase())) return;
  folders.value = [...folders.value, { ref: picked.ref, shown: picked.shown }];
}

function removeFolder(ref: string): void {
  folders.value = folders.value.filter((f) => f.ref !== ref);
}

async function save(): Promise<void> {
  if (blocked.value) return;
  saving.value = true;
  error.value = undefined;
  const result = await api.saveUserGame({
    ...(props.game ? { gameId: props.game.id } : {}),
    name: name.value.trim(),
    kind: kind.value,
    ...(program.value ? { program: program.value.ref } : {}),
    folders: folders.value.map((f) => f.ref),
    ...(steam.value ? { steamAppId: steam.value } : {}),
    processes: processes.value.map((p) => p.trim()).filter(Boolean),
  });
  saving.value = false;
  if (result.ok) emit('saved', result.value);
  else error.value = errorText(result.error);
}
</script>

<template>
  <v-dialog :model-value="open" max-width="620" scrollable @update:model-value="emit('close')">
    <v-card data-testid="add-game-dialog">
      <v-card-title>{{ game ? `Change ${game.name}` : 'Add a game' }}</v-card-title>
      <v-card-text>
        <p class="add-lead rr-muted">
          For a game RigReady does not know. Choose its program and the folders where it keeps its
          settings. It is then on this page, in new setups and in backups like the others.
        </p>

        <h3 class="add-label">Program</h3>
        <div class="rr-panel add-panel">
          <div class="rr-row">
            <v-icon icon="mdi-application-outline" class="rr-muted" />
            <div class="rr-row-main">
              <div v-if="program" class="rr-row-title rr-mono" data-testid="add-game-program">
                {{ program.shown }}
              </div>
              <div v-else class="rr-row-sub">
                Not chosen yet. Launch starts this program as it is, with nothing added to it.
              </div>
            </div>
            <v-btn
              size="small"
              variant="tonal"
              :loading="picking === 'program'"
              data-testid="add-game-choose-program"
              @click="chooseProgram"
              >{{ program ? 'Change…' : 'Choose program…' }}</v-btn
            >
          </div>
        </div>

        <v-text-field
          v-model="name"
          label="Name"
          placeholder="e.g. Richard Burns Rally"
          counter="60"
          maxlength="60"
          data-testid="add-game-name"
          @update:model-value="nameTouched = true"
        />

        <h3 id="add-game-kind-label" class="add-label">Kind of game</h3>
        <v-radio-group
          v-model="kind"
          inline
          hide-details
          aria-labelledby="add-game-kind-label"
          data-testid="add-game-kind"
        >
          <v-radio label="Flight" value="flight" data-testid="add-game-kind-flight" />
          <v-radio label="Racing" value="racing" data-testid="add-game-kind-racing" />
          <v-radio label="Neither" value="none" data-testid="add-game-kind-none" />
        </v-radio-group>
        <p class="add-hint rr-muted">
          A new setup for a flight game keeps your flight gear ticked, one for a racing game your
          wheel and pedals.
        </p>

        <h3 class="add-label">Settings folders</h3>
        <div class="rr-panel add-panel">
          <div
            v-for="folder in folders"
            :key="folder.ref"
            class="rr-row"
            data-testid="add-game-folder"
          >
            <v-icon icon="mdi-folder-cog-outline" class="rr-muted" />
            <div class="rr-row-main rr-row-sub rr-mono">{{ folder.shown }}</div>
            <v-btn
              icon="mdi-close"
              size="small"
              variant="text"
              :aria-label="`Remove ${folder.shown}`"
              data-testid="add-game-folder-remove"
              @click="removeFolder(folder.ref)"
            />
          </div>
          <div class="rr-row">
            <div class="rr-row-main rr-row-sub">
              <template v-if="folders.length === 0">None yet. </template>Backups suggest these
              folders, and a restore asks the game to close first.
            </div>
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-folder-plus-outline"
              :loading="picking === 'folder'"
              data-testid="add-game-add-folder"
              @click="addFolder"
              >Add folder…</v-btn
            >
          </div>
        </div>

        <v-text-field
          v-model="steamAppId"
          label="Steam app id (optional)"
          placeholder="e.g. 2014780"
          hint="For a game in your Steam library: RigReady then starts it through Steam. The number is in the address of the game's Steam store page."
          persistent-hint
          class="mb-4"
          data-testid="add-game-steam"
        />

        <v-combobox
          v-model="processes"
          label="Programs that mean it is running"
          multiple
          chips
          closable-chips
          hint="RigReady knows the game is running by these, and asks them to close before it puts the game's settings back. Type a name such as StarHauler.exe and press Enter."
          persistent-hint
          data-testid="add-game-processes"
        />

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-4"
          data-testid="add-game-error"
          >{{ error }}</v-alert
        >
        <p v-else-if="blocked" class="add-why rr-muted" data-testid="add-game-why">
          {{ blocked }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="add-game-cancel" @click="emit('close')">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="blocked !== undefined"
          :loading="saving"
          data-testid="add-game-save"
          @click="save"
          >{{ game ? 'Save changes' : 'Add game' }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.add-lead {
  font-size: var(--rr-text-sm);
  margin: 0 0 14px;
}
.add-label {
  font-size: var(--rr-text-sm);
  font-weight: 600;
  margin: 14px 0 6px;
}
.add-panel {
  margin-bottom: 14px;
}
.add-hint {
  font-size: var(--rr-text-xs);
  margin: 2px 0 6px;
}
.add-why {
  font-size: var(--rr-text-sm);
  margin: 14px 0 0;
}
</style>
