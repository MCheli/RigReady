<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract } from '../contract';
import { fieldsOf, type Field } from './schemaForm';

const props = defineProps<{
  schema: Record<string, unknown> | undefined;
  modelValue: Record<string, unknown>;
  /** Prefix for data-testid of each control: `${testid}-${key}`. */
  testid: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>] }>();

const api = useClient(profilesContract);
const fields = computed(() => fieldsOf(props.schema));
const browseError = ref<string>();
/** JSON fields are edited as text and applied when they parse. */
const jsonText = ref<Record<string, string>>({});
const jsonError = ref<Record<string, string>>({});

watch(
  () => props.modelValue,
  (value) => {
    for (const field of fields.value) {
      if (field.kind !== 'json') continue;
      const text = value[field.key] === undefined ? '' : JSON.stringify(value[field.key], null, 2);
      if (!jsonError.value[field.key]) jsonText.value[field.key] = text;
    }
  },
  { immediate: true, deep: true }
);

function set(key: string, value: unknown): void {
  const next = { ...props.modelValue };
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  emit('update:modelValue', next);
}

function setNumber(field: Field, raw: string): void {
  if (raw.trim() === '') return set(field.key, undefined);
  const n = Number(raw);
  set(field.key, Number.isFinite(n) ? (field.integer ? Math.round(n) : n) : raw);
}

function list(key: string): string[] {
  const value = props.modelValue[key];
  return Array.isArray(value) ? value.map(String) : [];
}

function setList(key: string, items: string[]): void {
  set(key, items);
}

function setNumberList(key: string, raw: string): void {
  const numbers = raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  set(key, numbers.length > 0 ? numbers : undefined);
}

function setJson(key: string, text: string): void {
  jsonText.value[key] = text;
  if (text.trim() === '') {
    delete jsonError.value[key];
    return set(key, undefined);
  }
  try {
    const value: unknown = JSON.parse(text);
    delete jsonError.value[key];
    set(key, value);
  } catch {
    jsonError.value[key] = 'Not valid JSON yet';
  }
}

async function browse(field: Field): Promise<void> {
  browseError.value = undefined;
  const picked = await api.browse({ kind: field.browse!, title: field.label });
  if (!picked.ok) {
    browseError.value = errorText(picked.error);
    return;
  }
  if (picked.value.path) set(field.key, picked.value.path);
}

const asText = (value: unknown): string =>
  value === undefined || value === null ? '' : String(value);
</script>

<template>
  <div class="params" :data-testid="testid">
    <v-alert v-if="browseError" type="error" variant="tonal" density="compact">{{
      browseError
    }}</v-alert>
    <div v-if="fields.length === 0" class="rr-row-sub">Nothing to set.</div>
    <template v-for="field in fields" :key="field.key">
      <div v-if="field.kind === 'boolean'" class="params-switch">
        <v-switch
          :model-value="modelValue[field.key] ?? field.default ?? false"
          :label="field.label"
          color="primary"
          density="compact"
          hide-details
          :data-testid="`${testid}-${field.key}`"
          @update:model-value="set(field.key, $event)"
        />
        <div v-if="field.hint" class="rr-row-sub params-hint">{{ field.hint }}</div>
      </div>
      <v-select
        v-else-if="field.kind === 'choice'"
        :model-value="asText(modelValue[field.key] ?? field.default) || undefined"
        :items="field.options"
        :label="field.label + (field.required ? ' *' : '')"
        :clearable="!field.required"
        density="compact"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="set(field.key, $event ?? undefined)"
      />
      <v-textarea
        v-else-if="field.kind === 'longText'"
        :model-value="asText(modelValue[field.key])"
        :label="field.label + (field.required ? ' *' : '')"
        :hint="field.hint"
        persistent-hint
        rows="4"
        auto-grow
        density="compact"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="set(field.key, $event)"
      />
      <v-text-field
        v-else-if="field.kind === 'text'"
        :model-value="asText(modelValue[field.key])"
        :label="field.label + (field.required ? ' *' : '')"
        :hint="field.hint"
        :placeholder="field.default !== undefined ? String(field.default) : undefined"
        persistent-hint
        density="compact"
        :class="{ 'rr-mono-input': field.browse }"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="set(field.key, $event)"
      >
        <template v-if="field.browse" #append-inner>
          <v-btn
            size="small"
            variant="text"
            :data-testid="`${testid}-${field.key}-browse`"
            @click="browse(field)"
            >Browse…</v-btn
          >
        </template>
      </v-text-field>
      <v-text-field
        v-else-if="field.kind === 'number'"
        :model-value="asText(modelValue[field.key])"
        :label="field.label + (field.required ? ' *' : '')"
        :placeholder="field.default !== undefined ? String(field.default) : undefined"
        type="number"
        :min="field.min"
        :max="field.max"
        density="compact"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="setNumber(field, $event)"
      />
      <div
        v-else-if="field.kind === 'list'"
        class="params-list"
        :data-testid="`${testid}-${field.key}`"
      >
        <div class="params-list-head">
          <span class="rr-row-sub">{{ field.label }}</span>
          <v-btn
            size="x-small"
            variant="text"
            prepend-icon="mdi-plus"
            :data-testid="`${testid}-${field.key}-add`"
            @click="setList(field.key, [...list(field.key), ''])"
            >Add</v-btn
          >
        </div>
        <div v-for="(entry, i) in list(field.key)" :key="i" class="params-list-row">
          <v-text-field
            :model-value="entry"
            density="compact"
            hide-details
            class="rr-mono-input"
            :aria-label="`${field.label} ${i + 1}`"
            @update:model-value="
              setList(
                field.key,
                list(field.key).map((v, j) => (j === i ? $event : v))
              )
            "
          />
          <v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            :aria-label="`Remove ${field.label} ${i + 1}`"
            @click="
              setList(
                field.key,
                list(field.key).filter((_, j) => j !== i)
              )
            "
          />
        </div>
        <div v-if="list(field.key).length === 0" class="rr-row-sub">None</div>
        <div v-if="field.hint" class="rr-row-sub params-hint">{{ field.hint }}</div>
      </div>
      <v-text-field
        v-else-if="field.kind === 'numberList'"
        :model-value="
          (Array.isArray(modelValue[field.key])
            ? (modelValue[field.key] as number[])
            : ((field.default as number[] | undefined) ?? [])
          ).join(', ')
        "
        :label="field.label"
        hint="Separate with commas"
        persistent-hint
        density="compact"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="setNumberList(field.key, $event)"
      />
      <v-textarea
        v-else
        :model-value="jsonText[field.key] ?? ''"
        :label="`${field.label} (JSON)`"
        :error-messages="jsonError[field.key]"
        rows="4"
        auto-grow
        density="compact"
        class="rr-mono-input"
        :data-testid="`${testid}-${field.key}`"
        @update:model-value="setJson(field.key, $event)"
      />
    </template>
  </div>
</template>

<style scoped>
.params {
  display: grid;
  gap: 12px;
  margin-bottom: 8px;
}
.params-switch {
  margin-bottom: 6px;
}
.params-hint {
  margin-left: 2px;
}
.params-list {
  margin-bottom: 10px;
}
.params-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.params-list-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 4px;
}
.rr-mono-input :deep(input),
.rr-mono-input :deep(textarea) {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
}
</style>
