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
import { quarterTurned } from '../core/arrange';
import { orientationText } from '../core/labels';
import { joinNames } from '../core/plan';
import MonitorMap from './MonitorMap.vue';

/**
 * Changes a saved layout by hand: which monitors are on, the main one, rotation, position.
 *
 * Two things here are deliberate. A screen that is turned takes the screens next to it
 * along, so no gap is left where it got narrower. And nothing in the dialog changes size
 * or place while it is used: a number counts as it is typed (not when the field is left),
 * and the drawing has a fixed height. Otherwise the press that leaves a field would redraw
 * the dialog under the pointer, and the button being pressed would move away from it.
 */
const props = defineProps<{ layout: LayoutView | undefined }>();
const emit = defineEmits<{ close: []; saved: [view: DisplaysView] }>();

const api = useClient(displaysContract);
const rows = ref<LayoutMonitor[]>([]);
const error = ref<string>();
const saving = ref(false);
/** What turning a screen did to the ones next to it. */
const note = ref<string>();
/** What stands in an X or Y field while it is being typed in, by row and field. */
const typing = ref<Record<string, string>>({});

watch(
  () => props.layout,
  (layout) => {
    // A plain copy: the layout is reactive state, which structuredClone cannot copy.
    rows.value = layout ? (JSON.parse(JSON.stringify(layout.monitors)) as LayoutMonitor[]) : [];
    error.value = undefined;
    note.value = undefined;
    typing.value = {};
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
  note.value = undefined;
  const quarter = sideways(rotation) !== sideways(row.rotation);
  row.rotation = rotation;
  if (!quarter) return;
  // A quarter turn swaps the desktop width and height, and the screens next to this one
  // move with its edge so that they still touch it.
  const on = rows.value.filter((r) => r.enabled);
  const turned = quarterTurned(
    on.map((r) => ({ id: r.id, x: r.x, y: r.y, width: r.width, height: r.height })),
    row.id
  );
  for (const box of turned.boxes) {
    const target = on.find((r) => r.id === box.id);
    if (target) Object.assign(target, { x: box.x, y: box.y, width: box.width, height: box.height });
  }
  if (!turned.fitted) {
    note.value = `The screens next to ${row.label} could not be moved to make room. Set X and Y by hand.`;
    return;
  }
  const moved = on.filter((r) => turned.moved.includes(r.id)).map((r) => r.label);
  if (moved.length > 0) note.value = `Moved ${joinNames(moved)} to stay next to ${row.label}.`;
}

const field = (row: LayoutMonitor, key: 'x' | 'y'): string => `${row.id}:${key}`;
/** What an X or Y field shows: what is being typed, or else the number. */
const shown = (row: LayoutMonitor, key: 'x' | 'y'): string =>
  typing.value[field(row, key)] ?? String(row[key]);

/** A number counts as it is typed, so the drawing has it before any button is pressed. */
function setNumber(row: LayoutMonitor, key: 'x' | 'y', value: string): void {
  typing.value[field(row, key)] = value;
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) row[key] = n;
  note.value = undefined;
}

/** The field is left: it shows the number it stands for again (a half-typed "-" is gone). */
function leave(row: LayoutMonitor, key: 'x' | 'y'): void {
  delete typing.value[field(row, key)];
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
      // Kept as saved: the rate is not edited here.
      ...(r.refreshHz !== undefined ? { refreshHz: r.refreshHz } : {}),
    })),
  });
  saving.value = false;
  if (result.ok) emit('saved', result.value);
  else error.value = errorText(result.error);
}
</script>

<template>
  <!-- `scrollable`: with many monitors, or in a low window, the rows scroll and the buttons stay. -->
  <v-dialog
    :model-value="layout !== undefined"
    max-width="880"
    scrollable
    @update:model-value="emit('close')"
  >
    <v-card v-if="layout" data-testid="edit-dialog">
      <v-card-title>Edit "{{ layout.name }}"</v-card-title>
      <v-card-text>
        <p class="rr-muted edit-hint">
          Positions are desktop pixels; the main display is always moved to 0,0 when the layout is
          applied. Monitors must touch, not overlap. When you turn a screen, the screens next to it
          move with it.
        </p>
        <div class="rr-panel edit-preview">
          <MonitorMap :monitors="rows" :max-height="180" compact />
        </div>
        <p class="edit-note" data-testid="edit-note" aria-live="polite">{{ note }}</p>
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
              <div class="rr-row-sub" data-testid="edit-mode">
                {{ row.width }}x{{ row.height
                }}<template v-if="row.enabled && row.refreshHz"> · {{ row.refreshHz }} Hz</template
                ><template v-if="!row.connected"> · not connected</template>
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
              :model-value="shown(row, 'x')"
              type="number"
              density="compact"
              hide-details
              :disabled="!row.enabled"
              :aria-label="`${row.label} x`"
              data-testid="edit-x"
              @update:model-value="setNumber(row, 'x', String($event))"
              @blur="leave(row, 'x')"
            />
            <v-text-field
              :model-value="shown(row, 'y')"
              type="number"
              density="compact"
              hide-details
              :disabled="!row.enabled"
              :aria-label="`${row.label} y`"
              data-testid="edit-y"
              @update:model-value="setNumber(row, 'y', String($event))"
              @blur="leave(row, 'y')"
            />
          </div>
        </div>
      </v-card-text>
      <!-- Outside the part that scrolls: why a save was refused stays in view with the buttons. -->
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        class="edit-error"
        data-testid="edit-error"
      >
        {{ error }}
      </v-alert>
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
/* Between the rows and the buttons, at its own height: it neither stretches nor scrolls away. */
.edit-error {
  flex: none;
  margin: 4px 20px 0;
}
/* A fixed height, whatever is drawn: the rows and buttons below never move. */
.edit-preview {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 272px;
  padding: 12px;
  overflow: auto;
}
.edit-preview > * {
  width: 100%;
}
/* The line is always there, so a note coming or going moves nothing either. */
.edit-note {
  min-height: 20px;
  margin: 6px 0 8px;
  font-size: 13px;
  color: var(--rr-muted);
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
