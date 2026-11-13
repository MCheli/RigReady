<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { profilesContract, type PathVariableChoice, type PickerInfo } from '../contract';
import { variableSubtitle, withVariable } from './insertVariable';
import { applyChoice, formRows, requiredKeys, type Followed } from './pickerForm';
import { optionTitle, type Field } from './schemaForm';

const props = defineProps<{
  schema: Record<string, unknown> | undefined;
  modelValue: Record<string, unknown>;
  /** Prefix for data-testid of each control: `${testid}-${key}`. */
  testid: string;
  /** The path variables a path field may start with (from the pickers); without them no Variables menu. */
  variables?: PathVariableChoice[] | undefined;
  /** Fields chosen by name from a list; what such a choice fills in is not asked for. */
  pickers?: PickerInfo[] | undefined;
  /** The fields a fix takes from its check: said in one line, not asked for again. */
  follows?: Followed | undefined;
}>();
const emit = defineEmits<{ 'update:modelValue': [Record<string, unknown>] }>();

const api = useClient(profilesContract);
const required = computed(() => requiredKeys(props.schema));
/**
 * What is asked for, each field with its list when it is chosen from one. Not asked for:
 * what a list fills in by itself, and what a fix takes from its check.
 */
const rows = computed(() => formRows(props.schema, props.modelValue, props.pickers, props.follows));
const fields = computed(() => rows.value.map((row) => row.field));
const NOTE_TONE = { muted: '', warn: 'rr-warn', bad: 'rr-bad' } as const;
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

/** A choice from a list: the field, and everything the choice fills in. */
function choose(info: PickerInfo, value: string | null): void {
  emit('update:modelValue', applyChoice(props.modelValue, info, value, required.value));
}

/** Tick boxes keep the order the type lists its options in. */
function toggleOption(field: Field, option: string, on: boolean): void {
  const ticked = new Set(list(field.key));
  if (on) ticked.add(option);
  else ticked.delete(option);
  const next = (field.options ?? []).filter((o) => ticked.has(o));
  set(field.key, next.length > 0 ? next : undefined);
}

function group(key: string): Record<string, unknown> {
  const value = props.modelValue[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function setGroup(key: string, value: Record<string, unknown>): void {
  set(key, Object.keys(value).length > 0 ? value : undefined);
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

/** The Variables menu: the field's path said through the chosen variable. */
function insertVariable(field: Field, variable: PathVariableChoice): void {
  set(
    field.key,
    withVariable(asText(props.modelValue[field.key]), variable, props.variables ?? [])
  );
}
</script>

<template>
  <div class="params" :data-testid="testid">
    <v-alert v-if="browseError" type="error" variant="tonal" density="compact">{{
      browseError
    }}</v-alert>
    <div v-if="follows" class="rr-row-sub" :data-testid="`${testid}-follows`">
      Uses the {{ follows.label }} chosen above.
    </div>
    <div v-else-if="fields.length === 0" class="rr-row-sub">Nothing to set.</div>
    <template v-for="{ field, pick } in rows" :key="field.key">
      <div v-if="pick" class="params-picker">
        <v-select
          :model-value="asText(modelValue[field.key] ?? field.default) || null"
          :items="pick.items"
          item-props
          :label="pick.info.label + (pick.required ? ' *' : '')"
          :clearable="!pick.required && modelValue[field.key] !== undefined"
          :no-data-text="pick.info.empty"
          density="compact"
          hide-details
          :data-testid="`${testid}-${field.key}`"
          @update:model-value="choose(pick.info, $event)"
        />
        <div
          v-if="pick.note"
          class="rr-row-sub params-hint params-note"
          :class="NOTE_TONE[pick.note.tone]"
          :data-testid="`${testid}-${field.key}-note`"
        >
          {{ pick.note.text }}
        </div>
      </div>
      <div v-else-if="field.kind === 'boolean'" class="params-switch">
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
        :items="(field.options ?? []).map((o) => ({ title: optionTitle(field, o), value: o }))"
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
          <v-menu v-if="variables && variables.length > 0">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                size="small"
                variant="text"
                :aria-label="`Start ${field.label} with a path variable`"
                :data-testid="`${testid}-${field.key}-variables`"
                >Variables</v-btn
              >
            </template>
            <v-list density="compact" max-height="380" class="params-variables">
              <v-list-subheader>Start the path with</v-list-subheader>
              <v-list-item
                v-for="variable in variables"
                :key="variable.name"
                :title="`{${variable.name}}`"
                :subtitle="variableSubtitle(variable)"
                :data-testid="`${testid}-${field.key}-variable-${variable.name}`"
                @click="insertVariable(field, variable)"
              />
            </v-list>
          </v-menu>
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
        v-else-if="field.kind === 'multiChoice'"
        class="params-list"
        :data-testid="`${testid}-${field.key}`"
      >
        <div class="rr-row-sub">{{ field.label }}{{ field.required ? ' *' : '' }}</div>
        <v-checkbox
          v-for="option in field.options"
          :key="option"
          :model-value="list(field.key).includes(option)"
          :label="optionTitle(field, option)"
          color="primary"
          density="compact"
          hide-details
          :data-testid="`${testid}-${field.key}-${option}`"
          @update:model-value="toggleOption(field, option, $event === true)"
        />
      </div>
      <div v-else-if="field.kind === 'group'" class="params-group">
        <div class="rr-row-sub">{{ field.label }}{{ field.required ? ' *' : '' }}</div>
        <ParamsForm
          :schema="field.schema"
          :model-value="group(field.key)"
          :testid="`${testid}-${field.key}`"
          @update:model-value="setGroup(field.key, $event)"
        />
      </div>
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
.params-note {
  margin-top: 4px;
}
.params-group :deep(.params) {
  grid-template-columns: 1fr 1fr;
  margin: 6px 0 0;
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
.params-variables :deep(.v-list-item-title) {
  font-family: var(--rr-font-mono);
}
.rr-mono-input :deep(input),
.rr-mono-input :deep(textarea) {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12.5px;
}
</style>
