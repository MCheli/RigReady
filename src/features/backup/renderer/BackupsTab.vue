<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import {
  backupContract,
  type BackupOutcomeView,
  type BackupView,
  type Overview,
} from '../contract';
import { ALWAYS, plural, SCOPE_KIND_LABEL, size, when } from './format';

const emit = defineEmits<{ showTracked: [] }>();
const api = useClient(backupContract);
const router = useRouter();

const view = ref<Overview>();
const error = ref<string>();
const message = ref<string>();
const running = ref(false);
const progress = ref<{ done: number; total: number; label: string }>();
const outcome = ref<BackupOutcomeView>();
const open = ref(new Set<string>());
const renaming = ref<{ id: string; name: string }>();
const deleting = ref<BackupView>();

async function load(): Promise<void> {
  const result = await api.overview();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let offProgress: (() => void) | undefined;
let offMachine: (() => void) | undefined;
onMounted(() => {
  void load();
  offProgress = api.on('progress', (p) => (progress.value = p));
  offMachine = onMachineChanged(() => void load());
});
onBeforeUnmount(() => {
  offProgress?.();
  offMachine?.();
});

const setups = computed(() => (view.value?.scopes ?? []).filter((s) => s.id !== ALWAYS));
const tracked = computed(() => {
  const items = (view.value?.scopes ?? []).flatMap((s) => s.items);
  return {
    items: items.length,
    files: items.reduce((sum, i) => sum + i.fileCount, 0),
    bytes: items.reduce((sum, i) => sum + i.totalBytes, 0),
  };
});
const lastBackup = computed(() =>
  (view.value?.backups ?? []).find((b) => !b.damaged && b.scopeKind === 'full')
);
const nothingToBackUp = computed(() => setups.value.length === 0 && tracked.value.items === 0);

function clearMessages(): void {
  error.value = undefined;
  message.value = undefined;
}

async function backUp(
  scope: { kind: 'full' } | { kind: 'profile'; profileId: string }
): Promise<void> {
  clearMessages();
  outcome.value = undefined;
  running.value = true;
  progress.value = undefined;
  const result = await api.backUp({ scope });
  running.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  outcome.value = result.value;
  await load();
}

const outcomeTitle = computed(() => {
  const o = outcome.value;
  if (!o) return '';
  const what = `${plural(o.backup.fileCount, 'file')} (${size(o.backup.totalBytes)})`;
  return o.skipped.length > 0
    ? `Backup completed with ${o.skipped.length} skipped: ${what} saved`
    : `Backed up ${what}`;
});

function toggle(id: string): void {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

async function exportOne(backup: BackupView): Promise<void> {
  clearMessages();
  const result = await api.exportBackup({ id: backup.id });
  if (!result.ok) error.value = errorText(result.error);
  else if (result.value) message.value = `Exported to ${result.value.path}`;
}

async function reveal(backup: BackupView): Promise<void> {
  clearMessages();
  const result = await api.reveal({ id: backup.id });
  if (!result.ok) error.value = errorText(result.error);
}

async function openFile(): Promise<void> {
  clearMessages();
  const result = await api.openFile();
  if (!result.ok) error.value = `That file cannot be used: ${errorText(result.error)}`;
  else if (result.value) {
    message.value = `Added "${result.value.name}" to the list`;
    await load();
  }
}

async function confirmRename(): Promise<void> {
  if (!renaming.value) return;
  clearMessages();
  const result = await api.rename(renaming.value);
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  renaming.value = undefined;
  await load();
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value) return;
  clearMessages();
  const name = deleting.value.name;
  const result = await api.remove({ id: deleting.value.id });
  deleting.value = undefined;
  if (!result.ok) error.value = errorText(result.error);
  else message.value = `Deleted "${name}"`;
  await load();
}

const KEEP_CHOICES = [
  { title: 'Keep the newest 5', value: 5 },
  { title: 'Keep the newest 10', value: 10 },
  { title: 'Keep the newest 20', value: 20 },
  { title: 'Keep the newest 50', value: 50 },
  { title: 'Keep all', value: 0 },
];

async function setKeep(keepBackups: number): Promise<void> {
  clearMessages();
  const result = await api.setKeep({ keepBackups });
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

function restore(backup: BackupView): void {
  void router.push(`/configure/backups/restore/${encodeURIComponent(backup.id)}`);
}

const kindIcon = (b: BackupView): string =>
  b.damaged
    ? 'mdi-file-alert-outline'
    : b.scopeKind === 'before-restore'
      ? 'mdi-history'
      : b.scopeKind === 'full'
        ? 'mdi-archive-outline'
        : 'mdi-archive-star-outline';
</script>

<template>
  <div data-testid="backups-tab">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="backup-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="backup-message rr-ok" data-testid="backup-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <div v-if="view" class="rr-panel hero">
      <div class="hero-main">
        <div class="hero-title">Back up everything</div>
        <div class="rr-row-sub" data-testid="backup-summary">
          {{ plural(setups.length, 'setup') }} and {{ plural(tracked.items, 'tracked item') }} ({{
            plural(tracked.files, 'file')
          }}, {{ size(tracked.bytes) }}), plus RigReady's settings and monitor layouts.
        </div>
        <div class="rr-row-sub hero-last" data-testid="backup-last">
          <template v-if="lastBackup"> Last full backup {{ when(lastBackup.createdAt) }} </template>
          <template v-else>No full backup yet.</template>
        </div>
        <div v-if="nothingToBackUp" class="rr-row-sub mt-2">
          Nothing to back up yet.
          <a href="#" data-testid="backup-go-tracked" @click.prevent="emit('showTracked')">
            Choose what to back up
          </a>
        </div>
      </div>
      <div class="hero-actions">
        <v-menu v-if="setups.length > 0">
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              variant="text"
              :disabled="running"
              append-icon="mdi-menu-down"
              data-testid="backup-one-setup"
            >
              One setup
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="setup in setups"
              :key="setup.id"
              :title="setup.name"
              :subtitle="plural(setup.items.length, 'tracked item')"
              :data-testid="`backup-setup-${setup.id}`"
              @click="backUp({ kind: 'profile', profileId: setup.id })"
            />
          </v-list>
        </v-menu>
        <v-btn
          color="primary"
          prepend-icon="mdi-backup-restore"
          :loading="running"
          :disabled="nothingToBackUp"
          data-testid="backup-all"
          @click="backUp({ kind: 'full' })"
        >
          Back up now
        </v-btn>
      </div>
      <div v-if="running" class="hero-progress" data-testid="backup-progress">
        <v-progress-linear
          :model-value="progress && progress.total ? (100 * progress.done) / progress.total : 0"
          :indeterminate="!progress"
          color="primary"
          rounded
        />
        <div class="rr-row-sub mt-1">
          {{ progress ? `${progress.label} · ${progress.done} of ${progress.total}` : 'Starting' }}
        </div>
      </div>
    </div>

    <div v-if="outcome" class="rr-panel outcome" data-testid="backup-outcome">
      <div
        class="outcome-title"
        :class="outcome.skipped.length ? 'rr-warn' : 'rr-ok'"
        data-testid="backup-outcome-title"
      >
        <v-icon
          :icon="outcome.skipped.length ? 'mdi-alert-outline' : 'mdi-check-circle-outline'"
          size="18"
        />
        {{ outcomeTitle }}
      </div>
      <div class="rr-row-sub">
        Saved as <span class="rr-mono">{{ outcome.backup.name }}</span> ({{
          size(outcome.backup.size)
        }}
        on disk).
        <template v-if="outcome.pruned.length">
          Removed {{ plural(outcome.pruned.length, 'older backup') }} to keep the newest
          {{ view?.keepBackups }}.
        </template>
      </div>
      <div v-if="outcome.skipped.length" class="outcome-list" data-testid="backup-skipped">
        <div class="rr-section-title section-gap">Could not be read</div>
        <div v-for="s in outcome.skipped" :key="s.path" class="outcome-line">
          <span class="rr-mono">{{ s.path }}</span> — {{ s.reason }}
        </div>
      </div>
      <div v-if="outcome.withheld.length" class="outcome-list" data-testid="backup-withheld">
        <div class="rr-section-title section-gap">Left out on purpose</div>
        <div v-for="s in outcome.withheld" :key="s.path" class="outcome-line">
          <span class="rr-mono">{{ s.path }}</span> — never copied: {{ s.reason }}
        </div>
      </div>
    </div>

    <div v-if="view" class="list-head">
      <h2 class="rr-section-title list-title">Saved backups</h2>
      <v-select
        :model-value="view.keepBackups"
        :items="KEEP_CHOICES"
        density="compact"
        variant="outlined"
        hide-details
        class="keep-select"
        data-testid="backup-keep"
        @update:model-value="setKeep"
      />
      <v-btn
        variant="tonal"
        size="small"
        prepend-icon="mdi-folder-open-outline"
        data-testid="backup-open-file"
        @click="openFile"
      >
        Open backup file
      </v-btn>
    </div>

    <div
      v-if="view && view.backups.length === 0"
      class="rr-panel rr-empty"
      data-testid="backups-empty"
    >
      No backups yet. "Back up now" saves one here; "Open backup file" adds one you made on another
      PC.
    </div>

    <div v-else-if="view" class="rr-panel">
      <div
        v-for="backup in view.backups"
        :key="backup.id"
        class="backup-row"
        data-testid="backup-row"
        :data-name="backup.name"
      >
        <div class="rr-row">
          <v-btn
            :icon="open.has(backup.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            variant="text"
            size="small"
            density="comfortable"
            :disabled="!!backup.damaged"
            :aria-label="open.has(backup.id) ? 'Hide the contents' : 'Show the contents'"
            data-testid="backup-toggle"
            @click="toggle(backup.id)"
          />
          <v-icon :icon="kindIcon(backup)" size="20" :class="backup.damaged ? 'rr-bad' : ''" />
          <div class="rr-row-main">
            <div class="rr-row-title">{{ backup.name }}</div>
            <div v-if="backup.damaged" class="rr-row-sub rr-bad" data-testid="backup-damaged">
              Not a readable backup: {{ backup.damaged }}
            </div>
            <div v-else class="rr-row-sub" data-testid="backup-sub">
              {{ when(backup.createdAt) }} · {{ SCOPE_KIND_LABEL[backup.scopeKind] }}
              <template
                v-if="
                  backup.scopeKind !== 'full' &&
                  backup.scopeLabel !== SCOPE_KIND_LABEL[backup.scopeKind]
                "
                >({{ backup.scopeLabel }})</template
              >
              · {{ plural(backup.fileCount, 'file') }} · {{ size(backup.size) }} · from
              {{ backup.machine || 'an unknown PC' }}
              <span v-if="backup.imported"> · added from a file</span>
            </div>
          </div>
          <v-btn
            v-if="!backup.damaged"
            size="small"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-restore"
            data-testid="backup-restore"
            @click="restore(backup)"
          >
            Restore
          </v-btn>
          <v-menu>
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                aria-label="More actions"
                data-testid="backup-menu"
              />
            </template>
            <v-list density="compact">
              <v-list-item
                v-if="!backup.damaged"
                prepend-icon="mdi-export"
                title="Export to…"
                data-testid="backup-export"
                @click="exportOne(backup)"
              />
              <v-list-item
                prepend-icon="mdi-folder-search-outline"
                title="Show in folder"
                data-testid="backup-reveal"
                @click="reveal(backup)"
              />
              <v-list-item
                prepend-icon="mdi-pencil-outline"
                title="Rename"
                data-testid="backup-rename"
                @click="renaming = { id: backup.id, name: backup.name }"
              />
              <v-list-item
                prepend-icon="mdi-delete-outline"
                title="Delete"
                data-testid="backup-delete"
                @click="deleting = backup"
              />
            </v-list>
          </v-menu>
        </div>
        <div v-if="open.has(backup.id)" class="backup-contents" data-testid="backup-contents">
          <div
            v-for="item in backup.items"
            :key="item.label + item.sourceName"
            class="content-line"
          >
            <span>{{ item.label }}</span>
            <span class="rr-muted"
              >{{ plural(item.fileCount, 'file') }} · {{ item.sourceName }}</span
            >
          </div>
          <div
            v-for="record in backup.records"
            :key="record.from"
            class="content-line"
            data-testid="backup-record"
          >
            <span>{{ record.label }}</span>
            <span class="rr-muted">kept as a record, not restored · {{ record.from }}</span>
          </div>
          <div v-if="backup.profiles.length" class="content-line">
            <span>Setups</span>
            <span class="rr-muted">{{ backup.profiles.join(', ') }}</span>
          </div>
          <div v-if="backup.items.length === 0 && backup.profiles.length === 0" class="rr-muted">
            RigReady settings only.
          </div>
        </div>
      </div>
    </div>

    <div v-if="view" class="rr-row-sub folder-line">
      Backups are kept in <span class="rr-mono">{{ view.folder }}</span
      >. Backups added from a file are never deleted automatically.
    </div>

    <v-dialog
      :model-value="renaming !== undefined"
      max-width="480"
      @update:model-value="renaming = undefined"
    >
      <v-card v-if="renaming" data-testid="backup-rename-dialog">
        <v-card-title>Rename backup</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renaming.name"
            label="Name"
            autofocus
            data-testid="backup-rename-input"
            @keyup.enter="confirmRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renaming = undefined">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="!renaming.name.trim()"
            data-testid="backup-rename-save"
            @click="confirmRename"
          >
            Rename
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="deleting !== undefined"
      max-width="480"
      @update:model-value="deleting = undefined"
    >
      <v-card v-if="deleting" data-testid="backup-delete-dialog">
        <v-card-title>Delete this backup?</v-card-title>
        <v-card-text>
          "{{ deleting.name }}" ({{ size(deleting.size) }}) will be deleted from this PC. Copies you
          exported elsewhere are not affected.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = undefined">Keep it</v-btn>
          <v-btn color="error" data-testid="backup-delete-confirm" @click="confirmDelete">
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.backup-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -8px 0 12px;
}
.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 18px 20px;
  margin-bottom: 16px;
}
.hero-main {
  flex: 1;
  min-width: 280px;
}
.hero-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}
.hero-last {
  margin-top: 6px;
}
.hero-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.hero-progress {
  flex-basis: 100%;
}
.outcome {
  padding: 14px 20px;
  margin-bottom: 16px;
}
.outcome-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  margin-bottom: 4px;
}
.outcome-line {
  font-size: 12.5px;
  color: var(--rr-muted);
  overflow-wrap: anywhere;
}
.list-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 24px 0 8px;
}
.list-title {
  flex: 1;
  margin: 0;
}
.keep-select {
  max-width: 210px;
}
.backup-row {
  border-top: 1px solid var(--rr-border);
}
.backup-row:first-child {
  border-top: none;
}
.backup-row .rr-row {
  border-top: none;
}
.backup-contents {
  padding: 0 16px 12px 88px;
  font-size: 13px;
}
.content-line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 2px 0;
}
.folder-line {
  margin-top: 12px;
}
</style>
