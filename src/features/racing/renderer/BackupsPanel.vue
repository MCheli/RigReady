<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import { racingContract, type BackupGame, type BindingBackup } from '../contract';

/**
 * Quick backups of one game's bindings: back up now, restore one (after a confirmation
 * listing its files), delete one. Restores go through RigReady's journal, so they show up
 * on the Safety page and can be undone.
 */
const props = defineProps<{
  game: BackupGame;
  /** "iRacing bindings", "Fanatec App settings". */
  what: string;
  /** Why restoring needs the game closed, shown in the confirmation. */
  closedHint: string;
}>();
const emit = defineEmits<{ restored: [] }>();

const api = useClient(racingContract);
const backups = ref<BindingBackup[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref<string>();
const message = ref<string>();
const confirmRestore = ref<BindingBackup>();
const confirmDelete = ref<BindingBackup>();
/** The Fanatec App is open: offer to close it, restore, and start it again. */
const appOpen = ref(false);

async function load(): Promise<void> {
  const result = await api.backups({ game: props.game });
  if (result.ok) backups.value = result.value;
  else error.value = errorText(result.error);
  loaded.value = true;
}

async function backup(): Promise<void> {
  busy.value = true;
  error.value = undefined;
  message.value = undefined;
  const result = await api.backup({ game: props.game });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const n = result.value.files.length;
  message.value = `Backed up ${n} ${n === 1 ? 'file' : 'files'}.`;
  await load();
}

async function restore(closeApp = false): Promise<void> {
  const target = confirmRestore.value;
  if (!target) return;
  busy.value = true;
  error.value = undefined;
  message.value = undefined;
  const result = await api.restore({ game: props.game, id: target.id, closeApp });
  busy.value = false;
  if (result.ok) {
    confirmRestore.value = undefined;
    appOpen.value = false;
    message.value = result.value.message;
    notifyMachineChanged();
    emit('restored');
  } else if (result.error.code === 'racing.appOpen') {
    appOpen.value = true;
  } else {
    confirmRestore.value = undefined;
    error.value = errorText(result.error);
  }
}

async function remove(): Promise<void> {
  const target = confirmDelete.value;
  if (!target) return;
  const result = await api.deleteBackup({ game: props.game, id: target.id });
  confirmDelete.value = undefined;
  if (!result.ok) error.value = errorText(result.error);
  await load();
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`;
const total = (b: BindingBackup): number => b.files.reduce((sum, f) => sum + f.size, 0);

onMounted(load);
</script>

<template>
  <section class="rc-section" :data-testid="`backups-${game}`">
    <div class="rc-section-head">
      <h2 class="rr-section-title">Backups</h2>
      <span class="rc-hint">Copies of the {{ what }} kept by RigReady</span>
      <v-spacer />
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-content-save-outline"
        :loading="busy && !confirmRestore"
        data-testid="backup-now"
        @click="backup"
        >Back up now</v-btn
      >
    </div>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="backup-error"
      >{{ error }}</v-alert
    >
    <div v-if="message" class="rc-message rr-ok" data-testid="backup-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>
    <div class="rr-panel">
      <div v-for="b in backups" :key="b.id" class="rr-row" data-testid="backup-row">
        <v-icon icon="mdi-archive-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ when(b.createdAt) }}</div>
          <div class="rr-row-sub">
            {{ b.files.length }} {{ b.files.length === 1 ? 'file' : 'files' }} ·
            {{ size(total(b)) }}
          </div>
        </div>
        <v-btn size="small" variant="text" data-testid="backup-restore" @click="confirmRestore = b"
          >Restore…</v-btn
        >
        <v-btn
          size="small"
          variant="text"
          icon="mdi-delete-outline"
          :aria-label="`Delete the backup of ${when(b.createdAt)}`"
          data-testid="backup-delete"
          @click="confirmDelete = b"
        />
      </div>
      <div
        v-if="loaded && backups.length === 0"
        class="rr-row rr-muted"
        data-testid="backups-empty"
      >
        No backups yet. Back up while everything works, so there is something to go back to.
      </div>
    </div>

    <v-dialog :model-value="confirmRestore !== undefined" max-width="560" persistent>
      <v-card v-if="confirmRestore" data-testid="restore-confirm">
        <v-card-title>Restore the {{ what }}?</v-card-title>
        <v-card-text>
          <p class="mb-3">
            These files are put back as they were on {{ when(confirmRestore.createdAt) }}. The
            current files are backed up first, so this can be undone on the Safety page.
          </p>
          <div v-for="f in confirmRestore.files" :key="f.stored" class="restore-file">
            <v-icon
              :icon="f.restorable ? 'mdi-file-restore-outline' : 'mdi-file-eye-outline'"
              size="16"
            />
            <span>{{ f.label }}</span>
            <span v-if="!f.restorable" class="rr-muted">· kept as a record, not restored</span>
          </div>
          <p class="rc-hint mt-3">{{ closedHint }}</p>
          <v-alert
            v-if="appOpen"
            type="warning"
            variant="tonal"
            density="compact"
            class="mt-3"
            data-testid="restore-app-open"
          >
            The Fanatec App is open. RigReady can close it, restore, and start it again.
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            data-testid="restore-cancel"
            @click="((confirmRestore = undefined), (appOpen = false))"
            >Cancel</v-btn
          >
          <v-btn
            v-if="appOpen"
            color="primary"
            :loading="busy"
            data-testid="restore-close-app"
            @click="restore(true)"
            >Close the app and restore</v-btn
          >
          <v-btn v-else color="primary" :loading="busy" data-testid="restore-go" @click="restore()"
            >Restore</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="confirmDelete !== undefined" max-width="440">
      <v-card v-if="confirmDelete" data-testid="delete-confirm">
        <v-card-title>Delete this backup?</v-card-title>
        <v-card-text
          >The backup of {{ when(confirmDelete.createdAt) }} is removed from RigReady. Your game
          files are not touched.</v-card-text
        >
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDelete = undefined">Keep it</v-btn>
          <v-btn color="error" data-testid="delete-go" @click="remove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.restore-file {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 2px 0;
}
</style>
