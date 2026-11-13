<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import {
  iracingBindingsContract,
  type ControlProfile,
  type CopyCompare,
  type CopyResult,
  type CopyReview,
} from '../contract';

/**
 * Copy bindings from one control profile into another: choose the two, tick the actions
 * (or all of them), look at the change, then Copy. Buttons and keys are copied; an axis
 * and its calibration stay as they are, and each row says why.
 */
const props = defineProps<{ open: boolean; profiles: ControlProfile[] }>();
const emit = defineEmits<{ close: []; copied: [result: CopyResult] }>();
const api = useClient(iracingBindingsContract);

const from = ref<string>();
const to = ref<string>();
const compared = ref<CopyCompare>();
const ticked = ref(new Set<string>());
const error = ref<string>();
const loading = ref(false);
const review = ref<CopyReview>();
const reviewError = ref<string>();
const copying = ref(false);

const names = computed(() => props.profiles.map((p) => p.name));
const targets = computed(() => names.value.filter((n) => n !== from.value));

/** By default from the profile for all cars into the first other one. */
function reset(): void {
  const general = props.profiles.find((p) => p.forAllCars)?.name ?? names.value[0];
  from.value = general;
  to.value = names.value.find((n) => n !== general);
  compared.value = undefined;
  review.value = undefined;
  error.value = undefined;
}
watch(
  () => props.open,
  (open) => {
    if (open) reset();
  },
  { immediate: true }
);
watch(from, () => {
  if (to.value === from.value) to.value = targets.value[0];
});

let turn = 0;
async function compare(): Promise<void> {
  if (!props.open || !from.value || !to.value || from.value === to.value) return;
  const mine = ++turn;
  loading.value = true;
  error.value = undefined;
  // Rows of two other profiles are never shown under these names.
  compared.value = undefined;
  const result = await api.copyCompare({ fromProfile: from.value, toProfile: to.value });
  if (mine !== turn) return;
  loading.value = false;
  if (!result.ok) {
    compared.value = undefined;
    error.value = errorText(result.error);
    return;
  }
  compared.value = result.value;
  // A binding is copied, unticked or not; clearing one is ticked only by hand.
  ticked.value = new Set(result.value.rows.filter((r) => r.kind === 'copy').map((r) => r.id));
}
watch([from, to, () => props.open], () => void compare(), { immediate: true });

const choosable = computed(() => (compared.value?.rows ?? []).filter((r) => r.kind !== 'kept'));
const kept = computed(() => (compared.value?.rows ?? []).filter((r) => r.kind === 'kept'));

function toggle(id: string): void {
  const next = new Set(ticked.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  ticked.value = next;
}
const tickAll = (): void => void (ticked.value = new Set(choosable.value.map((r) => r.id)));
const tickNone = (): void => void (ticked.value = new Set());

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

async function showReview(): Promise<void> {
  if (!from.value || !to.value || ticked.value.size === 0) return;
  reviewError.value = undefined;
  const result = await api.copyPreview({
    fromProfile: from.value,
    toProfile: to.value,
    actions: [...ticked.value],
  });
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  review.value = result.value;
}

async function copy(): Promise<void> {
  if (!review.value || !from.value || !to.value) return;
  copying.value = true;
  const result = await api.copy({
    fromProfile: from.value,
    toProfile: to.value,
    actions: [...ticked.value],
    seen: review.value.seen,
  });
  copying.value = false;
  if (!result.ok) {
    reviewError.value = errorText(result.error);
    return;
  }
  review.value = undefined;
  emit('copied', result.value);
}
</script>

<template>
  <v-dialog
    :model-value="open && !review"
    max-width="760"
    scrollable
    persistent
    @keydown.esc="emit('close')"
  >
    <v-card v-if="open" data-testid="iracing-copy">
      <v-card-title>Copy bindings between profiles</v-card-title>
      <v-card-text>
        <div class="ic-pick">
          <v-select
            v-model="from"
            :items="names"
            label="Copy from"
            density="compact"
            hide-details
            data-testid="iracing-copy-from"
          />
          <v-icon icon="mdi-arrow-right" class="rr-muted" />
          <v-select
            v-model="to"
            :items="targets"
            label="Into"
            density="compact"
            hide-details
            data-testid="iracing-copy-to"
          />
        </div>
        <p class="ic-why">
          Buttons and keys are copied. An axis and its calibration stay as they are in the profile
          you copy into: iRacing calibrates an axis as it binds it, so bind axes in iRacing. The
          profile you copy from is not changed.
        </p>
        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          class="mb-3"
          data-testid="iracing-copy-error"
          >{{ error }}</v-alert
        >
        <div v-if="loading" class="rr-muted" data-testid="iracing-copy-loading">
          Comparing the two profiles…
        </div>
        <template v-if="compared">
          <div v-if="compared.blocked" class="ic-blocked" data-testid="iracing-copy-blocked">
            <v-icon icon="mdi-alert" class="rr-warn" size="18" />
            <span>{{ compared.blocked }}</span>
          </div>
          <div class="ic-summary" data-testid="iracing-copy-summary">
            {{ plural(compared.rows.length, 'action differs', 'actions differ') }};
            {{ plural(compared.same, 'action is', 'actions are') }} the same in both.
          </div>
          <div
            v-if="compared.rows.length === 0"
            class="rr-panel rr-empty"
            data-testid="iracing-copy-nothing"
          >
            “{{ compared.to }}” already has every binding of “{{ compared.from }}”.
          </div>
          <template v-if="choosable.length">
            <div class="ic-tick">
              <v-btn size="small" variant="text" data-testid="iracing-copy-all" @click="tickAll"
                >Tick all</v-btn
              >
              <v-btn size="small" variant="text" data-testid="iracing-copy-none" @click="tickNone"
                >Tick none</v-btn
              >
            </div>
            <div class="rr-panel">
              <label
                v-for="r in choosable"
                :key="r.id"
                class="rr-row ic-row"
                data-testid="iracing-copy-row"
                :data-action="r.id"
                :data-kind="r.kind"
              >
                <v-checkbox
                  :model-value="ticked.has(r.id)"
                  hide-details
                  density="compact"
                  :aria-label="`Copy ${r.name}`"
                  data-testid="iracing-copy-tick"
                  @update:model-value="toggle(r.id)"
                />
                <div class="rr-row-main">
                  <div class="rr-row-title">
                    {{ r.name }} <span class="ic-id">{{ r.id }}</span>
                  </div>
                  <div class="rr-row-sub">
                    “{{ compared.from }}”: {{ r.from }} · “{{ compared.to }}” now: {{ r.to }}
                  </div>
                  <div
                    v-if="r.kind === 'clear'"
                    class="rr-row-sub"
                    data-testid="iracing-copy-clears"
                  >
                    <v-icon icon="mdi-information-outline" size="14" class="rr-muted" />
                    Copying clears it, because “{{ compared.from }}” has nothing on it.
                  </div>
                </div>
              </label>
            </div>
          </template>
          <template v-if="kept.length">
            <div class="ic-kept-title">Left as they are</div>
            <div class="rr-panel">
              <div
                v-for="r in kept"
                :key="r.id"
                class="rr-row ic-row"
                data-testid="iracing-copy-kept"
                :data-action="r.id"
              >
                <v-icon icon="mdi-minus-circle-outline" class="rr-muted" />
                <div class="rr-row-main">
                  <div class="rr-row-title">
                    {{ r.name }} <span class="ic-id">{{ r.id }}</span>
                  </div>
                  <div class="rr-row-sub">{{ r.why }}</div>
                </div>
              </div>
            </div>
          </template>
        </template>
      </v-card-text>
      <v-card-actions>
        <span v-if="compared && choosable.length && ticked.size === 0" class="ic-hint"
          >Tick the actions to copy.</span
        >
        <v-spacer />
        <v-btn variant="text" data-testid="iracing-copy-cancel" @click="emit('close')"
          >Cancel</v-btn
        >
        <v-btn
          v-if="choosable.length"
          color="primary"
          :disabled="ticked.size === 0"
          data-testid="iracing-copy-review"
          @click="showReview"
          >Review copying {{ plural(ticked.size, 'binding', 'bindings') }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ConfirmChanges
    :open="review !== undefined"
    :title="`Copy ${plural(review?.count ?? 0, 'binding', 'bindings')} into “${review?.to ?? ''}”?`"
    confirm-text="Copy"
    :preview="review?.preview"
    :error="reviewError"
    :busy="copying"
    :blocked="!!review?.blocked"
    :max-width="640"
    testid="iracing-copy-save"
    @cancel="review = undefined"
    @confirm="copy"
  >
    <template v-if="review">
      <p data-testid="iracing-copy-what">
        RigReady copies the {{ plural(review.count, 'binding', 'bindings') }} you ticked from “{{
          review.from
        }}” into the controls.cfg of “{{ review.to }}”<template v-if="review.clears"
          >, and {{ review.clears }} of them
          {{ review.clears === 1 ? 'clears a binding' : 'clear bindings' }} there</template
        >. It changes those actions and nothing else in the file.
      </p>
      <div v-if="review.blocked" class="ic-blocked" data-testid="iracing-copy-save-blocked">
        <v-icon icon="mdi-alert" class="rr-warn" size="18" />
        <span>{{ review.blocked }}</span>
      </div>
    </template>
  </ConfirmChanges>
</template>

<style scoped>
.ic-pick {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 4px 0 12px;
}
.ic-why {
  font-size: 13px;
  color: var(--rr-text-2);
  margin-bottom: 12px;
}
.ic-summary {
  font-size: 13px;
  margin-bottom: 6px;
}
.ic-tick {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.ic-row {
  cursor: pointer;
  padding-top: 4px;
  padding-bottom: 4px;
}
.ic-id {
  margin-left: 8px;
  font-family: var(--rr-font-mono);
  font-size: 11px;
  color: var(--rr-muted);
}
.ic-kept-title {
  margin: 14px 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rr-text-2);
}
.ic-blocked {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 10px;
}
.ic-hint {
  font-size: 12.5px;
  color: var(--rr-muted);
  padding-left: 8px;
}
</style>
