<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import { backupContract, type ChangesViewData, type Overview } from '../contract';
import DiffView from './DiffView.vue';
import { ALWAYS, plural, when } from './format';

const emit = defineEmits<{ showTracked: [] }>();
const api = useClient(backupContract);
const view = ref<Overview>();
const profileId = ref<string>();
const changes = ref<ChangesViewData>();
const error = ref<string>();
const marking = ref(false);

const setups = computed(() => (view.value?.scopes ?? []).filter((s) => s.id !== ALWAYS));

async function loadChanges(): Promise<void> {
  if (!profileId.value) return;
  const result = await api.changes({ profileId: profileId.value });
  if (result.ok) {
    changes.value = result.value;
    error.value = undefined;
  } else error.value = errorText(result.error);
}

async function load(): Promise<void> {
  const overview = await api.overview();
  if (!overview.ok) {
    error.value = errorText(overview.error);
    return;
  }
  view.value = overview.value;
  if (!profileId.value || !setups.value.some((s) => s.id === profileId.value)) {
    profileId.value = setups.value[0]?.id;
  }
  await loadChanges();
}

let offRecorded: (() => void) | undefined;
let offMachine: (() => void) | undefined;
onMounted(() => {
  void load();
  offRecorded = api.on('recorded', (p) => {
    if (p.profileId === profileId.value) void loadChanges();
  });
  offMachine = onMachineChanged(() => void loadChanges());
});
onBeforeUnmount(() => {
  offRecorded?.();
  offMachine?.();
});
watch(profileId, () => {
  changes.value = undefined;
  void loadChanges();
});

async function markWorking(): Promise<void> {
  if (!profileId.value) return;
  marking.value = true;
  const result = await api.markWorking({ profileId: profileId.value });
  marking.value = false;
  if (result.ok) changes.value = result.value;
  else error.value = errorText(result.error);
}
</script>

<template>
  <div data-testid="changes-tab">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" data-testid="changes-error">
      {{ error }}
    </v-alert>

    <EmptyState
      v-if="view && setups.length === 0"
      art="setup"
      title="Create a setup first"
      data-testid="changes-no-setups"
    >
      Each time its game starts, RigReady records its tracked files, so when something stops working
      you can see exactly what changed since.
      <template #action>
        <v-btn color="primary" prepend-icon="mdi-camera-iris" to="/configure/profiles/capture">
          New setup from this rig
        </v-btn>
      </template>
    </EmptyState>

    <template v-else-if="view">
      <v-chip-group v-model="profileId" mandatory selected-class="scope-selected" class="mb-3">
        <v-chip
          v-for="s in setups"
          :key="s.id"
          :value="s.id"
          variant="outlined"
          :data-testid="`changes-setup-${s.id}`"
        >
          {{ s.name }}
        </v-chip>
      </v-chip-group>

      <div v-if="changes" class="rr-panel known" data-testid="changes-known">
        <div class="rr-row-main">
          <template v-if="changes.trackedItems === 0">
            <div class="rr-row-title">Nothing is tracked for this setup</div>
            <div class="rr-row-sub">
              Add its bindings and settings in
              <a href="#" @click.prevent="emit('showTracked')">Tracked files</a> first.
            </div>
          </template>
          <template v-else-if="changes.knownGood">
            <div class="rr-row-title" data-testid="changes-known-title">
              Last worked {{ when(changes.knownGood.time) }}
            </div>
            <div class="rr-row-sub">
              {{ changes.knownGood.reason }} · {{ plural(changes.knownGood.fileCount, 'file') }}
              recorded. Recorded again each time the game starts.
            </div>
          </template>
          <template v-else>
            <div class="rr-row-title" data-testid="changes-never">Not recorded yet</div>
            <div class="rr-row-sub">
              RigReady records the tracked files the next time this game starts. If everything works
              right now, record them now.
            </div>
          </template>
        </div>
        <v-btn
          v-if="changes.trackedItems > 0"
          variant="tonal"
          prepend-icon="mdi-check-decagram-outline"
          :loading="marking"
          data-testid="changes-mark"
          @click="markWorking"
        >
          It works now
        </v-btn>
      </div>

      <template v-if="changes?.comparison">
        <h2 class="rr-section-title section-gap">Changed since it last worked</h2>
        <DiffView
          :comparison="changes.comparison"
          empty-text="Nothing changed: every tracked file is exactly as it was when it last worked."
        />
      </template>
    </template>
  </div>
</template>

<style scoped>
.known {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
}
:deep(.scope-selected) {
  background: var(--rr-surface-2);
  border-color: var(--rr-accent) !important;
}
</style>
