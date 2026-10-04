<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import ChangePreview from '../../../renderer/components/ChangePreview.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import type { ChangePreview as Preview } from '../../../shared/changePreview';
import { backupContract, type ComparisonView, type Overview, type SnapshotView } from '../contract';
import DiffView from './DiffView.vue';
import { plural, size, when } from './format';

const emit = defineEmits<{ showTracked: [] }>();
const api = useClient(backupContract);
const view = ref<Overview>();
const snapshots = ref<SnapshotView[]>();
const error = ref<string>();
const message = ref<string>();
const chosen = ref<string>();
const name = ref('');
const taking = ref(false);
const comparing = ref<{ snapshot: SnapshotView; comparison: ComparisonView; folder?: string }>();
const restoring = ref<SnapshotView>();
/** Which files putting the snapshot back would change; loaded when the confirmation opens. */
const restorePreview = ref<Preview>();
const restorePreviewError = ref<string>();
watch(restoring, async (snapshot) => {
  restorePreview.value = undefined;
  restorePreviewError.value = undefined;
  if (!snapshot) return;
  const result = await api.restoreSnapshotPreview({ id: snapshot.id });
  if (restoring.value?.id !== snapshot.id) return;
  if (result.ok) restorePreview.value = result.value;
  else restorePreviewError.value = errorText(result.error);
});
const renaming = ref<{ id: string; name: string }>();
const deleting = ref<SnapshotView>();

async function load(): Promise<void> {
  const [overview, list] = await Promise.all([api.overview(), api.snapshots()]);
  if (overview.ok) view.value = overview.value;
  else error.value = errorText(overview.error);
  if (list.ok) snapshots.value = list.value;
  else error.value = errorText(list.error);
}
onMounted(() => void load());

/** Every tracked item, as "scope|id" with a readable title. */
const choices = computed(() =>
  (view.value?.scopes ?? []).flatMap((s) =>
    s.items.map((i) => ({
      value: `${s.id}|${i.item.id}`,
      title: `${i.item.label} (${s.name})`,
    }))
  )
);

function clear(): void {
  error.value = undefined;
  message.value = undefined;
}

async function take(): Promise<void> {
  if (!chosen.value) return;
  clear();
  const [scope, itemId] = chosen.value.split('|') as [string, string];
  taking.value = true;
  const result = await api.takeSnapshot({ scope, itemId, name: name.value });
  taking.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  message.value = `Saved snapshot "${result.value.name}" (${plural(result.value.fileCount, 'file')})`;
  name.value = '';
  await load();
}

async function compare(snapshot: SnapshotView): Promise<void> {
  clear();
  const result = await api.compareSnapshot({ id: snapshot.id });
  if (result.ok) comparing.value = result.value;
  else error.value = errorText(result.error);
}

async function confirmRestore(): Promise<void> {
  if (!restoring.value) return;
  clear();
  const snapshot = restoring.value;
  const result = await api.restoreSnapshot({ id: snapshot.id });
  restoring.value = undefined;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const { written, leftAlone } = result.value;
  message.value =
    written === 0
      ? `"${snapshot.name}" already matches the files.`
      : `Put back ${plural(written, 'file')} from "${snapshot.name}". Undo it on the Safety page.` +
        (leftAlone ? ` ${plural(leftAlone, 'file')} added since were left as they are.` : '');
  if (comparing.value?.snapshot.id === snapshot.id) comparing.value = undefined;
  notifyMachineChanged();
}

async function confirmRename(): Promise<void> {
  if (!renaming.value) return;
  clear();
  const result = await api.renameSnapshot(renaming.value);
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  renaming.value = undefined;
  await load();
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value) return;
  clear();
  const result = await api.removeSnapshot({ id: deleting.value.id });
  const gone = deleting.value.name;
  deleting.value = undefined;
  if (!result.ok) error.value = errorText(result.error);
  else message.value = `Deleted snapshot "${gone}"`;
  await load();
}
</script>

<template>
  <div data-testid="snapshots-tab">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="snapshot-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="snap-message rr-ok" data-testid="snapshot-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <div v-if="view" class="rr-panel take">
      <div class="take-title">Take a snapshot</div>
      <div class="rr-row-sub mb-3">
        A named copy of one tracked item, for example before you rebind an aircraft. Compare it with
        the files later, line by line, or put it back.
      </div>
      <div v-if="choices.length === 0" class="rr-row-sub" data-testid="snapshot-nothing-tracked">
        Track a file or folder first.
        <a href="#" @click.prevent="emit('showTracked')">Go to Tracked files</a>
      </div>
      <div v-else class="take-form">
        <v-select
          v-model="chosen"
          :items="choices"
          label="Tracked item"
          density="compact"
          variant="outlined"
          hide-details
          data-testid="snapshot-item"
        />
        <v-text-field
          v-model="name"
          label="Name"
          placeholder="Before rebinding the throttle"
          density="compact"
          variant="outlined"
          hide-details
          data-testid="snapshot-name"
          @keyup.enter="take"
        />
        <v-btn
          color="primary"
          :disabled="!chosen || !name.trim()"
          :loading="taking"
          data-testid="snapshot-take"
          @click="take"
        >
          Take snapshot
        </v-btn>
      </div>
    </div>

    <h2 class="rr-section-title section-gap">Snapshots</h2>
    <div
      v-if="snapshots && snapshots.length === 0"
      class="rr-panel rr-empty"
      data-testid="snapshots-empty"
    >
      No snapshots yet.
    </div>
    <div v-else-if="snapshots" class="rr-panel">
      <div
        v-for="s in snapshots"
        :key="s.id"
        class="rr-row"
        data-testid="snapshot-row"
        :data-name="s.name"
      >
        <v-icon icon="mdi-camera-outline" size="20" />
        <div class="rr-row-main">
          <div class="rr-row-title">{{ s.name }}</div>
          <div class="rr-row-sub">
            {{ s.itemLabel }} · {{ when(s.createdAt) }} · {{ plural(s.fileCount, 'file') }} ·
            {{ size(s.totalBytes) }}
          </div>
        </div>
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-compare-horizontal"
          data-testid="snapshot-compare"
          @click="compare(s)"
        >
          Compare
        </v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn
              v-bind="props"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              aria-label="More actions"
              data-testid="snapshot-menu"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              prepend-icon="mdi-restore"
              title="Put back…"
              data-testid="snapshot-restore"
              @click="restoring = s"
            />
            <v-list-item
              prepend-icon="mdi-pencil-outline"
              title="Rename"
              data-testid="snapshot-rename"
              @click="renaming = { id: s.id, name: s.name }"
            />
            <v-list-item
              prepend-icon="mdi-delete-outline"
              title="Delete"
              data-testid="snapshot-delete"
              @click="deleting = s"
            />
          </v-list>
        </v-menu>
      </div>
    </div>

    <v-dialog
      :model-value="comparing !== undefined"
      max-width="900"
      scrollable
      @update:model-value="comparing = undefined"
    >
      <v-card v-if="comparing" data-testid="snapshot-comparison">
        <v-card-title>"{{ comparing.snapshot.name }}" compared with now</v-card-title>
        <v-card-subtitle>
          {{ comparing.snapshot.itemLabel }}
          <template v-if="comparing.folder"> · {{ comparing.folder }}</template>
        </v-card-subtitle>
        <v-card-text>
          <DiffView
            :comparison="comparing.comparison"
            empty-text="The files are exactly as they were in this snapshot."
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            v-if="comparing.comparison.changes.length"
            variant="text"
            prepend-icon="mdi-restore"
            data-testid="snapshot-compare-restore"
            @click="restoring = comparing.snapshot"
          >
            Put this snapshot back
          </v-btn>
          <v-btn color="primary" variant="tonal" @click="comparing = undefined">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="restoring !== undefined"
      max-width="560"
      scrollable
      @update:model-value="restoring = undefined"
    >
      <v-card v-if="restoring" data-testid="snapshot-restore-dialog">
        <v-card-title>Put back "{{ restoring.name }}"?</v-card-title>
        <v-card-text>
          Files of {{ restoring.itemLabel }} that differ from the snapshot are replaced with the
          snapshot's version. Each one is backed up first, and the Safety page can undo it. Files
          added since the snapshot are left alone.
          <ChangePreview class="mt-3" :preview="restorePreview" :error="restorePreviewError" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="restoring = undefined">Cancel</v-btn>
          <v-btn
            color="primary"
            :disabled="!restorePreview"
            data-testid="snapshot-restore-confirm"
            @click="confirmRestore"
          >
            Put back
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="renaming !== undefined"
      max-width="480"
      @update:model-value="renaming = undefined"
    >
      <v-card v-if="renaming">
        <v-card-title>Rename snapshot</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renaming.name"
            label="Name"
            autofocus
            @keyup.enter="confirmRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="renaming = undefined">Cancel</v-btn>
          <v-btn color="primary" :disabled="!renaming.name.trim()" @click="confirmRename"
            >Rename</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      :model-value="deleting !== undefined"
      max-width="480"
      @update:model-value="deleting = undefined"
    >
      <v-card v-if="deleting">
        <v-card-title>Delete this snapshot?</v-card-title>
        <v-card-text>"{{ deleting.name }}" is deleted. Your files are not touched.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = undefined">Keep it</v-btn>
          <v-btn color="error" data-testid="snapshot-delete-confirm" @click="confirmDelete"
            >Delete</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.snap-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin: -8px 0 12px;
}
.take {
  padding: 16px 20px;
}
.take-title {
  font-size: 15px;
  font-weight: 600;
}
.take-form {
  display: grid;
  grid-template-columns: 1.3fr 1fr auto;
  gap: 12px;
  align-items: center;
}
</style>
