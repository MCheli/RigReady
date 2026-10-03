<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import type { Rotation } from '../../../shared/models';
import {
  displaysContract,
  type DisplaysView,
  type LayoutMonitor,
  type LayoutView,
} from '../contract';
import { orientationText } from '../core/labels';
import MonitorMap from './MonitorMap.vue';

/** Changes a saved layout by hand: which monitors are on, the main one, rotation, position. */
const props = defineProps<{ layout: LayoutView | undefined }>();
const emit = defineEmits<{ close: []; saved: [view: DisplaysView] }>();

const api = useClient(displaysContract);
const rows = ref<LayoutMonitor[]>([]);
const error = ref<string>();
const saving = ref(false);

watch(
  () => props.layout,
  (layout) => {
    // A plain copy: the layout is reactive state, which structuredClone cannot copy.
    rows.value = layout ? (JSON.parse(JSON.stringify(layout.monitors)) as LayoutMonitor[]) : [];
    error.value = undefined;
  },
  { immediate: true }
);

const rotations = ([0, 90, 180, 270] as Rotation[]).map((r) => ({
  value: r,
  title: `${orientationText(r)} (${r}°)`,
}));

const primaryId = computed({
  get: () => rows.value.find((r) => r.enabled && r.primary)?.id,
  set: (id) => {
    for (const r of rows.value) r.primary = r.id === id;
  },
});

const sideways = (r: Rotation): boolean => r === 90 || r === 270;

function setRotation(row: LayoutMonitor, rotation: Rotation): void {
  // Turning a monitor a quarter turn swaps its desktop width and height.
  if (sideways(rotation) !== sideways(row.rotation)) {
    [row.width, row.height] = [row.height, row.width];
  }
  row.rotation = rotation;
}

function setNumber(row: LayoutMonitor, key: 'x' | 'y', value: string): void {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) row[key] = n;
}

async function save(): Promise<void> {
  if (!props.layout) return;
  saving.value = true;
  error.value = undefined;
  const result = await api.editLayout({
    id: props.layout.id,
    displays: rows.value.map((r) => ({
      id: r.id,
      name: r.name,
      enabled: r.enabled,
      primary: r.enabled && r.primary,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      rotation: r.rotation,
    })),
  });
  saving.value = false;
  if (result.ok) emit('saved', result.value);
  else error.value = errorText(result.error);
}
</script>

<template>
  <v-dialog :model-value="layout !== undefined" max-width="880" @update:model-value="emit('close')">
    <v-card v-if="layout" data-testid="edit-dialog">
      <v-card-title>Edit "{{ layout.name }}"</v-card-title>
      <v-card-text>
        <p class="rr-muted edit-hint">
          Positions are desktop pixels; the main display is always moved to 0,0 when the layout is
          applied. Monitors must touch, not overlap.
        </p>
        <div class="rr-panel edit-preview">
          <MonitorMap :monitors="rows" :max-height="180" compact />
        </div>
        <div class="edit-table">
          <div class="edit-head">
            <span>Monitor</span><span>On</span><span>Main</span><span>Orientation</span>
            <span>X</span><span>Y</span>
          </div>
          <div
            v-for="row in rows"
            :key="row.id"
            class="edit-row"
            data-testid="edit-row"
            :data-label="row.label"
          >
            <div class="edit-name">
              <div>{{ row.label }}</div>
              <div class="rr-row-sub">
                {{ row.width }}x{{ row.height
                }}<template v-if="!row.connected"> · not connected</template>
              </div>
            </div>
            <v-switch
              v-model="row.enabled"
              density="compact"
              hide-details
              :aria-label="`${row.label} on`"
              data-testid="edit-enabled"
            />
            <v-radio-group
              v-model="primaryId"
              density="compact"
              hide-details
              :disabled="!row.enabled"
            >
              <v-radio :value="row.id" :aria-label="`${row.label} is the main display`" />
            </v-radio-group>
            <v-select
              :model-value="row.rotation"
              :items="rotations"
              density="compact"
              hide-details
              :disabled="!row.enabled"
              :aria-label="`${row.label} orientation`"
              data-testid="edit-rotation"
              @update:model-value="setRotation(row, $event as Rotation)"
            />
            <v-text-field
              :model-value="row.x"
              type="number"
              density="compact"
              hide-details
              :disabled="!row.enabled"
              :aria-label="`${row.label} x`"
              data-testid="edit-x"
              @change="setNumber(row, 'x', ($event.target as HTMLInputElement).value)"
            />
            <v-text-field
              :model-value="row.y"
              type="number"
              density="compact"
              hide-details
              :disabled="!row.enabled"
              :aria-label="`${row.label} y`"
              data-testid="edit-y"
              @change="setNumber(row, 'y', ($event.target as HTMLInputElement).value)"
            />
          </div>
        </div>
        <v-alert v-if="error" type="error" variant="tonal" class="mt-3" data-testid="edit-error">
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close')">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          data-testid="edit-save"
          @click="save"
        >
          Save layout
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.edit-hint {
  font-size: 13px;
  margin: 0 0 12px;
}
.edit-preview {
  padding: 12px;
  margin-bottom: 12px;
}
.edit-head,
.edit-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) 56px 48px 200px 96px 96px;
  gap: 10px;
  align-items: center;
}
.edit-head {
  font-size: 12px;
  color: var(--rr-muted);
  padding: 0 0 4px;
}
.edit-row {
  padding: 4px 0;
  border-top: 1px solid var(--rr-border);
}
.edit-name {
  min-width: 0;
  font-size: 13.5px;
}
</style>
