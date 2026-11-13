<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { notifyMachineChanged, onMachineChanged } from '../../../renderer/machine';
import {
  iracingBindingsContract,
  type ClearGoneResult,
  type ClearGoneReview,
  type GoneDevice,
  type GoneView,
} from '../contract';

/**
 * The controllers of one iRacing binding set that are not plugged in, and what RigReady
 * makes of each (core/cleanup.ts): gone, unplugged but known as yours, a new Windows id, or
 * cannot tell. Only a gone one can be ticked; clearing its bindings is shown first and
 * written with a backup. Shown only when the set names a controller that is not plugged in.
 */
const props = defineProps<{
  /** The set id the page shows. */
  set: string;
  /** The page with the id repair, when there is one. */
  repairRoute?: string | undefined;
}>();

const api = useClient(iracingBindingsContract);
const view = ref<GoneView>();
const error = ref<string>();
/** Instance GUIDs of the gone controllers the user ticked. */
const chosen = ref<string[]>([]);

const asking = ref(false);
const review = ref<ClearGoneReview>();
const reviewError = ref<string>();
const busy = ref(false);
const done = ref<ClearGoneResult>();

async function load(): Promise<void> {
  const id = props.set;
  const result = await api.goneDevices({ set: id });
  if (props.set !== id) return;
  if (!result.ok) {
    error.value = errorText(result.error);
    view.value = undefined;
    return;
  }
  error.value = undefined;
  view.value = result.value;
  // A tick for a controller that is no longer gone (plugged in meanwhile) goes.
  const gone = new Set(result.value.devices.filter((d) => d.verdict === 'gone').map((d) => d.key));
  chosen.value = chosen.value.filter((k) => gone.has(k));
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
watch(
  () => props.set,
  () => {
    chosen.value = [];
    done.value = undefined;
    void load();
  }
);

const gone = computed(() => (view.value?.devices ?? []).filter((d) => d.verdict === 'gone'));
const count = computed(() =>
  gone.value.filter((d) => chosen.value.includes(d.key)).reduce((n, d) => n + d.bindings.length, 0)
);

function toggle(key: string, on: boolean | null): void {
  chosen.value = on ? [...new Set([...chosen.value, key])] : chosen.value.filter((k) => k !== key);
}

const LOOK = {
  gone: { text: 'Not seen on this PC', cls: 'rr-warn', icon: 'mdi-help-circle' },
  unplugged: { text: 'Unplugged', cls: 'rr-muted', icon: 'mdi-power-plug-off-outline' },
  moved: { text: 'New Windows id', cls: 'rr-warn', icon: 'mdi-alert' },
  unknown: { text: 'Cannot tell', cls: 'rr-muted', icon: 'mdi-help-circle-outline' },
} as const;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const nameOf = (d: GoneDevice): string => d.givenName ?? d.name;
/** "Push to pass: Button 3 · DRS: Button 4", the first six, then how many more. */
const bindingsLine = (d: GoneDevice): string =>
  d.bindings.length === 0
    ? 'Nothing bound'
    : d.bindings
        .slice(0, 6)
        .map((b) => `${b.name}: ${b.input}`)
        .join(' · ') + (d.bindings.length > 6 ? ` · and ${d.bindings.length - 6} more` : '');

async function openReview(): Promise<void> {
  review.value = undefined;
  reviewError.value = undefined;
  done.value = undefined;
  asking.value = true;
  const result = await api.clearGonePreview({ set: props.set, devices: chosen.value });
  if (!asking.value) return;
  if (result.ok) review.value = result.value;
  else reviewError.value = errorText(result.error);
}

async function confirm(): Promise<void> {
  if (!review.value) return;
  busy.value = true;
  const result = await api.clearGone({
    set: props.set,
    devices: review.value.devices.map((d) => d.key),
    seen: review.value.seen,
  });
  busy.value = false;
  if (!result.ok) {
    reviewError.value = errorText(result.error);
    return;
  }
  asking.value = false;
  done.value = result.value;
  chosen.value = [];
  // This panel, the page around it and every other page that reads the file read it again.
  notifyMachineChanged();
}
</script>

<template>
  <section
    v-if="error || (view && view.devices.length > 0) || done"
    class="ib-section"
    data-testid="iracing-gone"
  >
    <div class="gd-head">
      <h2 class="rr-section-title">Controllers iRacing will not find</h2>
      <span class="gd-hint">Bindings for a controller that is gone can be cleared</span>
    </div>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-2"
      data-testid="iracing-gone-error"
    >
      {{ error }}
    </v-alert>
    <div v-if="done" class="gd-done rr-ok" role="status" data-testid="iracing-gone-cleared">
      <v-icon icon="mdi-check" size="16" />
      <span>{{ done.message }}</span>
      <router-link to="/configure/safety" data-testid="iracing-gone-safety-link"
        >Safety page</router-link
      >
    </div>
    <div v-if="view && view.devices.length > 0" class="rr-panel">
      <div
        v-for="d in view.devices"
        :key="d.key"
        class="gd-device"
        data-testid="iracing-gone-device"
        :data-device="d.key"
        :data-verdict="d.verdict"
      >
        <div class="rr-row">
          <v-checkbox-btn
            v-if="d.verdict === 'gone'"
            :model-value="chosen.includes(d.key)"
            :aria-label="`Clear the bindings of ${nameOf(d)}`"
            density="compact"
            class="gd-tick"
            data-testid="iracing-gone-choose"
            @update:model-value="toggle(d.key, $event)"
          />
          <v-icon v-else icon="mdi-steering" class="rr-muted" />
          <div class="rr-row-main">
            <div class="rr-row-title" data-testid="iracing-gone-name">
              {{ nameOf(d) }}
              <span v-if="d.givenName" class="rr-muted gd-hardware"> {{ d.name }}</span>
            </div>
            <div class="rr-row-sub">
              {{ plural(d.bindings.length, 'binding', 'bindings') }}
              <template v-if="d.vendorId && d.productId">
                · USB {{ d.vendorId }}:{{ d.productId }}</template
              >
            </div>
          </div>
          <span class="gd-verdict" :class="LOOK[d.verdict].cls" data-testid="iracing-gone-verdict">
            <v-icon :icon="LOOK[d.verdict].icon" size="15" />
            {{ LOOK[d.verdict].text }}
          </span>
        </div>
        <div class="gd-more">
          <div data-testid="iracing-gone-why">
            {{ d.why }}
            <router-link
              v-if="d.verdict !== 'gone' && d.verdict !== 'unknown' && repairRoute"
              :to="repairRoute"
              data-testid="iracing-gone-repair-link"
              >Open the iRacing page</router-link
            >
          </div>
          <div class="gd-bindings" data-testid="iracing-gone-bindings">{{ bindingsLine(d) }}</div>
        </div>
      </div>
      <div v-if="gone.length > 0" class="gd-actions" data-testid="iracing-gone-actions">
        <v-btn
          color="primary"
          variant="flat"
          size="small"
          :disabled="count === 0"
          :aria-describedby="count === 0 ? 'iracing-gone-tick-hint' : undefined"
          data-testid="iracing-gone-review"
          @click="openReview"
          >{{
            count === 0
              ? 'Review clearing'
              : `Review clearing ${plural(count, 'binding', 'bindings')}`
          }}</v-btn
        >
        <span
          v-if="count === 0"
          id="iracing-gone-tick-hint"
          class="gd-hint"
          data-testid="iracing-gone-tick-hint"
          >Tick each controller that is gone for good. Nothing is ticked for you.</span
        >
      </div>
    </div>

    <ConfirmChanges
      :open="asking"
      title="Clear the bindings of controllers that are gone?"
      :confirm-text="`Clear ${plural(review?.bindings.length ?? count, 'binding', 'bindings')}`"
      :preview="review?.preview"
      :error="reviewError"
      :busy="busy"
      :blocked="review?.blocked !== undefined"
      testid="iracing-gone"
      @cancel="asking = false"
      @confirm="confirm"
    >
      <template v-if="review">
        <p>
          RigReady clears these bindings in iRacing’s file
          {{ review.set.general ? 'for all cars' : `for ${review.set.name}`
          }}<template v-if="review.set.profile">
            (control profile “{{ review.set.profile }}”)</template
          >. Each action is then not bound, as if it never was. Every other binding and the
          calibration stay as they are.
        </p>
        <div
          v-for="dev in review.devices"
          :key="dev.key"
          class="gd-review"
          data-testid="iracing-gone-review-device"
        >
          <div class="gd-review-title">
            {{ dev.name }}: {{ plural(dev.count, 'binding', 'bindings') }}
          </div>
          <ul class="gd-review-list">
            <li
              v-for="b in review.bindings.filter((x) => x.device === dev.key)"
              :key="b.action"
              data-testid="iracing-gone-review-binding"
            >
              {{ b.name }}<span class="rr-muted">: {{ b.input }}</span>
            </li>
          </ul>
        </div>
        <p v-if="review.blocked" class="rr-warn" data-testid="iracing-gone-blocked">
          <v-icon icon="mdi-alert" size="16" /> {{ review.blocked }}
        </p>
      </template>
      <template v-else-if="!reviewError">Working out the change…</template>
    </ConfirmChanges>
  </section>
</template>

<style scoped>
.gd-head {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}
.gd-head .rr-section-title {
  margin: 0;
}
.gd-hint {
  font-size: 12.5px;
  color: var(--rr-muted);
}
.gd-device + .gd-device {
  border-top: 1px solid var(--rr-border);
}
.gd-tick {
  flex: 0 0 auto;
}
.gd-hardware {
  font-weight: 400;
  font-size: 12.5px;
}
.gd-verdict {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
}
.gd-more {
  padding: 0 16px 12px 52px;
  font-size: 13px;
  color: var(--rr-muted);
}
.gd-bindings {
  margin-top: 4px;
  font-size: 12.5px;
}
.gd-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--rr-border);
}
.gd-done {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 8px;
}
.gd-review {
  margin-top: 8px;
}
.gd-review-title {
  font-weight: 600;
}
.gd-review-list {
  margin: 4px 0 0 18px;
  font-size: 13px;
}
</style>
