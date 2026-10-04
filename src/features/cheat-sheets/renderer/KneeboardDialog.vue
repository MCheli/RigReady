<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { z } from 'zod';
import { errorText } from '../../../renderer/ipc';
import { notifyMachineChanged } from '../../../renderer/machine';
import type { KneeboardStatusSchema } from '../contract';
import { useCheatSheets } from './store';

/**
 * Export the sheet as DCS kneeboard pages: which devices, the day or the night style,
 * with a preview of exactly the page that will be written.
 */
const emit = defineEmits<{ close: [] }>();
const store = useCheatSheets();

type Status = z.infer<typeof KneeboardStatusSchema>;

const devices = computed(() => store.sheet?.devices ?? []);
const chosen = ref<string[]>(devices.value.filter((d) => d.counts.bound > 0).map((d) => d.key));
const style = ref<'light' | 'night' | 'both'>('light');
const summary = ref(true);
const lists = ref(false);
const status = ref<Status>();
const busy = ref(false);
const error = ref('');
const done = ref<{ folder: string; written: string[]; removed: string[]; kept: string[] }>();
const removedNote = ref('');

const previewDevice = ref(store.device?.key ?? '');
const previewStyle = ref<'light' | 'night'>('light');
const preview = ref('');
const previewBusy = ref(false);

const ref_ = computed(() => ({ game: store.game, aircraftId: store.aircraftId }));

async function loadStatus(): Promise<void> {
  const result = await store.api.kneeboardStatus(ref_.value);
  if (result.ok) status.value = result.value;
  else error.value = errorText(result.error);
}

let previewRun = 0;
async function loadPreview(): Promise<void> {
  const run = ++previewRun;
  previewBusy.value = true;
  const result = await store.api.kneeboardPreview({
    ...ref_.value,
    ...(previewDevice.value ? { deviceKey: previewDevice.value } : {}),
    style: previewStyle.value,
  });
  if (run !== previewRun) return;
  previewBusy.value = false;
  if (result.ok) preview.value = result.value.image;
  else error.value = errorText(result.error);
}

const options = computed(() => ({
  devices: chosen.value,
  styles: style.value === 'both' ? (['light', 'night'] as const) : [style.value],
  summary: summary.value,
  lists: lists.value,
}));

async function exportPages(): Promise<void> {
  busy.value = true;
  error.value = '';
  done.value = undefined;
  removedNote.value = '';
  const result = await store.api.exportKneeboard({
    ...ref_.value,
    options: { ...options.value, styles: [...options.value.styles] },
  });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  done.value = result.value;
  notifyMachineChanged();
  await loadStatus();
}

async function removePages(): Promise<void> {
  busy.value = true;
  error.value = '';
  done.value = undefined;
  const result = await store.api.removeKneeboard(ref_.value);
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const { removed, kept } = result.value;
  removedNote.value =
    `Removed ${removed.length} page${removed.length === 1 ? '' : 's'}.` +
    (kept.length ? ` Left ${kept.length} that changed since RigReady wrote them.` : '');
  notifyMachineChanged();
  await loadStatus();
}

watch(style, (value) => {
  if (value !== 'both') previewStyle.value = value;
});
watch([previewDevice, previewStyle], () => void loadPreview());

onMounted(async () => {
  await loadStatus();
  const last = status.value?.options;
  if (last) {
    if (last.devices.length > 0) chosen.value = last.devices;
    style.value = last.styles.length > 1 ? 'both' : (last.styles[0] ?? 'light');
    summary.value = last.summary;
    lists.value = last.lists;
  }
  await loadPreview();
});
</script>

<template>
  <v-dialog :model-value="true" max-width="980" @update:model-value="emit('close')">
    <v-card data-testid="kneeboard-dialog">
      <v-card-title>Kneeboard pages for {{ store.sheet?.aircraft.name }}</v-card-title>
      <v-card-text class="kb">
        <div class="kb-options">
          <div
            v-if="status"
            class="kb-status rr-panel"
            data-testid="kneeboard-status"
            :data-state="status.state"
          >
            <v-icon
              :icon="
                status.state === 'current'
                  ? 'mdi-check-circle'
                  : status.state === 'none'
                    ? 'mdi-notebook-outline'
                    : 'mdi-alert'
              "
              size="18"
              :class="
                status.state === 'current'
                  ? 'rr-ok'
                  : status.state === 'none'
                    ? 'rr-muted'
                    : 'rr-warn'
              "
            />
            <div>
              <div>{{ status.summary }}</div>
              <div v-if="status.folder" class="rr-row-sub rr-mono">{{ status.folder }}</div>
            </div>
          </div>

          <div class="rr-section-title mt-4">Pages</div>
          <div class="kb-devices">
            <v-checkbox
              v-for="d in devices"
              :key="d.key"
              v-model="chosen"
              :value="d.key"
              :label="`${d.title} (${d.counts.bound} bound)`"
              density="compact"
              hide-details
              data-testid="kneeboard-device"
              :data-key="d.key"
            />
          </div>
          <v-checkbox
            v-model="summary"
            label="First page: the most important actions"
            density="compact"
            hide-details
            data-testid="kneeboard-summary"
          />
          <v-checkbox
            v-model="lists"
            label="Large-print list pages after each device"
            density="compact"
            hide-details
            data-testid="kneeboard-lists"
          />

          <div class="rr-section-title mt-4">Style</div>
          <v-btn-toggle v-model="style" mandatory density="compact" variant="outlined" divided>
            <v-btn value="light" size="small" data-testid="kneeboard-style-light">Day</v-btn>
            <v-btn value="night" size="small" data-testid="kneeboard-style-night">Night</v-btn>
            <v-btn value="both" size="small" data-testid="kneeboard-style-both">Both</v-btn>
          </v-btn-toggle>
          <div class="rr-row-sub mt-1">
            Night is dark with dim red, for a dark cockpit. With both, the night pages come after
            the day pages.
          </div>
          <div class="rr-row-sub mt-3">
            RigReady only ever replaces or removes pages it wrote itself. Your own kneeboard pages
            are never touched, and every change can be undone on the Safety page. DCS loads new
            pages with the next mission.
          </div>

          <v-alert
            v-if="error"
            type="warning"
            variant="tonal"
            class="mt-3"
            data-testid="kneeboard-error"
          >
            {{ error }}
          </v-alert>
          <v-alert
            v-if="done"
            type="info"
            variant="tonal"
            class="mt-3"
            data-testid="kneeboard-done"
            :data-written="done.written.length"
          >
            Wrote {{ done.written.length }} page{{ done.written.length === 1 ? '' : 's' }} to
            {{ done.folder
            }}<span v-if="done.removed.length"
              >, removed {{ done.removed.length }} old one{{
                done.removed.length === 1 ? '' : 's'
              }}</span
            ><span v-if="done.kept.length"
              >. Left alone (not RigReady's, or changed since): {{ done.kept.join(', ') }}</span
            >.
          </v-alert>
          <v-alert
            v-if="removedNote"
            type="info"
            variant="tonal"
            class="mt-3"
            data-testid="kneeboard-removed"
          >
            {{ removedNote }}
          </v-alert>
        </div>

        <div class="kb-preview">
          <div class="kb-preview-bar">
            <v-select
              v-model="previewDevice"
              :items="[
                { title: 'Key actions (first page)', value: '' },
                ...devices.map((d) => ({ title: d.title, value: d.key })),
              ]"
              label="Preview"
              density="compact"
              variant="outlined"
              hide-details
              data-testid="kneeboard-preview-device"
            />
            <v-btn-toggle
              v-model="previewStyle"
              mandatory
              density="compact"
              variant="outlined"
              divided
            >
              <v-btn value="light" size="small" data-testid="kneeboard-preview-light">Day</v-btn>
              <v-btn value="night" size="small" data-testid="kneeboard-preview-night">Night</v-btn>
            </v-btn-toggle>
          </div>
          <div class="kb-page" :class="{ busy: previewBusy }">
            <img
              v-if="preview"
              :src="preview"
              alt="Kneeboard page preview"
              data-testid="kneeboard-preview"
              :data-style="previewStyle"
              :data-busy="previewBusy"
            />
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="status && status.state !== 'none'"
          variant="text"
          color="warning"
          :disabled="busy"
          data-testid="kneeboard-remove"
          @click="removePages"
          >Remove RigReady's pages</v-btn
        >
        <v-spacer />
        <v-btn variant="text" data-testid="kneeboard-close" @click="emit('close')">Close</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="busy"
          :disabled="chosen.length === 0 && !summary"
          data-testid="kneeboard-export"
          @click="exportPages"
          >{{
            status && status.state !== 'none' ? 'Write the pages again' : 'Export to kneeboard'
          }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.kb {
  display: flex;
  gap: 20px;
}
.kb-options {
  flex: 1;
  min-width: 0;
}
.kb-status {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  font-size: 13.5px;
}
.kb-devices {
  max-height: 220px;
  overflow-y: auto;
}
.kb-preview {
  width: 384px;
  flex-shrink: 0;
}
.kb-preview-bar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.kb-page {
  width: 384px;
  height: 512px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  overflow: hidden;
  background: #000;
  transition: opacity 0.15s;
}
.kb-page.busy {
  opacity: 0.6;
}
.kb-page img {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
