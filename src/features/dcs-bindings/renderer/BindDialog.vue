<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { curvePoints } from '../core/curve';
import type { ComboView, DeviceView } from '../core/model';
import { comboLabel, describeInput, deviceInputs, inputSortKey } from '../core/names';
import { useBindingsStore } from './store';

/**
 * Binds an action to a control: press the control on the device, or pick device and
 * control from the lists. For axes it also holds the curve settings. The result is
 * staged, not written.
 */
type Filter = NonNullable<ComboView['filter']>;
const FLAT: Filter = {
  deadzone: 0,
  saturationX: 1,
  saturationY: 1,
  hardwareDetent: false,
  hardwareDetentAB: 0,
  hardwareDetentMax: 0,
  invert: false,
  slider: false,
  curvature: [0],
};

const store = useBindingsStore();
const request = computed(() => store.bindRequest);
const commandId = ref<string>();
const deviceId = ref<string>();
const key = ref<string>();
const reformers = ref<string[]>([]);
const filter = ref<Filter>({ ...FLAT });
const listening = ref(false);
const listenError = ref<string>();
let off: (() => void) | undefined;

const isCurve = computed(() => request.value?.mode === 'curve');
const command = computed(() => (commandId.value ? store.commands.get(commandId.value) : undefined));
const device = computed(() => (deviceId.value ? store.devices.get(deviceId.value) : undefined));

/** Axis actions take axes; everything else takes buttons and hat directions. */
const wantsAxis = computed(() => {
  if (command.value) return command.value.kind === 'axis';
  if (key.value) return describeInput(key.value).kind === 'axis';
  return undefined;
});

const actionItems = computed(() => {
  const only = request.value?.commandIds;
  return (store.view?.commands ?? [])
    .filter((c) => c.editable && !c.unmatched)
    .filter((c) => !only || only.includes(c.id))
    .filter((c) => wantsAxis.value === undefined || (c.kind === 'axis') === wantsAxis.value)
    .map((c) => ({ title: c.name, value: c.id, subtitle: c.category.join(' · ') }));
});

const deviceItems = computed(() =>
  store.controllers.map((d) => ({
    title: d.givenName ?? d.name,
    value: d.id,
    subtitle: d.connected ? '' : 'Not attached',
  }))
);

function inputsOf(d: DeviceView): string[] {
  const keys = d.connected ? deviceInputs(d) : [...new Set(d.bindings.map((b) => b.combo.key))];
  return keys.sort((a, b) => inputSortKey(a).localeCompare(inputSortKey(b)));
}

const inputItems = computed(() => {
  const d = device.value;
  if (!d) return [];
  return inputsOf(d)
    .filter((k) => {
      const kind = describeInput(k).kind;
      if (kind === 'key') return false;
      return wantsAxis.value === undefined || (kind === 'axis') === wantsAxis.value;
    })
    .map((k) => ({ title: describeInput(k).label, value: k }));
});

const modifierItems = computed(() =>
  (store.view?.modifiers ?? []).map((m) => ({ title: m.label, value: m.name }))
);

const label = computed(() =>
  key.value ? comboLabel({ key: key.value, reformers: reformers.value }) : ''
);

/** What the chosen input does now on that device, other than the chosen action. */
const taken = computed(() => {
  const d = device.value;
  if (!d || !key.value) return [];
  const wanted = [...reformers.value].sort().join('+');
  return d.bindings
    .filter(
      (b) =>
        !b.inert &&
        b.combo.key === key.value &&
        [...b.combo.reformers].sort().join('+') === wanted &&
        b.commandId !== commandId.value
    )
    .map((b) => store.commandName(b.commandId));
});

const existing = computed(() =>
  device.value?.bindings.find(
    (b) =>
      b.commandId === commandId.value &&
      b.combo.key === key.value &&
      [...b.combo.reformers].sort().join('+') === [...reformers.value].sort().join('+')
  )
);

const showFilter = computed(() => wantsAxis.value === true && key.value !== undefined);
const userCurve = computed(() => filter.value.curvature.length > 1);
const curvaturePercent = computed({
  get: () => Math.round((filter.value.curvature[0] ?? 0) * 100),
  set: (value: number) => {
    const clamped = Math.max(-100, Math.min(100, Number.isFinite(value) ? value : 0));
    filter.value = { ...filter.value, curvature: [clamped / 100] };
  },
});
const preview = computed(() => curvePoints(filter.value, 180, 180));

function setNumber(field: 'deadzone' | 'saturationX' | 'saturationY', raw: string): void {
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  const percent = Math.max(field === 'deadzone' ? 0 : 1, Math.min(100, value));
  filter.value = { ...filter.value, [field]: percent / 100 };
}

async function stopListening(): Promise<void> {
  off?.();
  off = undefined;
  if (listening.value) {
    listening.value = false;
    await store.api.listenStop();
  }
}

async function listen(): Promise<void> {
  listenError.value = undefined;
  const started = await store.api.listenStart();
  if (!started.ok) {
    listenError.value = started.error.message;
    return;
  }
  listening.value = true;
  off = store.api.on('pressed', (pressed) => {
    if (wantsAxis.value !== undefined && (pressed.kind === 'axis') !== wantsAxis.value) return;
    const found = store.controllers.find(
      (d) => d.connected && d.guid?.toUpperCase() === pressed.guid.toUpperCase()
    );
    if (!found) return;
    deviceId.value = found.id;
    key.value = pressed.key;
    void stopListening();
  });
}

watch(request, (next) => {
  void stopListening();
  if (!next) return;
  commandId.value =
    next.commandId ?? (next.commandIds?.length === 1 ? next.commandIds[0] : undefined);
  deviceId.value = next.deviceId;
  key.value = next.key;
  reformers.value = next.reformers ?? [];
  filter.value = { ...FLAT };
  listenError.value = undefined;
  if (next.mode === 'curve') filter.value = { ...(existing.value?.combo.filter ?? FLAT) };
});

watch(deviceId, () => {
  if (key.value && !inputItems.value.some((i) => i.value === key.value)) key.value = undefined;
});

function close(): void {
  void stopListening();
  store.bindRequest = undefined;
}

const canSave = computed(
  () => command.value !== undefined && device.value !== undefined && key.value !== undefined
);

function save(): void {
  const c = command.value;
  const d = device.value;
  if (!c || !d || !key.value || !store.aircraftId) return;
  const combo = { key: key.value, reformers: reformers.value };
  const isFlat = JSON.stringify(filter.value) === JSON.stringify(FLAT);
  if (isCurve.value) {
    store.stage(
      {
        op: 'setFilter',
        aircraft: store.aircraftId,
        deviceId: d.id,
        commandId: c.id,
        combo,
        filter: filter.value,
      },
      `${d.name}: change the curve of ${label.value} (${c.name})`
    );
  } else {
    store.stage(
      {
        op: 'bind',
        aircraft: store.aircraftId,
        deviceId: d.id,
        commandId: c.id,
        combo: { ...combo, ...(showFilter.value && !isFlat ? { filter: filter.value } : {}) },
      },
      `${d.name}: bind ${label.value} to ${c.name}`
    );
  }
  close();
}

onBeforeUnmount(() => void stopListening());
</script>

<template>
  <v-dialog :model-value="request !== undefined" max-width="640" persistent @keydown.esc="close">
    <v-card v-if="request" data-testid="bind-dialog">
      <v-card-title>{{ isCurve ? 'Axis curve' : 'Bind a control' }}</v-card-title>
      <v-card-text>
        <template v-if="isCurve">
          <div class="rr-row-title">{{ command?.plain ?? command?.name }}</div>
          <div v-if="command?.plain" class="rr-row-sub">DCS calls it: {{ command.name }}</div>
          <div class="rr-row-sub mb-4">{{ label }} on {{ device?.name }}</div>
        </template>
        <template v-else>
          <v-autocomplete
            v-model="commandId"
            label="Action"
            :items="actionItems"
            item-props
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="mb-4"
            placeholder="Type to search"
            data-testid="bind-action"
          />

          <div class="bind-press rr-panel" :class="{ 'bind-press-on': listening }">
            <template v-if="listening">
              <v-progress-circular indeterminate size="18" width="2" />
              <span data-testid="bind-listening">
                Press the {{ wantsAxis ? 'axis (move it most of the way)' : 'button or hat' }} on
                the device now…
              </span>
              <v-spacer />
              <v-btn
                size="small"
                variant="text"
                data-testid="bind-listen-stop"
                @click="stopListening"
              >
                Stop
              </v-btn>
            </template>
            <template v-else>
              <v-icon icon="mdi-gesture-tap-button" class="rr-muted" />
              <span>Do not know which button it is?</span>
              <v-spacer />
              <v-btn size="small" variant="tonal" data-testid="bind-listen" @click="listen">
                Press it on the device
              </v-btn>
            </template>
          </div>
          <div v-if="listenError" class="rr-row-sub rr-bad mb-2">{{ listenError }}</div>

          <div class="bind-pick">
            <v-autocomplete
              v-model="deviceId"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              auto-select-first
              label="Device"
              :items="deviceItems"
              item-props
              data-testid="bind-device"
            />
            <v-autocomplete
              v-model="key"
              variant="outlined"
              density="comfortable"
              hide-details="auto"
              auto-select-first
              label="Control"
              :items="inputItems"
              :disabled="!device"
              :no-data-text="
                wantsAxis ? 'This device has no axes' : 'This device has no buttons or hats'
              "
              data-testid="bind-input"
            />
          </div>
          <v-select
            v-model="reformers"
            class="mt-4"
            label="Held together with (modifiers, optional)"
            :items="modifierItems"
            multiple
            chips
            closable-chips
            data-testid="bind-modifiers"
          />
        </template>

        <div v-if="showFilter" class="bind-filter" data-testid="bind-filter">
          <div class="bind-filter-fields">
            <div v-if="userCurve" class="rr-row-sub mb-2" data-testid="bind-user-curve">
              This axis has a custom curve with {{ filter.curvature.length }} points, which is kept.
              Setting a curvature below replaces it.
            </div>
            <v-text-field
              type="number"
              label="Curvature"
              suffix="−100 to 100"
              :model-value="curvaturePercent"
              data-testid="bind-curvature"
              @update:model-value="curvaturePercent = Number($event)"
            />
            <v-text-field
              type="number"
              label="Deadzone"
              suffix="%"
              :model-value="Math.round(filter.deadzone * 100)"
              data-testid="bind-deadzone"
              @update:model-value="setNumber('deadzone', String($event))"
            />
            <div class="bind-two">
              <v-text-field
                type="number"
                label="Saturation X"
                suffix="%"
                :model-value="Math.round(filter.saturationX * 100)"
                data-testid="bind-saturation-x"
                @update:model-value="setNumber('saturationX', String($event))"
              />
              <v-text-field
                type="number"
                label="Saturation Y"
                suffix="%"
                :model-value="Math.round(filter.saturationY * 100)"
                data-testid="bind-saturation-y"
                @update:model-value="setNumber('saturationY', String($event))"
              />
            </div>
            <div class="bind-two">
              <v-checkbox
                label="Invert"
                :model-value="filter.invert"
                data-testid="bind-invert"
                @update:model-value="filter = { ...filter, invert: $event === true }"
              />
              <v-checkbox
                label="Slider (one-way axis)"
                :model-value="filter.slider"
                data-testid="bind-slider"
                @update:model-value="filter = { ...filter, slider: $event === true }"
              />
            </div>
          </div>
          <div class="bind-curve">
            <svg viewBox="0 0 180 180" width="180" height="180" data-testid="bind-curve">
              <rect x="0.5" y="0.5" width="179" height="179" class="bind-curve-frame" />
              <line x1="90" y1="0" x2="90" y2="180" class="bind-curve-grid" />
              <line x1="0" y1="90" x2="180" y2="90" class="bind-curve-grid" />
              <line x1="0" y1="180" x2="180" y2="0" class="bind-curve-grid" />
              <polyline :points="preview" class="bind-curve-line" />
            </svg>
            <div class="rr-row-sub">Output for input, left to right</div>
          </div>
        </div>

        <v-alert
          v-if="!isCurve && taken.length > 0"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-4"
          data-testid="bind-taken"
        >
          {{ label }} now does "{{ taken.join('", "') }}" on this device. Binding it here takes it
          away from there, as DCS does.
        </v-alert>
        <div
          v-if="!isCurve && existing && !showFilter"
          class="rr-row-sub mt-3"
          data-testid="bind-already"
        >
          {{ label }} is already bound to this action.
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="bind-cancel" @click="close">Cancel</v-btn>
        <v-btn
          color="primary"
          :disabled="!canSave || (!isCurve && !!existing && !showFilter)"
          data-testid="bind-save"
          @click="save"
        >
          Add to staged changes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.bind-press {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 16px;
  font-size: 13.5px;
  background: var(--rr-surface-2);
}
.bind-press-on {
  border-color: var(--rr-accent);
}
.bind-pick {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 12px;
}
.bind-filter {
  display: flex;
  gap: 20px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--rr-border);
}
.bind-filter-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.bind-two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.bind-curve {
  flex: 0 0 180px;
  text-align: center;
}
.bind-curve-frame {
  fill: var(--rr-bg);
  stroke: var(--rr-border);
}
.bind-curve-grid {
  stroke: var(--rr-border);
  stroke-width: 1;
}
.bind-curve-line {
  fill: none;
  stroke: var(--rr-accent);
  stroke-width: 2;
}
</style>
