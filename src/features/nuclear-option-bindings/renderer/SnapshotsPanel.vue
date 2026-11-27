<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  nuclearOptionBindingsContract,
  type Snapshot,
  type SnapshotRestoreReview,
} from '../contract';

/**
 * Snapshots of Nuclear Option's bindings: named copies of everything the game saved, kept in
 * RigReady's own folder. Taking one only reads. Putting one back is shown first and written
 * only on "Restore" (through FileStore: a backup, the Safety page, Undo).
 */
const api = useClient(nuclearOptionBindingsContract);
const emit = defineEmits<{ restored: [message: string]; count: [snapshots: number] }>();

const snapshots = ref<Snapshot[]>([]);
const error = ref('');
const name = ref('');
const busy = ref(false);

async function load(): Promise<void> {
  const result = await api.snapshots();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = '';
  snapshots.value = result.value;
  emit('count', result.value.length);
}
onMounted(load);
defineExpose({ load });

async function take(): Promise<void> {
  const wanted = name.value.trim();
  if (!wanted || busy.value) return;
  busy.value = true;
  const result = await api.snapshotCreate({ name: wanted });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  name.value = '';
  await load();
}

// ---- Renaming and deleting, each asked for on its own row ----

const renaming = ref<{ id: string; name: string }>();
const deleting = ref<string>();

async function rename(): Promise<void> {
  const r = renaming.value;
  if (!r || !r.name.trim()) return;
  const result = await api.snapshotRename({ id: r.id, name: r.name.trim() });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  renaming.value = undefined;
  await load();
}

async function remove(id: string): Promise<void> {
  deleting.value = undefined;
  const result = await api.snapshotDelete({ id });
  await load();
  // Said after the list was read again, which clears what was said before.
  if (!result.ok) error.value = errorText(result.error);
}

// ---- Putting one back: the review first, and only its Restore writes ----

const restoring = ref<Snapshot>();
const review = ref<SnapshotRestoreReview>();
const reviewError = ref('');
const saving = ref(false);
let turn = 0;

async function startRestore(snapshot: Snapshot): Promise<void> {
  if (saving.value) return;
  // What an earlier restore said is no longer the news.
  emit('restored', '');
  const mine = ++turn;
  restoring.value = snapshot;
  review.value = undefined;
  reviewError.value = '';
  const result = await api.snapshotRestorePreview({ id: snapshot.id });
  if (mine !== turn) return;
  if (result.ok) review.value = result.value;
  else reviewError.value = errorText(result.error);
}
function closeRestore(): void {
  // While it is being written the dialog stays: what happens is said in it.
  if (saving.value) return;
  turn++;
  restoring.value = undefined;
  review.value = undefined;
  reviewError.value = '';
}
async function restore(): Promise<void> {
  if (!restoring.value || !review.value || saving.value) return;
  saving.value = true;
  const result = await api.snapshotRestore({ id: restoring.value.id, seen: review.value.seen });
  saving.value = false;
  if (!result.ok) {
    // Part of it may have been put back before the failure: the review shown is of bindings
    // that are no longer so, and is dropped.
    turn++;
    review.value = undefined;
    reviewError.value = errorText(result.error);
    emit('restored', '');
    return;
  }
  const message = result.value.message;
  closeRestore();
  emit('restored', message);
}

const when = (iso: string): string => new Date(iso).toLocaleString();
const listed = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
</script>

<template>
  <div class="rr-panel snap" data-testid="nuclear-option-snapshots">
    <p class="snap-lead">
      A snapshot keeps every binding the game has saved now: all controllers, the keyboard and the
      mouse. Take one before you change a lot, and put it back when you want those bindings again.
      RigReady keeps them in its own folder.
    </p>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-3"
      data-testid="nuclear-option-snapshots-error"
      >{{ error }}</v-alert
    >
    <form class="snap-new" @submit.prevent="take">
      <v-text-field
        v-model="name"
        label="Name for a new snapshot"
        density="compact"
        variant="outlined"
        hide-details
        maxlength="80"
        data-testid="nuclear-option-snapshots-name"
      />
      <v-btn
        type="submit"
        variant="tonal"
        prepend-icon="mdi-camera-outline"
        :disabled="!name.trim()"
        :loading="busy"
        data-testid="nuclear-option-snapshots-take"
        >Take a snapshot</v-btn
      >
    </form>

    <div
      v-if="snapshots.length === 0"
      class="rr-muted snap-none"
      data-testid="nuclear-option-snapshots-none"
    >
      No snapshot yet.
    </div>
    <div
      v-for="s in snapshots"
      :key="s.id"
      class="snap-row"
      data-testid="nuclear-option-snapshot"
      :data-name="s.name"
    >
      <div class="snap-main">
        <template v-if="renaming?.id === s.id">
          <form class="snap-new" @submit.prevent="rename">
            <v-text-field
              v-model="renaming.name"
              label="Name"
              density="compact"
              variant="outlined"
              hide-details
              autofocus
              maxlength="80"
              data-testid="nuclear-option-snapshot-new-name"
            />
            <v-btn
              type="submit"
              size="small"
              variant="tonal"
              data-testid="nuclear-option-snapshot-rename-save"
              >Save</v-btn
            >
            <v-btn size="small" variant="text" @click="renaming = undefined">Cancel</v-btn>
          </form>
        </template>
        <template v-else-if="s.damaged">
          <div class="rr-row-title">{{ s.name }}</div>
          <div class="rr-row-sub rr-warn" data-testid="nuclear-option-snapshot-damaged">
            This snapshot’s file is damaged, so RigReady does not use it. It can be deleted.
          </div>
        </template>
        <template v-else>
          <div class="rr-row-title">{{ s.name }}</div>
          <div class="rr-row-sub">
            {{ when(s.createdAt) }} · {{ s.bindings }} bindings on {{ listed(s.devices) }}
          </div>
        </template>
      </div>
      <template v-if="deleting === s.id">
        <span class="rr-muted">Delete this snapshot?</span>
        <v-btn
          size="small"
          variant="tonal"
          color="error"
          data-testid="nuclear-option-snapshot-delete-yes"
          @click="remove(s.id)"
          >Delete</v-btn
        >
        <v-btn size="small" variant="text" @click="deleting = undefined">Keep</v-btn>
      </template>
      <template v-else-if="renaming?.id !== s.id">
        <v-btn
          v-if="!s.damaged"
          size="small"
          variant="tonal"
          prepend-icon="mdi-restore"
          data-testid="nuclear-option-snapshot-restore"
          @click="startRestore(s)"
          >Restore…</v-btn
        >
        <v-btn
          v-if="!s.damaged"
          size="small"
          variant="text"
          data-testid="nuclear-option-snapshot-rename"
          @click="renaming = { id: s.id, name: s.name }"
          >Rename</v-btn
        >
        <v-btn
          size="small"
          variant="text"
          data-testid="nuclear-option-snapshot-delete"
          @click="deleting = s.id"
          >Delete</v-btn
        >
      </template>
    </div>

    <ConfirmChanges
      :open="restoring !== undefined"
      :title="`Put “${restoring?.name ?? ''}” back?`"
      confirm-text="Restore"
      :preview="review && !review.same ? review.preview : undefined"
      :error="reviewError"
      :busy="saving"
      :blocked="review?.blocked !== undefined"
      testid="nuclear-option-snapshot-restore-dialog"
      @cancel="closeRestore"
      @confirm="restore"
    >
      <div v-if="review" class="snap-review" data-testid="nuclear-option-snapshot-review">
        <div v-if="review.same" class="rr-muted">
          {{
            review.gone.length
              ? 'What the game still has saved bindings for is already as in this snapshot: nothing to restore.'
              : 'The bindings are already as they were in this snapshot: nothing to restore.'
          }}
        </div>
        <template v-else>
          <p>
            The bindings of {{ review.devices.length === 1 ? 'this device' : 'these devices' }} go
            back to what they were in the snapshot. Everything else stays as it is. The game reads
            it the next time it starts.
          </p>
          <table class="snap-table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">Bindings now</th>
                <th scope="col">In the snapshot</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="d in review.devices"
                :key="d.name"
                data-testid="nuclear-option-snapshot-device"
              >
                <td>
                  {{ d.name }}
                  <details
                    v-if="d.back.length + d.goes.length > 0"
                    class="snap-detail"
                    data-testid="nuclear-option-snapshot-detail"
                  >
                    <summary>
                      {{ d.back.length }} {{ d.back.length === 1 ? 'comes' : 'come' }} back,
                      {{ d.goes.length }} {{ d.goes.length === 1 ? 'goes' : 'go' }}
                    </summary>
                    <div v-for="(words, i) in d.back" :key="`b${i}`" class="snap-back">
                      + {{ words }}
                    </div>
                    <div v-for="(words, i) in d.goes" :key="`g${i}`" class="snap-goes">
                      − {{ words }}
                    </div>
                  </details>
                </td>
                <td>{{ d.now }}</td>
                <td>{{ d.then }}</td>
              </tr>
            </tbody>
          </table>
        </template>
        <div v-if="review.gone.length" class="snap-note" data-testid="nuclear-option-snapshot-gone">
          <v-icon icon="mdi-information-outline" size="small" class="rr-muted" />
          <span
            >Not put back: {{ listed(review.gone) }}. The game no longer has saved bindings for
            {{ review.gone.length === 1 ? 'it' : 'them' }} under the name the snapshot holds, and
            RigReady cannot make new ones. If the game has bindings for
            {{ review.gone.length === 1 ? 'it' : 'them' }} now, they are left as they are.</span
          >
        </div>
        <div
          v-if="review.newer.length"
          class="snap-note"
          data-testid="nuclear-option-snapshot-newer"
        >
          <v-icon icon="mdi-information-outline" size="small" class="rr-muted" />
          <span
            >Left as {{ review.newer.length === 1 ? 'it is' : 'they are' }}:
            {{ listed(review.newer) }}, which the snapshot does not hold.</span
          >
        </div>
        <div v-if="review.blocked" class="snap-note" data-testid="nuclear-option-snapshot-blocked">
          <v-icon icon="mdi-alert-outline" size="small" class="rr-warn" />
          <span>{{ review.blocked }}</span>
        </div>
      </div>
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.snap-detail {
  font-size: 13px;
  margin-top: 4px;
}
.snap-detail summary {
  cursor: pointer;
  color: var(--rr-muted);
}
.snap-back {
  color: var(--rr-ok);
}
.snap-goes {
  color: var(--rr-muted);
}
.snap {
  padding: 16px;
  margin-bottom: 16px;
}
.snap-lead {
  margin: 0 0 12px;
}
.snap-new {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
  flex: 1;
}
.snap-none {
  font-size: var(--rr-text-sm);
}
.snap-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-top: 1px solid var(--rr-border);
}
.snap-main {
  flex: 1;
  min-width: 0;
}
.snap-review {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}
.snap-review p {
  margin: 0;
}
.snap-table {
  width: 100%;
  border-collapse: collapse;
}
.snap-table th,
.snap-table td {
  text-align: left;
  padding: 4px 12px 4px 0;
}
.snap-table th {
  font-size: var(--rr-text-xs);
  color: var(--rr-text-2);
  font-weight: 600;
}
.snap-note {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
</style>
