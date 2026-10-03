<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CheckItem } from '../../../core/profile/schema';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  profilesContract,
  type CheckTypeInfo,
  type Pickers,
  type RemediationTypeInfo,
} from '../contract';
import ParamsForm from './ParamsForm.vue';
import { defaultsOf } from './schemaForm';

const props = defineProps<{
  item: CheckItem;
  checks: CheckTypeInfo[];
  remediations: RemediationTypeInfo[];
  pickers: Pickers | undefined;
  index: number;
  count: number;
  /** Lines of the last save error that concern this item. */
  problems: string[];
  open: boolean;
}>();
const emit = defineEmits<{
  'update:item': [CheckItem];
  move: [number];
  remove: [];
  toggle: [];
}>();

const api = useClient(profilesContract);
const prepared = ref<{ ok: boolean; message: string }>();
const preparing = ref(false);

const type = computed(() => props.checks.find((c) => c.type === props.item.type));
const fixTypes = computed(() => {
  const suited = type.value?.fixes;
  const list = props.remediations.filter((r) => !suited || suited.includes(r.type));
  return [{ title: 'No fix', value: '' }, ...list.map((r) => ({ title: r.label, value: r.type }))];
});
const fixType = computed(() =>
  props.remediations.find((r) => r.type === props.item.remediation?.type)
);

function update(patch: Partial<CheckItem>): void {
  const next = { ...props.item, ...patch };
  for (const key of Object.keys(patch) as (keyof CheckItem)[]) {
    if (patch[key] === undefined) delete next[key];
  }
  emit('update:item', next);
}

function setFixType(value: string): void {
  if (!value) return update({ remediation: undefined });
  const schema = props.remediations.find((r) => r.type === value)?.schema;
  update({ remediation: { type: value, params: defaultsOf(schema) } });
}

function setTimeout(raw: string): void {
  const n = Number(raw);
  update({ timeoutSeconds: raw.trim() === '' || !Number.isFinite(n) ? undefined : Math.round(n) });
}

async function prepare(): Promise<void> {
  if (!props.item.remediation) return;
  preparing.value = true;
  const done = await api.prepareFix(props.item.remediation);
  preparing.value = false;
  prepared.value = done.ok
    ? { ok: true, message: done.value.message }
    : { ok: false, message: errorText(done.error) };
}

// ---- "pick from this PC" helpers for the common types ----

function pickDevice(device: Pickers['devices'][number]): void {
  update({
    title: props.item.title === 'New check' ? device.name : props.item.title,
    params: {
      vendorId: device.vendorId,
      productId: device.productId,
      // Identical devices are told apart by serial, else by USB port.
      ...(device.hasTwin
        ? device.serial
          ? { serial: device.serial }
          : { instanceId: device.instanceId }
        : {}),
    },
  });
}

function pickProcess(process: Pickers['processes'][number]): void {
  update({
    title:
      props.item.title === 'New check' ? process.name.replace(/\.exe$/i, '') : props.item.title,
    params: { ...props.item.params, name: process.name },
    ...(process.path
      ? { remediation: { type: 'process.launch', params: { exe: process.path, args: [] } } }
      : {}),
  });
}

function pickService(service: Pickers['services'][number]): void {
  update({
    title: props.item.title === 'New check' ? service.displayName : props.item.title,
    params: { name: service.name },
  });
}
</script>

<template>
  <div class="item rr-row" data-testid="edit-check" :data-title="item.title" :data-type="item.type">
    <div class="item-move">
      <v-btn
        icon="mdi-chevron-up"
        size="x-small"
        variant="text"
        :disabled="index === 0"
        :aria-label="`Move ${item.title} up`"
        data-testid="edit-check-up"
        @click="emit('move', -1)"
      />
      <v-btn
        icon="mdi-chevron-down"
        size="x-small"
        variant="text"
        :disabled="index === count - 1"
        :aria-label="`Move ${item.title} down`"
        data-testid="edit-check-down"
        @click="emit('move', 1)"
      />
    </div>
    <div class="rr-row-main">
      <div class="item-head">
        <div class="item-head-text">
          <div class="rr-row-title">{{ item.title }}</div>
          <div class="rr-row-sub">
            {{ type?.label ?? `Unknown type ${item.type}` }}
            <template v-if="fixType"> · fix: {{ fixType.label.toLowerCase() }}</template>
          </div>
        </div>
        <v-btn-toggle
          :model-value="type?.advisory ? false : item.required"
          mandatory
          density="compact"
          variant="outlined"
          divided
          :disabled="type?.advisory"
          @update:model-value="update({ required: $event })"
        >
          <v-btn :value="true" size="small" data-testid="edit-required">Required</v-btn>
          <v-btn :value="false" size="small" data-testid="edit-optional">Optional</v-btn>
        </v-btn-toggle>
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="open ? 'mdi-chevron-up' : 'mdi-pencil-outline'"
          data-testid="edit-check-open"
          @click="emit('toggle')"
          >{{ open ? 'Done' : 'Edit' }}</v-btn
        >
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          size="small"
          :aria-label="`Remove ${item.title}`"
          data-testid="edit-check-remove"
          @click="emit('remove')"
        />
      </div>
      <ul v-if="problems.length" class="item-problems rr-bad" data-testid="edit-check-problems">
        <li v-for="line in problems" :key="line">{{ line }}</li>
      </ul>

      <div v-if="open" class="item-body">
        <v-alert v-if="type?.advisory" type="info" variant="tonal" density="compact" class="mb-3">
          This check only ever warns: it never makes the setup Not ready.
        </v-alert>
        <div class="item-grid">
          <v-text-field
            :model-value="item.title"
            label="Name shown in the checklist"
            density="compact"
            data-testid="edit-check-title"
            @update:model-value="update({ title: $event })"
          />
          <v-text-field
            :model-value="item.timeoutSeconds ?? ''"
            label="Timeout (seconds)"
            placeholder="From Settings"
            type="number"
            min="1"
            max="600"
            density="compact"
            data-testid="edit-check-timeout"
            @update:model-value="setTimeout($event)"
          />
        </div>

        <div v-if="pickers" class="item-pickers">
          <v-menu v-if="item.type === 'device.connected'" max-height="360">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                size="small"
                variant="tonal"
                prepend-icon="mdi-usb"
                data-testid="pick-device"
                >Pick a connected device</v-btn
              >
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="device in pickers.devices"
                :key="device.instanceId"
                :title="device.name"
                :subtitle="`${device.vendorId}:${device.productId}${device.serial ? ` · ${device.serial}` : ''}${device.hasTwin ? ' · identical device present' : ''}`"
                @click="pickDevice(device)"
              />
            </v-list>
          </v-menu>
          <v-menu v-if="item.type === 'process.running'" max-height="360">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                size="small"
                variant="tonal"
                prepend-icon="mdi-application-outline"
                data-testid="pick-process"
                >Pick a running app</v-btn
              >
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="p in pickers.processes"
                :key="p.name"
                :title="p.name"
                :subtitle="p.path"
                :data-testid="`pick-process-${p.name}`"
                @click="pickProcess(p)"
              />
            </v-list>
          </v-menu>
          <v-menu v-if="item.type === 'service.running'" max-height="360">
            <template #activator="{ props: menu }">
              <v-btn
                v-bind="menu"
                size="small"
                variant="tonal"
                prepend-icon="mdi-cog-outline"
                data-testid="pick-service"
                >Pick a service</v-btn
              >
            </template>
            <v-list density="compact">
              <v-list-item
                v-for="s in pickers.services"
                :key="s.name"
                :title="s.displayName"
                :subtitle="`${s.name} · ${s.state}`"
                @click="pickService(s)"
              />
            </v-list>
          </v-menu>
        </div>

        <div class="rr-section-title mt-2">What to check</div>
        <ParamsForm
          :schema="type?.schema"
          :model-value="item.params"
          testid="edit-params"
          @update:model-value="update({ params: $event })"
        />

        <div class="rr-section-title mt-4">Fix</div>
        <v-select
          :model-value="item.remediation?.type ?? ''"
          :items="fixTypes"
          label="What Make ready does when this is not met"
          density="compact"
          class="mb-3"
          data-testid="edit-fix-type"
          @update:model-value="setFixType($event)"
        />
        <template v-if="item.remediation">
          <v-alert v-if="!fixType" type="warning" variant="tonal" density="compact" class="mb-2">
            This version of RigReady has no fix of type {{ item.remediation.type }}; no fix button
            is shown.
          </v-alert>
          <ParamsForm
            v-else
            :schema="fixType.schema"
            :model-value="item.remediation.params"
            testid="edit-fix-params"
            @update:model-value="
              update({ remediation: { type: item.remediation!.type, params: $event } })
            "
          />
          <div v-if="fixType?.prepare" class="item-prepare">
            <v-btn
              size="small"
              variant="tonal"
              prepend-icon="mdi-content-save-outline"
              :loading="preparing"
              data-testid="edit-fix-prepare"
              @click="prepare"
              >{{ fixType.prepare }}</v-btn
            >
            <span
              v-if="prepared"
              class="rr-row-sub"
              :class="prepared.ok ? 'rr-ok' : 'rr-bad'"
              data-testid="edit-fix-prepared"
              >{{ prepared.message }}</span
            >
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.item {
  align-items: flex-start;
}
.item-move {
  display: flex;
  flex-direction: column;
}
.item-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.item-head-text {
  flex: 1;
  min-width: 0;
}
.item-body {
  margin-top: 14px;
  padding: 14px 16px 6px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-bg);
}
.item-grid {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}
.item-pickers {
  display: flex;
  gap: 8px;
  margin: 4px 0 14px;
}
.item-prepare {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.item-problems {
  margin: 6px 0 0 18px;
  font-size: 12.5px;
}
</style>
