<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText } from '../../../renderer/ipc';
import type { CopyPreview } from '../core/model';
import { useBindingsStore } from './store';

/** Copy common controls (trigger, trim, view, radio) from this aircraft to another. */
const store = useBindingsStore();
const view = computed(() => store.view!);
const target = ref<string>();
const deviceIds = ref<string[]>([]);
const preview = ref<CopyPreview>();
const selected = ref(new Set<string>());
const error = ref<string>();
const busy = ref(false);
const showUnmatched = ref(false);

const targets = computed(() =>
  (store.overview?.aircraft ?? [])
    .filter((a) => a.id !== view.value.aircraft.id && a.hasDefaults)
    .map((a) => ({ title: a.name, value: a.id }))
);

/** Devices that have something of the user's to copy. */
const sources = computed(() =>
  store.controllers.filter(
    (d) => d.connected && d.bindings.some((b) => b.source !== 'default' || b.filterChanged)
  )
);

function reset(): void {
  preview.value = undefined;
  error.value = undefined;
  target.value = targets.value[0]?.value;
  // The controls people share between aircraft live on the stick, throttle and pedals.
  deviceIds.value = sources.value
    .filter((d) => ['stick', 'throttle', 'pedals'].includes(d.role))
    .map((d) => d.id);
}
watch(() => store.aircraftId, reset, { immediate: true });
watch([target, deviceIds], () => (preview.value = undefined));
watch(
  () => store.revision,
  () => {
    if (preview.value) void find();
  }
);

function toggleDevice(id: string): void {
  deviceIds.value = deviceIds.value.includes(id)
    ? deviceIds.value.filter((d) => d !== id)
    : [...deviceIds.value, id];
}

async function find(): Promise<void> {
  if (!target.value) return;
  busy.value = true;
  error.value = undefined;
  const result = await store.api.copyPreview({
    from: view.value.aircraft.id,
    to: target.value,
    deviceIds: deviceIds.value,
  });
  busy.value = false;
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  preview.value = result.value;
  selected.value = new Set(result.value.proposals.filter((p) => p.selected).map((p) => p.id));
}

function toggle(id: string): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

const groups = computed(() => {
  const out: { device: string; proposals: CopyPreview['proposals'] }[] = [];
  for (const proposal of preview.value?.proposals ?? []) {
    const group = out.find((g) => g.device === proposal.deviceName);
    if (group) group.proposals.push(proposal);
    else out.push({ device: proposal.deviceName, proposals: [proposal] });
  }
  return out;
});

const MATCH = {
  same: 'Same DCS command',
  equivalent: 'Same kind of control',
  closest: 'Closest action in this aircraft',
} as const;

async function review(): Promise<void> {
  if (!target.value) return;
  const result = await store.api.copyOps({
    from: view.value.aircraft.id,
    to: target.value,
    deviceIds: deviceIds.value,
    selected: [...selected.value],
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  if (result.value.ops.length === 0) {
    error.value = 'Nothing is ticked that is not already bound that way.';
    return;
  }
  await store.reviewOps(result.value.ops, result.value.summary);
}
</script>

<template>
  <div data-testid="bind-copy">
    <p class="rr-row-sub copy-why">
      Set a control up once and carry it to the next aircraft: RigReady looks at what you bound on
      the chosen devices for {{ view.aircraft.name }} and finds the same action in the other
      aircraft. You choose what is copied, and see the exact change before it is written.
    </p>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" data-testid="copy-error">
      {{ error }}
    </v-alert>

    <div v-if="targets.length === 0" class="rr-panel rr-empty" data-testid="copy-no-target">
      There is no other aircraft to copy to.
    </div>
    <div v-else-if="sources.length === 0" class="rr-panel rr-empty" data-testid="copy-no-source">
      You have not bound anything for {{ view.aircraft.name }} yet, so there is nothing to copy from
      it. Choose another aircraft at the top.
    </div>
    <template v-else>
      <div class="rr-panel copy-setup">
        <div class="copy-line">
          <span class="rr-row-title">From {{ view.aircraft.name }} to</span>
          <v-select
            v-model="target"
            class="copy-target"
            density="compact"
            :items="targets"
            aria-label="Aircraft to copy to"
            data-testid="copy-target"
          />
        </div>
        <div class="copy-devices">
          <label v-for="device in sources" :key="device.id" class="copy-device">
            <v-checkbox
              :model-value="deviceIds.includes(device.id)"
              :aria-label="device.name"
              data-testid="copy-device"
              :data-device="device.name"
              @update:model-value="toggleDevice(device.id)"
            />
            {{ device.name }}
          </label>
        </div>
        <v-btn
          color="primary"
          :disabled="deviceIds.length === 0 || !target"
          :loading="busy"
          data-testid="copy-find"
          @click="find"
        >
          Find controls to copy
        </v-btn>
      </div>

      <template v-if="preview">
        <div
          v-if="preview.proposals.length === 0"
          class="rr-panel rr-empty"
          data-testid="copy-nothing"
        >
          None of your bindings on these devices has a counterpart in the {{ preview.to }}.
        </div>
        <div v-for="group in groups" :key="group.device" data-testid="copy-group">
          <div class="rr-section-title copy-group-title">{{ group.device }}</div>
          <div class="rr-panel">
            <label
              v-for="proposal in group.proposals"
              :key="proposal.id"
              class="rr-row copy-row"
              data-testid="copy-proposal"
              :data-input="proposal.label"
              :data-match="proposal.match"
            >
              <v-checkbox
                :model-value="selected.has(proposal.id)"
                :disabled="proposal.already"
                :aria-label="`Copy ${proposal.label}`"
                @update:model-value="toggle(proposal.id)"
              />
              <div class="copy-input">{{ proposal.label }}</div>
              <div class="rr-row-main">
                <div class="rr-row-title">
                  {{ proposal.to.name }}
                  <span v-if="proposal.to.name !== proposal.from.name" class="rr-row-sub">
                    · {{ preview.from }}: {{ proposal.from.name }}
                  </span>
                </div>
                <div class="rr-row-sub">
                  <template v-if="proposal.already">Already bound like this</template>
                  <template v-else>
                    {{ MATCH[proposal.match] }}
                    <span
                      v-if="proposal.replaces.length > 0"
                      class="rr-warn"
                      data-testid="copy-replaces"
                    >
                      · {{ proposal.label }} now does "{{ proposal.replaces.join('", "') }}" there,
                      which it would stop doing
                    </span>
                  </template>
                </div>
              </div>
            </label>
          </div>
        </div>

        <div v-if="preview.unmatched.length > 0" class="copy-unmatched">
          <v-btn
            size="small"
            variant="text"
            :prepend-icon="showUnmatched ? 'mdi-chevron-down' : 'mdi-chevron-right'"
            data-testid="copy-toggle-unmatched"
            @click="showUnmatched = !showUnmatched"
          >
            {{ preview.unmatched.length }} bindings have no counterpart in the {{ preview.to }}
          </v-btn>
          <div v-if="showUnmatched" class="rr-panel" data-testid="copy-unmatched">
            <div v-for="(item, index) in preview.unmatched" :key="index" class="rr-row copy-small">
              <div class="copy-input">{{ item.label }}</div>
              <div class="rr-row-main">{{ item.name }}</div>
              <span class="rr-row-sub">{{ item.deviceName }}</span>
            </div>
          </div>
        </div>

        <div v-if="preview.proposals.length > 0" class="copy-actions">
          <v-btn
            color="primary"
            :disabled="selected.size === 0"
            data-testid="copy-review"
            @click="review"
          >
            Preview copying {{ selected.size }} {{ selected.size === 1 ? 'control' : 'controls' }}
          </v-btn>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.copy-why {
  max-width: 820px;
  margin: 0 0 16px;
}
.copy-setup {
  padding: 16px;
  margin-bottom: 20px;
}
.copy-line {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.copy-target {
  flex: 0 0 260px;
}
.copy-devices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin-bottom: 14px;
}
.copy-device {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13.5px;
  cursor: pointer;
}
.copy-group-title {
  margin-top: 16px;
}
.copy-row {
  cursor: pointer;
  padding-top: 5px;
  padding-bottom: 5px;
}
.copy-input {
  flex: 0 0 130px;
  font-size: 13.5px;
  font-weight: 500;
}
.copy-small {
  font-size: 13px;
  padding-top: 5px;
  padding-bottom: 5px;
}
.copy-unmatched {
  margin-top: 12px;
}
.copy-actions {
  margin-top: 16px;
}
</style>
