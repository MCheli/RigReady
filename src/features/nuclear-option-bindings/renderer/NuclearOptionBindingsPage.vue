<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ConfirmChanges from '../../../renderer/components/ConfirmChanges.vue';
import EmptyState from '../../../renderer/components/EmptyState.vue';
import NotOnThisPc from '../../../renderer/components/NotOnThisPc.vue';
import PageSkeleton from '../../../renderer/components/PageSkeleton.vue';
import { errorText, useClient } from '../../../renderer/ipc';
import { onMachineChanged } from '../../../renderer/machine';
import {
  nuclearOptionBindingsContract,
  type ChangeReview,
  type Overview,
  type OverviewBinding,
  type OverviewDevice,
  type Pressed,
} from '../contract';
import { canChange, shownBindings } from './rows';

/**
 * Nuclear Option's bindings as the game saved them, one device at a time. A button of a
 * controller can be bound, moved or cleared here: the change is shown first, and only Save
 * writes it (through FileStore: a backup, the Safety page, Undo).
 */
const api = useClient(nuclearOptionBindingsContract);
const route = useRoute();

const overview = ref<Overview>();
const error = ref('');
const selected = ref('');
const search = ref('');

const device = computed<OverviewDevice | undefined>(
  () => overview.value?.devices.find((d) => d.id === selected.value) ?? overview.value?.devices[0]
);
const rows = computed(() =>
  device.value ? shownBindings(device.value.bindings, search.value) : []
);
const buttonActions = computed(() => new Set((overview.value?.actions ?? []).map((a) => a.id)));

/** The controller a link asked for (`?guid=`), when it is one the game has bindings for. */
function fromLink(view: Overview): string | undefined {
  const guid = typeof route.query.guid === 'string' ? route.query.guid.toUpperCase() : '';
  return guid ? view.devices.find((d) => d.guid?.toUpperCase() === guid)?.id : undefined;
}

async function load(): Promise<void> {
  const result = await api.overview();
  if (!result.ok) {
    error.value = errorText(result.error);
    return;
  }
  error.value = '';
  overview.value = result.value;
  const still = result.value.devices.some((d) => d.id === selected.value);
  if (!still) selected.value = fromLink(result.value) ?? result.value.devices[0]?.id ?? '';
}

let off: (() => void) | undefined;
onMounted(() => {
  void load();
  off = onMachineChanged(() => void load());
});
onBeforeUnmount(() => off?.());
watch(
  () => route.query.guid,
  () => {
    const wanted = overview.value ? fromLink(overview.value) : undefined;
    if (wanted) selected.value = wanted;
  }
);

const cheatSheet = computed(() => ({
  path: '/configure/cheat-sheets',
  query: { game: 'nuclear-option', aircraft: 'all' },
}));

const deviceIcon = (d: OverviewDevice): string =>
  d.kind === 'keyboard'
    ? 'mdi-keyboard-outline'
    : d.kind === 'mouse'
      ? 'mdi-mouse'
      : 'mdi-controller';

// ---- Changing one binding: the review first, and only its Save writes ----

interface Editing {
  /** The action; chosen in the dialog when it opens from "Bind an action". */
  actionId: number | null;
  /** The action was given by the row, so it is not asked for. */
  fromRow: boolean;
  /** The button, as typed; empty until one is. */
  button: string;
  clear: boolean;
}
const editing = ref<Editing>();
const review = ref<ChangeReview>();
const reviewError = ref('');
const saving = ref(false);
const savedMessage = ref('');
/** Counts the reviews asked for: an answer to an earlier one is not shown. */
let reviewTurn = 0;

const wantedButton = computed<number | null | undefined>(() => {
  const e = editing.value;
  if (!e) return undefined;
  if (e.clear) return null;
  const n = Number(e.button);
  return e.button.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 128 ? n : undefined;
});
const buttonHint = computed(() => {
  const count = device.value?.controls?.buttons;
  return count
    ? `${listening.value ? 'Press the button on the controller, or type its number. ' : ''}This controller has buttons 1 to ${count}. The numbers are the ones on its cheat sheet.`
    : 'A number from 1 to 128: the one on the controller’s cheat sheet.';
});

async function refreshReview(): Promise<void> {
  const mine = ++reviewTurn;
  review.value = undefined;
  reviewError.value = '';
  const e = editing.value;
  const button = wantedButton.value;
  if (!e || !device.value || e.actionId === null || button === undefined) return;
  const result = await api.changePreview({ device: device.value.id, actionId: e.actionId, button });
  if (mine !== reviewTurn) return;
  if (result.ok) review.value = result.value;
  else reviewError.value = errorText(result.error);
}
watch(() => [editing.value?.actionId, editing.value?.button, editing.value?.clear], refreshReview);

// ---- The button can be pressed instead of typed, while the dialog asks for one ----

const listening = ref(false);
/** A press on another controller than the one being changed, to say so. */
const elsewhere = ref('');
let offPressed: (() => void) | undefined;
/** Counts the starts and stops: an answer to a start that was cut short is dropped. */
let listens = 0;

function onPressed(press: Pressed): void {
  const e = editing.value;
  if (!e || e.clear || !device.value) return;
  if (press.device.toUpperCase() !== (device.value.guid ?? '').toUpperCase()) {
    elsewhere.value = `That was Button ${press.button} on ${press.deviceName}. This change is for ${device.value.name}.`;
    return;
  }
  elsewhere.value = '';
  e.button = String(press.button);
}

async function startListening(): Promise<void> {
  const mine = ++listens;
  elsewhere.value = '';
  // Only a plugged-in controller can be pressed; the number can always be typed.
  if (!device.value?.connected) return;
  offPressed?.();
  offPressed = api.on('pressed', onPressed);
  const started = await api.listenStart();
  if (mine !== listens) return;
  listening.value = started.ok && started.value.listening;
  if (!listening.value) {
    offPressed?.();
    offPressed = undefined;
  }
}

async function stopListening(): Promise<void> {
  listens++;
  offPressed?.();
  offPressed = undefined;
  elsewhere.value = '';
  if (!listening.value) return;
  listening.value = false;
  await api.listenStop();
}
onBeforeUnmount(() => void stopListening());

function startChange(binding: OverviewBinding): void {
  savedMessage.value = '';
  editing.value = { actionId: Number(binding.actionId), fromRow: true, button: '', clear: false };
  void startListening();
}
function startClear(binding: OverviewBinding): void {
  savedMessage.value = '';
  editing.value = { actionId: Number(binding.actionId), fromRow: true, button: '', clear: true };
}
function startBind(): void {
  savedMessage.value = '';
  editing.value = { actionId: null, fromRow: false, button: '', clear: false };
  void startListening();
}
function closeEdit(): void {
  void stopListening();
  reviewTurn++;
  editing.value = undefined;
  review.value = undefined;
  reviewError.value = '';
}

async function save(): Promise<void> {
  const e = editing.value;
  const button = wantedButton.value;
  if (!e || !device.value || e.actionId === null || button === undefined || !review.value) return;
  saving.value = true;
  const result = await api.change({
    device: device.value.id,
    actionId: e.actionId,
    button,
    seen: review.value.seen,
  });
  saving.value = false;
  if (!result.ok) {
    reviewError.value = errorText(result.error);
    return;
  }
  savedMessage.value = result.value.message;
  closeEdit();
  await load();
}

const editTitle = computed(() => {
  const e = editing.value;
  if (!e) return '';
  const name = overview.value?.actions.find((a) => a.id === e.actionId)?.name;
  if (e.clear) return `Clear ${name ?? 'this binding'}?`;
  return name ? `Bind ${name} to a button?` : 'Bind an action to a button?';
});
</script>

<template>
  <div class="rr-page" data-testid="nuclear-option-bindings-page">
    <div class="nb-head">
      <div>
        <h1 class="rr-page-title">Nuclear Option bindings</h1>
        <p class="rr-page-sub">
          What each button, axis and key does in Nuclear Option, as the game saved it. One set of
          bindings serves every aircraft.
        </p>
      </div>
      <v-spacer />
      <v-btn
        v-if="overview?.saved"
        variant="text"
        prepend-icon="mdi-card-text-outline"
        :to="cheatSheet"
        data-testid="nuclear-option-bindings-cheat-sheet"
        >Cheat sheet</v-btn
      >
      <v-btn
        variant="text"
        prepend-icon="mdi-information-outline"
        to="/configure/games/nuclear-option"
        data-testid="nuclear-option-bindings-game-link"
        >Install and files</v-btn
      >
    </div>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      data-testid="nuclear-option-bindings-error"
      >{{ error }}</v-alert
    >
    <PageSkeleton v-if="!overview && !error" label="Reading Nuclear Option’s bindings…" />

    <template v-if="overview">
      <NotOnThisPc
        v-if="!overview.installed && !overview.saved"
        name="Nuclear Option"
        :looked="['every Steam library', 'the settings the game saves in the Windows registry']"
        game-page="/configure/games/nuclear-option"
      />
      <EmptyState
        v-else-if="!overview.saved"
        art="file"
        title="Nuclear Option has saved no bindings yet"
        data-testid="nuclear-option-bindings-empty"
      >
        The game saves its bindings the first time it runs. Start it once, then come back.
        <template #action>
          <v-btn variant="tonal" to="/configure/games/nuclear-option">Open Nuclear Option</v-btn>
        </template>
      </EmptyState>

      <template v-else>
        <v-alert
          v-for="problem in overview.problems"
          :key="problem"
          type="warning"
          variant="tonal"
          class="mb-4"
          data-testid="nuclear-option-bindings-problem"
          >{{ problem }}</v-alert
        >
        <v-alert
          v-if="savedMessage"
          type="success"
          variant="tonal"
          class="mb-4"
          closable
          data-testid="nuclear-option-bindings-saved"
          @click:close="savedMessage = ''"
          >{{ savedMessage }}</v-alert
        >

        <div class="rr-panel nb-note" data-testid="nuclear-option-bindings-note">
          <v-icon icon="mdi-pencil-outline" class="rr-muted" />
          <div>
            You can bind a controller’s button to an action here, move it or clear it. RigReady
            shows what will change and writes nothing until you press Save; it backs the saved
            bindings up first, and Undo is on the
            <router-link to="/configure/safety">Safety page</router-link>. An axis, a key or a mouse
            button is bound in the game, under Settings, then Controls. The bindings are in
            <span class="rr-mono">{{ overview.registryKey }}</span>.
          </div>
        </div>

        <div class="nb-devices" role="tablist" aria-label="Devices">
          <v-btn
            v-for="d in overview.devices"
            :key="d.id"
            role="tab"
            :aria-selected="d.id === device?.id"
            :variant="d.id === device?.id ? 'tonal' : 'text'"
            :prepend-icon="deviceIcon(d)"
            class="nb-device"
            data-testid="nuclear-option-bindings-device"
            :data-device="d.name"
            @click="selected = d.id"
          >
            {{ d.name }}
            <span class="nb-count rr-muted">{{ d.bindings.length }}</span>
          </v-btn>
        </div>

        <template v-if="device">
          <div class="nb-device-head">
            <h2 class="rr-section-title" data-testid="nuclear-option-bindings-device-title">
              {{ device.name }}
            </h2>
            <span
              v-if="device.kind === 'controller'"
              class="nb-state"
              :class="device.connected ? 'rr-ok' : 'rr-muted'"
              data-testid="nuclear-option-bindings-device-state"
            >
              <v-icon
                :icon="device.connected ? 'mdi-check-circle-outline' : 'mdi-power-plug-off-outline'"
                size="small"
              />
              {{ device.connected ? 'Plugged in' : 'Not plugged in' }}
            </span>
            <v-spacer />
            <v-btn
              v-if="device.kind === 'controller'"
              variant="tonal"
              prepend-icon="mdi-plus"
              data-testid="nuclear-option-bindings-bind"
              @click="startBind"
              >Bind an action</v-btn
            >
            <v-text-field
              v-model="search"
              density="compact"
              variant="outlined"
              hide-details
              clearable
              prepend-inner-icon="mdi-magnify"
              label="Find an action or input"
              class="nb-search"
              data-testid="nuclear-option-bindings-search"
            />
          </div>

          <div
            v-if="device.kind === 'controller' && !device.connected"
            class="rr-muted nb-hint"
            data-testid="nuclear-option-bindings-unplugged"
          >
            This controller is not plugged in, so its axes are named in the usual order (X, Y, Z,
            then the rotations).
          </div>

          <div class="rr-panel">
            <table class="nb-table" data-testid="nuclear-option-bindings-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Group</th>
                  <th scope="col">Input</th>
                  <th scope="col">In the game</th>
                  <th v-if="device.kind === 'controller'" scope="col">
                    <span class="rr-sr-only">Change</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(b, i) in rows"
                  :key="`${b.actionId}-${b.input}-${b.mapCategory}-${i}`"
                  data-testid="nuclear-option-bindings-row"
                >
                  <td class="nb-action">{{ b.action }}</td>
                  <td class="rr-muted">
                    {{ b.category
                    }}<span v-if="b.mapCategory !== 'Game'"> · {{ b.mapCategory }}</span>
                  </td>
                  <td>
                    <span v-if="b.modifiers.length" class="rr-muted"
                      >{{ b.modifiers.join(' + ') }} + </span
                    >{{ b.inputLabel }}<span v-if="b.inverted" class="rr-muted"> · reversed</span>
                  </td>
                  <td class="rr-mono rr-muted">{{ b.input }}</td>
                  <td v-if="device.kind === 'controller'" class="nb-actions">
                    <template v-if="canChange(b, buttonActions)">
                      <v-btn
                        size="small"
                        variant="text"
                        :aria-label="`Change the button for ${b.action}`"
                        data-testid="nuclear-option-bindings-change"
                        @click="startChange(b)"
                        >Change</v-btn
                      >
                      <v-btn
                        size="small"
                        variant="text"
                        :aria-label="`Clear ${b.action}`"
                        data-testid="nuclear-option-bindings-clear"
                        @click="startClear(b)"
                        >Clear</v-btn
                      >
                    </template>
                  </td>
                </tr>
                <tr v-if="rows.length === 0">
                  <td
                    :colspan="device.kind === 'controller' ? 5 : 4"
                    class="rr-muted"
                    data-testid="nuclear-option-bindings-none"
                  >
                    {{
                      device.bindings.length === 0
                        ? 'Nothing is bound on this device.'
                        : 'Nothing bound on this device matches.'
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="device.kind === 'controller'" class="rr-muted nb-hint">
            The game counts a controller’s buttons from 0, so its “Button 4” is the fifth button,
            Button 5 here and on the cheat sheets.
          </p>
        </template>
      </template>
    </template>

    <ConfirmChanges
      :open="editing !== undefined"
      :title="editTitle"
      :confirm-text="editing?.clear ? 'Clear it' : 'Save'"
      :preview="review && !review.same ? review.preview : undefined"
      :error="reviewError"
      :busy="saving"
      :blocked="review?.blocked !== undefined"
      testid="nuclear-option-bindings-edit"
      @cancel="closeEdit"
      @confirm="save"
    >
      <template v-if="editing && device">
        <p class="mb-3">
          On <strong>{{ device.name }}</strong>, in what Nuclear Option saved. The game reads it the
          next time it starts.
        </p>
        <v-autocomplete
          v-if="!editing.fromRow"
          v-model="editing.actionId"
          :items="overview?.actions ?? []"
          item-title="name"
          item-value="id"
          label="Action"
          density="compact"
          variant="outlined"
          hide-details
          class="mb-3"
          data-testid="nuclear-option-bindings-edit-action"
        />
        <v-text-field
          v-if="!editing.clear"
          v-model="editing.button"
          label="Button number"
          type="number"
          min="1"
          max="128"
          density="compact"
          variant="outlined"
          :hint="buttonHint"
          persistent-hint
          autofocus
          class="mb-3"
          data-testid="nuclear-option-bindings-edit-button"
        />
        <div
          v-if="elsewhere"
          class="nb-also mb-3"
          data-testid="nuclear-option-bindings-edit-elsewhere"
        >
          <v-icon icon="mdi-information-outline" size="small" class="rr-muted" />
          <span>{{ elsewhere }}</span>
        </div>
        <div v-if="review" class="nb-review" data-testid="nuclear-option-bindings-edit-review">
          <div>
            <strong>{{ review.action }}</strong>: {{ review.before }}
            <v-icon icon="mdi-arrow-right" size="small" />
            {{ review.after }}
          </div>
          <div v-if="review.same" class="rr-muted">That is how it is now: nothing to save.</div>
          <div v-if="review.alsoOnButton.length" class="nb-also">
            <v-icon icon="mdi-alert-outline" size="small" class="rr-warn" />
            <span
              >That button already does {{ review.alsoOnButton.join(', ') }}. One press will do
              both.</span
            >
          </div>
          <div
            v-if="review.blocked"
            class="nb-also"
            data-testid="nuclear-option-bindings-edit-blocked"
          >
            <v-icon icon="mdi-alert-outline" size="small" class="rr-warn" />
            <span>{{ review.blocked }}</span>
          </div>
        </div>
      </template>
    </ConfirmChanges>
  </div>
</template>

<style scoped>
.nb-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 16px;
}
.nb-note {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.nb-devices {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
}
.nb-device {
  text-transform: none;
}
.nb-count {
  margin-left: 8px;
  font-size: var(--rr-text-xs);
}
.nb-device-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
.nb-state {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--rr-text-sm);
}
.nb-search {
  max-width: 320px;
}
.nb-hint {
  margin: 8px 0;
  font-size: var(--rr-text-sm);
}
.nb-table {
  width: 100%;
  border-collapse: collapse;
}
.nb-table th,
.nb-table td {
  text-align: left;
  padding: 8px 16px;
  border-bottom: 1px solid var(--rr-border);
}
.nb-table tbody tr:last-child td {
  border-bottom: 0;
}
.nb-table th {
  font-size: var(--rr-text-xs);
  color: var(--rr-text-2);
  font-weight: 600;
}
.nb-action {
  font-weight: 500;
}
.nb-actions {
  white-space: nowrap;
  text-align: right;
}
.nb-review {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}
.nb-also {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
</style>
