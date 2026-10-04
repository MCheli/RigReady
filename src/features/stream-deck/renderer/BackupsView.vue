<script setup lang="ts">
import { computed, ref } from 'vue';
import ChangePreview from '../../../renderer/components/ChangePreview.vue';
import { errorText } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import type { Overview } from '../contract';
import type { Backup, RestoreOutcome, RestorePreview } from '../core/model';
import { formatBytes, formatDate, plural, useStreamDeckStore } from './store';

const props = defineProps<{ overview: Overview }>();
const store = useStreamDeckStore();
const api = store.api;

const error = ref<string>();
const message = ref<string>();
const busy = ref(false);

/** After a file restore: what can be done next. */
const restored = ref<{ outcome: RestoreOutcome; name: string }>();

async function refresh(): Promise<void> {
  await store.load();
}

function say(text: string): void {
  error.value = undefined;
  message.value = text;
}
function fail(text: string): void {
  message.value = undefined;
  error.value = text;
}

// ---- Back up ------------------------------------------------------------------------
const creating = ref(false);
const newName = ref('');
const includePlugins = ref(false);

function openBackup(): void {
  newName.value = '';
  includePlugins.value = false;
  creating.value = true;
}

async function createBackup(): Promise<void> {
  busy.value = true;
  const result = await api.createBackup({
    ...(newName.value.trim() ? { name: newName.value.trim() } : {}),
    includePlugins: includePlugins.value,
  });
  busy.value = false;
  creating.value = false;
  if (!result.ok) return fail(errorText(result.error));
  say(`Backed up ${plural(result.value.profiles.length, 'profile')} as "${result.value.name}".`);
  await refresh();
}

// ---- Import --------------------------------------------------------------------------
async function importFile(): Promise<void> {
  busy.value = true;
  const result = await api.importFile();
  busy.value = false;
  if (!result.ok) return fail(errorText(result.error));
  if (!result.value.backup) return;
  say(
    `Imported "${result.value.backup.name}" with ${plural(result.value.backup.profiles.length, 'profile')}.`
  );
  await refresh();
}

async function importElgato(fileName: string): Promise<void> {
  busy.value = true;
  const result = await api.importElgato({ fileName });
  busy.value = false;
  if (!result.ok) return fail(errorText(result.error));
  say(`Imported "${result.value.name}" with ${plural(result.value.profiles.length, 'profile')}.`);
  await refresh();
}

// ---- Rename, delete, export ----------------------------------------------------------
const renaming = ref<Backup>();
const renameTo = ref('');
function openRename(backup: Backup): void {
  renaming.value = backup;
  renameTo.value = backup.name;
}
async function rename(): Promise<void> {
  if (!renaming.value || !renameTo.value.trim()) return;
  const result = await api.renameBackup({ id: renaming.value.id, name: renameTo.value.trim() });
  renaming.value = undefined;
  if (!result.ok) return fail(errorText(result.error));
  say(`Renamed to "${result.value.name}".`);
  await refresh();
}

const deleting = ref<Backup>();
async function remove(): Promise<void> {
  if (!deleting.value) return;
  const name = deleting.value.name;
  const result = await api.deleteBackup({ id: deleting.value.id });
  deleting.value = undefined;
  if (!result.ok) return fail(errorText(result.error));
  say(`Deleted "${name}".`);
  await refresh();
}

async function exportBackup(backup: Backup): Promise<void> {
  const result = await api.exportBackup({ id: backup.id });
  if (!result.ok) return fail(errorText(result.error));
  if (result.value.path) say(`Exported "${backup.name}" to ${result.value.path}`);
}

// ---- Restore -------------------------------------------------------------------------
const preview = ref<RestorePreview>();
const previewError = ref<string>();
const restorePlugins = ref(false);
/** Stream Deck ignored the polite request to quit: ending it needs a second yes. */
const stubborn = ref<string>();
/** An app restore is waiting for the user to confirm in the Stream Deck app. */
const appRestore = ref<{ backup: Backup; result?: { found: string[]; missing: string[] } }>();

async function openRestore(backup: Backup): Promise<void> {
  preview.value = undefined;
  previewError.value = undefined;
  stubborn.value = undefined;
  restorePlugins.value = false;
  const result = await api.previewRestore({ id: backup.id });
  if (result.ok) preview.value = result.value;
  else fail(errorText(result.error));
}

async function restore(force = false): Promise<void> {
  if (!preview.value) return;
  const target = preview.value;
  busy.value = true;
  const result = await api.restore({
    id: target.backup.id,
    closeApp: target.appRunning,
    force,
    restorePlugins: restorePlugins.value,
  });
  busy.value = false;
  if (!result.ok) {
    if (result.error.code === 'streamDeck.stillRunning') {
      stubborn.value = errorText(result.error);
      return;
    }
    previewError.value = errorText(result.error);
    return;
  }
  preview.value = undefined;
  notifyMachineChanged();
  if (result.value.method === 'app') {
    appRestore.value = { backup: target.backup };
  } else {
    restored.value = { outcome: result.value, name: target.backup.name };
    message.value = undefined;
    error.value = undefined;
  }
  await refresh();
}

async function checkAppRestore(): Promise<void> {
  if (!appRestore.value) return;
  const result = await api.verifyAppRestore({ id: appRestore.value.backup.id });
  if (!result.ok) return fail(errorText(result.error));
  appRestore.value = { ...appRestore.value, result: result.value };
  await refresh();
}

async function startApp(): Promise<void> {
  busy.value = true;
  const result = await api.startApp();
  busy.value = false;
  if (!result.ok) return fail(errorText(result.error));
  if (restored.value)
    restored.value = {
      ...restored.value,
      outcome: { ...restored.value.outcome, closedApp: false },
    };
  say(result.value.message);
  notifyMachineChanged();
  await refresh();
}

const undoChanged = ref<string>();
async function undoRestore(force = false): Promise<void> {
  const groupId = restored.value?.outcome.groupId;
  if (!groupId) return;
  const result = await api.undoRestore({ groupId, force });
  if (!result.ok) {
    if (result.error.code === 'journal.changed' && !force) {
      undoChanged.value = result.error.message;
      return;
    }
    undoChanged.value = undefined;
    return fail(errorText(result.error));
  }
  undoChanged.value = undefined;
  say(`Undid the restore of "${restored.value?.name}". Your previous profiles are back.`);
  restored.value = undefined;
  notifyMachineChanged();
  await refresh();
}

const KIND_LABEL: Record<Backup['kind'], string> = {
  manual: '',
  'before-restore': 'Made automatically before a restore',
  imported: 'Imported',
};

const appRunning = computed(() => props.overview.status.running);
/** Stream Deck's own backups that are already in RigReady. */
const imported = computed(
  () => new Set(props.overview.backups.flatMap((b) => (b.sourceFile ? [b.sourceFile] : [])))
);
const installed = computed(() => props.overview.status.installed);

defineExpose({ openBackup });
</script>

<template>
  <div class="bk-head">
    <div class="rr-row-sub bk-intro">
      Backups hold your profiles in Stream Deck's own file format and a list of the plugins you had.
      Backing up works while the Stream Deck app is running.
    </div>
    <v-spacer />
    <v-btn
      variant="tonal"
      prepend-icon="mdi-file-import-outline"
      :disabled="busy"
      data-testid="sd-import"
      @click="importFile"
    >
      Import a backup file
    </v-btn>
    <v-btn
      color="primary"
      prepend-icon="mdi-content-save-outline"
      :disabled="busy || overview.inventory.profiles.length === 0"
      data-testid="sd-backup"
      @click="openBackup"
    >
      Back up now
    </v-btn>
  </div>

  <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="sd-error">{{
    error
  }}</v-alert>
  <div v-if="message" class="bk-message rr-ok" data-testid="sd-message">
    <v-icon icon="mdi-check" size="16" /> {{ message }}
  </div>

  <div v-if="restored" class="rr-panel bk-restored" data-testid="sd-restored">
    <v-icon icon="mdi-check-circle" class="rr-ok" />
    <div class="rr-row-main">
      <div class="rr-row-title">
        Restored {{ plural(restored.outcome.restored, 'profile') }} from "{{ restored.name }}"
      </div>
      <div class="rr-row-sub">
        Read back and checked: every profile is in place.
        <template v-if="restored.outcome.safetyBackupId">
          Your previous profiles were saved as a backup first.
        </template>
        <template v-if="restored.outcome.closedApp">
          Stream Deck was closed for the restore.</template
        >
      </div>
    </div>
    <v-btn
      v-if="!appRunning && installed"
      color="primary"
      prepend-icon="mdi-play"
      :disabled="busy"
      data-testid="sd-start-after"
      @click="startApp"
    >
      Start Stream Deck
    </v-btn>
    <v-btn
      v-if="restored.outcome.groupId"
      variant="tonal"
      prepend-icon="mdi-undo"
      data-testid="sd-undo-restore"
      @click="undoRestore()"
    >
      Undo
    </v-btn>
  </div>

  <div
    v-if="overview.backups.length === 0"
    class="rr-panel rr-empty"
    data-testid="sd-backups-empty"
  >
    <div class="rr-row-title">No Stream Deck backups yet</div>
    <div class="rr-row-sub bk-empty-sub">
      <template v-if="overview.inventory.profiles.length">
        Back up your {{ plural(overview.inventory.profiles.length, 'profile') }} now, or import a
        backup file you already have.
      </template>
      <template v-else>Import a backup file to restore your profiles on this PC.</template>
    </div>
  </div>
  <div v-else class="rr-panel">
    <div
      v-for="backup in overview.backups"
      :key="backup.id"
      class="rr-row"
      data-testid="sd-backup-row"
      :data-name="backup.name"
    >
      <v-icon
        :icon="
          backup.kind === 'imported'
            ? 'mdi-file-import-outline'
            : backup.kind === 'before-restore'
              ? 'mdi-history'
              : 'mdi-archive-outline'
        "
        class="rr-muted"
      />
      <div class="rr-row-main">
        <div class="rr-row-title" data-testid="sd-backup-name">{{ backup.name }}</div>
        <div class="rr-row-sub">
          {{ formatDate(backup.createdAt) }} · {{ plural(backup.profiles.length, 'profile') }} ·
          {{ formatBytes(backup.bytes) }}
          <template v-if="backup.includesPluginFolders"> · with plugin folders</template>
          <template v-if="backup.format === 'v2'"> · older Stream Deck format</template>
        </div>
        <div v-if="KIND_LABEL[backup.kind]" class="rr-row-sub">
          {{ KIND_LABEL[backup.kind]
          }}<template v-if="backup.sourceFile"> from {{ backup.sourceFile }}</template
          ><template v-if="backup.sourceModifiedAt">
            (made {{ formatDate(backup.sourceModifiedAt) }})</template
          >
        </div>
      </div>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-backup-restore"
        :disabled="busy"
        data-testid="sd-restore"
        @click="openRestore(backup)"
      >
        Restore
      </v-btn>
      <v-menu>
        <template #activator="{ props: menu }">
          <v-btn
            v-bind="menu"
            icon="mdi-dots-vertical"
            size="small"
            variant="text"
            aria-label="More"
            data-testid="sd-backup-menu"
          />
        </template>
        <v-list density="compact">
          <v-list-item
            prepend-icon="mdi-pencil-outline"
            title="Rename"
            data-testid="sd-rename"
            @click="openRename(backup)"
          />
          <v-list-item
            prepend-icon="mdi-export"
            title="Export to a file"
            data-testid="sd-export"
            @click="exportBackup(backup)"
          />
          <v-list-item
            prepend-icon="mdi-delete-outline"
            title="Delete"
            data-testid="sd-delete"
            @click="deleting = backup"
          />
        </v-list>
      </v-menu>
    </div>
  </div>
  <div v-if="overview.damagedBackups" class="rr-row-sub bk-damaged">
    {{ plural(overview.damagedBackups, 'backup') }} in RigReady's folder could not be read and
    {{ overview.damagedBackups === 1 ? 'is' : 'are' }} not listed.
  </div>

  <template v-if="installed">
    <h2 class="rr-section-title bk-section">Stream Deck's own automatic backups</h2>
    <div
      v-if="overview.elgatoBackups.length === 0"
      class="rr-panel bk-note"
      data-testid="sd-elgato-empty"
    >
      The Stream Deck app has not made any automatic backups on this PC yet. It makes one when it
      updates.
    </div>
    <div v-else class="rr-panel">
      <div
        v-for="file in overview.elgatoBackups"
        :key="file.fileName"
        class="rr-row"
        data-testid="sd-elgato-row"
      >
        <v-icon icon="mdi-archive-clock-outline" class="rr-muted" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ file.fileName }}</div>
          <div class="rr-row-sub">
            {{ formatDate(file.modifiedAt) }} · {{ formatBytes(file.bytes) }}
          </div>
        </div>
        <span
          v-if="imported.has(file.fileName)"
          class="rr-row-sub"
          data-testid="sd-elgato-imported"
        >
          Imported
        </span>
        <v-btn
          v-else
          size="small"
          variant="tonal"
          :disabled="busy"
          data-testid="sd-elgato-import"
          @click="importElgato(file.fileName)"
        >
          Import
        </v-btn>
      </div>
    </div>
  </template>

  <h2 class="rr-section-title bk-section">Restoring without RigReady</h2>
  <div class="rr-panel bk-note" data-testid="sd-manual-restore">
    Every backup can be exported as a <span class="rr-mono">.streamDeckProfilesBackup</span> file.
    Double-click that file, or in the Stream Deck app open Preferences, then Profiles, and choose
    Restore from the menu at the bottom of the profile list. Stream Deck asks before it replaces
    your profiles. Plugins are never in a backup: install them from the Elgato Marketplace
    afterwards.
  </div>

  <!-- Back up -->
  <v-dialog v-model="creating" max-width="520">
    <v-card data-testid="sd-backup-dialog">
      <v-card-title>Back up Stream Deck</v-card-title>
      <v-card-text>
        <p class="bk-dialog-p">
          Copies {{ plural(overview.inventory.profiles.length, 'profile') }} and the list of
          installed plugins into RigReady's folder. Nothing in Stream Deck is changed.
        </p>
        <v-text-field
          v-model="newName"
          label="Name (optional)"
          placeholder="For example: before the F-16 rework"
          data-testid="sd-backup-name-input"
          @keyup.enter="createBackup"
        />
        <v-checkbox
          v-model="includePlugins"
          class="mt-2"
          label="Also copy the plugin folders (larger; some plugins keep their settings there)"
          data-testid="sd-backup-plugins"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="creating = false">Cancel</v-btn>
        <v-btn color="primary" :loading="busy" data-testid="sd-backup-confirm" @click="createBackup"
          >Back up</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Rename -->
  <v-dialog
    :model-value="renaming !== undefined"
    max-width="460"
    @update:model-value="renaming = undefined"
  >
    <v-card data-testid="sd-rename-dialog">
      <v-card-title>Rename backup</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="renameTo"
          label="Name"
          data-testid="sd-rename-input"
          @keyup.enter="rename"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="renaming = undefined">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="!renameTo.trim()"
          data-testid="sd-rename-confirm"
          @click="rename"
          >Rename</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Delete -->
  <v-dialog
    :model-value="deleting !== undefined"
    max-width="460"
    @update:model-value="deleting = undefined"
  >
    <v-card v-if="deleting" data-testid="sd-delete-dialog">
      <v-card-title>Delete "{{ deleting.name }}"?</v-card-title>
      <v-card-text>
        The backup is removed from RigReady's folder. This cannot be undone. Your Stream Deck
        profiles are not affected.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="deleting = undefined">Keep it</v-btn>
        <v-btn color="error" data-testid="sd-delete-confirm" @click="remove">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Restore -->
  <v-dialog :model-value="preview !== undefined" max-width="640" persistent scrollable>
    <v-card v-if="preview" data-testid="sd-restore-dialog">
      <v-card-title>Restore "{{ preview.backup.name }}"?</v-card-title>
      <v-card-text>
        <template v-if="preview.method === 'files'">
          <div v-if="preview.add.length" class="bk-list" data-testid="sd-restore-add">
            <div class="bk-list-title">Added ({{ preview.add.length }})</div>
            <div v-for="p in preview.add" :key="p.uuid">{{ p.name }}</div>
          </div>
          <div v-if="preview.replace.length" class="bk-list" data-testid="sd-restore-replace">
            <div class="bk-list-title">
              Replaced with the backed-up version ({{ preview.replace.length }})
            </div>
            <div v-for="p in preview.replace" :key="p.uuid">
              {{ p.name
              }}<span v-if="p.currentName !== p.name" class="rr-muted">
                (now "{{ p.currentName }}")</span
              >
            </div>
          </div>
          <div v-if="preview.keep.length" class="bk-list" data-testid="sd-restore-keep">
            <div class="bk-list-title">
              Not in this backup, left as they are ({{ preview.keep.length }})
            </div>
            <div v-for="p in preview.keep" :key="p.uuid">{{ p.name }}</div>
          </div>
          <div v-if="preview.changes" class="bk-list" data-testid="sd-restore-files">
            <div class="bk-list-title">Files in the Stream Deck profiles folder</div>
            <ChangePreview :preview="preview.changes" :show-unchanged="false" :limit="6" />
          </div>
          <v-checkbox
            v-if="preview.backup.includesPluginFolders"
            v-model="restorePlugins"
            label="Also put back the plugin folders from this backup"
            data-testid="sd-restore-plugins"
          />
          <div
            v-if="restorePlugins && preview.pluginChanges"
            class="bk-list"
            data-testid="sd-restore-plugin-files"
          >
            <div class="bk-list-title">Files in the Stream Deck plugins folder</div>
            <ChangePreview :preview="preview.pluginChanges" :show-unchanged="false" :limit="6" />
          </div>
          <p class="bk-dialog-p">
            Your current profiles are backed up first, and every file RigReady changes can be undone
            on the Safety page.
          </p>
          <v-alert
            v-if="preview.appRunning && !stubborn"
            type="warning"
            variant="tonal"
            density="compact"
            data-testid="sd-restore-running"
          >
            Stream Deck is running. RigReady will close it first: it keeps profiles in memory and
            would write over the restored ones when it quits. You can start it again afterwards.
          </v-alert>
          <v-alert
            v-if="stubborn"
            type="warning"
            variant="tonal"
            density="compact"
            data-testid="sd-restore-stubborn"
          >
            {{ stubborn }}
          </v-alert>
        </template>
        <template v-else>
          <p class="bk-dialog-p" data-testid="sd-restore-app">
            {{ preview.methodReason }} RigReady hands the file to the Stream Deck app, which asks
            before it replaces anything.
            <template v-if="preview.keep.length || preview.replace.length">
              Your current profiles are backed up in RigReady first.
            </template>
          </p>
          <div class="bk-list">
            <div class="bk-list-title">
              Profiles in this backup ({{ preview.backup.profiles.length }})
            </div>
            <div v-for="p in preview.backup.profiles" :key="p.uuid">{{ p.name }}</div>
          </div>
          <v-alert v-if="!preview.appInstalled" type="warning" variant="tonal" density="compact">
            Install the Stream Deck app first.
          </v-alert>
        </template>
        <v-alert
          v-if="previewError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="sd-restore-error"
        >
          {{ previewError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="sd-restore-cancel" @click="preview = undefined"
          >Cancel</v-btn
        >
        <template v-if="preview.method === 'files'">
          <v-btn
            v-if="stubborn"
            color="error"
            :loading="busy"
            data-testid="sd-restore-force"
            @click="restore(true)"
          >
            End Stream Deck and restore
          </v-btn>
          <v-btn
            v-else
            color="primary"
            :loading="busy"
            data-testid="sd-restore-confirm"
            @click="restore()"
          >
            {{ preview.appRunning ? 'Close Stream Deck and restore' : 'Restore' }}
          </v-btn>
        </template>
        <v-btn
          v-else
          color="primary"
          :loading="busy"
          :disabled="!preview.appInstalled"
          data-testid="sd-restore-confirm"
          @click="restore()"
        >
          Open in Stream Deck
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Waiting for the Stream Deck app's own restore prompt -->
  <v-dialog :model-value="appRestore !== undefined" max-width="520" persistent>
    <v-card v-if="appRestore" data-testid="sd-app-restore">
      <v-card-title>Confirm in Stream Deck</v-card-title>
      <v-card-text>
        <template v-if="!appRestore.result">
          The Stream Deck app is asking whether to restore "{{ appRestore.backup.name }}". Confirm
          it there, wait until your profiles appear, then check the result here.
        </template>
        <template v-else-if="appRestore.result.missing.length === 0">
          <span class="rr-ok" data-testid="sd-app-restore-ok">
            All {{ plural(appRestore.result.found.length, 'profile') }} from the backup are in
            Stream Deck now.
          </span>
        </template>
        <template v-else>
          <span class="rr-warn" data-testid="sd-app-restore-missing">
            Not there yet: {{ appRestore.result.missing.join(', ') }}.
          </span>
          If you confirmed the restore in Stream Deck, give it a moment and check again.
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="appRestore = undefined">Close</v-btn>
        <v-btn
          v-if="!appRestore.result || appRestore.result.missing.length"
          color="primary"
          data-testid="sd-app-restore-check"
          @click="checkAppRestore"
        >
          Check result
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Undo, when Stream Deck changed the restored files since -->
  <v-dialog :model-value="undoChanged !== undefined" max-width="520" persistent>
    <v-card v-if="undoChanged" data-testid="sd-undo-confirm">
      <v-card-title>Undo anyway?</v-card-title>
      <v-card-text>
        {{ undoChanged }} Stream Deck has saved the restored profiles since. The current files are
        backed up first, so this undo can itself be undone on the Safety page.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="undoChanged = undefined">Leave it</v-btn>
        <v-btn color="primary" data-testid="sd-undo-force" @click="undoRestore(true)"
          >Undo anyway</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bk-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.bk-intro {
  max-width: 520px;
}
.bk-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -4px 0 12px;
}
.bk-restored {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
  border-color: color-mix(in srgb, var(--rr-ok) 45%, var(--rr-border));
}
.bk-empty-sub {
  margin-top: 4px;
}
.bk-damaged {
  margin-top: 8px;
}
.bk-section {
  margin-top: 28px;
}
.bk-note {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--rr-muted);
  line-height: 1.55;
}
.bk-dialog-p {
  margin-bottom: 12px;
  color: var(--rr-muted);
  font-size: 13.5px;
}
.bk-list {
  margin-bottom: 12px;
  font-size: 13.5px;
}
.bk-list-title {
  font-weight: 600;
  margin-bottom: 2px;
}
</style>
