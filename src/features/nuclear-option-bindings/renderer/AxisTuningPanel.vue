<script setup lang="ts">
import { ref, watch } from 'vue';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { nuclearOptionBindingsContract, type TuneReview, type Tuning } from '../contract';

/**
 * The axes of one controller with the dead zones and the sensitivity the game saved for
 * each, as its own Calibrate window sets them. A change is shown first and written only on
 * "Save" (through FileStore: a backup, the Safety page, Undo).
 */
const props = defineProps<{ open: boolean; device: string; deviceName: string }>();
const emit = defineEmits<{ close: []; saved: [message: string] }>();
const api = useClient(nuclearOptionBindingsContract);

/** What the fields hold: whole percents, and the sensitivity to two decimals. */
interface Row {
  index: number;
  name: string;
  tunable: boolean;
  unread: boolean;
  reversed: boolean;
  hasUpper: boolean;
  deadZone: number;
  upperDeadZone: number;
  sensitivity: number;
  was: { deadZone: number; upperDeadZone: number; sensitivity: number };
}

const tuning = ref<Tuning>();
const rows = ref<Row[]>([]);
const error = ref('');
/** What the last Save said, shown in the dialog too: the page's own line is behind it. */
const savedText = ref('');
let turn = 0;

const percent = (value: number): number => Math.round(value * 100);
const hundredths = (value: number): number => Math.round(value * 100) / 100;

async function load(keepTyped = false): Promise<void> {
  const mine = ++turn;
  error.value = '';
  const result = await api.tuning({ device: props.device });
  if (mine !== turn) return;
  if (!result.ok) {
    tuning.value = undefined;
    rows.value = [];
    error.value = errorText(result.error);
    return;
  }
  tuning.value = result.value;
  const typed = new Map(rows.value.filter(changed).map((row) => [row.index, row]));
  rows.value = result.value.axes.map((a): Row => {
    const now = {
      deadZone: percent(a.deadZone),
      upperDeadZone: percent(a.upperDeadZone ?? 0),
      sensitivity: hundredths(a.sensitivity),
    };
    return {
      index: a.index,
      name: a.name,
      tunable: a.tunable,
      unread: a.unread,
      reversed: a.reversed,
      hasUpper: a.upperDeadZone !== undefined,
      ...now,
      // Another axis's numbers, typed and not saved yet, stay in their fields.
      ...(keepTyped && typed.has(a.index)
        ? {
            deadZone: typed.get(a.index)!.deadZone,
            upperDeadZone: typed.get(a.index)!.upperDeadZone,
            sensitivity: typed.get(a.index)!.sensitivity,
          }
        : {}),
      was: { ...now },
    };
  });
}

watch(
  () => [props.open, props.device] as const,
  ([open]) => {
    reviewing.value = undefined;
    review.value = undefined;
    savedText.value = '';
    if (open) void load();
    else turn++;
  }
);

/** A field's number; an emptied field is not 0. */
const number = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
const valid = (row: Row): boolean =>
  Number.isInteger(number(row.deadZone)) &&
  number(row.deadZone) >= 0 &&
  number(row.deadZone) <= 80 &&
  Number.isInteger(number(row.upperDeadZone)) &&
  number(row.upperDeadZone) >= 0 &&
  number(row.upperDeadZone) <= 80 &&
  number(row.deadZone) + number(row.upperDeadZone) <= 90 &&
  number(row.sensitivity) >= 0.1 &&
  number(row.sensitivity) <= 2;
const changed = (row: Row): boolean =>
  number(row.deadZone) !== row.was.deadZone ||
  number(row.upperDeadZone) !== row.was.upperDeadZone ||
  number(row.sensitivity) !== row.was.sensitivity;

// ---- One axis at a time: the review first, and only its Save writes ----

const reviewing = ref<Row>();
const review = ref<TuneReview>();
const reviewError = ref('');
const saving = ref(false);
let reviewTurn = 0;

const requestOf = (row: Row) => ({
  device: props.device,
  axis: row.index,
  deadZone: number(row.deadZone) / 100,
  ...(row.hasUpper ? { upperDeadZone: number(row.upperDeadZone) / 100 } : {}),
  sensitivity: number(row.sensitivity),
});

async function startReview(row: Row): Promise<void> {
  if (!valid(row) || !changed(row) || saving.value) return;
  savedText.value = '';
  const mine = ++reviewTurn;
  review.value = undefined;
  reviewError.value = '';
  reviewing.value = row;
  const result = await api.tunePreview(requestOf(row));
  if (mine !== reviewTurn) return;
  if (result.ok) review.value = result.value;
  else reviewError.value = errorText(result.error);
}
function closeReview(): void {
  // Not while a Save is on its way: its answer, a failure too, is shown in this dialog.
  if (saving.value) return;
  reviewTurn++;
  reviewing.value = undefined;
  review.value = undefined;
  reviewError.value = '';
}
async function save(): Promise<void> {
  const row = reviewing.value;
  if (!row || !review.value || saving.value) return;
  saving.value = true;
  const result = await api.tune({ ...requestOf(row), seen: review.value.seen });
  saving.value = false;
  if (!result.ok) {
    reviewError.value = errorText(result.error);
    return;
  }
  // The row now holds what was saved; the others keep what was typed in them.
  row.was = {
    deadZone: number(row.deadZone),
    upperDeadZone: number(row.upperDeadZone),
    sensitivity: number(row.sensitivity),
  };
  closeReview();
  savedText.value = result.value.message;
  emit('saved', result.value.message);
  await load(true);
}
</script>

<template>
  <v-dialog :model-value="open" max-width="860" scrollable persistent @keydown.esc="emit('close')">
    <v-card v-if="open" data-testid="nuclear-option-tuning">
      <v-card-title class="at-title">Axis tuning: {{ deviceName }}</v-card-title>
      <v-card-text>
        <p class="rr-muted at-lead">
          What Nuclear Option saved for each axis of this controller, as its own Calibrate window
          sets it (Settings, Controls, Calibrate). A dead zone is how far the axis moves from its
          centre before the game takes notice; the upper dead zone is how far before its end it
          counts as fully moved; a sensitivity of 1 is as the controller reports, less is calmer.
          The game reads this the next time it starts.
        </p>
        <v-alert
          v-if="error"
          type="warning"
          variant="tonal"
          class="mb-3"
          data-testid="nuclear-option-tuning-error"
        >
          {{ error }}
        </v-alert>
        <div v-if="savedText" class="rr-ok at-lead" data-testid="nuclear-option-tuning-saved">
          <v-icon icon="mdi-check" size="small" /> {{ savedText }}
        </div>
        <div
          v-if="tuning && !tuning.named"
          class="rr-muted at-lead"
          data-testid="nuclear-option-tuning-unnamed"
        >
          The controller did not say which axes it has (it may not be plugged in), so they go by the
          game's own numbers here.
        </div>
        <table v-if="rows.length > 0" class="at-table">
          <thead>
            <tr>
              <th>Axis</th>
              <th>Dead zone (%)</th>
              <th>Upper dead zone (%)</th>
              <th>Sensitivity</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.index"
              data-testid="nuclear-option-tuning-row"
              :data-axis="row.name"
            >
              <td>
                <div class="rr-row-title">{{ row.name }}</div>
                <div v-if="row.reversed" class="rr-muted at-note">
                  Reversed in the game's calibration
                </div>
                <div v-if="!row.tunable" class="rr-muted at-note">
                  Saved in a way RigReady does not change
                </div>
              </td>
              <td
                v-if="row.unread"
                colspan="4"
                class="rr-muted at-note"
                data-testid="nuclear-option-tuning-unread"
              >
                RigReady cannot read this axis's settings. Look at them in the game: Settings,
                Controls, then Calibrate.
              </td>
              <template v-else>
                <td>
                  <v-text-field
                    v-model.number="row.deadZone"
                    type="number"
                    min="0"
                    max="80"
                    step="1"
                    density="compact"
                    variant="outlined"
                    hide-details
                    :disabled="!row.tunable"
                    :aria-label="`Dead zone of ${row.name}, percent`"
                    data-testid="nuclear-option-tuning-dead-zone"
                  />
                </td>
                <td>
                  <v-text-field
                    v-if="row.hasUpper"
                    v-model.number="row.upperDeadZone"
                    type="number"
                    min="0"
                    max="80"
                    step="1"
                    density="compact"
                    variant="outlined"
                    hide-details
                    :disabled="!row.tunable"
                    :aria-label="`Upper dead zone of ${row.name}, percent`"
                    data-testid="nuclear-option-tuning-upper"
                  />
                  <span v-else class="rr-muted at-note">Not in this calibration</span>
                </td>
                <td>
                  <v-text-field
                    v-model.number="row.sensitivity"
                    type="number"
                    min="0.1"
                    max="2"
                    step="0.05"
                    density="compact"
                    variant="outlined"
                    hide-details
                    :disabled="!row.tunable"
                    :aria-label="`Sensitivity of ${row.name}`"
                    data-testid="nuclear-option-tuning-sensitivity"
                  />
                </td>
                <td class="at-act">
                  <v-btn
                    size="small"
                    variant="tonal"
                    :disabled="!row.tunable || !changed(row) || !valid(row)"
                    data-testid="nuclear-option-tuning-review"
                    @click="startReview(row)"
                    >Review</v-btn
                  >
                  <div
                    v-if="row.tunable && !valid(row)"
                    class="rr-warn at-note"
                    data-testid="nuclear-option-tuning-invalid"
                  >
                    0 to 80 percent each, 90 together; 0.1 to 2
                  </div>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" data-testid="nuclear-option-tuning-close" @click="emit('close')"
          >Close</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ConfirmChanges
    :open="reviewing !== undefined"
    :title="`Tune ${reviewing?.name ?? 'this axis'} of ${deviceName}?`"
    confirm-text="Save"
    :preview="review && !review.same ? review.preview : undefined"
    :error="reviewError"
    :busy="saving"
    :blocked="review?.blocked !== undefined"
    testid="nuclear-option-tuning-dialog"
    @cancel="closeReview"
    @confirm="save"
  >
    <div v-if="review" class="at-review" data-testid="nuclear-option-tuning-change">
      <div v-if="review.same" class="rr-muted">
        <strong>{{ review.axis }}</strong> is tuned so already: nothing to save.
      </div>
      <template v-else>
        <div>
          <strong>{{ review.axis }}</strong>: {{ review.before }}
          <v-icon icon="mdi-arrow-right" size="small" />
          {{ review.after }}
        </div>
        <div class="rr-muted">
          For every action bound to this axis, in what Nuclear Option saved. The game reads it the
          next time it starts.
        </div>
      </template>
      <div v-if="review.blocked" class="at-blocked" data-testid="nuclear-option-tuning-blocked">
        <v-icon icon="mdi-alert-outline" size="small" class="rr-warn" />
        <span>{{ review.blocked }}</span>
      </div>
    </div>
  </ConfirmChanges>
</template>

<style scoped>
.at-title {
  white-space: normal;
  font-size: 17px;
}
.at-lead {
  font-size: 13.5px;
  margin: 0 0 12px;
}
.at-table {
  width: 100%;
  border-collapse: collapse;
}
.at-table th {
  text-align: left;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--rr-muted);
  padding: 4px 8px;
}
.at-table td {
  padding: 6px 8px;
  vertical-align: middle;
  width: 20%;
}
.at-table td:first-child {
  width: 28%;
}
.at-note {
  font-size: 12.5px;
}
.at-act {
  text-align: right;
}
.at-review {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.at-blocked {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
</style>
