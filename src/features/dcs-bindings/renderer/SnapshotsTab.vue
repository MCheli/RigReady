<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { errorText } from '../../../renderer/ipc';
import type { Comparison, Snapshot } from '../core/model';
import { useBindingsStore } from './store';

/** Named snapshots of the binding files: take one, restore it, or see what changed since. */
const store = useBindingsStore();
const snapshots = ref<Snapshot[]>();
const error = ref<string>();
const message = ref<string>();
const name = ref('');
const scope = ref<'aircraft' | 'all'>('aircraft');
const renaming = ref<{ id: string; name: string }>();
const deleting = ref<Snapshot>();
const restoring = ref<{ snapshot: Snapshot; remapIds: boolean }>();
const compareLeft = ref<Snapshot>();
const compareRight = ref<string>('');
const comparison = ref<Comparison>();

const aircraft = computed(() => store.view?.aircraft);
const canSnapshotAircraft = computed(() => (aircraft.value?.userFiles ?? 0) > 0);
watch(
  canSnapshotAircraft,
  (can) => {
    if (!can) scope.value = 'all';
  },
  { immediate: true }
);

async function load(): Promise<void> {
  const result = await store.api.snapshots();
  if (result.ok) snapshots.value = result.value;
  else error.value = errorText(result.error);
}
onMounted(load);
watch(
  () => store.revision,
  () => {
    void load();
    // A restore changes what "now" is: an open comparison is worked out again.
    if (comparison.value) void compare();
  }
);

async function create(): Promise<void> {
  error.value = undefined;
  message.value = undefined;
  const result = await store.api.snapshotCreate({
    name: name.value,
    aircraft: scope.value === 'aircraft' && aircraft.value ? [aircraft.value.id] : [],
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  message.value = `Snapshot "${result.value.name}" taken: ${result.value.files} files.`;
  name.value = '';
  await load();
}

async function rename(): Promise<void> {
  if (!renaming.value) return;
  const result = await store.api.snapshotRename(renaming.value);
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  renaming.value = undefined;
  await load();
}

async function remove(): Promise<void> {
  if (!deleting.value) return;
  const result = await store.api.snapshotDelete({ id: deleting.value.id });
  if (!result.ok) error.value = errorText(result.error);
  else message.value = `Snapshot "${deleting.value.name}" deleted.`;
  if (compareLeft.value?.id === deleting.value.id) {
    compareLeft.value = undefined;
    comparison.value = undefined;
  }
  // A comparison against the deleted snapshot falls back to "now".
  if (compareRight.value === deleting.value.id) compareRight.value = '';
  deleting.value = undefined;
  await load();
}

function restore(): void {
  if (!restoring.value) return;
  const { snapshot, remapIds } = restoring.value;
  restoring.value = undefined;
  void store.plan({ type: 'restore', id: snapshot.id, remapIds });
}

async function compare(): Promise<void> {
  if (!compareLeft.value) return;
  const result = await store.api.snapshotCompare({
    left: compareLeft.value.id,
    ...(compareRight.value ? { right: compareRight.value } : {}),
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  comparison.value = result.value;
}

function startCompare(snapshot: Snapshot): void {
  compareLeft.value = snapshot;
  compareRight.value = '';
  void compare();
}
watch(compareRight, () => void compare());

const compareItems = computed(() => [
  { title: 'the bindings DCS has now', value: '' },
  ...(snapshots.value ?? [])
    .filter((s) => s.id !== compareLeft.value?.id)
    .map((s) => ({ title: `snapshot "${s.name}"`, value: s.id })),
]);

const when = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const size = (bytes: number): string =>
  bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(0)} KB`;
const covers = (snapshot: Snapshot): string =>
  snapshot.aircraft.length === 0
    ? `All aircraft (${snapshot.folders.length} folders)`
    : snapshot.folders.join(', ');
</script>

<template>
  <div data-testid="bind-snapshots">
    <p class="rr-row-sub snap-why">
      A snapshot is a copy of the binding files, kept by RigReady. Take one before a big change or a
      DCS update; restore it when something goes wrong, also on another PC, where the device IDs
      will differ.
    </p>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" data-testid="snap-error">
      {{ error }}
    </v-alert>
    <div v-if="message" class="snap-message rr-ok" data-testid="snap-message">
      <v-icon icon="mdi-check" size="16" /> {{ message }}
    </div>

    <div class="rr-panel snap-new">
      <v-text-field
        v-model="name"
        class="snap-name"
        density="compact"
        placeholder="Name, e.g. Before the 2.9.30 update"
        aria-label="Snapshot name"
        data-testid="snap-name"
        @keyup.enter="name.trim() && create()"
      />
      <v-btn-toggle v-model="scope" mandatory density="comfortable" variant="outlined" divided>
        <v-btn
          value="aircraft"
          size="small"
          :disabled="!canSnapshotAircraft"
          data-testid="snap-scope-aircraft"
        >
          {{ aircraft?.name ?? 'This aircraft' }}
        </v-btn>
        <v-btn value="all" size="small" data-testid="snap-scope-all">All aircraft</v-btn>
      </v-btn-toggle>
      <v-btn color="primary" :disabled="!name.trim()" data-testid="snap-create" @click="create">
        Take snapshot
      </v-btn>
    </div>

    <div
      v-if="snapshots && snapshots.length === 0"
      class="rr-panel rr-empty"
      data-testid="snap-empty"
    >
      No snapshots yet.
    </div>
    <div v-else-if="snapshots" class="rr-panel">
      <div
        v-for="snapshot in snapshots"
        :key="snapshot.id"
        class="rr-row"
        data-testid="snap-row"
        :data-name="snapshot.name"
      >
        <v-icon icon="mdi-camera-outline" class="rr-muted" />
        <div v-if="renaming?.id === snapshot.id" class="rr-row-main snap-inline">
          <v-text-field
            v-model="renaming.name"
            density="compact"
            aria-label="Snapshot name"
            data-testid="snap-rename-input"
            @keyup.enter="rename"
          />
          <v-btn size="small" color="primary" data-testid="snap-rename-save" @click="rename">
            Save
          </v-btn>
          <v-btn size="small" variant="text" @click="renaming = undefined">Cancel</v-btn>
        </div>
        <div v-else class="rr-row-main">
          <div class="rr-row-title">{{ snapshot.name }}</div>
          <div class="rr-row-sub" data-testid="snap-meta">
            {{ when(snapshot.createdAt) }} · {{ covers(snapshot) }} · {{ snapshot.files }} files,
            {{ size(snapshot.bytes) }} · {{ snapshot.devices.length }} devices · DCS
            {{ snapshot.dcsVersion }}
          </div>
        </div>
        <template v-if="renaming?.id !== snapshot.id">
          <v-btn
            size="small"
            variant="tonal"
            data-testid="snap-compare"
            @click="startCompare(snapshot)"
          >
            Compare
          </v-btn>
          <v-btn
            size="small"
            variant="tonal"
            data-testid="snap-restore"
            @click="restoring = { snapshot, remapIds: true }"
          >
            Restore
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            data-testid="snap-rename"
            @click="renaming = { id: snapshot.id, name: snapshot.name }"
          >
            Rename
          </v-btn>
          <v-btn size="small" variant="text" data-testid="snap-delete" @click="deleting = snapshot">
            Delete
          </v-btn>
        </template>
      </div>
    </div>

    <template v-if="compareLeft && comparison">
      <div class="snap-compare-head">
        <div class="rr-section-title">Snapshot "{{ compareLeft.name }}" compared with</div>
        <v-select
          v-model="compareRight"
          class="snap-compare-select"
          density="compact"
          :items="compareItems"
          aria-label="Compare with"
          data-testid="snap-compare-with"
        />
        <v-spacer />
        <v-btn size="small" variant="text" @click="comparison = undefined">Close</v-btn>
      </div>
      <div v-if="comparison.devices.length === 0" class="rr-panel rr-empty" data-testid="snap-same">
        No differences: {{ comparison.identical }} device
        {{ comparison.identical === 1 ? 'file is' : 'files are' }} the same.
      </div>
      <div
        v-for="device in comparison.devices"
        :key="device.folder + device.device"
        class="rr-panel snap-diff"
        data-testid="snap-diff"
        :data-device="device.device"
      >
        <div class="rr-row-title">{{ device.device }}</div>
        <div class="rr-row-sub">{{ device.folder }}</div>
        <div v-if="device.added.length > 0" class="snap-diff-list" data-testid="snap-added">
          <div class="snap-diff-title">
            Only in {{ comparison.right }} ({{ device.added.length }})
          </div>
          <div v-for="line in device.added.slice(0, 12)" :key="line">+ {{ line }}</div>
          <div v-if="device.added.length > 12" class="rr-muted">
            and {{ device.added.length - 12 }} more
          </div>
        </div>
        <div v-if="device.removed.length > 0" class="snap-diff-list" data-testid="snap-removed">
          <div class="snap-diff-title">
            Only in the snapshot "{{ comparison.left }}" ({{ device.removed.length }})
          </div>
          <div v-for="line in device.removed.slice(0, 12)" :key="line">− {{ line }}</div>
          <div v-if="device.removed.length > 12" class="rr-muted">
            and {{ device.removed.length - 12 }} more
          </div>
        </div>
        <div v-if="device.changed.length > 0" class="snap-diff-list" data-testid="snap-changed">
          <div class="snap-diff-title">Changed ({{ device.changed.length }})</div>
          <div v-for="line in device.changed" :key="line">~ {{ line }}</div>
        </div>
      </div>
      <div v-if="comparison.devices.length > 0" class="rr-row-sub">
        {{ comparison.identical }} other device
        {{ comparison.identical === 1 ? 'file is' : 'files are' }} the same. Devices are matched by
        name, so a changed device ID alone is not a difference.
      </div>
    </template>

    <v-dialog :model-value="restoring !== undefined" max-width="540" persistent>
      <v-card v-if="restoring" data-testid="snap-restore-dialog">
        <v-card-title>Restore "{{ restoring.snapshot.name }}"?</v-card-title>
        <v-card-text>
          <p>
            The binding files of {{ covers(restoring.snapshot) }} are put back as they were in the
            snapshot; files that were not in it are removed from those folders. You will see every
            file before anything is written.
          </p>
          <v-checkbox
            v-model="restoring.remapIds"
            label="Put files under the device IDs the attached devices have now"
            data-testid="snap-remap"
          />
          <div class="rr-row-sub">
            Leave this on unless you want the files exactly as stored. With it off, a file for a
            device whose ID has changed lands where DCS will not look.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="restoring = undefined">Cancel</v-btn>
          <v-btn color="primary" data-testid="snap-restore-preview" @click="restore">
            Show what will change
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="deleting !== undefined" max-width="460">
      <v-card v-if="deleting" data-testid="snap-delete-dialog">
        <v-card-title>Delete "{{ deleting.name }}"?</v-card-title>
        <v-card-text>
          The snapshot's {{ deleting.files }} files are removed from RigReady's folder. Your current
          bindings are not touched. This cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleting = undefined">Keep it</v-btn>
          <v-btn color="primary" data-testid="snap-delete-yes" @click="remove">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.snap-why {
  max-width: 820px;
  margin: 0 0 16px;
}
.snap-message {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 12px;
}
.snap-new {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  margin-bottom: 20px;
}
.snap-name {
  flex: 1;
}
.snap-inline {
  display: flex;
  align-items: center;
  gap: 8px;
}
.snap-compare-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0 10px;
}
.snap-compare-head .rr-section-title {
  margin: 0;
}
.snap-compare-select {
  flex: 0 0 300px;
}
.snap-diff {
  padding: 12px 16px;
  margin-bottom: 10px;
}
.snap-diff-list {
  margin-top: 8px;
  font-size: 13px;
}
.snap-diff-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--rr-muted);
  margin-bottom: 2px;
}
</style>
