<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { errorText } from '../../../renderer/ipc';
import { DEVICE_ROLES, ROLE_LABELS, type BindingOp, type ProblemsView } from '../core/model';
import { useBindingsStore } from './store';

/** What is wrong with this aircraft's bindings, each with a fix that is previewed before it is written. */
const store = useBindingsStore();
const view = computed(() => store.view!);
const problems = computed(() => view.value.problems);
const aircraft = computed(() => view.value.aircraft);
const showExpected = ref(false);
const error = ref<string>();
const roleItems = DEVICE_ROLES.map((role) => ({ title: ROLE_LABELS[role], value: role }));

type Duplicate = ProblemsView['actionDuplicates'][number];
type Occurrence = Duplicate['occurrences'][number];
type Conflict = ProblemsView['inputConflicts'][number];

const duplicates = computed(() =>
  problems.value.actionDuplicates.filter((d) => showExpected.value || !d.expected)
);
const expectedCount = computed(
  () => problems.value.actionDuplicates.filter((d) => d.expected).length
);

// Unwanted defaults, per device, with a tick per item.
const unticked = ref(new Set<string>());
watch(
  () => store.aircraftId,
  () => (unticked.value = new Set())
);
const unwantedByDevice = computed(() => {
  const groups = new Map<string, ProblemsView['unwantedDefaults']>();
  for (const item of problems.value.unwantedDefaults) {
    groups.set(item.deviceId, [...(groups.get(item.deviceId) ?? []), item]);
  }
  return [...groups.entries()].map(([deviceId, items]) => ({
    device: store.devices.get(deviceId)!,
    items,
  }));
});
const ticked = computed(() =>
  problems.value.unwantedDefaults.filter((u) => !unticked.value.has(u.id))
);

function toggle(id: string): void {
  const next = new Set(unticked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  unticked.value = next;
}

const tiers = computed(() => {
  const out: { tier: number; title: string; items: ProblemsView['importantUnbound'] }[] = [];
  for (const item of problems.value.importantUnbound) {
    const tier = out.find((t) => t.tier === item.tier);
    if (tier) tier.items.push(item);
    else out.push({ tier: item.tier, title: item.tierTitle, items: [item] });
  }
  return out;
});

const total = computed(
  () =>
    problems.value.inputConflicts.length +
    problems.value.actionDuplicates.filter((d) => !d.expected).length +
    problems.value.unwantedDefaults.length +
    problems.value.importantUnbound.length
);

const unbind = (
  deviceId: string,
  commandId: string,
  combo: { key: string; reformers: string[] }
): BindingOp => ({
  op: 'unbind',
  aircraft: aircraft.value.id,
  deviceId,
  commandId,
  combo: { key: combo.key, reformers: combo.reformers },
});

function keepOnlyAction(conflict: Conflict, keep: string): void {
  void store.reviewOps(
    conflict.commandIds
      .filter((id) => id !== keep)
      .map((id) => unbind(conflict.deviceId, id, conflict.combo)),
    `Keep ${conflict.label} on ${conflict.deviceName} only for ${store.commandName(keep)} (${aircraft.value.name})`
  );
}

function clearOccurrence(duplicate: Duplicate, occurrence: Occurrence): void {
  void store.reviewOps(
    [unbind(occurrence.deviceId, duplicate.commandId, occurrence.combo)],
    `Clear ${occurrence.label} on ${occurrence.deviceName} from ${store.commandName(duplicate.commandId)} (${aircraft.value.name})`
  );
}

function keepOnlyOccurrence(duplicate: Duplicate, keep: Occurrence): void {
  void store.reviewOps(
    duplicate.occurrences
      .filter((o) => o !== keep)
      .map((o) => unbind(o.deviceId, duplicate.commandId, o.combo)),
    `Keep ${store.commandName(duplicate.commandId)} only on ${keep.deviceName} ${keep.label} (${aircraft.value.name})`
  );
}

async function cleanUp(everyAircraft: boolean): Promise<void> {
  error.value = undefined;
  const result = await store.api.cleanupOps(
    everyAircraft
      ? { aircraft: [] }
      : { aircraft: [aircraft.value.id], only: ticked.value.map((u) => u.id) }
  );
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  const count = result.value.ops.length;
  if (count === 0) {
    error.value = 'There is nothing to clean up.';
    return;
  }
  await store.reviewOps(
    result.value.ops,
    everyAircraft
      ? `Clean up ${count} unwanted default ${count === 1 ? 'binding' : 'bindings'} on ${result.value.aircraft.length} aircraft`
      : `Clean up ${count} unwanted default ${count === 1 ? 'binding' : 'bindings'} (${aircraft.value.name})`
  );
}
</script>

<template>
  <div data-testid="bind-problems">
    <v-alert v-if="error" type="error" variant="tonal" class="mb-3" data-testid="prob-error">
      {{ error }}
    </v-alert>

    <div v-if="total === 0" class="rr-panel rr-empty prob-clean" data-testid="prob-none">
      <v-icon icon="mdi-check-circle-outline" size="36" class="rr-ok mb-3" />
      <div class="rr-row-title">No problems found for {{ aircraft.name }}</div>
      <div class="rr-row-sub">
        No input does two things, no default sits on a device that should not have it, and every
        important action is on a controller.
        <template v-if="expectedCount > 0">
          {{ expectedCount }} {{ expectedCount === 1 ? 'action is' : 'actions are' }} bound more
          than once on purpose.
        </template>
      </div>
    </div>

    <!-- 1. Unwanted defaults -->
    <section v-if="problems.unwantedDefaults.length > 0" data-testid="prob-defaults">
      <div class="prob-head">
        <div>
          <div class="rr-section-title">Default bindings on devices that should not have them</div>
          <p class="rr-row-sub prob-why">
            DCS binds pitch, roll, rudder, throttle and the view hat on every game controller it
            does not know. On a panel, an MFD frame or a wheel that means a bumped knob flies the
            aircraft. Cleaning up writes a "removed" entry for each into that device's file.
          </p>
        </div>
      </div>
      <div
        v-for="group in unwantedByDevice"
        :key="group.device.id"
        class="rr-panel prob-panel"
        data-testid="prob-defaults-device"
        :data-device="group.device.name"
      >
        <div class="rr-row prob-device">
          <div class="rr-row-main">
            <div class="rr-row-title">{{ group.device.name }}</div>
            <div class="rr-row-sub">
              {{ group.items.length }} unwanted
              {{ group.items.length === 1 ? 'default' : 'defaults' }}
            </div>
          </div>
          <span class="rr-row-sub">This device is a</span>
          <v-select
            class="prob-role"
            density="compact"
            :items="roleItems"
            :model-value="group.device.role"
            :aria-label="`What ${group.device.name} is used for`"
            data-testid="prob-role"
            @update:model-value="store.setRole(group.device, $event)"
          />
        </div>
        <label
          v-for="item in group.items"
          :key="item.id"
          class="rr-row prob-item"
          data-testid="prob-default"
        >
          <v-checkbox
            :model-value="!unticked.has(item.id)"
            :aria-label="`Clean up ${item.label}`"
            @update:model-value="toggle(item.id)"
          />
          <div class="rr-row-main">
            <div class="rr-row-title">
              {{ item.label }} → {{ store.commandName(item.commandId) }}
            </div>
            <div class="rr-row-sub">{{ item.reason }}</div>
          </div>
        </label>
      </div>
      <div class="prob-actions">
        <v-btn
          color="primary"
          :disabled="ticked.length === 0"
          data-testid="prob-cleanup"
          @click="cleanUp(false)"
        >
          Clean up {{ ticked.length }} for {{ aircraft.name }}
        </v-btn>
        <v-btn variant="tonal" data-testid="prob-cleanup-all" @click="cleanUp(true)">
          Clean up every aircraft
        </v-btn>
      </div>
    </section>

    <!-- 2. One input, several actions -->
    <section v-if="problems.inputConflicts.length > 0" data-testid="prob-conflicts">
      <div class="rr-section-title">One input does several things</div>
      <p class="rr-row-sub prob-why">
        The same control, with the same modifiers, is bound to more than one action on one device.
      </p>
      <div class="rr-panel prob-panel">
        <div
          v-for="conflict in problems.inputConflicts"
          :key="conflict.id"
          class="prob-block"
          data-testid="prob-conflict"
        >
          <div class="rr-row-title">{{ conflict.label }} on {{ conflict.deviceName }}</div>
          <div v-for="id in conflict.commandIds" :key="id" class="prob-line">
            <span>{{ store.commandName(id) }}</span>
            <v-btn
              size="x-small"
              variant="tonal"
              data-testid="prob-conflict-keep"
              @click="keepOnlyAction(conflict, id)"
            >
              Keep only this
            </v-btn>
          </div>
        </div>
      </div>
    </section>

    <!-- 3. One action, several inputs -->
    <section
      v-if="problems.actionDuplicates.length > 0"
      class="prob-section"
      data-testid="prob-duplicates"
    >
      <div class="prob-head">
        <div>
          <div class="rr-section-title">One action is bound more than once</div>
          <p class="rr-row-sub prob-why">
            Fine when you mean it (a second trim hat); a problem when two devices fight over an
            axis. Mark the ones you mean as expected and they stop counting.
          </p>
        </div>
        <v-switch
          v-if="expectedCount > 0"
          v-model="showExpected"
          :label="`Show ${expectedCount} expected`"
          data-testid="prob-show-expected"
        />
      </div>
      <div class="rr-panel prob-panel">
        <div v-if="duplicates.length === 0" class="rr-empty prob-small-empty">
          Every action that is bound more than once is marked as expected.
        </div>
        <div
          v-for="duplicate in duplicates"
          :key="duplicate.commandId"
          class="prob-block"
          data-testid="prob-duplicate"
          :data-action="store.commandName(duplicate.commandId)"
        >
          <div class="prob-block-head">
            <div class="rr-row-title">
              {{ store.commandName(duplicate.commandId) }}
              <span class="rr-row-sub">
                ·
                {{
                  duplicate.acrossDevices
                    ? `on ${new Set(duplicate.occurrences.map((o) => o.deviceId)).size} devices`
                    : 'twice on one device'
                }}
              </span>
            </div>
            <v-btn
              size="x-small"
              variant="text"
              data-testid="prob-expected"
              @click="store.setExpected(duplicate.commandId, !duplicate.expected)"
            >
              {{ duplicate.expected ? 'Not expected after all' : 'This is expected' }}
            </v-btn>
          </div>
          <div
            v-for="occurrence in duplicate.occurrences"
            :key="occurrence.deviceId + occurrence.label"
            class="prob-line"
            data-testid="prob-occurrence"
          >
            <span>
              {{ occurrence.deviceName }}: {{ occurrence.label }}
              <span class="rr-row-sub">
                {{ occurrence.source === 'default' ? '· DCS default' : '' }}
              </span>
            </span>
            <span class="prob-line-actions">
              <v-btn
                size="x-small"
                variant="text"
                data-testid="prob-clear"
                @click="clearOccurrence(duplicate, occurrence)"
              >
                Clear
              </v-btn>
              <v-btn
                size="x-small"
                variant="tonal"
                data-testid="prob-keep-only"
                @click="keepOnlyOccurrence(duplicate, occurrence)"
              >
                Keep only this one
              </v-btn>
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- 4. Important but unbound -->
    <section v-if="tiers.length > 0" class="prob-section" data-testid="prob-important">
      <div class="rr-section-title">Important actions that are not on any controller</div>
      <p class="rr-row-sub prob-why">
        From RigReady's priority list for the {{ aircraft.name }}, most important first.
      </p>
      <div v-for="tier in tiers" :key="tier.tier" class="rr-panel prob-panel">
        <div class="prob-tier">{{ tier.tier }}. {{ tier.title }}</div>
        <div
          v-for="item in tier.items"
          :key="item.id"
          class="rr-row"
          data-testid="prob-unbound"
          :data-item="item.title"
        >
          <div class="rr-row-main">
            <div class="rr-row-title">{{ item.title }}</div>
            <div class="rr-row-sub">
              {{ item.why }}
              <template v-if="item.keyboard"> Keyboard: {{ item.keyboard }}.</template>
            </div>
          </div>
          <v-btn
            size="small"
            variant="tonal"
            data-testid="prob-bind"
            @click="store.bindRequest = { mode: 'bind', commandIds: item.commandIds }"
          >
            Bind
          </v-btn>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.prob-clean {
  margin-bottom: 20px;
}
.prob-section {
  margin-top: 28px;
}
.prob-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
}
.prob-why {
  max-width: 760px;
  margin: 0 0 10px;
}
.prob-panel {
  margin-bottom: 10px;
}
.prob-device {
  background: var(--rr-surface-2);
  border-radius: var(--rr-radius) var(--rr-radius) 0 0;
}
.prob-role {
  flex: 0 0 210px;
}
.prob-item {
  cursor: pointer;
  padding-top: 4px;
  padding-bottom: 4px;
}
.prob-actions {
  display: flex;
  gap: 12px;
  margin: 12px 0 28px;
}
.prob-block {
  padding: 10px 16px;
  border-top: 1px solid var(--rr-border);
}
.prob-block:first-child {
  border-top: none;
}
.prob-block-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.prob-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13.5px;
  padding: 2px 0 2px 12px;
}
.prob-line-actions {
  display: flex;
  gap: 6px;
}
.prob-tier {
  padding: 8px 16px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rr-muted);
  background: var(--rr-surface-2);
  border-radius: var(--rr-radius) var(--rr-radius) 0 0;
}
.prob-small-empty {
  padding: 20px;
}
</style>
