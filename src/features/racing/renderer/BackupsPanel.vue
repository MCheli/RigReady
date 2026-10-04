<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import {
  racingContract,
  type BackupGame,
  type BindingBackup,
  type WritePreviewView,
} from '../contract';

/**
 * Quick backups of one game's bindings: back up now, restore one (after a confirmation
 * listing its files), delete one. Restores go through RigReady's journal, so they show up
 * on the Safety page and can be undone.
 *
 * A backup can be given a name ("Formula rim") and used in a setup: that setup then
 * expects exactly these bindings and Make ready restores them. With a copy of a setup per
 * steering wheel, switching rims is switching setups.
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
/** Name for the next backup. */
const newName = ref('');
/** Setups for this game and the backup each expects. */
const setups = ref<{ id: string; name: string; backupId?: string | undefined }[]>([]);
const renaming = ref<{ id: string; name: string }>();
const usedBy = computed(() => {
  const map = new Map<string, string[]>();
  for (const s of setups.value) {
    if (s.backupId) map.set(s.backupId, [...(map.get(s.backupId) ?? []), s.name]);
  }
  return map;
});
const loaded = ref(false);
const busy = ref(false);
const error = ref<string>();
const message = ref<string>();
const confirmRestore = ref<BindingBackup>();
const confirmDelete = ref<BindingBackup>();
/** What the restore would change, file by file; loaded when the confirmation opens. */
const preview = ref<WritePreviewView>();
const previewError = ref<string>();

async function askRestore(backup: BindingBackup): Promise<void> {
  preview.value = undefined;
  previewError.value = undefined;
  confirmRestore.value = backup;
  const result = await api.restorePreview({ game: props.game, id: backup.id });
  if (confirmRestore.value !== backup) return;
  if (result.ok) preview.value = result.value;
  else previewError.value = errorText(result.error);
}

const CHANGE_LABEL = {
  created: 'New',
  modified: 'Changes',
  unchanged: 'Same as now',
  renamed: 'Renamed',
  deleted: 'Deleted',
} as const;
/** The Fanatec App is open: offer to close it, restore, and start it again. */
const appOpen = ref(false);

async function load(): Promise<void> {
  const result = await api.backups({ game: props.game });
  if (result.ok) backups.value = result.value;
  else error.value = errorText(result.error);
  const used = await api.backupSetups({ game: props.game });
  if (used.ok) setups.value = used.value;
  loaded.value = true;
}

async function useIn(backup: BindingBackup, profileId: string): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.useBackupInSetup({ game: props.game, id: backup.id, profileId });
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

async function stopUsing(profileId: string): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.stopUsingBackup({ game: props.game, profileId });
  if (result.ok) {
    message.value = result.value.message;
    notifyMachineChanged();
  } else error.value = errorText(result.error);
  await load();
}

async function saveName(): Promise<void> {
  const target = renaming.value;
  if (!target) return;
  error.value = undefined;
  const result = await api.nameBackup({ game: props.game, id: target.id, name: target.name });
  renaming.value = undefined;
  if (!result.ok) error.value = errorText(result.error);
  await load();
}

async function backup(): Promise<void> {
  busy.value = true;
  error.value = undefined;
  message.value = undefined;
  const name = newName.value.trim();
  const result = await api.backup({ game: props.game, ...(name ? { name } : {}) });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  newName.value = '';
  const n = result.value.files.length;
  message.value = `Backed up ${n} ${n === 1 ? 'file' : 'files'}${name ? ` as "${name}"` : ''}.`;
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
      <v-text-field
        v-if="game !== 'fanatec'"
        v-model="newName"
        density="compact"
        variant="outlined"
        hide-details
        placeholder="Name, e.g. Formula rim (optional)"
        aria-label="Name for the next backup"
        class="backup-name"
        data-testid="backup-name"
        @keyup.enter="backup"
      />
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
      <div
        v-for="b in backups"
        :key="b.id"
        class="rr-row"
        data-testid="backup-row"
        :data-name="b.name ?? ''"
      >
        <v-icon icon="mdi-archive-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title" data-testid="backup-title">
            {{ b.name || when(b.createdAt) }}
          </div>
          <div class="rr-row-sub">
            <template v-if="b.name">{{ when(b.createdAt) }} · </template>
            {{ b.files.length }} {{ b.files.length === 1 ? 'file' : 'files' }} ·
            {{ size(total(b)) }}
          </div>
          <div v-if="usedBy.get(b.id)" class="rr-row-sub" data-testid="backup-used-by">
            The bindings of {{ usedBy.get(b.id)!.length === 1 ? 'the setup' : 'the setups' }}
            {{ usedBy.get(b.id)!.join(', ') }}
          </div>
        </div>
        <v-menu v-if="game !== 'fanatec' && setups.length > 0">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              size="small"
              variant="text"
              append-icon="mdi-menu-down"
              data-testid="backup-use"
              >Use in a setup</v-btn
            >
          </template>
          <v-list density="compact" data-testid="backup-use-menu">
            <v-list-subheader>This setup expects these bindings</v-list-subheader>
            <v-list-item
              v-for="s in setups"
              :key="s.id"
              :title="s.name"
              :subtitle="
                s.backupId === b.id
                  ? 'Uses these bindings: click to stop'
                  : s.backupId
                    ? 'Uses other bindings now'
                    : ''
              "
              :prepend-icon="s.backupId === b.id ? 'mdi-check' : 'mdi-clipboard-check-outline'"
              data-testid="backup-use-setup"
              :data-setup="s.name"
              @click="s.backupId === b.id ? stopUsing(s.id) : useIn(b, s.id)"
            />
          </v-list>
        </v-menu>
        <v-btn
          v-if="game !== 'fanatec'"
          size="small"
          variant="text"
          icon="mdi-pencil-outline"
          :aria-label="`Name the backup of ${when(b.createdAt)}`"
          data-testid="backup-rename"
          @click="renaming = { id: b.id, name: b.name ?? '' }"
        />
        <v-btn size="small" variant="text" data-testid="backup-restore" @click="askRestore(b)"
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
          <div v-if="previewError" class="rr-bad mb-2" data-testid="restore-preview-error">
            What it would change could not be worked out: {{ previewError }}
          </div>
          <div v-else-if="!preview" class="rr-muted mb-2">Comparing with the files on disk…</div>
          <template v-else>
            <div class="restore-summary" data-testid="restore-preview-summary">
              {{ preview.summary }}
            </div>
            <div
              v-for="f in preview.files"
              :key="f.path"
              class="restore-file"
              data-testid="restore-preview-file"
              :data-change="f.change"
            >
              <v-icon icon="mdi-file-restore-outline" size="16" />
              <div class="restore-file-main">
                <div>
                  {{ f.label }}
                  <span class="restore-change" :class="`change-${f.change}`">{{
                    CHANGE_LABEL[f.change]
                  }}</span>
                </div>
                <div class="rr-row-sub">{{ f.detail }}</div>
                <div class="rr-row-sub rr-mono restore-path">{{ f.path }}</div>
              </div>
            </div>
          </template>
          <div
            v-for="f in confirmRestore.files.filter((file) => !file.restorable)"
            :key="f.stored"
            class="restore-file"
          >
            <v-icon icon="mdi-file-eye-outline" size="16" />
            <span>{{ f.label }}</span>
            <span class="rr-muted">· kept as a record, not restored</span>
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
          <v-btn
            v-else
            color="primary"
            :loading="busy"
            :disabled="!preview"
            data-testid="restore-go"
            @click="restore()"
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
          files are not touched.
          <div v-if="usedBy.get(confirmDelete.id)" class="rr-warn mt-2" data-testid="delete-used">
            {{ usedBy.get(confirmDelete.id)!.join(', ') }}
            {{ usedBy.get(confirmDelete.id)!.length === 1 ? 'expects' : 'expect' }} these bindings:
            that item will be not met until the setup is given another backup.
          </div></v-card-text
        >
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmDelete = undefined">Keep it</v-btn>
          <v-btn color="error" data-testid="delete-go" @click="remove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="renaming !== undefined"
      max-width="440"
      @update:model-value="renaming = undefined"
    >
      <v-card v-if="renaming" data-testid="backup-rename-dialog">
        <v-card-title>Name this backup</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renaming.name"
            label="Name"
            placeholder="Formula rim"
            hint="What these bindings are for. Setups that use them show this name."
            persistent-hint
            autofocus
            maxlength="80"
            data-testid="backup-rename-input"
            @keyup.enter="saveName"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renaming = undefined">Cancel</v-btn>
          <v-btn color="primary" data-testid="backup-rename-save" @click="saveName">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.backup-name {
  max-width: 280px;
}
.restore-file {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  padding: 4px 0;
}
.restore-file-main {
  min-width: 0;
}
.restore-summary {
  font-weight: 600;
  margin-bottom: 6px;
}
.restore-change {
  font-size: 12px;
  margin-left: 6px;
  color: var(--rr-muted);
}
.change-modified,
.change-created {
  color: var(--rr-accent);
}
.restore-path {
  overflow-wrap: anywhere;
}
</style>
