<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BindingView, DeviceView } from '../core/model';
import { describeInput, deviceInputs, inputSortKey } from '../core/names';
import { useBindingsStore } from './store';

/** Every control of one device and what it does. */
const store = useBindingsStore();
const route = useRoute();
const router = useRouter();
const view = computed(() => store.view!);
const boundOnly = ref(false);
const confirmClear = ref(false);
const showInert = ref(false);
const showRemoved = ref(false);

const deviceItems = computed(() => [
  ...store.controllers.map((d) => ({
    title: d.name,
    value: d.id,
    subtitle: d.connected ? `${d.counts.active} bound` : 'Not attached · binding file only',
  })),
  ...view.value.devices
    .filter((d) => d.type !== 'joystick')
    .map((d) => ({ title: d.name, value: d.id, subtitle: `${d.counts.active} bound` })),
]);

const device = computed<DeviceView | undefined>(() => {
  const wanted = String(route.query['device'] ?? '');
  return (
    view.value.devices.find((d) => d.id === wanted) ??
    // Start on the device with the most bindings of the user's own.
    [...store.controllers].sort((a, b) => b.counts.fromUser - a.counts.fromUser)[0] ??
    view.value.devices[0]
  );
});

function select(id: string): void {
  void router.replace({ path: route.path, query: { ...route.query, device: id } });
}

const editable = computed(() => device.value?.type === 'joystick');

interface Row {
  key: string;
  label: string;
  kind: string;
  bindings: BindingView[];
}

/** One row per control the device has, plus rows for bindings on controls it is not known to have. */
const rows = computed<Row[]>(() => {
  const d = device.value;
  if (!d) return [];
  const active = d.bindings.filter((b) => !b.inert);
  const keys = new Set<string>(d.connected && d.type === 'joystick' ? deviceInputs(d) : []);
  for (const binding of active) keys.add(binding.combo.key);
  return [...keys]
    .sort((a, b) => inputSortKey(a).localeCompare(inputSortKey(b)))
    .map((key) => ({
      key,
      label: describeInput(key).label,
      kind: describeInput(key).kind,
      bindings: active.filter((b) => b.combo.key === key),
    }))
    .filter((row) => !boundOnly.value || row.bindings.length > 0);
});

const inert = computed(() => device.value?.bindings.filter((b) => b.inert) ?? []);
const clearCounts = computed(() => {
  const all = (device.value?.bindings ?? []).filter((b) => !b.inert);
  const yours = all.filter((b) => b.source !== 'default').length;
  return { yours, defaults: all.length - yours };
});

const SOURCE = {
  default: 'DCS default',
  user: 'Yours',
  template: 'DCS template',
} as const;

function category(commandId: string): string {
  return store.commands.get(commandId)?.category.join(' · ') ?? '';
}

function modifiers(binding: BindingView): string {
  // The label is "<modifiers> + <input>"; the input is in the first column already.
  const at = binding.label.lastIndexOf(' + ');
  return at < 0 ? '' : binding.label.slice(0, at);
}

function clear(binding: BindingView): void {
  const d = device.value;
  if (!d || !store.aircraftId) return;
  store.stage(
    {
      op: 'unbind',
      aircraft: store.aircraftId,
      deviceId: d.id,
      commandId: binding.commandId,
      combo: { key: binding.combo.key, reformers: binding.combo.reformers },
    },
    `${d.name}: clear ${binding.label} (${store.commandName(binding.commandId)})`
  );
}

function restore(
  commandId: string,
  combo: { key: string; reformers: string[] },
  label: string
): void {
  const d = device.value;
  if (!d || !store.aircraftId) return;
  store.stage(
    { op: 'bind', aircraft: store.aircraftId, deviceId: d.id, commandId, combo },
    `${d.name}: restore the default ${label} (${store.commandName(commandId)})`
  );
}

function clearAll(): void {
  const d = device.value;
  if (!d || !store.aircraftId) return;
  confirmClear.value = false;
  void store.reviewOps(
    [{ op: 'clearDevice', aircraft: store.aircraftId, deviceId: d.id }],
    `Clear all ${d.counts.active} bindings on ${d.name} (${view.value.aircraft.name})`
  );
}

const stagedHere = computed(() =>
  store.staged.filter((s) => s.op.deviceId === device.value?.id).map((s) => s.op)
);
const isStaged = (key: string): boolean =>
  stagedHere.value.some((op) => 'combo' in op && op.combo.key === key);
</script>

<template>
  <div data-testid="bind-devices">
    <div class="dev-bar">
      <v-autocomplete
        class="dev-select"
        label="Device"
        variant="outlined"
        density="comfortable"
        hide-details="auto"
        auto-select-first
        :items="deviceItems"
        item-props
        :model-value="device?.id"
        data-testid="dev-select"
        @update:model-value="select(String($event))"
      />
      <v-switch v-model="boundOnly" label="Only bound controls" data-testid="dev-bound-only" />
      <v-spacer />
      <v-btn
        v-if="editable && device && device.counts.active > 0"
        variant="tonal"
        prepend-icon="mdi-eraser"
        data-testid="dev-clear-all"
        @click="confirmClear = true"
      >
        Clear all on this device
      </v-btn>
    </div>

    <div v-if="!device" class="rr-panel rr-empty">There are no devices to show.</div>
    <template v-else>
      <div class="rr-row-sub dev-meta" data-testid="dev-meta">
        <template v-if="device.type === 'joystick'">
          <span v-if="device.connected" class="rr-ok">Attached</span>
          <span v-else class="rr-warn">Not attached</span>
          · device ID <span class="rr-mono">{{ device.guid ?? 'none' }}</span> ·
        </template>
        <template v-if="device.file.source === 'user'">
          your file <span class="rr-mono">{{ device.file.path }}</span>
        </template>
        <template v-else-if="device.file.source === 'template'">
          no file of your own yet: DCS uses the template it ships for this device
        </template>
        <template v-else>no file of your own yet: DCS defaults only</template>
      </div>
      <v-alert v-if="device.file.error" type="error" variant="tonal" class="mb-3">
        This device's binding file could not be read, so its bindings are not shown and RigReady
        will not change it: {{ device.file.error }}
      </v-alert>
      <div v-if="!editable" class="rr-row-sub dev-meta" data-testid="dev-readonly">
        Shown for reference. Keyboard and mouse bindings are changed in DCS's own controls screen.
      </div>

      <div v-if="rows.length === 0" class="rr-panel rr-empty" data-testid="dev-empty">
        Nothing is bound on this device for {{ view.aircraft.name }}.
      </div>
      <div v-else class="rr-panel dev-table" data-testid="dev-table">
        <div
          v-for="row in rows"
          :key="row.key"
          class="dev-row"
          :class="{ 'dev-row-empty': row.bindings.length === 0 }"
          data-testid="dev-row"
          :data-input="row.key"
        >
          <div class="dev-input">
            <v-icon
              :icon="
                row.kind === 'axis'
                  ? 'mdi-axis-arrow'
                  : row.kind === 'hat'
                    ? 'mdi-gamepad-round-outline'
                    : row.kind === 'key'
                      ? 'mdi-keyboard-outline'
                      : 'mdi-radiobox-marked'
              "
              size="16"
              class="rr-muted"
            />
            {{ row.label }}
            <span v-if="isStaged(row.key)" class="dev-staged" data-testid="dev-row-staged">
              staged
            </span>
          </div>
          <div class="dev-actions">
            <div v-if="row.bindings.length === 0" class="rr-muted dev-unbound">Not bound</div>
            <div
              v-for="binding in row.bindings"
              :key="binding.commandId + binding.label"
              class="dev-binding"
              data-testid="dev-binding"
              :data-source="binding.source"
            >
              <div class="dev-binding-main">
                <div class="dev-action-name">
                  <span v-if="modifiers(binding)" class="dev-mod">{{ modifiers(binding) }} +</span>
                  {{ store.commandName(binding.commandId) }}
                </div>
                <div class="rr-row-sub">
                  {{ SOURCE[binding.source] }}
                  <template v-if="binding.filterChanged"> with your curve</template>
                  <template v-if="category(binding.commandId)">
                    · {{ category(binding.commandId) }}
                  </template>
                  <span
                    v-if="store.commands.get(binding.commandId)?.unmatched"
                    class="rr-warn"
                    data-testid="dev-unmatched"
                  >
                    · not among DCS's current actions for this aircraft
                  </span>
                </div>
              </div>
              <template v-if="editable">
                <v-btn
                  v-if="row.kind === 'axis'"
                  size="x-small"
                  variant="text"
                  data-testid="dev-curve"
                  @click="
                    store.bindRequest = {
                      mode: 'curve',
                      commandId: binding.commandId,
                      deviceId: device.id,
                      key: binding.combo.key,
                      reformers: binding.combo.reformers,
                    }
                  "
                >
                  Curve
                </v-btn>
                <v-btn
                  size="x-small"
                  variant="text"
                  :disabled="store.commands.get(binding.commandId)?.editable === false"
                  data-testid="dev-clear"
                  @click="clear(binding)"
                >
                  Clear
                </v-btn>
              </template>
            </div>
          </div>
          <v-btn
            v-if="editable && row.kind !== 'key'"
            size="small"
            variant="tonal"
            class="dev-bind"
            data-testid="dev-bind"
            @click="store.bindRequest = { mode: 'bind', deviceId: device.id, key: row.key }"
          >
            {{ row.bindings.length === 0 ? 'Bind' : 'Change' }}
          </v-btn>
        </div>
      </div>

      <div v-if="device.removed.length > 0" class="dev-fold">
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="showRemoved ? 'mdi-chevron-down' : 'mdi-chevron-right'"
          data-testid="dev-toggle-removed"
          @click="showRemoved = !showRemoved"
        >
          {{ device.removed.length }} DCS
          {{ device.removed.length === 1 ? 'default is' : 'defaults are' }} cancelled on this device
        </v-btn>
        <div v-if="showRemoved" class="rr-panel" data-testid="dev-removed">
          <div v-for="r in device.removed" :key="r.commandId + r.label" class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-title">{{ store.commandName(r.commandId) }}</div>
              <div class="rr-row-sub">{{ r.label }}</div>
            </div>
            <v-btn
              v-if="editable"
              size="x-small"
              variant="text"
              data-testid="dev-restore"
              @click="restore(r.commandId, r.combo, r.label)"
            >
              Restore
            </v-btn>
          </div>
        </div>
      </div>

      <div v-if="inert.length > 0" class="dev-fold">
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="showInert ? 'mdi-chevron-down' : 'mdi-chevron-right'"
          data-testid="dev-toggle-inert"
          @click="showInert = !showInert"
        >
          {{ inert.length }} DCS {{ inert.length === 1 ? 'default' : 'defaults' }} on controls this
          device does not have
        </v-btn>
        <div v-if="showInert" class="rr-panel" data-testid="dev-inert">
          <div v-for="b in inert" :key="b.commandId + b.label" class="rr-row">
            <div class="rr-row-main">
              <div class="rr-row-title">{{ store.commandName(b.commandId) }}</div>
              <div class="rr-row-sub">
                {{ b.label }} · can never fire: this device has no such control
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <v-dialog v-model="confirmClear" max-width="520">
      <v-card v-if="device" data-testid="dev-clear-confirm">
        <v-card-title>Clear {{ device.name }}?</v-card-title>
        <v-card-text>
          This removes all {{ device.counts.active }} bindings on this device for
          {{ view.aircraft.name }}: {{ clearCounts.yours }} of yours and
          {{ clearCounts.defaults }} DCS defaults, which are cancelled so they do not come back.
          Other aircraft are not touched. You will see the exact change before it is written, and it
          can be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmClear = false">Keep them</v-btn>
          <v-btn color="primary" data-testid="dev-clear-confirm-yes" @click="clearAll">
            Show what will change
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.dev-bar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 10px;
}
.dev-select {
  flex: 0 0 440px;
}
.dev-meta {
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}
.dev-table {
  margin-bottom: 12px;
}
.dev-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 16px;
  border-top: 1px solid var(--rr-border);
}
.dev-row:first-child {
  border-top: none;
}
.dev-row-empty {
  padding-top: 5px;
  padding-bottom: 5px;
}
.dev-input {
  flex: 0 0 170px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 500;
  padding-top: 3px;
}
.dev-staged {
  font-size: 11px;
  color: var(--rr-accent);
  border: 1px solid var(--rr-border);
  border-radius: 6px;
  padding: 0 6px;
}
.dev-actions {
  flex: 1;
  min-width: 0;
}
.dev-unbound {
  font-size: 13px;
  padding-top: 3px;
}
.dev-binding {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}
.dev-binding-main {
  flex: 1;
  min-width: 0;
}
.dev-action-name {
  font-size: 14px;
}
.dev-mod {
  color: var(--rr-accent);
}
.dev-bind {
  margin-top: 1px;
}
.dev-fold {
  margin-top: 8px;
}
</style>
