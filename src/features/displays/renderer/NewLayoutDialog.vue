<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { displaysContract, type DisplaysView, type MonitorView } from '../contract';
import { keepOnly } from '../core/arrange';
import MonitorMap from './MonitorMap.vue';
import type { MapMonitor } from './mapTypes';

/**
 * A new layout that starts from which monitors stay on: tick them, name it, save. The
 * others are saved as off, which is what makes applying the layout switch them off. The
 * monitors themselves are not touched here.
 *
 * The drawing shows the layout as it will be saved (the same arithmetic the save uses),
 * in a box of fixed height, so ticking a monitor moves nothing else in the dialog.
 */
const props = defineProps<{ open: boolean; monitors: MonitorView[] }>();
const emit = defineEmits<{ close: []; saved: [view: DisplaysView, name: string] }>();

const api = useClient(displaysContract);
const name = ref('');
const stayOn = ref<string[]>([]);
const error = ref<string>();
const saving = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    name.value = '';
    error.value = undefined;
    // Start from the monitors as they are: every one that is on stays on.
    stayOn.value = props.monitors.filter((m) => m.enabled).map((m) => m.id);
  },
  { immediate: true }
);

/** The layout as it would be saved: the ticked monitors closed up, the others off. */
const preview = computed<MapMonitor[]>(() => {
  const labels = new Map(props.monitors.map((m) => [m.id.toLowerCase(), m.label]));
  return keepOnly(
    props.monitors.map((m) => ({
      id: m.id,
      name: m.name,
      enabled: m.enabled,
      primary: m.primary,
      x: m.x,
      y: m.y,
      width: m.width,
      height: m.height,
      rotation: m.rotation,
    })),
    stayOn.value
  ).map((t) => ({
    id: t.id,
    label: labels.get(t.id.toLowerCase()) ?? t.name,
    enabled: t.enabled,
    primary: t.primary,
    x: t.x,
    y: t.y,
    width: t.width ?? 0,
    height: t.height ?? 0,
    rotation: t.rotation,
  }));
});

const offCount = computed(() => props.monitors.length - stayOn.value.length);
const canSave = computed(() => name.value.trim() !== '' && stayOn.value.length > 0);

async function save(): Promise<void> {
  const value = name.value.trim();
  if (!value || stayOn.value.length === 0) return;
  saving.value = true;
  error.value = undefined;
  const result = await api.newLayout({ name: value, stayOn: stayOn.value });
  saving.value = false;
  if (result.ok) emit('saved', result.value, value);
  else error.value = errorText(result.error);
}
</script>

<template>
  <v-dialog :model-value="open" max-width="560" @update:model-value="emit('close')">
    <v-card data-testid="layout-new-dialog">
      <v-card-title>New layout</v-card-title>
      <v-card-text>
        <p class="rr-muted new-hint">
          Tick the monitors that stay on. The others are saved as off, so applying this layout
          switches them off. Nothing changes on the monitors until you apply it.
        </p>
        <div class="rr-panel new-preview" data-testid="layout-new-preview">
          <MonitorMap :monitors="preview" :max-height="120" compact />
        </div>
        <div class="new-list">
          <div
            v-for="m in monitors"
            :key="m.id"
            class="new-row"
            data-testid="layout-new-row"
            :data-label="m.label"
          >
            <v-checkbox
              v-model="stayOn"
              :value="m.id"
              :disabled="!m.enabled"
              density="compact"
              hide-details
              :aria-label="`${m.label} stays on`"
              data-testid="layout-new-monitor"
            />
            <div class="new-name">
              <div>
                {{ m.label }}
                <span v-if="m.primary" class="rr-muted"> · main display</span>
              </div>
              <div v-if="m.enabled" class="rr-row-sub">{{ m.width }}x{{ m.height }}</div>
              <div v-else class="rr-row-sub" data-testid="layout-new-off">
                Off now, so it is saved as off. To keep it on in a layout, switch it on in Windows
                first.
              </div>
            </div>
          </div>
        </div>
        <p class="new-count rr-muted" data-testid="layout-new-count" aria-live="polite">
          <template v-if="stayOn.length === 0">Tick at least one monitor.</template>
          <template v-else>
            {{ stayOn.length }} on, {{ offCount }} off{{
              offCount === 0 ? ': the same as saving the monitors as they are now' : ''
            }}.
          </template>
        </p>
        <v-text-field
          v-model="name"
          label="Layout name"
          placeholder="e.g. Ultrawide only"
          hide-details
          data-testid="layout-new-name"
          @keyup.enter="save"
        />
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mt-3"
          data-testid="layout-new-error"
        >
          {{ error }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="layout-new-cancel" @click="emit('close')">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!canSave"
          :loading="saving"
          data-testid="layout-new-save"
          @click="save"
        >
          Save layout
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.new-hint {
  font-size: 13px;
  margin: 0 0 12px;
}
/* A fixed height, whatever is ticked: the list and the buttons below never move. */
.new-preview {
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 196px;
  padding: 12px;
  margin-bottom: 8px;
  overflow: auto;
}
.new-preview > * {
  width: 100%;
}
.new-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
  border-top: 1px solid var(--rr-border);
}
.new-row:first-child {
  border-top: 0;
}
.new-row :deep(.v-checkbox) {
  flex: 0 0 auto;
}
.new-name {
  min-width: 0;
  font-size: 13.5px;
}
.new-count {
  min-height: 20px;
  margin: 8px 0 12px;
  font-size: 13px;
}
</style>
