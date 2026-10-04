<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import { safetyContract, type ChangeGroupView, type SafetyView } from '../contract';

const api = useClient(safetyContract);
const view = ref<SafetyView>();
const error = ref<string>();
const message = ref<string>();
const open = ref(new Set<string>());
/** The action whose files changed again since: undoing needs a second, explicit yes. */
const confirming = ref<{ group: ChangeGroupView; detail: string }>();

async function load(): Promise<void> {
  const result = await api.journal();
  if (result.ok) view.value = result.value;
  else error.value = errorText(result.error);
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());

function toggle(id: string): void {
  const next = new Set(open.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  open.value = next;
}

async function undo(group: ChangeGroupView, force = false): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.undo({ groupId: group.id, force });
  if (result.ok) {
    confirming.value = undefined;
    view.value = result.value;
    message.value = `Undid "${group.reason}"`;
    notifyMachineChanged();
  } else if (result.error.code === 'journal.changed' && !force) {
    confirming.value = { group, detail: result.error.message };
  } else {
    confirming.value = undefined;
    error.value = errorText(result.error);
  }
}

const KIND_LABEL = { created: 'Created', changed: 'Changed', deleted: 'Deleted' } as const;

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const fileCount = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;
</script>

<template>
  <div class="rr-page" data-testid="safety-page">
    <h1 class="rr-page-title">Safety</h1>
    <p class="rr-page-sub">
      Every file RigReady changed outside its own folder. Each change was backed up first and can be
      undone.
    </p>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="safety-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="safety-message rr-ok" data-testid="safety-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <div class="rr-row-sub safety-usage" data-testid="safety-usage">
        Automatic backups use {{ size(view.backupBytes) }} in
        <span class="rr-mono">{{ view.backupFolder }}</span
        >. They are kept {{ view.retention.autoBackupDays }} days; the newest
        {{ view.retention.autoBackupGroups }} changes are always kept.
      </div>

      <EmptyState
        v-if="view.groups.length === 0"
        art="shield"
        title="RigReady has not changed any of your files"
        data-testid="safety-empty"
      >
        When it does, the change is listed here with the file as it was before, and can be undone.
      </EmptyState>

      <div v-else class="rr-panel">
        <div
          v-for="group in view.groups"
          :key="group.id"
          class="safety-group"
          data-testid="change-group"
          :data-reason="group.reason"
          :data-undone="group.undone"
        >
          <div class="rr-row safety-head">
            <v-btn
              :icon="open.has(group.id) ? 'mdi-chevron-down' : 'mdi-chevron-right'"
              variant="text"
              size="small"
              density="comfortable"
              :aria-label="open.has(group.id) ? 'Hide the files' : 'Show the files'"
              data-testid="change-toggle"
              @click="toggle(group.id)"
            />
            <div class="rr-row-main">
              <div class="rr-row-title">{{ group.reason }}</div>
              <div class="rr-row-sub">
                {{ when(group.time) }} · {{ fileCount(group.changes.length) }}
                <span v-if="group.undone" data-testid="change-undone"> · undone</span>
              </div>
            </div>
            <v-btn
              v-if="!group.undone"
              size="small"
              variant="tonal"
              prepend-icon="mdi-undo"
              data-testid="change-undo"
              @click="undo(group)"
            >
              Undo
            </v-btn>
          </div>
          <div v-if="open.has(group.id)" class="safety-files">
            <div
              v-for="change in group.changes"
              :key="change.id"
              class="safety-file"
              data-testid="change-file"
            >
              <span class="safety-kind">{{ KIND_LABEL[change.kind] }}</span>
              <span class="rr-mono">{{ change.path }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>

    <v-dialog :model-value="confirming !== undefined" max-width="520" persistent>
      <v-card v-if="confirming" data-testid="undo-confirm">
        <v-card-title>Undo anyway?</v-card-title>
        <v-card-text>
          {{ confirming.detail }} The current content is backed up first, so this undo can itself be
          undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" data-testid="undo-cancel" @click="confirming = undefined">
            Leave it
          </v-btn>
          <v-btn color="primary" data-testid="undo-force" @click="undo(confirming.group, true)">
            Undo anyway
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.safety-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -12px 0 12px;
}
.safety-usage {
  margin-bottom: 16px;
}
.safety-group {
  border-top: 1px solid var(--rr-border);
}
.safety-group:first-child {
  border-top: none;
}
.safety-head {
  border-top: none;
}
.safety-files {
  padding: 0 16px 12px 56px;
}
.safety-file {
  display: flex;
  gap: 12px;
  padding: 2px 0;
  font-size: 12.5px;
  color: var(--rr-muted);
  overflow-wrap: anywhere;
}
.safety-kind {
  flex: 0 0 64px;
}
</style>
