<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { backupContract, type ItemDraftInput, type ItemPreview, type Overview } from '../contract';
import { plural, size } from './format';

const props = defineProps<{
  scope: string;
  scopeName: string;
  games: { id: string; name: string }[];
  initial?: ItemDraftInput;
}>();
const emit = defineEmits<{ saved: [overview: Overview]; cancel: [] }>();
const api = useClient(backupContract);

const label = ref(props.initial?.label ?? '');
const game = ref(props.initial?.game ?? '');
const gameChoices = computed(() => [
  { title: 'No particular game', value: '' },
  ...props.games.map((g) => ({ title: g.name, value: g.id })),
]);
const path = ref(props.initial?.path ?? '');
const kind = ref<'file' | 'folder'>(props.initial?.kind ?? 'folder');
const include = ref((props.initial?.include ?? []).join('\n'));
const exclude = ref((props.initial?.exclude ?? []).join('\n'));
const preview = ref<ItemPreview>();
const previewError = ref<string>();
const error = ref<string>();
const saving = ref(false);

const patterns = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter(Boolean);

const draft = computed<ItemDraftInput>(() => ({
  ...(props.initial?.id ? { id: props.initial.id } : {}),
  label: label.value,
  path: path.value,
  kind: kind.value,
  include: patterns(include.value),
  exclude: patterns(exclude.value),
  ...(game.value ? { game: game.value } : {}),
}));

let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
async function refresh(): Promise<void> {
  const mine = ++sequence;
  if (!path.value.trim()) {
    preview.value = undefined;
    previewError.value = undefined;
    return;
  }
  const result = await api.previewItem(draft.value);
  if (mine !== sequence) return;
  if (result.ok) {
    preview.value = result.value;
    previewError.value = undefined;
    kind.value = result.value.kind;
  } else {
    preview.value = undefined;
    previewError.value = errorText(result.error);
  }
}
watch(
  () => [path.value, include.value, exclude.value, kind.value],
  () => {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 250);
  },
  { immediate: true }
);
onBeforeUnmount(() => clearTimeout(timer));

async function browse(which: 'file' | 'folder'): Promise<void> {
  error.value = undefined;
  const result = await api.browse({ kind: which });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  if (!result.value) return;
  path.value = result.value.path;
  kind.value = which;
  if (!label.value.trim()) label.value = result.value.label;
}

async function save(): Promise<void> {
  error.value = undefined;
  saving.value = true;
  const result = await api.saveItem({ scope: props.scope, item: draft.value });
  saving.value = false;
  if (!result.ok) error.value = errorText(result.error);
  else emit('saved', result.value);
}

const canSave = computed(
  () => label.value.trim().length > 0 && path.value.trim().length > 0 && !previewError.value
);
</script>

<template>
  <v-card data-testid="item-editor">
    <v-card-title>{{ initial?.id ? 'Edit tracked item' : 'Track a file or folder' }}</v-card-title>
    <v-card-subtitle>In "{{ scopeName }}"</v-card-subtitle>
    <v-card-text class="editor">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" data-testid="item-error">
        {{ error }}
      </v-alert>
      <div class="editor-name">
        <v-text-field
          v-model="label"
          label="Name"
          placeholder="DCS bindings"
          data-testid="item-label"
        />
        <v-select v-model="game" :items="gameChoices" label="Game" data-testid="item-game" />
      </div>
      <div class="editor-path">
        <v-text-field
          v-model="path"
          label="Path"
          placeholder="{SAVED_GAMES}/DCS/Config/Input"
          hint="Use a variable such as {DOCUMENTS} or {DCS_USER} so it works on any PC; a full path is turned into one when it can be."
          persistent-hint
          data-testid="item-path"
        />
        <v-btn
          variant="tonal"
          size="small"
          data-testid="item-browse-folder"
          @click="browse('folder')"
        >
          Folder…
        </v-btn>
        <v-btn variant="tonal" size="small" data-testid="item-browse-file" @click="browse('file')">
          File…
        </v-btn>
      </div>
      <div v-if="kind === 'folder'" class="editor-patterns">
        <v-textarea
          v-model="include"
          label="Only these (optional)"
          placeholder="**/*.lua"
          rows="2"
          auto-grow
          hint="One pattern per line. Empty means every file."
          persistent-hint
          data-testid="item-include"
        />
        <v-textarea
          v-model="exclude"
          label="Leave out"
          placeholder="Logs/**"
          rows="2"
          auto-grow
          hint="One pattern per line, e.g. Logs/** or *.tmp"
          persistent-hint
          data-testid="item-exclude"
        />
      </div>

      <div class="preview" data-testid="item-preview">
        <div v-if="previewError" class="rr-bad">{{ previewError }}</div>
        <template v-else-if="preview">
          <div class="rr-row-sub">
            <span class="rr-mono">{{ preview.path }}</span>
            <template v-if="preview.absolute">
              → <span class="rr-mono">{{ preview.absolute }}</span>
            </template>
          </div>
          <div v-if="preview.problem" class="rr-warn mt-1">{{ preview.problem }}</div>
          <div v-else-if="!preview.exists" class="rr-warn mt-1" data-testid="item-preview-missing">
            Nothing is there on this PC right now. It is still saved and backed up when it appears.
          </div>
          <template v-else>
            <div class="preview-count" data-testid="item-preview-count">
              {{ plural(preview.fileCount, 'file') }} · {{ size(preview.totalBytes) }}
            </div>
            <div class="preview-files">
              <div
                v-for="f in preview.files"
                :key="f.relativePath"
                class="preview-file"
                data-testid="item-preview-file"
              >
                <span class="rr-mono">{{ f.relativePath }}</span>
                <span class="rr-muted">{{ size(f.size) }}</span>
              </div>
              <div v-if="preview.fileCount > preview.files.length" class="rr-muted">
                and {{ preview.fileCount - preview.files.length }} more
              </div>
            </div>
          </template>
          <div v-for="w in preview.withheld" :key="w.relativePath" class="rr-warn mt-1">
            Never backed up: <span class="rr-mono">{{ w.relativePath }}</span> ({{ w.reason }})
          </div>
        </template>
        <div v-else class="rr-muted">
          Enter a path or browse to see which files would be backed up.
        </div>
      </div>
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn variant="text" data-testid="item-cancel" @click="emit('cancel')">Cancel</v-btn>
      <v-btn
        color="primary"
        :disabled="!canSave"
        :loading="saving"
        data-testid="item-save"
        @click="save"
      >
        Save
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 12px;
}
.editor-name {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 12px;
}
.editor-path {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.editor-path .v-btn {
  margin-top: 10px;
}
.editor-patterns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.preview {
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  background: var(--rr-bg);
}
.preview-count {
  margin: 6px 0 4px;
  font-weight: 500;
}
.preview-files {
  max-height: 180px;
  overflow-y: auto;
}
.preview-file {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
}
</style>
