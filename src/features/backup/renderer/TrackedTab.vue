<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  backupContract,
  type ItemDraftInput,
  type ItemView,
  type Overview,
  type Suggestion,
} from '../contract';
import ItemEditor from './ItemEditor.vue';
import { ALWAYS, plural, size } from './format';

const api = useClient(backupContract);
const view = ref<Overview>();
const suggestions = ref<Suggestion[]>();
const scopeId = ref(ALWAYS);
const error = ref<string>();
const message = ref<string>();
const editing = ref<ItemDraftInput | null>();

async function load(): Promise<void> {
  const [overview, suggested] = await Promise.all([api.overview(), api.suggestions()]);
  if (overview.ok) view.value = overview.value;
  else error.value = errorText(overview.error);
  if (suggested.ok) suggestions.value = suggested.value;
  else error.value = errorText(suggested.error);
}
onMounted(() => void load());

const scope = computed(() => view.value?.scopes.find((s) => s.id === scopeId.value));

async function refreshSuggestions(): Promise<void> {
  const suggested = await api.suggestions();
  if (suggested.ok) suggestions.value = suggested.value;
}

async function add(s: Suggestion): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.saveItem({
    scope: scopeId.value,
    item: {
      label: s.label,
      path: s.path,
      kind: s.kind,
      include: s.include ?? [],
      exclude: s.exclude ?? [],
      ...(s.game ? { game: s.game } : {}),
    },
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  message.value = `Now backing up "${s.label}"`;
  await refreshSuggestions();
}

async function remove(entry: ItemView): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await api.removeItem({ scope: scopeId.value, id: entry.item.id });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  view.value = result.value;
  message.value = `Stopped backing up "${entry.item.label}". Nothing was deleted.`;
  await refreshSuggestions();
}

function edit(entry: ItemView): void {
  editing.value = {
    id: entry.item.id,
    label: entry.item.label,
    path: entry.item.path,
    kind: entry.item.kind,
    include: entry.item.include,
    exclude: entry.item.exclude,
    ...(entry.item.game ? { game: entry.item.game } : {}),
  };
}

async function saved(next: Overview): Promise<void> {
  view.value = next;
  message.value = editing.value?.id ? 'Saved the changes' : 'Now backing it up';
  editing.value = undefined;
  await refreshSuggestions();
}

/** Items ticked for a backup of just them, as "scope|id" across every list. */
const selected = ref(new Set<string>());
const backingUp = ref(false);
const key = (entry: ItemView): string => `${scopeId.value}|${entry.item.id}`;
function toggleSelected(entry: ItemView): void {
  const next = new Set(selected.value);
  if (next.has(key(entry))) next.delete(key(entry));
  else next.add(key(entry));
  selected.value = next;
}
async function backUpSelected(): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  backingUp.value = true;
  const items = [...selected.value].map((k) => {
    const [scope, id] = k.split('|') as [string, string];
    return { scope, id };
  });
  const result = await api.backUp({ scope: { kind: 'custom', label: 'Selected items', items } });
  backingUp.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  selected.value = new Set();
  const o = result.value;
  const what = `${plural(o.backup.fileCount, 'file')} (${size(o.backup.totalBytes)}) as "${o.backup.name}"`;
  if (o.skipped.length) {
    error.value = `Backup completed with ${o.skipped.length} skipped: saved ${what}. Could not read ${o.skipped.map((x) => x.path).join(', ')}.`;
  } else message.value = `Backed up ${what}`;
}
const gameName = (id: string): string => view.value?.games.find((g) => g.id === id)?.name ?? id;

const status = (entry: ItemView): { text: string; cls: string } => {
  if (entry.problem) return { text: entry.problem, cls: 'rr-warn' };
  if (!entry.exists) return { text: 'Not on this PC', cls: 'rr-warn' };
  return {
    text: `${plural(entry.fileCount, 'file')} · ${size(entry.totalBytes)}`,
    cls: '',
  };
};
</script>

<template>
  <div data-testid="tracked-tab">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="tracked-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="tracked-message rr-ok" data-testid="tracked-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <template v-if="view">
      <v-chip-group
        v-model="scopeId"
        mandatory
        selected-class="scope-selected"
        class="mb-3"
        data-testid="tracked-scopes"
      >
        <v-chip
          v-for="s in view.scopes"
          :key="s.id"
          :value="s.id"
          variant="outlined"
          :data-testid="`tracked-scope-${s.id === ALWAYS ? 'always' : s.id}`"
        >
          {{ s.name }}
          <span class="scope-count">{{ s.items.length }}</span>
        </v-chip>
      </v-chip-group>

      <div class="head">
        <div class="rr-row-sub head-text">
          <template v-if="scopeId === ALWAYS">
            Backed up with every full backup, whichever setup you use.
          </template>
          <template v-else>
            Backed up with this setup, and recorded each time it launches so you can see what
            changed.
          </template>
        </div>
        <v-btn
          v-if="selected.size > 0"
          variant="tonal"
          color="primary"
          size="small"
          prepend-icon="mdi-backup-restore"
          :loading="backingUp"
          data-testid="tracked-backup-selected"
          @click="backUpSelected"
        >
          Back up {{ plural(selected.size, 'selected item') }}
        </v-btn>
        <v-btn
          variant="tonal"
          size="small"
          prepend-icon="mdi-plus"
          data-testid="tracked-add"
          @click="editing = null"
        >
          Add file or folder
        </v-btn>
      </div>

      <div
        v-if="scope && scope.items.length === 0"
        class="rr-panel rr-empty"
        data-testid="tracked-empty"
      >
        Nothing is tracked in "{{ scope.name }}" yet. Add a suggestion below, or a file or folder of
        your own.
      </div>
      <div v-else-if="scope" class="rr-panel">
        <div
          v-for="entry in scope.items"
          :key="entry.item.id"
          class="rr-row"
          data-testid="tracked-item"
          :data-label="entry.item.label"
        >
          <v-checkbox-btn
            :model-value="selected.has(key(entry))"
            :disabled="!entry.exists || entry.fileCount === 0"
            density="compact"
            :aria-label="`Select ${entry.item.label}`"
            data-testid="tracked-select"
            @update:model-value="toggleSelected(entry)"
          />
          <v-icon
            :icon="entry.item.kind === 'folder' ? 'mdi-folder-outline' : 'mdi-file-outline'"
            size="20"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ entry.item.label }}
              <span v-if="entry.item.game" class="game-tag">{{ gameName(entry.item.game) }}</span>
            </div>
            <div class="rr-row-sub rr-mono">{{ entry.item.path }}</div>
            <div
              v-if="entry.absolute && entry.exists"
              class="rr-row-sub"
              data-testid="tracked-resolved"
            >
              {{ entry.absolute }}
            </div>
            <div v-if="entry.item.include.length || entry.item.exclude.length" class="rr-row-sub">
              <template v-if="entry.item.include.length">
                Only {{ entry.item.include.join(', ') }}.
              </template>
              <template v-if="entry.item.exclude.length">
                Leaves out {{ entry.item.exclude.join(', ') }}.
              </template>
            </div>
          </div>
          <div class="item-status" :class="status(entry).cls" data-testid="tracked-status">
            {{ status(entry).text }}
            <div v-if="entry.withheld" class="rr-row-sub">
              {{ plural(entry.withheld, 'credential file') }} never copied
            </div>
          </div>
          <v-btn
            icon="mdi-pencil-outline"
            variant="text"
            size="small"
            :aria-label="`Edit ${entry.item.label}`"
            data-testid="tracked-edit"
            @click="edit(entry)"
          />
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :aria-label="`Stop backing up ${entry.item.label}`"
            data-testid="tracked-remove"
            @click="remove(entry)"
          />
        </div>
      </div>

      <h2 class="rr-section-title section-gap">Suggested for this PC</h2>
      <div v-if="!suggestions" class="rr-panel rr-empty">Looking for game and tool settings…</div>
      <div
        v-else-if="suggestions.length === 0"
        class="rr-panel rr-empty"
        data-testid="suggestions-empty"
      >
        No supported game or tool settings were found on this PC. Add files and folders yourself
        above.
      </div>
      <div v-else class="rr-panel">
        <div
          v-for="s in suggestions"
          :key="s.key"
          class="rr-row"
          data-testid="suggestion"
          :data-label="s.label"
        >
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ s.label }} <span class="rr-muted suggestion-source">{{ s.source }}</span>
            </div>
            <div v-if="s.description" class="rr-row-sub">{{ s.description }}</div>
            <div class="rr-row-sub rr-mono">{{ s.path }}</div>
          </div>
          <div class="item-status rr-muted">
            {{ plural(s.fileCount, 'file') }} · {{ size(s.totalBytes) }}
          </div>
          <span
            v-if="s.trackedIn.includes(scopeId)"
            class="rr-muted added"
            data-testid="suggestion-added"
          >
            Tracked
          </span>
          <v-btn
            v-else
            size="small"
            variant="tonal"
            prepend-icon="mdi-plus"
            data-testid="suggestion-add"
            @click="add(s)"
          >
            Add
          </v-btn>
        </div>
      </div>
    </template>

    <v-dialog :model-value="editing !== undefined" max-width="720" persistent scrollable>
      <ItemEditor
        v-if="editing !== undefined && scope"
        :scope="scopeId"
        :scope-name="scope.name"
        :games="view?.games ?? []"
        :initial="editing ?? undefined"
        @saved="saved"
        @cancel="editing = undefined"
      />
    </v-dialog>
  </div>
</template>

<style scoped>
.tracked-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -8px 0 12px;
}
.scope-count {
  margin-left: 8px;
  color: var(--rr-muted);
  font-size: 12px;
}
:deep(.scope-selected) {
  background: var(--rr-surface-2);
  border-color: var(--rr-accent) !important;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.head-text {
  flex: 1;
}
.item-status {
  font-size: 12.5px;
  text-align: right;
  max-width: 260px;
}
.game-tag {
  font-weight: 400;
  font-size: 11.5px;
  color: var(--rr-muted);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 0 6px;
  margin-left: 6px;
}
.suggestion-source {
  font-weight: 400;
  font-size: 12px;
  margin-left: 6px;
}
.added {
  font-size: 13px;
  padding: 0 12px;
}
</style>
