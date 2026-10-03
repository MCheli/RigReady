<script setup lang="ts">
import { computed } from 'vue';
import type { LaunchAction } from '../../../core/profile/schema';
import type { RemediationTypeInfo } from '../contract';
import ParamsForm from './ParamsForm.vue';
import { defaultsOf } from './schemaForm';

const props = defineProps<{
  action: LaunchAction;
  phase: 'preLaunch' | 'postLaunch' | 'standDown';
  remediations: RemediationTypeInfo[];
  index: number;
  count: number;
  problems: string[];
}>();
const emit = defineEmits<{ 'update:action': [LaunchAction]; move: [number]; remove: [] }>();

const types = computed(() =>
  props.remediations
    .filter((r) => r.kind === 'action')
    .map((r) => ({ title: r.label, value: r.type }))
);
const type = computed(() => props.remediations.find((r) => r.type === props.action.type));
const isScript = computed(() => props.action.type === 'script.run');
const isProgram = computed(() => props.action.type === 'process.launch');
/** Options the action itself carries; the type's own params form leaves these out. */
const OWN = ['waitForCompletion', 'hidden', 'timeoutSeconds'];
const schema = computed(() => {
  const s = type.value?.schema;
  if (!s) return s;
  const properties = { ...((s['properties'] ?? {}) as Record<string, unknown>) };
  for (const key of OWN) delete properties[key];
  return { ...s, properties };
});

function update(patch: Partial<LaunchAction>): void {
  const next = { ...props.action, ...patch };
  for (const key of Object.keys(patch) as (keyof LaunchAction)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  emit('update:action', next);
}

function setType(value: string): void {
  const label = props.remediations.find((r) => r.type === value)?.label ?? value;
  update({
    type: value,
    params: defaultsOf(props.remediations.find((r) => r.type === value)?.schema),
    ...(props.action.title.startsWith('New ') ? { title: label } : {}),
  });
}

function setNumber(key: 'timeoutSeconds' | 'delaySeconds', raw: string): void {
  const n = Number(raw);
  update({ [key]: raw.trim() === '' || !Number.isFinite(n) ? undefined : Math.round(n) });
}
</script>

<template>
  <div
    class="action rr-row"
    data-testid="edit-action"
    :data-title="action.title"
    :data-phase="phase"
  >
    <div class="action-move">
      <v-btn
        icon="mdi-chevron-up"
        size="x-small"
        variant="text"
        :disabled="index === 0"
        aria-label="Move up"
        @click="emit('move', -1)"
      />
      <v-btn
        icon="mdi-chevron-down"
        size="x-small"
        variant="text"
        :disabled="index === count - 1"
        aria-label="Move down"
        @click="emit('move', 1)"
      />
    </div>
    <div class="rr-row-main">
      <div class="action-grid">
        <v-text-field
          :model-value="action.title"
          label="Name"
          density="compact"
          data-testid="edit-action-title"
          @update:model-value="update({ title: $event })"
        />
        <v-select
          :model-value="action.type"
          :items="types"
          label="What it does"
          density="compact"
          data-testid="edit-action-type"
          @update:model-value="setType($event)"
        />
      </div>
      <ParamsForm
        :schema="schema"
        :model-value="action.params"
        testid="edit-action-params"
        @update:model-value="update({ params: $event })"
      />
      <div class="action-options">
        <v-switch
          :model-value="action.continueOnError"
          label="Go on if it fails"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-action-continue"
          @update:model-value="update({ continueOnError: $event ?? true })"
        />
        <v-switch
          v-if="isScript || isProgram"
          :model-value="action.waitForCompletion ?? isScript"
          label="Wait until it finishes"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-action-wait"
          @update:model-value="update({ waitForCompletion: $event ?? undefined })"
        />
        <v-switch
          v-if="isScript"
          :model-value="action.hidden ?? true"
          label="No console window"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-action-hidden"
          @update:model-value="update({ hidden: $event ?? undefined })"
        />
        <v-switch
          v-if="isProgram"
          :model-value="action.closeOnStandDown ?? true"
          label="Close it at Stand down"
          color="primary"
          density="compact"
          hide-details
          data-testid="edit-action-close"
          @update:model-value="update({ closeOnStandDown: $event ?? undefined })"
        />
      </div>
      <div class="action-grid">
        <v-text-field
          :model-value="action.timeoutSeconds ?? ''"
          label="Timeout (seconds)"
          placeholder="30"
          type="number"
          density="compact"
          data-testid="edit-action-timeout"
          @update:model-value="setNumber('timeoutSeconds', $event)"
        />
        <v-text-field
          v-if="phase === 'postLaunch'"
          :model-value="action.delaySeconds || ''"
          label="Seconds after the game starts"
          placeholder="0"
          type="number"
          density="compact"
          data-testid="edit-action-delay"
          @update:model-value="setNumber('delaySeconds', $event)"
        />
      </div>
      <ul v-if="problems.length" class="action-problems rr-bad">
        <li v-for="line in problems" :key="line">{{ line }}</li>
      </ul>
    </div>
    <v-btn
      icon="mdi-delete-outline"
      variant="text"
      size="small"
      :aria-label="`Remove ${action.title}`"
      data-testid="edit-action-remove"
      @click="emit('remove')"
    />
  </div>
</template>

<style scoped>
.action {
  align-items: flex-start;
}
.action-move {
  display: flex;
  flex-direction: column;
}
.action-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.action-options {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
  margin: 2px 0 10px;
}
.action-problems {
  margin: 0 0 6px 18px;
  font-size: 12.5px;
}
</style>
